'use strict';

// Report numbers come from one read-only ledger snapshot, never model output.
const {HttpError}=require('../models/errors');
const {assertCurrentUser}=require('./auth');
const {snapshot,dateRange}=require('./history');
const {cents}=require('./ledger');
const {requestedPeriod}=require('./company-activity');
const businesses=require('./business');
const MAX_ROWS=10000,DAY=86400000;
const iso=value=>value?new Date(value).toISOString():null;
const day=value=>new Date(value+8*3600000).toISOString().slice(0,10);
const WHEN='COALESCE(t.completed_at,t.requested_at)';
function rangeFor(params,now){
  for(const key of params.keys())if(!['from','to','format'].includes(key))throw new HttpError(400,'Unsupported finance report filter.');
  const today=day(now()),range=dateRange(params,{from:today.slice(0,7)+'-01',to:today});
  if(range.to>today || Date.parse(range.end)-Date.parse(range.start)>366*DAY)throw new HttpError(400,'Choose a past or current finance report period of at most 366 days.');
  return range;
}
function paramsForMessage(message,{now=Date.now}={}){
  const period=requestedPeriod(message,{now});
  if(!period.from && /\btoday\b/i.test(message))period.from=period.to=day(now());
  if(!period.from && /\byesterday\b/i.test(message))period.from=period.to=day(now()-DAY);
  if(!period.from && /\b(?:week|weeks|year|years|quarter|quarters|since|between|until|before|after|hours?)\b/i.test(message))throw new HttpError(400,'For this report, specify two YYYY-MM-DD dates, today, yesterday, this month, last month, or last N days.');
  return new URLSearchParams(period);
}
async function create(db,user,params=new URLSearchParams(),{now=Date.now}={}){
  const range=rangeFor(params,now);
  return snapshot(db,async client=>{
    await assertCurrentUser(client,user);
    const generatedAt=iso(now()),business=await businesses.own(client,user);
    const accounts=(await client.query('SELECT id::text,name,number,status,balance_cents FROM accounts WHERE user_id=$1 ORDER BY id',[user.id])).rows.map(row=>({id:row.id,name:row.name,number:row.number,status:row.status,balanceCents:cents(row.balance_cents)}));
    const rows=(await client.query(`SELECT t.id,t.type,t.description,t.amount_cents,t.counterparty,t.status,t.reference,t.internal,t.requested_at,t.completed_at,
      a.id::text AS account_id,a.name AS account_name,a.number AS account_number
      FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.user_id=$1 AND ${WHEN}>=$2::timestamptz AND ${WHEN}<$3::timestamptz AND ${WHEN}<=$4::timestamptz
      ORDER BY ${WHEN} DESC,t.insert_seq DESC LIMIT $5`,[user.id,range.start,range.end,generatedAt,MAX_ROWS+1])).rows;
    if(rows.length>MAX_ROWS)throw new HttpError(413,'This finance report exceeds 10,000 ledger entries. Choose a shorter date range.');
    const totals={balanceCents:cents(accounts.reduce((sum,a)=>sum+BigInt(a.balanceCents),0n)),incomeCents:0,outgoingCents:0,netCents:0,completedCount:0,pendingCount:0,rejectedCount:0,pendingOutgoingCents:0,rejectedOutgoingCents:0,transactionCount:rows.length};
    let incoming=0n,outgoing=0n,pending=0n,rejected=0n;
    const grouped=new Map(),transactions=[];
    for(const row of rows){
      const value=BigInt(row.amount_cents),opening=row.type==='credit' && (row.reference==='DEMO-OPENING' || row.description.trim().toLowerCase()==='opening balance');
      if(row.status==='completed')totals.completedCount++;
      else if(row.status==='pending_review'){totals.pendingCount++;if(value<0n)pending-=value;}
      else if(row.status==='rejected'){totals.rejectedCount++;if(value<0n)rejected-=value;}
      const external=!row.internal && !opening;
      if(external){
        const label=(row.counterparty||'Unspecified counterparty').trim().replace(/\s+/g,' '),key=label.toLowerCase();
        if(!grouped.has(key))grouped.set(key,{company:label,incoming:0n,outgoing:0n,completedCount:0,pendingCount:0,rejectedCount:0});
        const company=grouped.get(key);
        if(row.status==='completed'){company.completedCount++;if(value>0n){incoming+=value;company.incoming+=value;}else{outgoing-=value;company.outgoing-=value;}}
        else if(row.status==='pending_review')company.pendingCount++;
        else if(row.status==='rejected')company.rejectedCount++;
      }
      transactions.push({id:row.id,type:row.type,accountId:row.account_id,accountName:row.account_name,accountNumber:row.account_number,description:row.description,counterparty:row.counterparty,reference:row.reference,status:row.status,amountCents:cents(row.amount_cents),internal:row.internal,openingBalance:opening,requestedAt:iso(row.requested_at),completedAt:iso(row.completed_at)});
    }
    Object.assign(totals,{incomeCents:cents(incoming),outgoingCents:cents(outgoing),netCents:cents(incoming-outgoing),pendingOutgoingCents:cents(pending),rejectedOutgoingCents:cents(rejected)});
    const companies=[...grouped.values()].sort((a,b)=>{const left=a.incoming+a.outgoing,right=b.incoming+b.outgoing;return left===right?a.company.localeCompare(b.company):left>right?-1:1;}).map(row=>({company:row.company,incomeCents:cents(row.incoming),outgoingCents:cents(row.outgoing),netCents:cents(row.incoming-row.outgoing),completedCount:row.completedCount,pendingCount:row.pendingCount,rejectedCount:row.rejectedCount}));
    return {title:'Business finance activity report',generatedAt,currency:'SGD',business:business?{legalName:business.legalName,registrationNumber:business.registrationNumber}:null,period:{from:range.from,to:range.to,timeZone:'Asia/Singapore'},totals,accounts,companies,transactions,
      notes:['Balances are current at the report snapshot, not historical period closing balances.','Received, paid and net movement use completed external entries only; own-account transfers and opening funds are excluded.','Pending and rejected requests never change these cash-flow totals. Pending requests do not reserve funds.','Completed activity uses settlement time; pending and rejected activity uses request time. Dates are inclusive in Singapore time.','This is a banking activity report using sample funds, not a full accounting statement or audited financial report.']};
  });
}
function summary(report){
  const {transactions,companies,...rest}=report;
  return {...rest,companies:companies.slice(0,10),companyCount:companies.length,items:[
    {title:'Current account balances',amountCents:report.totals.balanceCents},
    {title:'Received from external accounts',amountCents:report.totals.incomeCents},
    {title:'Paid to external accounts and billers',amountCents:report.totals.outgoingCents},
    {title:'Net external movement',amountCents:report.totals.netCents},
    {title:'Awaiting review',subtitle:String(report.totals.pendingCount)+' requests; funds are not reserved',amountCents:report.totals.pendingOutgoingCents},
    {title:'Rejected requests',subtitle:String(report.totals.rejectedCount)+' requests; no funds moved',amountCents:report.totals.rejectedOutgoingCents}
  ]};
}
const text=value=>{const valueText=String(value??'');return '"'+(/^[\s\u0000-\u001f]*[=+\-@\t\r\n]/.test(valueText)?"'"+valueText:valueText).replace(/"/g,'""')+'"';};
const decimal=value=>{const n=BigInt(value),absolute=n<0n?-n:n;return (n<0n?'-':'')+absolute/100n+'.'+String(absolute%100n).padStart(2,'0');};
function csv(report){
  const lines=[],line=(...fields)=>lines.push(fields.map(text).join(',')),metric=(label,value)=>lines.push(text(label)+','+decimal(value));
  line(report.title);line('Business',report.business?.legalName||'Business profile not linked');line('Registration number',report.business?.registrationNumber||'');line('Generated at (UTC)',report.generatedAt);line('Generated at (SGT)',new Date(report.generatedAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT');line('Period from (SGT)',report.period.from);line('Period to (SGT)',report.period.to);line('Currency',report.currency);line();
  line('Summary','Amount SGD');for(const [label,key] of [['Current account balances','balanceCents'],['Received - external completed','incomeCents'],['Paid - external completed','outgoingCents'],['Net external movement','netCents'],['Pending outgoing - not reserved','pendingOutgoingCents'],['Rejected outgoing - no funds moved','rejectedOutgoingCents']])metric(label,report.totals[key]);
  line('Completed entries',report.totals.completedCount);line('Awaiting review entries',report.totals.pendingCount);line('Rejected entries',report.totals.rejectedCount);line();
  line('Current accounts');line('Account','Account number','Status','Current balance SGD');for(const row of report.accounts)lines.push([text(row.name),text(row.number),text(row.status),decimal(row.balanceCents)].join(','));line();
  line('Company activity');line('Recorded counterparty','Received SGD','Paid SGD','Net SGD','Completed','Awaiting review','Rejected');for(const row of report.companies)lines.push([text(row.company),decimal(row.incomeCents),decimal(row.outgoingCents),decimal(row.netCents),row.completedCount,row.pendingCount,row.rejectedCount].join(','));line();
  line('Ledger entries');line('Activity at (UTC)','Requested at (UTC)','Completed at (UTC)','Account','Account number','Type','Description','Counterparty','Amount SGD','Status','Reference','Transaction ID','Own-account transfer','Opening funds');
  for(const row of report.transactions)lines.push([row.completedAt||row.requestedAt,row.requestedAt,row.completedAt,row.accountName,row.accountNumber,row.type,row.description,row.counterparty,null,row.status,row.reference,row.id,row.internal?'Yes':'No',row.openingBalance?'Yes':'No'].map((value,index)=>index===8?decimal(row.amountCents):text(value)).join(','));
  line();for(const note of report.notes)line('Note',note);
  const content='\uFEFF'+lines.join('\r\n')+'\r\n';
  if(Buffer.byteLength(content)>4000000)throw new HttpError(413,'This CSV report is too large. Choose a shorter period.');
  return {content,filename:'greenlink-finance-'+report.period.from+'-to-'+report.period.to+'.csv'};
}
module.exports={create,summary,csv,paramsForMessage,decimal};
