'use strict';

const { HttpError } = require('../../models/errors');
const { readPolicy, evaluateRules } = require('../risk');
const { nextOccurrence } = require('../workflows');
const { validProvenance } = require('../ai-provider');
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
async function assertActor(db, user, { admin = false } = {}) {
  const actor = (await db.query('SELECT id,role,auth_version FROM users WHERE id=$1', [user?.id])).rows[0];
  if (!actor) throw new HttpError(401, 'Sign in to continue.');
  if (user.auth_version !== undefined && actor.auth_version !== user.auth_version) throw new HttpError(409, 'Account security changed. Sign in again.');
  if (admin && actor.role !== 'admin') throw new HttpError(403, 'Administrator access is required.');
  return actor;
}

async function liquidity(db, user, { days = 30, now = Date.now } = {}) {
  await assertActor(db, user);
  days = horizon(days);
  const generated = now(), end = generated + days * DAY;
  return db.transaction(async client => {
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
    const held = (await client.query("SELECT count(*)::int AS count,COALESCE(sum(-t.amount_cents),0)::text AS cents FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.user_id=$1 AND t.status='pending_review' AND t.amount_cents<0", [user.id])).rows[0];
    return { title: `${days}-day business liquidity projection`, generatedAt: iso(generated), days,
      assumptions: ['Scenario based on current balances and active scheduled instructions, including overdue occurrences.', 'Assumes scheduled instructions settle in due order. Review, eligibility, cancellation and funds checks still apply.', 'No unscheduled income is predicted. Held payments are not reserved or deducted.'],
      accounts, occurrences: events, totalBalanceCents: amount(accounts.reduce((s,a) => s+a.balanceCents,0)), projectedTotalCents: amount(accounts.reduce((s,a) => s+a.projectedCents,0)),
      shortfalls: accounts.filter(a => a.minimumProjectedCents < 0).map(a => ({ accountId: a.id, name: a.name, shortageCents: -a.minimumProjectedCents, dueAt: a.firstShortfallAt })),
      heldPayments: { count: held.count, amountCents: amount(held.cents) }, actions: suggestions, evidence: accounts.map(a => ({ type: 'account', id: a.id, label: a.name })) };
  }, { isolation: 'REPEATABLE READ', readOnly: true });
}

