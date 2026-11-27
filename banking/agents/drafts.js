'use strict';

const { HttpError } = require('../../models/errors');
const ledger = require('../ledger');
const { assertActor } = require('./reports');
const {draftWarnings}=require('./funds');
const fields = ['kind','type','fromAccountId','toAccountNumber','billerId','reference','amount','description','scheduledAt','frequency'];
const object = v => v && typeof v === 'object' && !Array.isArray(v);

async function prepareDraft(db,user,input,{now=Date.now}={}) {
  await assertActor(db,user);
  if(!object(input) || Object.keys(input).some(k=>!fields.includes(k))) throw new HttpError(400,'Unsupported draft fields.');
  const draft=Object.fromEntries(Object.entries(input).map(([k,v])=>{if(typeof v!=='string' || v.length>150)throw new HttpError(400,'Invalid draft value.');return [k,v.trim()];}));
  if(!['transfer','bill','schedule'].includes(draft.kind))throw new HttpError(400,'Choose a transfer, bill or schedule draft.');
  const accounts=(await db.query("SELECT a.*,b.status AS business_status FROM accounts a LEFT JOIN businesses b ON b.id=a.business_id WHERE a.user_id=$1 AND a.status='active' ORDER BY a.id",[user.id])).rows;
  if(!accounts.length || accounts.some(a=>a.business_status!=='approved'))throw new HttpError(403,'An approved business account is required for payment drafts.');
  if(!draft.fromAccountId)draft.fromAccountId=String(accounts[0].id);
  const source=accounts.find(a=>String(a.id)===draft.fromAccountId);
  if(!source)throw new HttpError(404,'Owned savings account not found.');
  if(draft.kind==='schedule' && !draft.type)draft.type='transfer';
  const type=draft.kind==='schedule'?draft.type:draft.kind;
  if(!['transfer','bill'].includes(type))throw new HttpError(400,'Choose a valid scheduled payment type.');
  const missing=[];
  let cents;
  if(!draft.amount)missing.push('amount');else{cents=ledger.parseAmount(draft.amount);draft.amount=(cents/100).toFixed(2);}
  if(type==='transfer'){
    if(!draft.toAccountNumber)missing.push('recipient account number');
    else if(!/^\d{10}$/.test(draft.toAccountNumber) || draft.toAccountNumber===source.number)throw new HttpError(400,'Choose a different 10-digit recipient account.');
  }else{
    const billers=(await db.query('SELECT id,name FROM billers')).rows;
    if(!draft.billerId)missing.push('biller');else if(!billers.some(b=>b.id===draft.billerId))throw new HttpError(400,'Choose a supported biller.');
    if(!draft.reference)missing.push('billing reference');
    else if(!/^[A-Za-z0-9 _./-]{3,64}$/.test(draft.reference))throw new HttpError(400,'Enter a billing reference of 3-64 characters.');
  }
  if(draft.kind==='schedule'){
    if(!draft.scheduledAt)missing.push('future date and time');
    else {
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(draft.scheduledAt) || !Number.isFinite(Date.parse(draft.scheduledAt)) || Date.parse(draft.scheduledAt)<=now())throw new HttpError(400,'Use a future ISO UTC date, for example 2026-12-01T02:00:00Z.');
      const normalized=draft.scheduledAt.replace(/(?:\.(\d{1,3}))?Z$/,(_,fraction='')=>`.${fraction.padEnd(3,'0')}Z`);
      if(new Date(draft.scheduledAt).toISOString()!==normalized)throw new HttpError(400,'Choose a real calendar date for the schedule.');
      draft.scheduledAt=new Date(draft.scheduledAt).toISOString();
    }
    if(!draft.frequency)missing.push('frequency (once, weekly or monthly)');
    else if(!['once','weekly','monthly'].includes(draft.frequency))throw new HttpError(400,'Choose once, weekly or monthly.');
  }
  if(draft.description && draft.description.length>100)draft.description=draft.description.slice(0,100);
  const warnings=cents>Number(source.balance_cents)?['The selected account currently has insufficient funds. Review the amount and funding before authorization.']:[];
  const {kind,...payload}=draft;
  return {kind,draft,complete:!missing.length,missing,warnings,fundingWarnings:draftWarnings(source,cents,{scheduled:kind==='schedule',now}),source:{id:String(source.id),name:source.name,balanceCents:Number(source.balance_cents)},
    requiresAuthorization:true,actions:missing.length?[]:[{type:kind==='schedule'?'draft_schedule':kind==='bill'?'draft_payment':'draft_transfer',label:'Review '+(kind==='bill'?'bill payment':kind)+' draft',draft:payload}]};
}

