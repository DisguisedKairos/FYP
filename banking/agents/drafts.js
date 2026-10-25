'use strict';

const { HttpError } = require('../../models/errors');
const ledger = require('../ledger');
const { assertActor } = require('./reports');
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
  return {kind,draft,complete:!missing.length,missing,warnings,source:{id:String(source.id),name:source.name,balanceCents:Number(source.balance_cents)},
    requiresAuthorization:true,actions:missing.length?[]:[{type:kind==='schedule'?'draft_schedule':kind==='bill'?'draft_payment':'draft_transfer',label:'Review '+(kind==='bill'?'bill payment':kind)+' draft',draft:payload}]};
}

function extractDraft(message,previous={},accounts=[],billers=[],{now=Date.now}={}){
  const text=message.trim();
  const schedule=/\b(?:schedule|scheduled|weekly|monthly)\b/i.test(text);
  const payment=/\b(?:pay|payment|bill)\b/i.test(text) && !/\btransfer\b/i.test(text);
  let draft={...previous};
  if(!draft.kind)draft.kind=schedule?'schedule':payment?'bill':'transfer';
  if(schedule && draft.kind!=='schedule'){draft.type=draft.kind;draft.kind='schedule';}
  if(draft.kind==='schedule')draft.type=draft.type || (payment?'bill':'transfer');
  // Read the whole monetary token before validating it. Matching a valid prefix
  // would turn 1,000.50 into 1 or silently truncate excessive decimal places.
  const numeric=text.match(/(?:\b(?:SGD|amount)\s*|S\$\s*|\$\s*)([^\s]+)/i)
    || text.match(/^(?:please\s+)?(?:transfer|send|move|pay)\s+([-+\d][^\s]*)/i)
    || (!/^\d{10}$/.test(text) && text.match(/^([-+\d][\d.,eE+-]*)$/));
  if(numeric){
    if(!/^(?:\d{1,11}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(numeric[1]))throw new HttpError(400,'Enter a valid SGD amount with no more than two decimal places.');
    draft.amount=numeric[1].replace(/,/g,'');
    ledger.parseAmount(draft.amount);
  }
  const accountText=value=>value.trim().replace(/^(?:my|account)\s+/i,'').replace(/[.!?]$/,'').toLowerCase();
  const sourceText=text.match(/\b(?:from|use)\s+(.+?)(?=\s+(?:to|for|at|on|tomorrow|once|weekly|monthly)\b|$)/i)?.[1];
  if(sourceText){
    const matches=accounts.filter(a=>a.name.toLowerCase()===accountText(sourceText) || a.number===accountText(sourceText));
    if(matches.length!==1)throw new HttpError(400,'Choose an unambiguous owned source account by name or account number.');
    draft.fromAccountId=String(matches[0].id);
  }
  const targetText=text.match(/\bto\s+(.+?)(?=\s+(?:for|with|reference|ref|at|on|tomorrow|once|weekly|monthly)\b|$)/i)?.[1] || (/^\d{10}$/.test(text)?text:null);
  if(targetText){
    const target=accountText(targetText),owned=accounts.filter(a=>a.name.toLowerCase()===target || a.number===target);
    delete draft.toAccountNumber;
    if(owned.length>1)throw new HttpError(400,'Choose an unambiguous destination account number.');
    if(owned.length===1)draft.toAccountNumber=owned[0].number;
    else if(/^\d{10}$/.test(target))draft.toAccountNumber=target;
  }
  const biller=billers.find(b=>text.toLowerCase().includes(b.name.toLowerCase()));
  if(biller)draft.billerId=biller.id;
  const reference=text.match(/\b(?:ref(?:erence)?)\s+(.+?)(?=\s+(?:tomorrow|at|on|once|weekly|monthly)\b|$)/i);
  if(reference)draft.reference=reference[1].trim();
  const date=text.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/);
  if(date)draft.scheduledAt=date[0];
  if(/\btomorrow\b/i.test(text)){
    if(date)throw new HttpError(400,'Choose either tomorrow or an explicit UTC date, not both.');
    const tomorrow=new Date(now()+86400000);
    const sg=new Date(tomorrow.getTime()+8*3600000).toISOString().slice(0,10);
    const clock=text.match(/\btomorrow\s+(?:(at)\s+)?(\S+)(?:\s+(am|pm)\b)?/i);
    const explicit=clock && (clock[1] || /^\d/.test(clock[2]));
    const time=explicit?(clock[2]+(clock[3] || '')).match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i):null;
    let hour=9,minute=0;
    if(time){hour=Number(time[1]);minute=Number(time[2] || 0);if(minute>59 || (time[3]?hour<1 || hour>12:hour>23))throw new HttpError(400,'Choose a valid time for tomorrow in Singapore.');if(time[3])hour=hour%12+(/pm/i.test(time[3])?12:0);}
    else if(explicit || /\btomorrow\s+(?:at\b|(?:in\s+the\s+)?(?:morning|afternoon|evening|night|noon|midnight)\b)/i.test(text))throw new HttpError(400,'Use a valid time such as tomorrow at 15:30.');
    draft.scheduledAt=new Date(sg+'T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00+08:00').toISOString();
  }
  const frequency=text.match(/\b(once|weekly|monthly)\b/i);if(frequency)draft.frequency=frequency[1].toLowerCase();
  return draft;
}
module.exports={prepareDraft,extractDraft};
