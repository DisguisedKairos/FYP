'use strict';

const DRAFT_INTENT = /^(?!\s*(?:how|what|why|explain)\b)(?![\s\S]*\b(?:do not|don't|dont|never)\s+(?:(?:please|actually)\s+)?(?:prepare|create|draft|set up)\b)(?:(?:(?:please|can you|could you|would you|will you|help me|help us|I (?:want|need|would like) to|I'd like to)\s+)*(?:transfer|send|move|pay|schedule)\b|[\s\S]*\b(?:create|prepare|draft|set up)\b[\s\S]*\b(?:payment|transfer|schedule|bill)\b)/i;
const LABELS = { get_banking_context:'Sourced public banking background', analyze_news_insights:'Sourced public news implications and chat-only advisory flags', assess_counterparty_risk:'Owned company risk scenarios, recorded exposure and configured AI assessment', scan_counterparty_news:'Owned counterparties with sourced public sanctions/compliance and industry news', get_business_profile:'Owned business profile and activity', get_market_insights:'Sourced public market research', research_public_company:'Sourced public company research', check_payment_funds:'Owned source-account payment funding check', get_finance_report:'Current owned finance activity snapshot', list_saved_dashboards:'Owned saved dashboard definitions', open_saved_dashboard:'Refreshed owned company dashboard', save_company_dashboard: 'Private saved dashboard receipt', get_company_activity: 'Owned company transaction activity', get_daily_market_context: 'Dated official public market and scam context', analyze_market_transactions: 'Permitted payments with market and scam context', flag_transaction_for_review: 'Human investigation request', get_accounts: 'Owned account balances', get_schedules: 'Owned scheduled instructions', search_transactions: 'Owned transaction search', project_liquidity: 'Scheduled-payment liquidity scenario', investigate_transaction: 'Recorded payment risk assessment', get_related_payments: 'Earlier completed payments', simulate_rule: 'Historical rule comparison', reconcile_accounts: 'Ledger and operational checks', prepare_payment_draft: 'Payment form draft' };
function references(runId, results) {
  return results.map((result, i) => ({ id: `E${i + 1}`, runId, step: i + 1, tool: result.tool, label: LABELS[result.tool] || 'Banking evidence' }));
}
function narrativeIssue(reply, report, { results = [], evidence = [], requireCitations = false } = {}) {
  const plain = reply.replace(/[*_`]/g, '').replace(/[\u2018\u2019]/g, "'");
  const preview=results.find(r=>r.tool==='simulate_rule')?.value;
  if(preview?.assessed===0&&!/\b(?:no eligible|no (?:valid |recorded |eligible )?assessments|insufficient (?:eligible )?(?:history|data|coverage)|not enough (?:eligible )?(?:history|data|assessments))\b/i.test(plain))return 'There are no eligible assessments in the rule preview; explicitly state insufficient coverage instead of implying measured rule impact.';
  const executionClaims=plain.replace(/\bno\s+(?:payment|transfer|transaction|bill)\s+(?:has been|was|is now|successfully)\s+(?:sent|executed|approved|settled|paid|completed)\b(?=\s*(?:[.!?;,]|\[E\d+\]|$))/gi,'[no execution]');
  if (/\b(?:I|we)\s+(?:have\s+)?(?:sent|executed|approved|rejected|cancelled|canceled|settled|debited|credited|changed the rule)\b|\b(?:payment|transfer|transaction|bill)\s+(?:has been|was|is now|successfully)\s+(?:sent|executed|approved|settled|paid|completed)\b/i.test(executionClaims)) return 'An agent claimed an action outside its authority.';
  if (/\b(?:risk\s+|model\s+|combined\s+)?score\s*:?\s*\d+\s*(?:\/|out of)\s*(?!100\b)\d+/i.test(plain)) return 'Invalid risk-score scale.';
  const cited = [...plain.matchAll(/\[(E\d+)\]/g)].map(match => match[1]), valid = new Set(evidence.map(e => e.id));
  if (requireCitations && (!cited.length || cited.some(id => !valid.has(id)))) return 'The interpretation must cite evidence retrieved in this run.';
  let qualitative = plain.replace(/\[E\d+\]/g, '').replace(/^\s*\d+[.)]\s+/gm, '');
  if(!requireCitations)qualitative=qualitative.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '');
  if (/\d/.test(qualitative)) return 'Numerical AI claims must be read from authoritative tool facts instead.';
  // An imperative choice or interrogative pronoun is not a numerical bank fact.
  // Keep quantities elsewhere (including later in the same sentence) screened.
  const quantities=qualitative.replace(/\b(?:(?:choose|select|pick|specify|provide|give|name|use)\s+(?:just\s+)?one|(?:which|each) one)\b/gi,'[choice]');
  if (/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/i.test(quantities)) return 'Written numerical claims must be read from authoritative tool facts instead.';
  if (/\b(?:password|passcode|otp|pin|recovery code|api key|access token)\b/i.test(plain)) return 'Security credentials do not belong in agent interpretations.';
  const clearanceClaims=plain.replace(/\b(?:I|we)\s+(?:cannot|can't|can not)\s+(?:certify|confirm|establish|guarantee|determine|conclude)\s+(?:(?:compliance|sanctions clearance)\s+or\s+)?(?:that\s+)?(?:a|the|this|that|these|those)\s+compan(?:y|ies)\s+(?:is|are)\s+(?:(?:fully compliant|compliant|not sanctioned|sanctions[- ]free|cleared|safe to pay)(?:\s+(?:or|and)\s+)?)+/gi,'[unverified clearance]');
  if(results.some(r=>['scan_counterparty_news','assess_counterparty_risk'].includes(r.tool))&&/\b(?:sanctions[- ]free|(?:is|are) (?:fully compliant|not sanctioned|cleared)|no (?:sanctions|compliance) issues|safe to (?:pay|deal|transact))\b/i.test(clearanceClaims))return 'Name-based public research cannot establish sanctions clearance or permission to pay.';
  if (/https?:\/\/|www\./i.test(plain)) return 'External destinations are not banking evidence.';
  const claims = plain
    .replace(/\b(?:none|no company|no payment|no transaction)\s+can\s+be\s+(?:called|considered)\s+(?:definitely|certainly)\s+safe\b/gi,'[qualified uncertainty]')
    .replace(/\b(?:no\s+(?:company|payment|transaction)\s+(?:is|has been)|none\s+(?:is|are))\s+(?:definitely|certainly|proven|confirmed)\s+safe\b/gi,'[qualified uncertainty]')
    .replace(/\b(?:does not|do not|cannot|can't)\s+(?:provide|establish|determine|calculate)\s+(?:(?:exact|reliable|calibrated|supported)\s+)*(?:fraud\s+probabilit(?:y|ies)|probabilit(?:y|ies)\s+of\s+fraud)\s*(?:,\s*|\s+or\s+)guaranteed[ -](?:money[ -])?loss(?:es)?(?:[ -]estimates?)?(?:\s+for\s+(?:these|those|the|any)\s+(?:flagged\s+)?compan(?:y|ies))?(?=\s*(?:[.!?;]|\[E\d+\]|$|,\s+(?:or|and)\b))/gi,'[qualified uncertainty]')
    .replace(/\bdoes not establish\s+(?:fraud\s+or\s+)?guaranteed[ -]loss(?:es)?\b/gi,'[qualified uncertainty]')
    .replace(/\b(?:cannot|can't|can not)\s+(?:provide (?:a )?live stock (?:price|quote)\s+or\s+)?guarantee(?: that)?\s+(?:(?:a|any|this|the)\s+(?:payment|transaction)|it)\s+(?:is\s+)?fraud[ -]free(?=\s*(?:[.!?;]|\[E\d+\]|$))/gi,'[qualified uncertainty]')
    .replace(/\b(?:does not|do not|cannot|can't)\s+establish\s+(?:whether|that)\s+(?:(?:a|any|this|the)\s+(?:payment|transaction)|it)\s+is\s+fraud[ -]free(?=\s*(?:[.!?;]|\[E\d+\]|$))/gi,'[qualified uncertainty]')
    .replace(/\b(?:no|not|without)\s+(?:(?:a|any|supported|exact|reliable|calibrated)\s+)*(?:(?:fraud\s+probabilit(?:y|ies)|probabilit(?:y|ies)\s+of\s+fraud)\s+or\s+)?guaranteed[ -](?:money[ -])?loss(?:es)?(?:\s+estimate)?\b/gi,'[qualified uncertainty]')
    .replace(/\b(?:not|neither)\s+(?:payment\s+)?authorization\s+(?:or|nor)\s+(?:a\s+)?guarantee\b/gi,'[qualified uncertainty]')
    .replace(/\b(?:does not|do not|can not|will not|would not|cannot|can't|no|without(?: any)?|not a)\s+(?:(?:funding|payment)\s+)?guarantees?\b|\bnot\s+(?:guaranteed|(?:confirmed|proven)\s+fraud)\b/gi, '[qualified uncertainty]');
  if (/\b(?:definitely|certainly|proven|confirmed)\s+(?:fraud|fraudulent|safe|legitimate)|\b(?:no|zero)\s+(?:fraud|risk)\b|\bfraud[ -]free\b|\bguarantee(?:d|s)?\b/i.test(claims)) return 'The interpretation overstates what the evidence establishes.';
  const newsAdvice=[...results].reverse().find(r=>r.tool==='analyze_news_insights')?.value;
  if(newsAdvice?.status==='unavailable'&&!/\b(?:unavailable|no cited (?:public )?news|no searchable|insufficient (?:news|evidence)|cannot|can't|could not|couldn't|not available)\b/i.test(plain))return 'The sourced news advisory is unavailable; explain the coverage limitation without claiming advisory findings.';
  if (/\bno evidence of (?:fraud|anomalies)|\bany potential (?:obligations|payments|bills)\b/i.test(plain)) return 'The interpretation exceeds the scope of the retrieved banking checks.';
  if (/\b(?:allowed|approved|cleared)\b.{0,80}\bbecause\b.{0,100}\b(?:no prior|no completed|lack of|limited|new recipient|new payee)\b/i.test(plain)) return 'Missing payment history is a limitation, not a reason for authorizing a payment.';
  if (/\b(?:I|we)\s+(?:have\s+)?(?:flagged|referred)|\b(?:flag|review request)\s+(?:has been|was)\s+(?:created|submitted)/i.test(plain) && !results.some(r=>r.tool==='flag_transaction_for_review' && r.value.reviewRequested)) return 'A human review request was claimed without a successful permitted flag receipt.';
  const staffClaims = plain.replace(/\bno\s+(?:(?:staff|review|fraud|compliance|bank)\s+){0,2}(?:case|ticket|investigation|review request|staff|reviewers?|compliance team)\s+(?:(?:has|have|been|was|were|is|are|now)\s+){0,5}(?:created|opened|queued|submitted|notified|alerted|contacted)\b/gi, '[no staff action]');
  const staffActionClaim = /\b(?:I|we)\s+(?:(?:have|successfully|just|now|already)\s+)*(?:notified|alerted|contacted|emailed|messaged)\b|\b(?:case|ticket|investigation|review request)\s+(?:(?:has|have|been|was|is|now|successfully|already)\s+){0,5}(?:created|opened|queued|submitted)\b|\b(?:staff|bank|reviewers?|compliance team)\s+(?:(?:has|have|been|was|were|is|are|now|successfully|already)\s+){0,5}(?:notified|alerted|contacted)\b/i.test(staffClaims);
  if (staffActionClaim && !results.some(r=>r.tool==='flag_transaction_for_review' && r.value.reviewRequested)) return 'A staff notification or investigation was claimed without a successful permitted review receipt.';
  if(/\b(?:I|we)\s+(?:(?:have|successfully|just|now)\s+)*(?:saved|bookmarked)\b|\b(?:dashboard|view)\s+(?:(?:has|have|been|was|is|now|successfully|privately)\s+){0,5}(?:saved|bookmarked)\b|^\s*(?:saved|bookmarked)\b/i.test(plain) && !results.some(r=>r.tool==='save_company_dashboard' && r.value.saved))return 'A saved dashboard was claimed without a successful save receipt.';
  const investigations=results.filter(r=>r.tool==='investigate_transaction').map(r=>r.value);
  if(report?.humanReview)investigations.push(report);
  const openHumanReview=investigations.some(r=>r.humanReview?.open) || results.some(r=>r.tool==='analyze_market_transactions' && r.value?.transactions?.some(t=>t.humanReview?.open));
  if(openHumanReview){
    if(/\bno\s+(?:open|existing|active|ongoing|pending|outstanding)\s+(?:(?:human|payment|fraud|bank)\s+){0,2}(?:reviews?|investigations?|cases?)\b|\ball\s+(?:earlier\s+|existing\s+)?(?:reviews?|investigations?|cases?)\s+(?:are|have been)\s+closed\b/i.test(plain))return 'The narrative contradicts an existing open human investigation.';
    const reviewReceipt=results.some(r=>r.tool==='flag_transaction_for_review' && r.value.reviewRequested);
    if(!reviewReceipt && !/\b(?:existing|open|ongoing|already|awaiting|under|pending|remain(?:s|ing)?)\b.{0,80}\b(?:reviews?|reviewers?|investigat\w*|cases?)\b|\b(?:reviews?|investigations?|cases?)\b.{0,60}\b(?:open|ongoing|pending|active)\b/i.test(plain))return 'Mention that the retrieved existing human investigation remains open; no additional signal does not clear it.';
  }
  const assessments = [report, ...results.map(r => r.value)].filter(Boolean).filter(r=>!r.monitoring?.flagged && !r.humanReview?.exists).map(r => r.assessment).filter(Boolean);
  if (assessments.some(a => a.decision === 'allow') && /\b(?:high[ -]risk|flagged|blocked|held|rejected)\b/i.test(plain)) return 'The narrative conflicts with the recorded allow decision.';
  if (assessments.some(a => ['review', 'block'].includes(a.decision)) && /\b(?:approved|allowed|cleared|safe to (?:pay|send))\b/i.test(plain)) return 'The narrative conflicts with the recorded review or block decision.';
  const fundingWarnings=require('./funds').collect(results);
  const fundingClaims=plain.replace(/\b(?:(?:do|does|did|will|would|should|may|might|could|can)\s+not|cannot|can't|don't|doesn't|won't|wouldn't|shouldn't|couldn't|not)\s+(?:(?:have|be)\s+)?(?:sufficient funds|enough (?:money|funds)|fully funded|cover all(?:\s+(?:payments|bills))?)/gi,'[funding limitation]');
  if(fundingWarnings.length && /\b(?:no shortfalls?|no funding gaps?|cover all|sufficient funds|enough (?:money|funds)|fully funded|funds (?:are|will be) sufficient)\b/i.test(fundingClaims))return 'The narrative conflicts with a funding shortfall or an incomplete funding check.';
  const planningClaims=fundingClaims.replace(/\b(?:cannot|can't|couldn't|can not|could not|not able to)\s+(?:pay|afford|cover)\b/gi,'[funding limitation]');
  if(fundingWarnings.length && /\b(?:can|able to|ready to)\s+(?:pay|afford)|\bpayment (?:is|will be) (?:covered|funded)\b/i.test(planningClaims))return 'The narrative asserts payment readiness despite an incomplete or shortfall check.';
  const projections = [report, ...results.filter(r => r.tool === 'project_liquidity').map(r => r.value)].filter(r => Array.isArray(r?.shortfalls));
  if (!results.some(r=>r.value?.paymentReadiness) && projections.some(r => r.shortfalls.length > 0) && /\b(?:no shortfalls?|no funding gaps?|cover all|sufficient funds|enough (?:money|funds)|fully funded)\b/i.test(fundingClaims)) return 'The narrative conflicts with a projected funding shortfall.';
  const checks = [report, ...results.filter(r => r.tool === 'reconcile_accounts').map(r => r.value)].filter(r => Array.isArray(r?.discrepancies));
  const balanceExceptions=checks.some(r=>r.discrepancies.length),scheduleExceptions=checks.some(r=>r.failedSchedules?.length),notificationExceptions=checks.some(r=>r.notificationExceptions?.length);
  if(balanceExceptions && /\b(?:no (?:(?:account|balance|ledger)\s+)*discrepancies|all (?:balanced|reconciled)|everything (?:balances|reconciles))\b/i.test(plain))return 'The narrative conflicts with recorded balance exceptions.';
  if((balanceExceptions||scheduleExceptions||notificationExceptions) && /\b(?:no (?:issues|exceptions)|all clear|everything (?:is )?clear)\b/i.test(plain))return 'The narrative conflicts with recorded operational exceptions.';
  if(scheduleExceptions && /\bno (?:schedule|scheduled payment) (?:issues|exceptions|failures)\b/i.test(plain) || notificationExceptions && /\bno (?:notification|delivery) (?:issues|exceptions|failures)\b/i.test(plain))return 'The narrative conflicts with recorded operational exceptions.';
  if((scheduleExceptions||notificationExceptions) && !/\b(?:schedules?|notifications?|operational|exceptions?|overdue|retrying|undelivered|stuck)\b/i.test(plain))return 'Mention the recorded schedule or notification exceptions even when the ledger balances match.';
  if (results.some(r => r.tool === 'prepare_payment_draft' && r.value.complete === false) && /\b(?:draft|payment form)\s+(?:is\s+)?ready\b/i.test(plain)) return 'Required draft details are still missing.';
  return null;
}
function relevanceIssue(message, results, intent) {
  const tools = new Set(results.map(r => r.tool));
  // Semantic interpretation chooses tools; it cannot redefine an explicit
  // financial period or substitute a different customer-facing output.
  if(intent){
    const interpreted=require('./response').issue(intent,results);
    if(interpreted||intent.mode!=='banking_evidence')return interpreted;
    const chart=/\b(?:dashboard|chart|graph)\b/i.test(message)&&/\b(?:my|our)\b/i.test(message)&&/\b(?:transactions?|activity|inflows?|outflows?|cash[ -]?flow)\b/i.test(message)&&!require('../dashboard-views').saveIntent(message)&&!/\b(?:saved|bookmarked)\b/i.test(message);
    if(chart&&!tools.has('get_company_activity')&&!tools.has('open_saved_dashboard'))return 'Retrieve the requested owned dashboard/chart, not only a receipt list or written summary.';
    if(!chart&&/\b(?:show|list|retrieve|find|search|get)\b[^.!?]*\b(?:my|our)\s+(?:recent\s+)?transactions?\b|\b(?:my|our)\s+transaction history\b/i.test(message)&&!tools.has('search_transactions'))return 'Retrieve the requested individual receipt list using search_transactions.';
    if(/\b(?:download(?:able)?|export|pdf|csv)\b/i.test(message)&&/\b(?:finance|financial)\s+(?:activity\s+)?reports?\b/i.test(message)&&!tools.has('get_finance_report'))return 'Generate the requested downloadable finance report; account balances do not provide that output.';
    const coverageRequest=/\b(?:scheduled|upcoming|coming due)\b/i.test(message)&&/\b(?:cover|enough|sufficient|funding|shortfalls?|short|afford)\b/i.test(message)&&!DRAFT_INTENT.test(message);
    if(coverageRequest&&!results.some(r=>r.value?.paymentReadiness)){
      let days;try{days=require('./reports').requestedHorizon(message);}catch(error){return error.message;}
      const coverage=[...results].reverse().find(r=>r.value?.fundingCheck)?.value.fundingCheck;
      if(days!==undefined&&(!coverage||typeof coverage.available!=='boolean'||coverage.days!==days))return 'Check the requested '+days+'-day scheduled-payment period with project_liquidity; a default or different horizon does not answer it.';
    }
    return null;
  }
  if(tools.has('get_banking_context')&&require('./banking-context').generalQuestion(message))return null;
  if(tools.has('get_banking_context'))message=require('./banking-context').withoutGeneralClauses(message);
  const newsAdvice=require('../news-insights').requested(message);
  if(newsAdvice&&!tools.has('analyze_news_insights'))return 'Retrieve sourced public news and its advisory analysis before offering the requested news advice or flags.';
  // Public implications are not requests for an account projection. Remove only
  // those qualified phrases; retain owned metrics and separate banking clauses.
  const financialMessage = newsAdvice ? message
    .replace(/\b((?:(?:my|our)(?:\s+(?:business|company|account)(?:'s)?)?|this\s+(?:business|company)(?:'s)?)\s+)?(?:liquidity|cash[ -]?flow)\s+(?:risks?|impacts?|implications?|effects?|concerns?)\b/gi, (phrase, owner) => owner ? phrase : '[public news implications]')
    .replace(/\b(?:impacts?|implications?|effects?|risks?|concerns?)\s+(?:on|for|to)\s+(?:(?:industry|business|sector|corporate)\s+)?(?:liquidity|cash[ -]?flow)\b/gi, '[public news implications]') : message;
  if(require('../counterparty-risk').requested(message)&&!newsAdvice&&!tools.has('assess_counterparty_risk'))return 'The requested owned company reputation/financial interaction assessment was not retrieved.';
  if(/\b(?:sanctions?|compliance|regulatory|enforcement|news)\b/i.test(message)&&/\b(?:counterpart(?:y|ies)|suppliers?|business partners?|dealing|deal with|deals with|companies.*(?:account|transact)|account.*companies)\b/i.test(message)&&!tools.has('scan_counterparty_news'))return 'The requested owned-counterparty public research was not retrieved.';
  const planned=results.some(row=>row.tool==='check_payment_funds' && row.value?.paymentReadiness);
  if(require('../payment-planning').requested(message) && !planned)return 'The proposed dated payment and cash flow must be checked using check_payment_funds; a balance or general projection alone is insufficient.';
  if(/\bafford\b/i.test(message) && !DRAFT_INTENT.test(message) && !tools.has('check_payment_funds'))return 'Check the proposed payment using check_payment_funds, including clarification of any missing amount or owned source; general scheduled coverage is insufficient.';
  const has = names => names.some(name => tools.has(name));
  const coverage=[...results].reverse().find(row=>row.value?.fundingCheck)?.value.fundingCheck;
  const duration=message.match(/\b(\d+)\s+(days?|weeks?|months?)\b/i),unit=duration?.[2]?.toLowerCase();
  const requestedDays=duration?Number(duration[1])*(unit.startsWith('week')?7:unit.startsWith('month')?30:1):/\b(?:years?|quarters?)\b|\b\d{4}-\d{2}-\d{2}\b/i.test(message)?0:/\bweeks?\b/i.test(message)?7:/\btomorrow\b/i.test(message)?1:undefined;
  const emptyScheduleCoverage=coverage?.occurrenceCount===0 && /\b(?:scheduled|schedules?)\b/i.test(message);
  const covered=coverage && typeof coverage.available==='boolean' && (coverage.available===false || coverage.occurrenceCount>0 || emptyScheduleCoverage) && (requestedDays===undefined || coverage.days===requestedDays);
  const currentPayment=has(['check_payment_funds']) && !/\b(?:scheduled|upcoming|future|projection|liquidity|next|weekly|monthly)\b/i.test(message);
  if(require('../dashboard-views').saveIntent(message) && (/\b(?:dashboard|view|summary)\b/i.test(message) || require('../dashboard-views').followup(message)) && !has(['save_company_dashboard']) && !results.some(r=>r.tool==='get_company_activity' && r.value?.status && r.value.status!=='ready'))return 'The requested dashboard was not saved.';
  const fraudCheck=require('../market-risk').fraudIntent(message);
  if(fraudCheck && /\b(?:fraud(?:ulent)?|scams?|suspicious)\b/i.test(message) && /\b(?:market|daily news|scam alerts?|exchange rates?|forex)\b/i.test(message) && !has(['analyze_market_transactions']))return 'Call analyze_market_transactions to check the permitted payments; public context and a receipt list alone do not analyze them for fraud.';
  if (/\b(?:market|daily news|scam alerts?|exchange rates?|forex)\b/i.test(message) && !has(['get_daily_market_context','analyze_market_transactions','get_market_insights','research_public_company','scan_counterparty_news'])) return 'The requested dated market or scam context was not retrieved.';
  if (/\btransaction trends?\b|\bmonthly trends?\b/i.test(message) && !has(['get_company_activity','open_saved_dashboard','get_business_profile']))return 'The requested private transaction trends were not retrieved.';
  if (/\b(?:insufficient funds|low (?:on )?(?:funds|balance)|enough (?:money|funds)|sufficient funds)\b/i.test(message) && !has(['get_accounts','project_liquidity','prepare_payment_draft','check_payment_funds','get_finance_report'])) return 'The requested funding evidence was not retrieved.';
  if (/\b(?:finance|financial)\b/i.test(message) && /\breports?\b/i.test(message) && !has(['get_finance_report','assess_counterparty_risk'])) return 'The requested finance report was not retrieved.';
  if (/\b(?:balance|balances)\b/i.test(message) && !has(['get_accounts', 'project_liquidity', 'reconcile_accounts', 'get_finance_report','check_payment_funds'])) return 'The requested balance evidence was not retrieved.';
  if (/\b(?:liquidity|afford|shortfall|cover|projection)\b/i.test(financialMessage) && !has(['project_liquidity','get_company_activity','open_saved_dashboard']) && !covered && !currentPayment && !planned) return 'The requested liquidity scenario was not retrieved.';
  if (/\b(?:inflow|outflow)\b/i.test(message) && !has(['get_finance_report','get_company_activity','open_saved_dashboard']) && !planned)return 'The requested completed inflow and outflow were not retrieved.';
  if (/\bcash.?flow\b/i.test(financialMessage) && !has(['project_liquidity','get_company_activity','open_saved_dashboard','get_finance_report','check_payment_funds'])) return 'The requested cash flow evidence was not retrieved.';
  if (!DRAFT_INTENT.test(message) && /\b(?:scheduled|upcoming)\b/i.test(message) && !has(['get_schedules', 'project_liquidity']) && !covered && !planned) return 'The requested scheduled-payment evidence was not retrieved.';
  const marketFraudCheck=fraudCheck && has(['analyze_market_transactions']);
  const explicitReceiptList=/\b(?:show|list|retrieve|get)\b.*\btransactions?\b|\b(?:also|and)\s+(?:search|find)\b.*\btransactions?\b|\b(?:receipts?|transaction history)\b|\btransactions?\b.*\b(?:from|between|on|last|yesterday|today)\b/i.test(message);
  const receiptList=/\b(?:history|recent transactions?|find.*transactions?|search.*transactions?|(?:show|list|retrieve|get)\b.*\btransactions?|transactions?\b.*\b(?:from|between|on|last|yesterday|today))\b/i.test(message);
  const summaryRequest=/\b(?:dashboard|chart|trends?|inflow|outflow|cash.?flow|summari[sz]e|summary|finance|financial|activity)\b/i.test(message);
  if (receiptList && (!marketFraudCheck || explicitReceiptList) && !has(summaryRequest?['search_transactions','get_company_activity','open_saved_dashboard','get_finance_report']:['search_transactions'])) return 'Call search_transactions for the requested owned receipt list; an aggregate activity dashboard does not replace transaction history.';
  return null;
}
module.exports = { DRAFT_INTENT, references, narrativeIssue, relevanceIssue };
