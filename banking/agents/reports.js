'use strict';

const { HttpError } = require('../../models/errors');
const { readPolicy, evaluateRules, validateInput, sameBinding } = require('../risk');
const { nextOccurrence } = require('../workflows');
const { validProvenance } = require('../ai-provider');
const {projectionWarnings}=require('./funds');
const DAY = 86400000;
const iso = value => new Date(value).toISOString();
const amount = value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new HttpError(413, 'This report exceeds the supported numeric range.');
  return number;
};
function horizon(value = 30) {
  if (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 90) throw new HttpError(400, 'Choose a horizon from 1 to 90 days.');
  return Number(value);
}
// Projection scope comes from the customer's question, not a model-selected
// replacement period. Keep the rolling-day convention used by the report.
function requestedHorizon(message){
  const periods=[...message.matchAll(/(?<![\w.])([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(days?|weeks?|months?)\b/gi)];
  if(periods.length>1)throw new HttpError(400,'Choose a single projection period from 1 to 90 days.');
  if(periods.length){
    const [,count,unit]=periods[0];
    if(!/^\d+$/.test(count))throw new HttpError(400,'Choose a whole-number projection period from 1 to 90 days.');
    return horizon(Number(count)*(unit.toLowerCase().startsWith('week')?7:unit.toLowerCase().startsWith('month')?30:1));
  }
  if(/\bnext week\b/i.test(message))return 7;
  if(/\bnext month\b/i.test(message))return 30;
  return undefined;
}
async function assertActor(db, user, { admin = false } = {}) {
  const actor = (await db.query('SELECT id,role,auth_version FROM users WHERE id=$1', [user?.id])).rows[0];
  if (!actor) throw new HttpError(401, 'Sign in to continue.');
  if (user.auth_version !== undefined && actor.auth_version !== user.auth_version) throw new HttpError(409, 'Account security changed. Sign in again.');
  if (admin && actor.role !== 'admin') throw new HttpError(403, 'Administrator access is required.');
  return actor;
}

async function liquidity(db, user, { days = 30, now = Date.now, snapshotClient = null } = {}) {
  await assertActor(snapshotClient || db, user);
  days = horizon(days);
  const generated = now(), end = generated + days * DAY;
  const read=async client => {
    const owned = (await client.query("SELECT a.*,b.status AS business_status FROM accounts a LEFT JOIN businesses b ON b.id=a.business_id WHERE a.user_id=$1 AND a.status='active' ORDER BY a.id", [user.id])).rows;
    const accountMap = new Map(owned.map(a => [String(a.id), { id: String(a.id), name: a.name, number: a.number, balanceCents: amount(a.balance_cents), projectedCents: amount(a.balance_cents), minimumProjectedCents: amount(a.balance_cents), firstShortfallAt: null }]));
    const schedules = (await client.query("SELECT * FROM scheduled_payments WHERE user_id=$1 AND status='active' AND next_run_at<=$2 ORDER BY next_run_at,id LIMIT 501", [user.id, iso(end)])).rows;
    if (schedules.length > 500) throw new HttpError(413, 'Choose a shorter horizon: too many schedules.');
    const events = [];
    for (const schedule of schedules) {
      let due = new Date(schedule.next_run_at), count = 0;
      while (due.getTime() <= end) {
        if (++count > 100 || events.length >= 1000) throw new HttpError(413, 'Choose a shorter horizon: too many occurrences.');
        const source = accountMap.get(String(schedule.payload_json.fromId));
        const target = schedule.type === 'transfer' ? [...accountMap.values()].find(a => a.number === schedule.payload_json.number) : null;
        events.push({ scheduleId: schedule.id, dueAt: iso(due), amountCents: amount(schedule.amount_cents), fromAccountId: source?.id || String(schedule.payload_json.fromId), toOwnedAccountId: target?.id || null, frequency: schedule.frequency, overdue: due.getTime() < generated });
        const next = nextOccurrence({ ...schedule, next_run_at: due });
        if (!next) break;
        due = new Date(next);
      }
    }
    events.sort((a,b) => a.dueAt.localeCompare(b.dueAt) || a.scheduleId.localeCompare(b.scheduleId));
    for (const event of events) {
      const source = accountMap.get(event.fromAccountId), target = accountMap.get(event.toOwnedAccountId);
      if (source) {
        source.projectedCents = amount(source.projectedCents - event.amountCents);
        source.minimumProjectedCents = Math.min(source.minimumProjectedCents, source.projectedCents);
        if (source.projectedCents < 0 && !source.firstShortfallAt) source.firstShortfallAt = event.dueAt;
      }
      if (target) target.projectedCents = amount(target.projectedCents + event.amountCents);
    }
    const accounts = [...accountMap.values()];
    const eligible = owned.length && owned.every(a => a.business_status === 'approved');
    const available = new Map(accounts.map(a => [a.id, Math.max(0, Math.min(a.balanceCents, a.minimumProjectedCents))]));
    const suggestions = [];
    if (eligible) for (const recipient of accounts.filter(a => a.minimumProjectedCents < 0)) {
      let gap = -recipient.minimumProjectedCents;
      for (const donor of accounts.filter(a => a.id !== recipient.id)) {
        const cents = Math.min(gap, available.get(donor.id));
        if (cents <= 0) continue;
        suggestions.push({ type: 'draft_transfer', label: `Review liquidity transfer to ${recipient.name}`, draft: { fromAccountId: donor.id, toAccountNumber: recipient.number, amount: (cents / 100).toFixed(2), description: 'Liquidity planning draft' }, suggestedBefore: recipient.firstShortfallAt });
        available.set(donor.id, available.get(donor.id) - cents); gap -= cents;
        if (!gap) break;
      }
    }
    const shortfalls=accounts.filter(a => a.minimumProjectedCents < 0).map(a => ({ accountId:a.id,name:a.name,shortageCents:-a.minimumProjectedCents,dueAt:a.firstShortfallAt }));
    const held = (await client.query("SELECT count(*)::int AS count,COALESCE(sum(-t.amount_cents),0)::text AS cents FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.user_id=$1 AND t.status='pending_review' AND t.amount_cents<0", [user.id])).rows[0];
    return { title: `${days}-day business liquidity projection`, generatedAt: iso(generated), days,
      assumptions: ['Scenario based on current balances and active scheduled instructions, including overdue occurrences.', 'Assumes scheduled instructions settle in due order. Review, eligibility, cancellation and funds checks still apply.', 'No unscheduled income is predicted. Held payments are not reserved or deducted.'],
      accounts, occurrences: events, totalBalanceCents: amount(accounts.reduce((s,a) => s+a.balanceCents,0)), projectedTotalCents: amount(accounts.reduce((s,a) => s+a.projectedCents,0)),
      shortfalls, fundingCheck:projectionWarnings({shortfalls,generatedAt:iso(generated),days,occurrenceCount:events.length}),
      heldPayments: { count: held.count, amountCents: amount(held.cents) }, actions: suggestions, evidence: accounts.map(a => ({ type: 'account', id: a.id, label: a.name })) };
  };
  return snapshotClient?read(snapshotClient):db.transaction(read,{isolation:'REPEATABLE READ',readOnly:true});
}
async function fundingCoverage(db,user,{now=Date.now,snapshotClient=null}={}){
  try{return (await liquidity(db,user,{now,snapshotClient})).fundingCheck;}
  catch(error){
    if(error.status!==413)throw error;
    const checkedAt=iso(now());
    return {available:false,checkedAt,days:30,warnings:[{code:'coverage_unavailable',title:'Scheduled funding could not be checked completely.',message:'The scheduled-payment scenario exceeds the supported planning limits. Ask for a shorter planning period before deciding whether funds are sufficient.',checkedAt}]};
  }
}
async function balances(db,user,{now=Date.now}={}){
  return db.transaction(async client=>{
    await assertActor(client,user);
    const accounts=(await client.query("SELECT id::text,name,number,balance_cents::text FROM accounts WHERE user_id=$1 AND status='active' ORDER BY id",[user.id])).rows.map(row=>({id:row.id,name:row.name,number:row.number,balanceCents:amount(row.balance_cents)}));
    return {accounts,fundingCheck:await fundingCoverage(db,user,{now,snapshotClient:client})};
  },{isolation:'REPEATABLE READ',readOnly:true});
}

async function investigation(db, user, { transactionId, now = Date.now } = {}) {
  await assertActor(db,user,{admin:true});
  if (typeof transactionId !== 'string' || !/^[A-Za-z0-9:_-]{1,150}$/.test(transactionId)) throw new HttpError(400,'Choose a transaction to investigate.');
  return db.transaction(async client => {
    const row = (await client.query('SELECT t.*,a.user_id,a.number,b.legal_name FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN businesses b ON b.id=a.business_id WHERE t.id=$1', [transactionId])).rows[0];
    if (!row || Number(row.amount_cents) >= 0) throw new HttpError(404,'Outgoing transaction not found.');
    const assessment = (await client.query('SELECT id,input_json,result_json,policy_version FROM fraud_assessments WHERE id=$1', [transactionId])).rows[0];
    const screening = (await client.query('SELECT id,evidence_json,created_at FROM fraud_screenings WHERE transaction_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [transactionId])).rows[0];
    const review = (await client.query(`SELECT c.*,u.name AS reviewer_name,s.evidence_json FROM fraud_cases c
      JOIN fraud_screenings s ON s.id=c.screening_id LEFT JOIN users u ON u.id=c.assigned_to WHERE c.transaction_id=$1`, [transactionId])).rows[0];
    const monitoring = screening ? { ...screening.evidence_json, available:true, screeningId:screening.id, recordedAt:iso(screening.created_at) } : { available:false };
    const humanReview = review ? { exists:true, id:review.id, status:review.status, open:review.status!=='closed', version:review.version,
      reviewer:review.reviewer_name || null, outcome:review.outcome, reason:review.review_reason, resolvedAt:review.resolved_at?iso(review.resolved_at):null,
      screeningId:review.screening_id, priorityScore:review.score, signals:review.evidence_json.signals || [] } : { exists:false, open:false, status:'none' };
    const prior = (await client.query(`SELECT count(*)::int AS count,COALESCE(avg(-amount_cents),0)::text AS average,
      count(*) FILTER (WHERE payee=$3)::int AS same_payee,COALESCE(max(-amount_cents),0)::text AS maximum
      FROM transactions WHERE account_id=$1 AND amount_cents<0 AND status='completed' AND completed_at<$2 AND id<>$4`, [row.account_id,row.requested_at,row.payee,row.id])).rows[0];
    const risk = row.risk_json || assessment?.result_json;
    const reasons = (risk?.reasons || []).map(r => typeof r === 'string' ? r : r.message).filter(Boolean);
    const average = Math.round(Number(prior.average));
    return { title: 'Fraud investigation brief', generatedAt: iso(now()), transaction: { id: row.id, accountSuffix: row.number.slice(-4), business: row.legal_name || 'Business profile required', amountCents: -amount(row.amount_cents), status: row.status, requestedAt: iso(row.requested_at), counterparty: row.counterparty },
      assessment: { available: Boolean(risk), modelScore: risk?.modelScore ?? null, combinedScore: risk?.score ?? null, scoreScale:100, decision: risk?.decision || 'unavailable', modelVersion: risk?.modelVersion || null, policyVersion: risk?.currentRuleVersion || risk?.ruleVersion || (assessment ? Number(assessment.policy_version) : null), initialPolicyVersion: assessment ? Number(assessment.policy_version) : null, reasons },
      monitoring, humanReview,
      history: { priorCompletedOutgoing: prior.count, averageCents: average, maximumCents: amount(prior.maximum), samePayeeCount: prior.same_payee, amountMultiple: average > 0 ? Number((-Number(row.amount_cents)/average).toFixed(2)) : null },
      findings: [...reasons, ...new Set([...(monitoring.signals || []), ...(monitoring.model?.reasons || [])].map(s=>'Latest monitoring: '+s.message)),
        ...(humanReview.exists && humanReview.screeningId!==screening?.id ? humanReview.signals.map(s=>'Saved investigation evidence: '+s.message) : []),
        ...(prior.same_payee === 0 ? ['No earlier completed outgoing payment to this payee was found on the source account.'] : []), ...(!prior.count ? ['Insufficient completed history for a reliable behavioral comparison.'] : [])],
      nextSteps: ['Verify the business purpose and recipient through an independent channel.', 'Inspect the linked receipt and evidence before making a bank review decision.', 'Use the existing independent review screen; this brief does not approve, reject or prove fraud.'],
      limitations: ['Historical comparison uses payments completed before the requested time; explanations are evidence summaries, not a fraud verdict.', 'Current AI scoring is qualitative without validated fraud accuracy. Historical assessments retain their recorded provider and missing scores remain unavailable.'],
      evidence: [{ type:'transaction',id:row.id,label:'Payment receipt' }, ...(assessment ? [{type:'assessment',id:assessment.id,label:'Original assessment and input snapshot'}] : []),
        ...(screening ? [{type:'screening',id:screening.id,label:'Latest saved monitoring findings'}] : []), ...(review ? [{type:'fraud_case',id:review.id,label:'Human investigation and recorded outcome'}] : [])], actions: [] };
  }, { isolation:'REPEATABLE READ',readOnly:true });
}

function candidateRule(rule, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !['threshold','enabled','action'].includes(k))) throw new HttpError(400,'Choose valid simulation changes.');
  const candidate = { ...rule, ...patch };
  const threshold = Number(candidate.threshold);
  if (!['number','string'].includes(typeof candidate.threshold) || !/^\d+(?:\.\d{1,2})?$/.test(String(candidate.threshold)) || !Number.isFinite(threshold) || threshold <= 0 || threshold > 90000000000 || (rule.id === 'velocity' && !Number.isSafeInteger(threshold)) || (rule.id === 'balance_utilization' && threshold > 100) || typeof candidate.enabled !== 'boolean' || !['review','block'].includes(candidate.action)) throw new HttpError(400,'Choose a valid simulation threshold, status and action.');
  return { ...candidate, threshold };
}
async function simulation(db, user, { ruleId, patch, days=30, now=Date.now }={}) {
  await assertActor(db,user,{admin:true}); days=horizon(days);
  return db.transaction(async client => {
    const key=typeof ruleId==='string'?ruleId.trim().toLowerCase().replace(/[\s-]+/g,'_'):null;
    const policy=await readPolicy(client), rule=policy.rules.find(r=>r.id===key);
    if (!rule) throw new HttpError(400,'Choose a supported fraud rule.');
    const candidate=candidateRule(rule,patch), proposed=policy.rules.map(r=>r.id===rule.id?candidate:r);
    const rows=(await client.query('SELECT id,input_json,result_json,created_at FROM fraud_assessments WHERE created_at>=$1 AND created_at<=$2 ORDER BY created_at DESC,id LIMIT 1001',[iso(now()-days*DAY),iso(now())])).rows;
    const truncated=rows.length>1000, inspected=rows.slice(0,1000), before={allow:0,review:0,block:0},after={allow:0,review:0,block:0}, changes=[];
    const decide=(rules,input,result)=>{const matches=evaluateRules(rules,input); return matches.some(r=>r.action==='block')?'block':matches.length || result.modelScore>=65?'review':'allow';};
    let skipped=0;
    for(const row of inspected){
      // Archived providers remain readable, but only verified OpenAI scores enter current reports.
      const result=row.result_json;
      if(!validProvenance(result) || !Number.isInteger(result.modelScore) || result.modelScore<0 || result.modelScore>94){skipped++;continue;}
      // A valid score cannot make a missing or mismatched input safe to replay.
      try { validateInput(row.input_json); } catch { skipped++;continue; }
      if(row.input_json.transactionId!==row.id || !sameBinding(result,row.input_json)){skipped++;continue;}
      const initial=decide(policy.rules,row.input_json,row.result_json), next=decide(proposed,row.input_json,row.result_json);
      before[initial]++;after[next]++;
      if(initial!==next)changes.push({assessmentId:row.id,before:initial,after:next,amountCents:row.input_json.amountCents});
    }
    return {title:'Historical fraud rule impact analysis',generatedAt:iso(now()),days,policyVersion:policy.version,rule:rule,candidate,assessed:inspected.length-skipped,skipped,truncated,before,after,changed:changes.length,changes:changes.slice(0,100),actions:[],
      interpretation:changes.length ? `The proposed rule changes ${changes.length} assessed decisions. Review the affected cases before applying it.` : 'No decisions change in the assessed records. This does not establish that the proposed rule is safe.',
      limitations:['Current and proposed policies are replayed against the same recorded input snapshots and original model scores.', 'This is a static historical comparison, not a counterfactual settlement simulation or a forecast.', 'No labeled fraud outcomes are available; false positives, recall and accuracy cannot be inferred.', 'Only the latest 1,000 assessments in the selected window are inspected. Live rules and money are unchanged.'],
      evidence:changes.slice(0,100).map(c=>({type:'assessment',id:c.assessmentId,label:'Changed historical assessment'}))};
  },{isolation:'REPEATABLE READ',readOnly:true});
}

async function reconciliation(db,user,{now=Date.now}={}) {
  const actor=await assertActor(db,user), staff=actor.role==='admin';
  return db.transaction(async client=>{
    const accounts=(await client.query(`SELECT a.id::text,a.name,a.balance_cents::text,(a.opening_balance_cents+COALESCE(sum(t.amount_cents) FILTER(WHERE t.status='completed'),0))::text AS ledger_cents FROM accounts a LEFT JOIN transactions t ON t.account_id=a.id ${staff?'':'WHERE a.user_id=$1'} GROUP BY a.id ORDER BY a.id`,staff?[]:[user.id])).rows;
    const discrepancies=accounts.filter(a=>BigInt(a.balance_cents)!==BigInt(a.ledger_cents)).map(a=>({accountId:a.id,name:a.name,storedCents:amount(a.balance_cents),ledgerCents:amount(a.ledger_cents),differenceCents:amount(BigInt(a.balance_cents)-BigInt(a.ledger_cents))}));
    const schedules=(await client.query(`SELECT id,user_id,status,last_status,last_error,next_run_at FROM scheduled_payments WHERE ${staff?'':'user_id=$1 AND '}(status='failed' OR last_status IN ('failed','retrying','awaiting_business_approval') OR (status='active' AND next_run_at<now()-interval '5 minutes')) ORDER BY created_at DESC LIMIT 101`,staff?[]:[user.id])).rows;
    const outbox=(await client.query(`SELECT id,status,attempts,created_at FROM notification_outbox WHERE ${staff?'':'user_id=$1 AND '}status<>'delivered' AND (attempts>0 OR created_at<now()-interval '5 minutes') ORDER BY created_at DESC LIMIT 101`,staff?[]:[user.id])).rows;
    const failedSchedules=schedules.slice(0,100).map(s=>({id:s.id,status:s.status,lastStatus:s.last_status,reason:s.last_error || 'An occurrence is overdue. Inspect its run history.',nextRunAt:s.next_run_at?iso(s.next_run_at):null}));
    return {title:'Reconciliation and exception investigation',generatedAt:iso(now()),scope:staff?'bank operations':'your business',accountsChecked:accounts.length,balanced:discrepancies.length===0,discrepancies,failedSchedules,notificationExceptions:outbox.slice(0,100).map(o=>({id:o.id,status:o.status,attempts:o.attempts,createdAt:iso(o.created_at)})),truncated:schedules.length>100||outbox.length>100,
      findings:[discrepancies.length?`${discrepancies.length} account balance discrepancies require investigation.`:'Every inspected balance matches its opening funds plus completed ledger entries.',`${schedules.length} schedule exceptions and ${outbox.length} notification exceptions found in the inspected records.`],
      nextSteps:['Inspect the linked account or instruction and its audit history.','Resolve operational causes through existing authorized workflows. This report never rewrites balances, ledger entries or schedules.'],
      evidence:[...discrepancies.map(a=>({type:'account',id:a.accountId,label:'Balance discrepancy'})),...failedSchedules.map(s=>({type:'schedule',id:s.id,label:'Schedule exception'}))],actions:[]};
  },{isolation:'REPEATABLE READ',readOnly:true});
}
function assistantItems(name,value){
  if(name==='investigate_transaction'){
    const score=number=>Number.isFinite(number)&&number>=0&&number<=100?number+' / 100':'Not recorded';
    return [
      {title:'Reviewed outgoing payment',amountCents:value.transaction.amountCents,status:value.transaction.status,date:value.transaction.requestedAt,detail:value.transaction.counterparty+'; receipt '+value.transaction.id},
      {title:'Recorded model risk score',value:score(value.assessment.modelScore),detail:value.assessment.modelVersion||'No recorded model identity'},
      {title:'Recorded combined risk score',value:score(value.assessment.combinedScore),detail:'Historical recorded assessment; no new score was calculated.'},
      {title:'Recorded decision',value:value.assessment.decision==='unavailable'?'Not recorded':value.assessment.decision,detail:'Original payment decision; subsequent monitoring and human review are separate.'},
      {title:'Latest monitoring analysis',value:value.monitoring?.available?'Recorded':'Not recorded',date:value.monitoring?.recordedAt},
      ...(value.monitoring?.available?[
        {title:'Latest monitoring AI score',value:score(value.monitoring.model?.score),detail:value.monitoring.model?.version||'No numeric AI reassessment was recorded.'},
        {title:'Latest monitoring result',value:value.monitoring.flagged?'Human review requested':'No additional signal',detail:'This saved check does not establish that a payment is safe.'},
      ]:[]),
      {title:'Human investigation status',value:value.humanReview?.status || 'none',detail:value.humanReview?.reviewer?'Reviewer: '+value.humanReview.reviewer:value.humanReview?.exists?'Unassigned':'No saved investigation case'},
      ...(value.humanReview?.exists?[
        {title:'Human investigation case',value:value.humanReview.id},
        ...(value.humanReview.outcome?[{title:'Recorded human outcome',value:value.humanReview.outcome,detail:value.humanReview.reason,date:value.humanReview.resolvedAt}]:[]),
      ]:[]),
      {title:'Earlier completed outgoing payments',value:String(value.history.priorCompletedOutgoing)},
      {title:'Earlier payments to this payee',value:String(value.history.samePayeeCount)},
      ...(value.history.priorCompletedOutgoing?[{title:'Earlier payment average',amountCents:value.history.averageCents},{title:'Earlier payment maximum',amountCents:value.history.maximumCents}]:[]),
      ...value.findings,
    ];
  }
  if(name==='get_related_payments')return [
    {title:'Earlier completed payments shown',value:String(value.payments.length),detail:'Up to 20 payments completed before the selected payment on the same source account.'},
    ...value.payments.map(payment=>({title:payment.description,amountCents:payment.amountCents,date:payment.completedAt,detail:payment.counterparty+'; receipt '+payment.id})),
  ];
  if(name==='simulate_rule')return [
    {title:'Rule preview period',value:value.days+' days',date:value.generatedAt},
    {title:'Eligible assessments',value:String(value.assessed),detail:value.assessed?'Recorded eligible snapshots only; this is not a fraud-accuracy measurement.':'No eligible snapshots; the effect of the proposed rule cannot be established.'},
    {title:'Skipped assessments',value:String(value.skipped),detail:'Archived or unverifiable assessments are excluded.'},
    {title:'Historical decisions changed',value:String(value.changed),detail:'Live policy and banking records are unchanged.'},
    {title:'Proposed rule threshold',...(value.rule.id==='high_value'?{amountCents:Math.round(value.candidate.threshold*100)}:{value:String(value.candidate.threshold)}),detail:value.rule.id},
    {title:'Proposed rule action',value:value.candidate.action,detail:value.candidate.enabled?'Enabled in this preview':'Disabled in this preview'},
    ...['allow','review','block'].map(decision=>({title:'Historical '+decision+' decisions',value:String(value.before[decision])+' → '+String(value.after[decision]),detail:'Current policy → proposed policy'})),
    ...(value.truncated?[{title:'Preview coverage limit',detail:'Only the latest 1,000 assessments were inspected.'}]:[]),
    ...value.changes.map(change=>({title:'Historical decision change',amountCents:change.amountCents,detail:change.assessmentId+'; '+change.before+' → '+change.after})),
  ];
  if(name==='reconcile_accounts')return [
    {title:'Accounts checked',value:String(value.accountsChecked),detail:value.scope},
    ...value.findings,
    ...value.discrepancies.map(row=>({title:'Account balance discrepancy: '+row.name,amountCents:row.differenceCents,detail:'Stored balance minus completed ledger balance; account '+row.accountId})),
    ...value.failedSchedules.map(row=>({title:'Schedule exception',status:row.status,date:row.nextRunAt,detail:row.id+'; '+row.reason})),
    ...value.notificationExceptions.map(row=>({title:'Notification exception',status:row.status,date:row.createdAt,detail:row.id+'; attempts '+row.attempts})),
  ];
  return value.items||value.findings||[];
}
module.exports={liquidity,balances,fundingCoverage,investigation,simulation,reconciliation,assertActor,candidateRule,horizon,requestedHorizon,assistantItems};