async function investigation(db, user, { transactionId, now = Date.now } = {}) {
  await assertActor(db,user,{admin:true});
  if (typeof transactionId !== 'string' || !/^[A-Za-z0-9:_-]{1,150}$/.test(transactionId)) throw new HttpError(400,'Choose a transaction to investigate.');
  return db.transaction(async client => {
    const row = (await client.query('SELECT t.*,a.user_id,a.number,b.legal_name FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN businesses b ON b.id=a.business_id WHERE t.id=$1', [transactionId])).rows[0];
    if (!row || Number(row.amount_cents) >= 0) throw new HttpError(404,'Outgoing transaction not found.');
    const assessment = (await client.query('SELECT id,input_json,result_json,policy_version FROM fraud_assessments WHERE id=$1', [transactionId])).rows[0];
    const prior = (await client.query(`SELECT count(*)::int AS count,COALESCE(avg(-amount_cents),0)::text AS average,
      count(*) FILTER (WHERE payee=$3)::int AS same_payee,COALESCE(max(-amount_cents),0)::text AS maximum
      FROM transactions WHERE account_id=$1 AND amount_cents<0 AND status='completed' AND completed_at<$2 AND id<>$4`, [row.account_id,row.requested_at,row.payee,row.id])).rows[0];
    const risk = row.risk_json || assessment?.result_json;
    const reasons = (risk?.reasons || []).map(r => typeof r === 'string' ? r : r.message).filter(Boolean);
    const average = Math.round(Number(prior.average));
    return { title: 'Fraud investigation brief', generatedAt: iso(now()), transaction: { id: row.id, accountSuffix: row.number.slice(-4), business: row.legal_name || 'Business profile required', amountCents: -amount(row.amount_cents), status: row.status, requestedAt: iso(row.requested_at), counterparty: row.counterparty },
      assessment: { available: Boolean(risk), modelScore: risk?.modelScore ?? null, combinedScore: risk?.score ?? null, scoreScale:100, decision: risk?.decision || 'unavailable', modelVersion: risk?.modelVersion || null, policyVersion: risk?.currentRuleVersion || risk?.ruleVersion || (assessment ? Number(assessment.policy_version) : null), initialPolicyVersion: assessment ? Number(assessment.policy_version) : null, reasons },
      history: { priorCompletedOutgoing: prior.count, averageCents: average, maximumCents: amount(prior.maximum), samePayeeCount: prior.same_payee, amountMultiple: average > 0 ? Number((-Number(row.amount_cents)/average).toFixed(2)) : null },
      findings: [...reasons, ...(prior.same_payee === 0 ? ['No earlier completed outgoing payment to this payee was found on the source account.'] : []), ...(!prior.count ? ['Insufficient completed history for a reliable behavioral comparison.'] : [])],
      nextSteps: ['Verify the business purpose and recipient through an independent channel.', 'Inspect the linked receipt and evidence before making a bank review decision.', 'Use the existing independent review screen; this brief does not approve, reject or prove fraud.'],
      limitations: ['Historical comparison uses payments completed before the requested time; explanations are evidence summaries, not a fraud verdict.', 'Current AI scoring is qualitative without validated fraud accuracy. Historical assessments retain their recorded provider and missing scores remain unavailable.'],
      evidence: [{ type:'transaction',id:row.id,label:'Payment receipt' }, ...(assessment ? [{type:'assessment',id:assessment.id,label:'Recorded assessment and input snapshot'}] : [])], actions: [] };
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
    const policy=await readPolicy(client), rule=policy.rules.find(r=>r.id===ruleId);
    if (!rule) throw new HttpError(400,'Choose a supported fraud rule.');
    const candidate=candidateRule(rule,patch), proposed=policy.rules.map(r=>r.id===ruleId?candidate:r);
    const rows=(await client.query('SELECT id,input_json,result_json,created_at FROM fraud_assessments WHERE created_at>=$1 AND created_at<=$2 ORDER BY created_at DESC,id LIMIT 1001',[iso(now()-days*DAY),iso(now())])).rows;
    const truncated=rows.length>1000, sample=rows.slice(0,1000), before={allow:0,review:0,block:0},after={allow:0,review:0,block:0}, changes=[];
    const decide=(rules,input,result)=>{const matches=evaluateRules(rules,input); return matches.some(r=>r.action==='block')?'block':matches.length || result.modelScore>=65?'review':'allow';};
    let skipped=0;
    for(const row of sample){
      // Archived providers remain readable, but only verified OpenAI scores enter current reports.
      const result=row.result_json;
      if(!validProvenance(result) || !Number.isInteger(result.modelScore) || result.modelScore<0 || result.modelScore>94){skipped++;continue;}
      const initial=decide(policy.rules,row.input_json,row.result_json), next=decide(proposed,row.input_json,row.result_json);
      before[initial]++;after[next]++;
      if(initial!==next)changes.push({assessmentId:row.id,before:initial,after:next,amountCents:row.input_json.amountCents});
    }
    return {title:'Historical fraud rule impact analysis',generatedAt:iso(now()),days,policyVersion:policy.version,rule:rule,candidate,assessed:sample.length-skipped,skipped,truncated,before,after,changed:changes.length,changes:changes.slice(0,100),actions:[],
      interpretation:changes.length ? `The proposed rule changes ${changes.length} sampled decisions. Review the affected cases before applying it.` : 'No sampled decision changes. This does not establish that the proposed rule is safe.',
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
      findings:[discrepancies.length?`${discrepancies.length} account balance discrepancies require investigation.`:'Every inspected balance matches its opening funds plus completed ledger entries.',`${schedules.length} sampled schedule exceptions and ${outbox.length} sampled notification exceptions found.`],
      nextSteps:['Inspect the linked account or instruction and its audit history.','Resolve operational causes through existing authorized workflows. This report never rewrites balances, ledger entries or schedules.'],
      evidence:[...discrepancies.map(a=>({type:'account',id:a.accountId,label:'Balance discrepancy'})),...failedSchedules.map(s=>({type:'schedule',id:s.id,label:'Schedule exception'}))],actions:[]};
  },{isolation:'REPEATABLE READ',readOnly:true});
}
module.exports={liquidity,investigation,simulation,reconciliation,assertActor,candidateRule,horizon};
