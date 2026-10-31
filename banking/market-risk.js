'use strict';
const {createHash}=require('node:crypto');
const {HttpError}=require('../models/errors');
const {assertActor}=require('./agents/reports');
const {topics,day}=require('./market-context');
const {recordFinding,bindingMatches}=require('./fraud-cases');
const iso=value=>new Date(value).toISOString();
const fraudIntent=message=>/\b(?:fraud(?:ulent)?|scam(?:s|med|ming)?|suspicious|risk(?:y)?)\b/i.test(message)
  && /\b(?:transactions?|payments?|transfers?|bills?|accounts?|activity)\b/i.test(message)
  && (/\b(?:check|detect|analy[sz]e|assess|screen|investigate|flag|review|find)\b/i.test(message)||/^\s*(?:is|are)\b/i.test(message));
function publicItems(context){
  const {alerts,fx,news}=context.sources;
  return [
    ...fx.records.map(r=>({title:r.pair,value:r.rate.toFixed(6)+' SGD',detail:'Previous fixing change: '+r.changePercent.toFixed(3)+'%; as of '+r.asOf+'; ECB reference data'})),
    ...alerts.records.slice(0,3).map(r=>({title:r.title,detail:'ScamShield alert; published '+r.publishedAt})),
    ...news.records.slice(0,2).map(r=>({title:r.title,detail:'ECB financial news; published '+r.publishedAt})),
    ...Object.entries(context.sources).filter(([,source])=>!source.available).map(([id])=>({title:id==='fx'?'Exchange-rate context unavailable':id==='alerts'?'Scam alerts unavailable':'Financial news unavailable',detail:'The official source is unavailable or stale. No current data was invented.'})),
  ];
}
function eligibleSignals(row,context){
  const risk=row.risk_json||{},history=bindingMatches(row.input_json,row)?row.input_json.historySummary:null,signals=[];
  if(['review','block'].includes(risk.decision)||Number.isInteger(risk.modelScore)&&risk.modelScore>=65)signals.push({code:'recorded_risk',message:'Recorded payment screening already identified substantial risk or an independent review requirement.',source:'recorded_screening'});
  if(history && (history.outgoingCount10m>=3 || history.historyCount>=5 && -Number(row.amount_cents)>=150000 && -Number(row.amount_cents)>=4*history.averageOutgoingCents))signals.push({code:'historical_pattern',message:'Recorded pre-payment history shows unusually rapid outgoing payments or a substantial increase over the earlier average.',source:'historical_pattern'});
  // Advisory topic overlap alone is insufficient: also require a substantial
  // payment to an unfamiliar recipient, using its bound historical snapshot.
  if(history && !row.internal && !history.knownPayee && -Number(row.amount_cents)>=10000 && context.sources.alerts.available){
    const paymentTopics=topics(row.description+' '+row.reference);
    for(const topic of paymentTopics){
      const advisory=context.sources.alerts.records.find(alert=>alert.topics.includes(topic));
      if(advisory)signals.push({code:'advisory_'+topic,message:'An unfamiliar-recipient payment has a '+topic+' description that overlaps a recent official scam advisory. Verify the purpose independently; a topic match is not proof of fraud.',source:'scamshield_context',advisory});
    }
  }
  return signals;
}
async function analyze(db,user,{transactionId,context,now=Date.now}={}){
  const actor=await assertActor(db,user);
  if(transactionId!==undefined && (typeof transactionId!=='string'||!/^[A-Za-z0-9:_-]{1,150}$/.test(transactionId)))throw new HttpError(400,'Choose a valid outgoing transaction ID.');
  return db.transaction(async client=>{
    const values=[iso(now()),transactionId||null],scope=actor.role==='admin'?'':' AND a.user_id=$3';if(scope)values.push(user.id);
    const rows=(await client.query("SELECT t.*,a.user_id,f.input_json FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN fraud_assessments f ON f.id=t.id WHERE t.amount_cents<0 AND t.type IN ('transfer','bill') AND t.requested_at<=$1 AND ($2::text IS NULL OR t.id=$2)"+scope+' ORDER BY t.created_at DESC,t.insert_seq DESC LIMIT 5',values)).rows;
    if(transactionId&&!rows.length)throw new HttpError(404,'Outgoing transaction not found.');
    const transactions=rows.map(row=>({id:row.id,description:row.description,amountCents:-Number(row.amount_cents),status:row.status,requestedAt:iso(row.requested_at),recordedDecision:row.risk_json?.decision||'unavailable',eligibleSignals:eligibleSignals(row,context).slice(0,3)}));
    return {title:'Daily market and scam-context review',context,transactions,scope:actor.role==='admin'?'Up to five outgoing bank payments':'Up to five of your outgoing payments',findings:transactions.length?['Public context is supplementary. Only supported payment-specific signals can be referred for human investigation.']:['No outgoing payments were found in the permitted scope.'],items:[...publicItems(context),...transactions.map(t=>({title:t.description,amountCents:t.amountCents,status:t.status,detail:t.eligibleSignals.length?'Payment-specific signals available for human review':'No supported review signal in this limited check; safety is not established.'}))],limitations:['This analysis does not change payment authorization, settlement, balances or the existing numeric fraud score.','A scam-advisory topic overlap is not a determination of criminal activity.','Daily FX/news changes alone never permit a review flag.']};
  },{isolation:'REPEATABLE READ',readOnly:true});
}
function receipt(current,actor,transactionId,saved={}){
  return {transactionId,reviewRequested:current.status!=='closed',alreadyReviewed:current.status==='closed',created:Boolean(saved.created),reopened:Boolean(saved.reopened),findings:[current.status==='closed'?'A human already closed this case; unchanged signals did not reopen it.':'Suspicious activity has been referred to the human fraud investigation queue.'],items:[{title:current.status==='closed'?'Case already reviewed':'Human review requested',detail:'The payment status and account balances are unchanged.'}],actions:actor.role==='admin'?[{type:'navigate',page:'fraud',label:'Open fraud monitoring'}]:[]};
}
async function flag(db,user,{transactionId,signalCode,analysis,runId,model,validateSession=async()=>{},now=Date.now}={}){
  const selected=analysis?.transactions?.find(t=>t.id===transactionId),selectedSignal=selected?.eligibleSignals.find(s=>s.code===signalCode);
  if(!selectedSignal || !Number.isFinite(Date.parse(analysis.context.fetchedAt)) || analysis.context.asOf!==day(now()) || now()-Date.parse(analysis.context.fetchedAt)>3600000 || Date.parse(analysis.context.fetchedAt)>now()+60000)throw new HttpError(409,'Retrieve fresh permitted transaction and daily context before requesting a review.');
  return db.transaction(async client=>{
    await validateSession();const actor=await assertActor(client,user);
    const values=[transactionId],scope=actor.role==='admin'?'':' AND a.user_id=$2';if(scope)values.push(user.id);
    const row=(await client.query('SELECT t.*,a.user_id,f.input_json FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN fraud_assessments f ON f.id=t.id WHERE t.id=$1'+scope,values)).rows[0];
    if(!row||Number(row.amount_cents)>=0)throw new HttpError(404,'Outgoing transaction not found.');
    const currentSignal=eligibleSignals(row,analysis.context).find(s=>s.code===signalCode);
    if(!currentSignal)throw new HttpError(409,'The payment evidence changed. Analyze it again before flagging.');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['fraud-case:'+transactionId]);
    const previous=(await client.query('SELECT id,status FROM fraud_cases WHERE transaction_id=$1 FOR UPDATE',[transactionId])).rows[0];
    if(previous?.status==='closed')return receipt(previous,actor,transactionId);
    const evidence={analyzedAt:iso(now()),detector:'assistant-market-v1',assessmentKind:'market_assisted_review',transactionId,amountCents:-Number(row.amount_cents),transactionStatusAtScan:row.status,flagged:true,score:null,scoreScale:100,
      signals:[{...currentSignal,code:'trend_'+currentSignal.code}],model:null,agent:{provider:'openai',modelName:model,runId,qualitative:true},dailyContext:analysis.context,original:row.risk_json||null,
      limitations:['The AI requested qualitative human review; it did not assign a new numeric fraud score.','Public market moves are not proof of fraud and did not change the payment decision.','Case decisions do not approve, reject, reverse or refund a payment.']};
    const digest=createHash('sha256').update(JSON.stringify(analysis.context.sources)).digest('hex');
    const saved=await recordFinding(client,row,evidence,'assistant-market-v1:'+analysis.context.asOf+':'+signalCode+':'+digest,{actor:user,now});
    await validateSession();await assertActor(client,user,{admin:actor.role==='admin'});
    const current=(await client.query('SELECT id,status FROM fraud_cases WHERE transaction_id=$1',[transactionId])).rows[0];
    return receipt(current,actor,transactionId,saved);
  });
}
module.exports={analyze,flag,publicItems,eligibleSignals,fraudIntent};