function extractDraft(message,previous={},accounts=[],billers=[],{now=Date.now}={}){
  const text=message.trim();
  const timingText=text.replace(/\b(?:ref(?:erence)?|description)\s+(?:"[^"\r\n]*"|'[^'\r\n]*')/gi,'[quoted payment detail]');
  const oncePer=timingText.match(/\bonce\s+(?:a|per|each|every)\s+(\w+)\b/i);
  if(oncePer&&!/^(?:weeks?|months?)$/i.test(oncePer[1]))throw new HttpError(400,'Choose a single payment, weekly or monthly recurrence.');
  const cadence=timingText.match(/\b(once\s+(?:a|per|each|every)\s+(?:weeks?|months?)|(?:each|every)\s+(?:week|month)|one[ \u2010-\u2014-]?(?:off|time)|once|weekly|monthly)\b/i)?.[1].toLowerCase();
  const frequency=cadence?.includes('week')?'weekly':cadence?.includes('month')?'monthly':cadence?.startsWith('one')?'once':cadence;
  const schedule=/\b(?:schedule|scheduled)\b/i.test(timingText)||['weekly','monthly'].includes(frequency);
  const payment=/\b(?:pay|payment|bill)\b/i.test(text) && !/\btransfer\b/i.test(text);
  let draft={...previous};
  if(!draft.kind)draft.kind=schedule?'schedule':payment?'bill':'transfer';
  if(schedule && draft.kind!=='schedule'){draft.type=draft.kind;draft.kind='schedule';}
  // Read the whole monetary token before validating it. Matching a valid prefix
  // would turn 1,000.50 into 1 or silently truncate excessive decimal places.
  const numeric=text.match(/(?:\b(?:SGD|amount)\s*|S\$\s*|\$\s*)([^\s]+)/i)
    || text.match(/^(?:please\s+)?(?:transfer|send|move|pay)\s+([-+\d][^\s]*)/i)
    || (!/^\d{10}$/.test(text) && text.match(/^([-+\d][\d.,eE+-]*)$/));
  if(numeric){
    const token=numeric[1].replace(/[!?]+$/,'');
    if(!/^(?:\d{1,11}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(token))throw new HttpError(400,'Enter a valid SGD amount with no more than two decimal places.');
    draft.amount=token.replace(/,/g,'');
    ledger.parseAmount(draft.amount);
  }
  const accountText=value=>value.trim().replace(/^(?:my|account)\s+/i,'').replace(/[.!?]$/,'').toLowerCase();
  const sourceText=text.match(/\b(?:from|use)\s+(.+?)(?=\s+(?:to|for|at|on|starting|tomorrow|once|weekly|monthly|(?:with\s+)?ref(?:erence)?)\b|$)/i)?.[1];
  if(sourceText){
    const matches=accounts.filter(a=>a.name.toLowerCase()===accountText(sourceText) || a.number===accountText(sourceText));
    if(matches.length!==1)throw new HttpError(400,'Choose an unambiguous owned source account by name or account number.');
    draft.fromAccountId=String(matches[0].id);
  }
  const numberedTargets=[...text.matchAll(/\bto\s+(\d{10})(?=$|\s|[.!?,;](?=$|\s))/gi)].map(match=>match[1]);
  if(new Set(numberedTargets).size>1)throw new HttpError(400,'Choose an unambiguous destination account number.');
  const targetText=numberedTargets[0] || text.match(/\bto\s+(.+?)(?=\s+(?:for|with|reference|ref|at|on|starting|tomorrow|once|weekly|monthly)\b|$)/i)?.[1] || (/^\d{10}$/.test(text)?text:null);
  if(targetText){
    const target=accountText(targetText),owned=accounts.filter(a=>a.name.toLowerCase()===target || a.number===target);
    delete draft.toAccountNumber;
    if(owned.length>1)throw new HttpError(400,'Choose an unambiguous destination account number.');
    if(owned.length===1)draft.toAccountNumber=owned[0].number;
    else if(/^\d{10}$/.test(target))draft.toAccountNumber=target;
  }
  const biller=billers.find(b=>text.toLowerCase().includes(b.name.toLowerCase()));
  if(biller)draft.billerId=biller.id;
  if(draft.kind==='schedule'&&!draft.type)draft.type=draft.toAccountNumber?'transfer':biller||payment?'bill':'transfer';
  const reference=text.match(/\b(?:ref(?:erence)?)\s+("[^"\r\n]*"[.!?]?|'[^'\r\n]*'[.!?]?|.+?)(?=\s+(?:from|use|starting|tomorrow|at|on|once|weekly|monthly)\b|$)/i);
  if(reference){const value=reference[1].trim(),quoted=value.match(/^(["'])(.*)\1[.!?]?$/);draft.reference=quoted?quoted[2]:value.replace(/[!?]+$/,'');}
  const date=timingText.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/);
  if(date)draft.scheduledAt=date[0];
  if(/\btomorrow\b/i.test(timingText)){
    if(date)throw new HttpError(400,'Choose either tomorrow or an explicit UTC date, not both.');
    const tomorrow=new Date(now()+86400000);
    const sg=new Date(tomorrow.getTime()+8*3600000).toISOString().slice(0,10);
    const clock=timingText.match(/\btomorrow\s+(?:(at)\s+)?(\S+)(?:\s+(am|pm)\b)?/i);
    const clockToken=clock?.[2].replace(/[.,!?]$/,'');
    const explicit=clock && (clock[1] || /^\d/.test(clockToken));
    const time=explicit?(clockToken+(clock[3] || '')).match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i):null;
    let hour=9,minute=0;
    if(time){hour=Number(time[1]);minute=Number(time[2] || 0);if(minute>59 || (time[3]?hour<1 || hour>12:hour>23))throw new HttpError(400,'Choose a valid time for tomorrow in Singapore.');if(time[3])hour=hour%12+(/pm/i.test(time[3])?12:0);}
    else if(explicit || /\btomorrow\s+(?:at\b|(?:in\s+the\s+)?(?:morning|afternoon|evening|night|noon|midnight)\b)/i.test(timingText))throw new HttpError(400,'Use a valid time such as tomorrow at 15:30.');
    draft.scheduledAt=new Date(sg+'T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00+08:00').toISOString();
  }
  if(draft.scheduledAt&&draft.kind!=='schedule'){draft.type=draft.kind;draft.kind='schedule';}
  if(frequency)draft.frequency=frequency;
  return draft;
}
module.exports={prepareDraft,extractDraft};
