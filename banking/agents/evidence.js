'use strict';

const DRAFT_INTENT = /^(?:please\s+)?(?:help me\s+)?(?:transfer|send|move|pay|schedule)\b|\b(?:create|prepare|draft|set up)\b.*\b(?:payment|transfer|schedule)\b/i;
const LABELS = { get_accounts: 'Owned account balances', get_schedules: 'Owned scheduled instructions', search_transactions: 'Owned transaction search', project_liquidity: 'Scheduled-payment liquidity scenario', investigate_transaction: 'Recorded payment risk assessment', get_related_payments: 'Earlier completed payments', simulate_rule: 'Historical rule comparison', reconcile_accounts: 'Ledger and operational checks', prepare_payment_draft: 'Payment form draft' };
function references(runId, results) {
  return results.map((result, i) => ({ id: `E${i + 1}`, runId, step: i + 1, tool: result.tool, label: LABELS[result.tool] || 'Banking evidence' }));
}
function narrativeIssue(reply, report, { results = [], evidence = [], requireCitations = false } = {}) {
  const plain = reply.replace(/[*_`]/g, '');
  if (/\b(?:I|we)\s+(?:have\s+)?(?:sent|executed|approved|rejected|cancelled|canceled|settled|debited|credited|changed the rule)\b|\b(?:payment|transfer|transaction|bill)\s+(?:has been|was|is now|successfully)\s+(?:sent|executed|approved|settled|paid|completed)\b/i.test(plain)) return 'An agent claimed an action outside its authority.';
  if (/\b(?:risk\s+|model\s+|combined\s+)?score\s*:?\s*\d+\s*(?:\/|out of)\s*(?!100\b)\d+/i.test(plain)) return 'Invalid risk-score scale.';
  const cited = [...plain.matchAll(/\[(E\d+)\]/g)].map(match => match[1]), valid = new Set(evidence.map(e => e.id));
  if (requireCitations && (!cited.length || cited.some(id => !valid.has(id)))) return 'The interpretation must cite evidence retrieved in this run.';
  let qualitative = plain.replace(/\[E\d+\]/g, '').replace(/^\s*\d+[.)]\s+/gm, '');
  if(!requireCitations)qualitative=qualitative.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '');
  if (/\d/.test(qualitative)) return 'Numerical AI claims must be read from authoritative tool facts instead.';
  if (/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/i.test(qualitative)) return 'Written numerical claims must be read from authoritative tool facts instead.';
  if (/\b(?:password|passcode|otp|pin|recovery code|api key|access token)\b/i.test(plain)) return 'Security credentials do not belong in agent interpretations.';
  if (/https?:\/\/|www\./i.test(plain)) return 'External destinations are not banking evidence.';
  const claims = plain.replace(/\b(?:does not|do not|cannot|can't|not a)\s+guarantee\b|\bnot\s+(?:guaranteed|(?:confirmed|proven)\s+fraud)\b/gi, '[qualified uncertainty]');
  if (/\b(?:definitely|certainly|proven|confirmed)\s+(?:fraud|fraudulent|safe|legitimate)|\b(?:no|zero)\s+(?:fraud|risk)\b|\bfraud[ -]free\b|\bguarantee(?:d|s)?\b/i.test(claims)) return 'The interpretation overstates what the evidence establishes.';
  if (/\bno evidence of (?:fraud|anomalies)|\bany potential (?:obligations|payments|bills)\b/i.test(plain)) return 'The interpretation exceeds the scope of the retrieved banking checks.';
  if (/\b(?:allowed|approved|cleared)\b.{0,80}\bbecause\b.{0,100}\b(?:no prior|no completed|lack of|limited|new recipient|new payee)\b/i.test(plain)) return 'Missing payment history is a limitation, not a reason for authorizing a payment.';
  const assessments = [report, ...results.map(r => r.value)].filter(Boolean).map(r => r.assessment).filter(Boolean);
  if (assessments.some(a => a.decision === 'allow') && /\b(?:high[ -]risk|flagged|blocked|held|rejected)\b/i.test(plain)) return 'The narrative conflicts with the recorded allow decision.';
  if (assessments.some(a => ['review', 'block'].includes(a.decision)) && /\b(?:approved|allowed|cleared|safe to (?:pay|send))\b/i.test(plain)) return 'The narrative conflicts with the recorded review or block decision.';
  const projections = [report, ...results.filter(r => r.tool === 'project_liquidity').map(r => r.value)].filter(r => Array.isArray(r?.shortfalls));
  if (projections.some(r => r.shortfalls.length > 0) && /\b(?:no shortfalls?|no funding gaps?|cover all|sufficient funds|enough (?:money|funds)|fully funded)\b/i.test(plain)) return 'The narrative conflicts with a projected funding shortfall.';
  const checks = [report, ...results.filter(r => r.tool === 'reconcile_accounts').map(r => r.value)].filter(r => Array.isArray(r?.discrepancies));
  if (checks.some(r => r.discrepancies.length || r.failedSchedules?.length) && /\b(?:no (?:issues|exceptions|discrepancies)|all (?:clear|balanced|reconciled)|everything (?:balances|reconciles))\b/i.test(plain)) return 'The narrative conflicts with recorded operational exceptions.';
  if (results.some(r => r.tool === 'prepare_payment_draft' && r.value.complete === false) && /\b(?:draft|payment form)\s+(?:is\s+)?ready\b/i.test(plain)) return 'Required draft details are still missing.';
  return null;
}
function relevanceIssue(message, results) {
  const tools = new Set(results.map(r => r.tool));
  const has = names => names.some(name => tools.has(name));
  if (/\b(?:balance|balances)\b/i.test(message) && !has(['get_accounts', 'project_liquidity', 'reconcile_accounts'])) return 'The requested balance evidence was not retrieved.';
  if (/\b(?:liquidity|cash.?flow|afford|shortfall|cover|projection)\b/i.test(message) && !has(['project_liquidity'])) return 'The requested liquidity scenario was not retrieved.';
  if (!DRAFT_INTENT.test(message) && /\b(?:scheduled|upcoming)\b/i.test(message) && !has(['get_schedules', 'project_liquidity'])) return 'The requested scheduled-payment evidence was not retrieved.';
  if (/\b(?:history|recent transactions|find.*transaction|search.*transaction)\b/i.test(message) && !has(['search_transactions'])) return 'The requested transaction evidence was not retrieved.';
  return null;
}
module.exports = { DRAFT_INTENT, references, narrativeIssue, relevanceIssue };
