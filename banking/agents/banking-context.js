'use strict';

const {HttpError}=require('../../models/errors');
const {DRAFT_INTENT}=require('./evidence');

const TOPICS=Object.freeze({
 general:'wholesale digital banking for businesses and the difference from retail banking',
 cash_flow:'business cash inflows, cash outflows and cash flow statements',
 liquidity:'business liquidity management and scheduled payment funding',
 scheduled_payments:'scheduled bank payments and standing instructions',
 authorization:'payment authorization, independent review and maker-checker controls',
 fraud:'bank payment fraud indicators and human review controls',
 counterparty_risk:'counterparty reputation risk, financial exposure and legal entity verification',
 sanctions:'Singapore business sanctions compliance and official sanctions screening limitations',
 reconciliation:'bank account and transaction reconciliation',
 statements:'opening balances, closing balances and bank account statements',
 interest_rates:'central bank interest rates and business cash flow implications',
 security:'business banking access controls and multi-factor authentication',
});
const CONCEPT=/\b(?:wholesale(?: digital)? bank(?:ing)?|digital bank(?:ing)?|savings accounts?|account balances?|internal (?:fund )?transfers?|bill payments?|finance reports?|financial reports?|fraud rules?|transaction history|cash[ -]?flow|inflows?|outflows?|liquidity|reconciliation|scheduled payments?|standing (?:orders?|instructions?)|maker[- ]checker|payment authori[sz]ation|fraud (?:risk|indicators?|detection|scores?)|counterparty risk|sanctions|financial statements?|opening balance|closing balance|interest rates?|multi[- ]factor authentication|role[- ]based access)\b/i;
function generalQuestion(message){
 const text=message.trim();
 return /^(?:(?:please|can you|could you)\s+)*(?:what|why|how|explain|define|describe|tell me about|help me understand)\b/i.test(text)
  &&CONCEPT.test(text)&&!DRAFT_INTENT.test(text)
  &&!/\b(?:my|our|mine|ours)\b|\d{4,}|\b(?:balance|cash[ -]?flow|liquidity|transactions?|payments?)\s+(?:of|for|between)\b/i.test(text);
}
const needsResearch=message=>/\b(?:current|currently|latest|today|recent|now|news|regulations?|requirements?|legal|laws?|changes?|MAS|OFAC|UN)\b/i.test(message);
const generalFollowup=(message,previous)=>typeof previous==='string'&&previous.length>0&&previous.length<=2400&&/^(?:please\s+)?(?:explain (?:more|that(?: more simply)?)|tell me more|give (?:me )?an example|why is that|what does that mean|how does that work)[.!?]*$/i.test(message.trim());
const withoutGeneralClauses=message=>message.replace(/\b(?:explain|describe|define)\s+(?:the\s+)?(?:general|public|background)\s+(?:liquidity|cash[ -]?flow|scheduled payments?|finance reports?|financial statements?|account balances?)\s+(?:context|concepts?|principles|meaning|background)\b/gi,'[public banking explanation]');
function requestFor(args,{now=Date.now}={}){
 const topic=args.topic||'general';
 if(!Object.hasOwn(TOPICS,topic))throw new HttpError(400,'Choose a supported public banking topic.');
 return {kind:'market',topic:'banking_background',title:'Public banking background: '+topic.replace(/_/g,' '),checkedAt:new Date(now()).toISOString(),allowedDomains:['mas.gov.sg','abs.org.sg','moneysense.gov.sg','bis.org','ecb.europa.eu'],query:'Explain '+TOPICS[topic]+' in a concise paragraph using current primary regulator, central-bank or banking-association sources. Focus on Singapore business banking where relevant. Distinguish general principles from jurisdiction-specific requirements and report publication dates. This is public background only: do not infer any private account facts, app-specific product terms, legal compliance, company clearance or payment decisions.'};
}
function replyIssue(reply,{hasEvidence=false}={}){
 if(/\b(?:is|are|was|were)\s+(?:fully compliant|sanctions[- ]free|sanctioned|insolvent|creditworthy|solvent|cleared|safe to pay)\b/i.test(reply))return 'General background cannot certify an actual company or a payment.';
 if(!hasEvidence&&/\[E\d+\]/.test(reply))return 'A general explanation must not invent references to account evidence.';
 if(/\b(?:I|we)\s+(?:(?:have|just)\s+)?(?:checked|retrieved|reviewed|found|scanned|analy[sz]ed)\b[^.!?]*\b(?:your|owned|records|transactions?|payments?)\b/i.test(reply))return 'A general explanation cannot claim to have inspected private records.';
 if(/\b(?:your|our|my)\s+(?:(?:current|available|opening|closing|projected|business|company|account)\s+){0,3}(?:balances?|accounts?|transactions?|receipts?|payments?|funds?|liquidity|cash[ -]?flow|interest rates?|rates?|product terms?)\s+(?:is|are|was|were|has|have|shows?|totals?|contains?|will)\b/i.test(reply))return 'A general explanation cannot assert facts about an actual account.';
 return null;
}
module.exports={TOPICS,generalQuestion,generalFollowup,needsResearch,withoutGeneralClauses,requestFor,replyIssue};
