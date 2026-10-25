'use strict';

const {HttpError}=require('../models/errors');
const iso=value=>new Date(value).toISOString();
const kinds=new Set(['agent','payment','monitoring','failure']);
async function actor(db,user){
  const row=(await db.query('SELECT id,role,auth_version FROM users WHERE id=$1',[user?.id])).rows[0];
  if(!row)throw new HttpError(401,'Sign in to view AI audit records.');
  if(user.auth_version!==undefined && user.auth_version!==row.auth_version)throw new HttpError(409,'Account security changed. Sign in again.');
  return row;
}
// Append only metadata: no prompts, raw chat, generated prose or hidden reasoning.
// Existing protected tables remain the authoritative evidence store.
async function record(db,event){
  if(!['agent','payment','monitoring'].includes(event.kind)||typeof event.subjectId!=='string'||event.subjectId.length>150)throw new Error('Invalid AI audit subject.');
  const metadata={schemaVersion:1,subjectKind:event.kind,subjectId:event.subjectId,provider:'ollama',localOnly:true,
    model:typeof event.model==='string'?event.model.slice(0,100):null,phase:event.phase,attempt:event.attempt || 1,
    status:event.status,executed:event.executed!==false,startedAt:event.startedAt,durationMs:Math.max(0,Math.round(event.durationMs || 0)),
    toolNames:(event.toolNames || []).filter(v=>typeof v==='string' && /^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(v)).slice(0,4),
    errorCode:event.errorCode || null,detectorVersion:event.detectorVersion || null};
  for(const field of ['modelSha256','promptSha256'])if(/^[a-f0-9]{64}$/.test(event[field] || ''))metadata[field]=event[field];
  await db.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata,created_at) VALUES($1,$2,'ai.model_call',$3,$4)",
    [event.actorId || null,event.userId,metadata,event.createdAt || new Date().toISOString()]);
}
const failureScope="((metadata->>'subjectKind'='agent' AND target_user_id=$1) OR (metadata->>'subjectKind'='payment' AND ($2 OR target_user_id=$1)) OR (metadata->>'subjectKind'='monitoring' AND $2))";
const union=[
  "SELECT 'agent'::text AS kind,id,user_id,created_at,COALESCE(report_json->>'title',replace(kind,'_',' ')) AS title,status,engine AS provider,report_json->'aiAudit'->>'model' AS model,NULL::integer AS score,NULL::text AS decision,id AS reference FROM agent_runs WHERE user_id=$1 AND created_at>=$3 AND created_at<=$4",
  "UNION ALL SELECT 'payment',f.id,f.user_id,f.created_at,'Payment risk assessment',CASE WHEN f.result_json IS NULL THEN 'incomplete' ELSE 'completed' END,COALESCE(f.result_json->>'provider','not_recorded'),f.result_json->>'modelName',CASE WHEN f.result_json->>'modelScore' ~ '^[0-9]{1,3}$' THEN (f.result_json->>'modelScore')::integer END,COALESCE(t.risk_json->>'decision',f.result_json->>'decision'),f.id FROM fraud_assessments f LEFT JOIN transactions t ON t.id=f.id WHERE ($2 OR f.user_id=$1) AND f.created_at>=$3 AND f.created_at<=$4",
  "UNION ALL SELECT 'monitoring',s.id,a.user_id,s.created_at,'Transaction monitoring','completed',COALESCE(s.evidence_json->'model'->>'provider','not_recorded'),s.evidence_json->'model'->>'modelName',CASE WHEN s.evidence_json->'model'->>'score' ~ '^[0-9]{1,3}$' THEN (s.evidence_json->'model'->>'score')::integer END,CASE WHEN s.evidence_json->>'flagged'='true' THEN 'flagged' ELSE 'unflagged' END,s.transaction_id FROM fraud_screenings s JOIN transactions t ON t.id=s.transaction_id JOIN accounts a ON a.id=t.account_id WHERE $2 AND s.created_at>=$3 AND s.created_at<=$4",
  "UNION ALL SELECT 'failure',id::text,target_user_id,created_at,'Model request failed','failed','ollama',metadata->>'model',NULL::integer,NULL::text,metadata->>'subjectId' FROM audit_log WHERE event_type='ai.model_call' AND metadata->>'status'='failed' AND "+failureScope+" AND created_at>=$3 AND created_at<=$4"
].join('\n');
function parameters(params,now){
  for(const key of params.keys())if(!['type','page','pageSize','days','q'].includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'Unsupported or duplicate AI audit filter.');
  const integer=(key,fallback,max)=>{const value=params.get(key);if(value===null||value==='')return fallback;if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)throw new HttpError(400,'Invalid AI audit pagination or period.');return Number(value);};
  const type=params.get('type') || 'all';if(type!=='all'&&!kinds.has(type))throw new HttpError(400,'Choose a supported AI audit record type.');
  const q=(params.get('q') || '').trim();if(q.length>150)throw new HttpError(400,'Use an audit search of at most 150 characters.');
  const days=integer('days',30,90),end=now();
  return {type,q,days,page:integer('page',1,10000),pageSize:integer('pageSize',20,100),from:iso(end-days*86400000),to:iso(end)};
}
async function list(db,user,params=new URLSearchParams(),{now=Date.now}={}){
  const p=parameters(params,now);
  return db.transaction(async client=>{
    const current=await actor(client,user),staff=current.role==='admin';
    const values=[current.id,staff,p.from,p.to,p.type,'%'+p.q.replace(/[\\%_]/g,v=>'\\'+v)+'%'];
    const cte='WITH records AS ('+union+"), filtered AS (SELECT * FROM records WHERE ($5='all' OR kind=$5) AND (id || ' ' || title || ' ' || COALESCE(reference,'')) ILIKE $6 ESCAPE '\\') ";
    const total=Number((await client.query(cte+'SELECT count(*) AS total FROM filtered',values)).rows[0].total);
    const rows=(await client.query(cte+'SELECT * FROM filtered ORDER BY created_at DESC,kind,id DESC LIMIT $7 OFFSET $8',[...values,p.pageSize,(p.page-1)*p.pageSize])).rows;
    return {entries:rows.map(r=>({kind:r.kind,id:r.id,title:r.title,status:r.status,provider:r.provider,model:r.model,score:r.score,decision:r.decision,reference:r.reference,createdAt:iso(r.created_at)})),
      pagination:{page:p.page,pageSize:p.pageSize,total,totalPages:Math.ceil(total/p.pageSize)},filters:{type:p.type,q:p.q,days:p.days},
      scope:staff?'Bank-wide payment and monitoring records; only your own assistant and insight runs.':'Only your own assistant, insight and outgoing-payment records.',
      explanation:'Recorded evidence, model request metadata and guardrail outcomes. Hidden model reasoning and raw chat prompts are not recorded.'};
  },{isolation:'REPEATABLE READ',readOnly:true});
}
async function detail(db,user,kind,id){
  if(!kinds.has(kind)||typeof id!=='string'||!/^[A-Za-z0-9:_-]{1,150}$/.test(id))throw new HttpError(400,'Choose a valid AI audit record.');
  return db.transaction(async client=>{
    const current=await actor(client,user),staff=current.role==='admin';let row,subjectId=id,subjectKind=kind,detector=null,evidence;
    if(kind==='agent'){
      row=(await client.query('SELECT id,kind,engine,status,report_json,error_code,created_at,completed_at FROM agent_runs WHERE id=$1 AND user_id=$2',[id,current.id])).rows[0];
      if(row){const tools=(await client.query('SELECT step,tool_name,arguments_json,result_json,created_at FROM agent_tool_calls WHERE run_id=$1 ORDER BY step',[id])).rows;
        evidence={task:row.kind,provider:row.engine,status:row.status,report:row.report_json,errorCode:row.error_code,
          tools:tools.map(t=>({step:t.step,tool:t.tool_name,arguments:t.arguments_json,result:t.result_json,createdAt:iso(t.created_at)})),
          guardrails:{narrative:row.report_json?.aiAudit?.outcome || (row.report_json?.narrativeWithheld?'withheld':row.status==='completed'?'historical_outcome':'not_completed'),reason:row.report_json?.aiAudit?.reason || row.report_json?.narrativeIssue || row.error_code || null},
          startedAt:iso(row.created_at),completedAt:row.completed_at?iso(row.completed_at):null};}
    }else if(kind==='payment'){
      row=(await client.query('SELECT f.*,t.status AS payment_status,t.risk_json AS payment_risk,t.review_json FROM fraud_assessments f LEFT JOIN transactions t ON t.id=f.id WHERE f.id=$1 AND ($2 OR f.user_id=$3)',[id,staff,current.id])).rows[0];
      if(row){const r=row.result_json,finalRisk=row.payment_risk || r,reasons=Array.isArray(finalRisk?.reasons)?finalRisk.reasons.filter(v=>v && typeof v==='object'):[];evidence={transactionId:id,paymentStatus:row.payment_status || 'No committed payment',inputSnapshot:row.input_json,policySnapshot:row.policy_json,assessment:r,paymentRisk:row.payment_risk || null,
        decisionSummary:finalRisk?{aiScore:finalRisk.modelScore,combinedScore:finalRisk.score,decision:finalRisk.decision,aiReasons:reasons.filter(v=>typeof v.code!=='string' || !v.code.startsWith('rule:')),ruleMatches:reasons.filter(v=>typeof v.code==='string' && v.code.startsWith('rule:'))}:null,
        guardrails:{initialDecision:r?.decision || null,paymentControlDecision:row.payment_risk?.decision || null,currentRuleVersion:row.payment_risk?.currentRuleVersion || null,recordedProvider:r?.provider || 'not_recorded',payloadBinding:r?['transactionId','userId','sourceAccountId','payloadHash','type','amountCents','payee','isInternal'].every(k=>r[k]===row.input_json[k]):null,scoreRecorded:Number.isInteger(r?.modelScore)},humanPaymentReview:row.review_json || null,
        modelInput:'Payment type, amount, available balance, historical aggregates, internal-payee flag, Singapore hour and grounded evidence codes. Identifiers, descriptions and credentials are omitted from the fraud prompt.',
        scoreMeaning:'The AI score is a qualitative indicator from 0 to 94. Scores at least 65 request human review; financial rules may independently hold or block a payment.'};}
    }else if(kind==='monitoring'){
      if(!staff)throw new HttpError(403,'Bank staff access is required for monitoring audit records.');
      row=(await client.query('SELECT * FROM fraud_screenings WHERE id=$1',[id])).rows[0];
      if(row){subjectId=row.transaction_id;detector=row.detector_version;const humanReview=(await client.query('SELECT id,status,assigned_to,outcome,review_reason,version,updated_at,resolved_at FROM fraud_cases WHERE transaction_id=$1',[subjectId])).rows[0] || null;evidence={transactionId:subjectId,detectorVersion:detector,analysis:row.evidence_json,humanReview,guardrails:{flagged:row.evidence_json.flagged,signals:row.evidence_json.signals,modelAvailable:Boolean(row.evidence_json.model)},limitations:row.evidence_json.limitations};}
    }else{
      row=(await client.query("SELECT id,created_at,metadata FROM audit_log WHERE id::text=$3 AND event_type='ai.model_call' AND metadata->>'status'='failed' AND "+failureScope,[current.id,staff,id])).rows[0];
      if(row)evidence={modelRequest:row.metadata,guardrails:{status:'failed',reason:row.metadata.errorCode},explanation:'No valid model result was accepted for this attempt. No success or risk score is invented.'};
    }
    if(!row)throw new HttpError(404,'AI audit record not found.');
    const calls=kind==='failure'?[{id:String(row.id),createdAt:iso(row.created_at),...row.metadata}]:(await client.query("SELECT id,created_at,metadata FROM audit_log WHERE event_type='ai.model_call' AND metadata->>'subjectKind'=$1 AND metadata->>'subjectId'=$2 AND ($3::text IS NULL OR metadata->>'detectorVersion'=$3) ORDER BY created_at,id LIMIT 101",[subjectKind,subjectId,detector])).rows.map(c=>({id:String(c.id),createdAt:iso(c.created_at),...c.metadata}));
    return {kind,id,createdAt:iso(row.created_at),evidence,modelCalls:calls.slice(0,100),modelCallsTruncated:calls.length>100,
      interpretation:'This is a trace of saved evidence and application checks, not a transcript of hidden model thoughts.',
      provenanceNote:calls.length?'Model call metadata was recorded when these requests ran.':'Detailed call timing was not recorded for this historical entry; existing saved evidence is shown without inventing a trace.'};
  },{isolation:'REPEATABLE READ',readOnly:true});
}
module.exports={record,list,detail};
