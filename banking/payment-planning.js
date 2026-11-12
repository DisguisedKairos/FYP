'use strict';

// Settled cash flow is descriptive, never future income. This module is read-only.
const {snapshot}=require('./history');
const {assertCurrentUser}=require('./auth');
const {parseAmount,cents}=require('./ledger');
const {liquidity}=require('./agents/reports');
const DAY=86400000;
const sgDay=value=>new Date(value+8*3600000).toISOString().slice(0,10);
const iso=value=>new Date(value).toISOString();
const literal=value=>value.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_PATTERN=MONTHS.map(name=>name+'|'+name.slice(0,3)).join('|');
function requested(message){
  const proposed=/\bSGD\s*\S|S\$|\$|\b(?:pay|payment to|transfer to|company|supplier|vendor)\b/i.test(message);
  return proposed && /\b(?:afford|enough|sufficient|funding|cover|can (?:i|we|my business|the business) pay)\b/i.test(message)
    && (/\b(?:inflow|outflow|cash.?flow|received|paid|by|before|until|this month|current month|next month|today|tomorrow|end of|month.end)\b|\b\d{4}-\d{2}/i.test(message) || new RegExp('\\b('+MONTH_PATTERN+')\\s+\\d{4}\\b','i').test(message));
}
function endOfMonth(year,month){return new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);}
function deadlineFor(message,now){
  if(/\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b|T\d{2}:/i.test(message))return {error:'Use a date without a clock time; checks cover the end of that Singapore date.'};
  const dates=message.match(/\b\d{4}-\d{2}-\d{2}\b/g)||[];
  if(dates.length>1)return {error:'Give one payment deadline, using YYYY-MM-DD.'};
  let date=dates[0],exclusive=false;
  if(date)exclusive=new RegExp('\\bbefore\\s+'+literal(date),'i').test(message);
  const namedDays=[...message.matchAll(new RegExp('\\b(\\d{1,2})\\s+('+MONTH_PATTERN+')\\s+(\\d{4})\\b','gi'))],namedDay=namedDays[0];
  const namedMonths=[...message.matchAll(new RegExp('\\b('+MONTH_PATTERN+')\\s+(\\d{4})\\b','gi'))];
  const monthTokens=[...message.matchAll(/\b(\d{4})-(\d{2})(?!-\d)\b/g)];
  if(namedDays.length>1 || namedMonths.length>1 || monthTokens.length>1 || (dates.length && (namedMonths.length || monthTokens.length)) || (monthTokens.length && namedMonths.length))return {error:'Give one explicit payment deadline or month, rather than multiple alternatives.'};
  if(!date && namedDay)date=namedDay[3]+'-'+String(MONTHS.findIndex(name=>name.startsWith(namedDay[2].toLowerCase()))+1).padStart(2,'0')+'-'+namedDay[1].padStart(2,'0');
  if(!date && monthTokens.length){
    if(monthTokens.length!==1 || Number(monthTokens[0][2])<1 || Number(monthTokens[0][2])>12)return {error:'Give one valid payment month as YYYY-MM.'};
    date=endOfMonth(Number(monthTokens[0][1]),Number(monthTokens[0][2]));
  }
  const namedMonth=namedMonths[0];
  if(!date && namedMonth)date=endOfMonth(Number(namedMonth[2]),MONTHS.findIndex(name=>name.startsWith(namedMonth[1].toLowerCase()))+1);
  if(namedDay && /\bbefore\s+\d{1,2}\s+/i.test(message))exclusive=true;
  if(!dates.length && !namedDay && /\bbefore\b/i.test(message))return {error:'For a before-date check, give an explicit YYYY-MM-DD or day, month and year.'};
  const today=sgDay(now);
  if(!date){
    if(/\bthis month\b.*\bor\b.*\bnext month\b|\bnext month\b.*\bor\b.*\bthis month\b/i.test(message))return {error:'Choose this month or next month as the payment deadline.'};
    if(/\bnext month\b/i.test(message)){const current=new Date(today+'T00:00:00Z');date=endOfMonth(current.getUTCFullYear(),current.getUTCMonth()+2);}
    else if(/\b(?:this|current) month\b|\bend of (?:the )?month\b|\bmonth.end\b/i.test(message))date=endOfMonth(Number(today.slice(0,4)),Number(today.slice(5,7)));
    else if(/\btomorrow\b/i.test(message))date=sgDay(now+DAY);
    else if(/\btoday\b/i.test(message))date=today;
    else if(/\b(?:by|until|before|weeks?|quarters?|years?|days?|dates?)\b/i.test(message))return {error:'Specify a payment deadline such as YYYY-MM-DD, YYYY-MM, this month or next month.'};
    else date=today;
  }
  const start=Date.parse(date+'T00:00:00+08:00');
  if(!Number.isFinite(start) || sgDay(start)!==date)return {error:'Give a valid calendar deadline in YYYY-MM-DD format.'};
  const until=start+(exclusive?0:DAY);
  if(until<=now || until-now>90*DAY)return {error:'Choose a payment deadline from today through the next 90 days.'};
  return {date:exclusive?sgDay(start-1):date,until,exclusiveUntil:iso(until),timeZone:'Asia/Singapore'};
}
function details(message,accounts,now){
  const missing=[],clean=message.trim().replace(/[!?]+$/,'');
  let amountCents;
  const monetary=[...clean.matchAll(/(?:\b(?:SGD|amount)\s*|S\$\s*|\$\s*)([^\s]+)/gi)];
  const token=monetary.length===1?monetary[0][1]:!monetary.length?clean.match(/\b(?:pay|payment of|send|transfer)\s+([-+\d][^\s]*)/i)?.[1]:null;
  if(/\b(?:USD|EUR|MYR|AUD|GBP|CNY|HKD)\b|US\$/i.test(clean))missing.push('Use SGD; foreign-currency payment amounts are not supported by this check.');
  if(token && /^(?:\d{1,11}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(token)){
    try{amountCents=parseAmount(token.replace(/,/g,''));}catch{missing.push('Enter a positive SGD amount within the supported limit.');}
  }else missing.push('Give one proposed payment amount in SGD, with at most two decimal places.');
  const sourceMatches=accounts.filter(a=>[a.name,a.number].some(value=>new RegExp('\\bfrom\\s+(?:(?:my|account)\\s+)*'+literal(value)+'(?=\\s+(?:to|by|before|until|on|for|in|this|next|today|tomorrow|and|with)\\b|[.!?,;]?\\s*$)','i').test(clean)));
  const source=sourceMatches.length===1?sourceMatches[0]:!/\bfrom\b/i.test(clean) && accounts.length===1?accounts[0]:null;
  if(!source)missing.push('Specify an unambiguous owned source account name or number after "from".');
  const target=clean.match(/\bto\s+(?!pay\b)(.+?)(?=\s+(?:from|by|before|until|on|using|this month|next month)\b|[!?]?\s*$)/i)?.[1]?.trim().replace(/^["']|["']$/g,'');
  const company=target && !/^(?:another|other|a|the)\s+compan(?:y|ies)$/i.test(target)?target:null;
  if(company && (company.length>120 || /[\x00-\x1f\x7f]/.test(company)))missing.push('Use a company name of at most 120 characters.');
  if(!company && /\b(?:another|other|a|the)\s+compan(?:y|ies)\b/i.test(clean))missing.push('Name the proposed recipient company after "to".');
  const deadline=deadlineFor(clean,now);
  if(deadline.error)missing.push(deadline.error);
  return {source,company,amountCents,deadline:deadline.error?null:deadline,missing};
}
const NOTES=[
  'Past inflow and outflow use completed external entries only. Own-account transfers, opening funds, pending requests and rejected requests are excluded.',
  'Completed activity is already included in the current balance and is not added to the funding check again.',
  'This conservative check deducts active outgoing schedules, including overdue instructions, through the deadline. Future credits, including scheduled incoming transfers, are excluded until they settle.',
  'The proposed payment is additional to existing schedules and is placed at the end of the chosen Singapore date. Other accounts are not combined automatically.',
  'This is a funding scenario, not a forecast or payment authorization. Future receipts, cancelled schedules and other new spending can change it. Recipient, business and security checks still apply.'
];
async function assess(db,user,message,{now=Date.now}={}){
  return snapshot(db,async client=>{
    await assertCurrentUser(client,user);
    const generated=now(),generatedAt=iso(generated),today=sgDay(generated);
    const accounts=(await client.query("SELECT id::text,name,number,balance_cents FROM accounts WHERE user_id=$1 AND status='active' ORDER BY id",[user.id])).rows.map(row=>({id:row.id,name:row.name,number:row.number,balanceCents:cents(row.balance_cents)}));
    const input=details(message,accounts,generated);
    let from=today.slice(0,7)+'-01',to=today;
    if(/\blast month\b/i.test(message)){to=sgDay(Date.parse(from+'T00:00:00+08:00')-1);from=to.slice(0,7)+'-01';}
    const rows=(await client.query("SELECT a.id::text AS account_id,COALESCE(sum(t.amount_cents) FILTER(WHERE t.amount_cents>0),0)::text AS income,COALESCE(sum(-t.amount_cents) FILTER(WHERE t.amount_cents<0),0)::text AS outgoing FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.user_id=$1 AND t.status='completed' AND NOT t.internal AND NOT(t.type='credit' AND (t.reference='DEMO-OPENING' OR lower(btrim(t.description))='opening balance')) AND t.completed_at>=$2 AND t.completed_at<$3 AND t.completed_at<=$4 GROUP BY a.id",[user.id,from+'T00:00:00+08:00',iso(Date.parse(to+'T00:00:00+08:00')+DAY),generatedAt])).rows;
    const total=key=>cents(rows.reduce((sum,row)=>sum+BigInt(row[key]),0n)),incomeCents=total('income'),outgoingCents=total('outgoing'),sourceFlow=rows.find(row=>row.account_id===input.source?.id);
    const flow={period:{from,to,timeZone:'Asia/Singapore'},incomeCents,outgoingCents,netCents:cents(BigInt(incomeCents)-BigInt(outgoingCents)),source:input.source?{incomeCents:cents(sourceFlow?.income||0),outgoingCents:cents(sourceFlow?.outgoing||0)}:null};
    const plan={generatedAt,currency:'SGD',status:'needs_details',complete:false,missing:input.missing,company:input.company,recipientVerified:false,source:input.source,amountCents:input.amountCents??null,deadline:input.deadline?{date:input.deadline.date,exclusiveUntil:input.deadline.exclusiveUntil,timeZone:input.deadline.timeZone}:null,flow,notes:NOTES};
    let warnings=[];
    if(input.missing.length)warnings=[{code:'payment_details_required',title:'Payment planning needs more details.',message:input.missing.join(' '),checkedAt:generatedAt}];
    else{
      try{
        const until=input.deadline.until;
        const projection=await liquidity(db,user,{days:Math.ceil((until-generated)/DAY),now:()=>generated,snapshotClient:client});
        const events=projection.occurrences.filter(row=>Date.parse(row.dueAt)<until),outgoing=events.filter(row=>row.fromAccountId===input.source.id),incoming=events.filter(row=>row.toOwnedAccountId===input.source.id);
        const scheduledOutgoingCents=cents(outgoing.reduce((sum,row)=>sum+BigInt(row.amountCents),0n)),scheduledIncomingCents=cents(incoming.reduce((sum,row)=>sum+BigInt(row.amountCents),0n));
        const beforePaymentCents=cents(BigInt(input.source.balanceCents)-BigInt(scheduledOutgoingCents)),afterPaymentCents=cents(BigInt(beforePaymentCents)-BigInt(input.amountCents)),shortageCents=Math.max(0,-afterPaymentCents);
        Object.assign(plan,{status:shortageCents?'needs_funding':'covered',complete:true,scheduledOutgoingCents,scheduledIncomingCents,beforePaymentCents,afterPaymentCents,shortageCents,scheduledCount:outgoing.length});
        if(shortageCents)warnings=[{code:'dated_payment_shortfall',accountId:input.source.id,accountName:input.source.name,availableCents:input.source.balanceCents,requiredCents:input.amountCents,shortageCents,checkedAt:generatedAt,title:'More settled funds are needed in this payment scenario.',message:'Current source funds do not cover both the active outgoing schedules through the selected deadline and this additional proposed payment. Future credits are excluded until settled.'}];
      }catch(error){
        if(error.status!==413 && !(error.status===409 && /monetary value/.test(error.message)))throw error;
        plan.status='unavailable';warnings=[{code:'coverage_unavailable',title:'The full payment scenario could not be checked.',message:'Choose a shorter deadline or review scheduled obligations separately; the scenario exceeds supported calculation limits.',checkedAt:generatedAt}];
      }
    }
    return {complete:plan.complete,missing:plan.missing,paymentReadiness:plan,fundingWarnings:warnings,items:[],actions:[]};
  });
}
module.exports={requested,deadlineFor,details,assess};
