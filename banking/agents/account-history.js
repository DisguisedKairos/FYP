'use strict';

const history=require('../history');
const {cents}=require('../ledger');
const {assertActor}=require('./reports');
const {requestedPeriod}=require('../assistant-period');
const {periodBalances}=require('../account-period-balances');
const {HttpError}=require('../../models/errors');
const DAY=86400000;
function rangeFor(message,now){
  const period=requestedPeriod(message,{now});
  if(!period.from)return null;
  const range=history.dateRange(new URLSearchParams(period)),today=new Date(now()+8*3600000).toISOString().slice(0,10);
  if(range.to>today||Date.parse(range.end)-Date.parse(range.start)>366*DAY)throw new HttpError(400,'Choose past or current dates spanning at most 366 days. Future balances require a scheduled-payment projection.');
  return range;
}
async function balances(db,user,message,{now=Date.now}={}){
  const range=rangeFor(message,now);
  if(!range)return null;
  return history.snapshot(db,async client=>{
    await assertActor(client,user);
    const accounts=await periodBalances(client,user,range);
    const total=key=>cents(accounts.reduce((sum,a)=>sum+BigInt(a[key]),0n));
    return {period:{from:range.from,to:range.to,timeZone:'Asia/Singapore'},accounts,
      items:[{title:'Historical balance period',detail:range.from+' to '+range.to+' (inclusive, SGT); settled entries only'},
        {title:'Opening balance across your accounts',amountCents:total('openingBalanceCents')},
        {title:'Closing balance across your accounts',amountCents:total('closingBalanceCents')},
        {title:'Balance change during the period',amountCents:total('balanceChangeCents')},
        ...accounts.map(a=>({title:a.name,amountCents:a.closingBalanceCents,detail:'Period closing balance; account ending '+a.number.slice(-4)}))],actions:[]};
  });
}
async function search(db,user,args,message,{now=Date.now}={}){
  await assertActor(db,user);
  const range=rangeFor(message,now),filters={...args,...(range?{from:range.from,to:range.to}:{})};
  for(const key of ['status','type'])if(filters[key]==='all')delete filters[key];
  const result=await history.list(db,user,new URLSearchParams({...filters,pageSize:'20'}));
  const period=range?{from:range.from,to:range.to,timeZone:'Asia/Singapore',dateBasis:'Receipt date'}:null;
  return {total:result.pagination.total,totals:result.totals,period,filters,transactions:result.transactions,
    items:[...(period?[{title:'Transaction period',detail:period.from+' to '+period.to+' (inclusive, SGT); receipt dates'}]:[]),
      ...(filters.status||filters.type?[{title:'Transaction filters',detail:[filters.status&&'Status: '+({completed:'Completed',pending_review:'Awaiting review',rejected:'Rejected'}[filters.status]),filters.type&&'Type: '+({transfer:'Transfers',bill:'Bill payments',incoming:'Money in',outgoing:'Money out'}[filters.type])].filter(Boolean).join('; ')}]:[]),
      {title:'Matching transactions',detail:String(result.pagination.total)+' matching receipts; showing '+result.transactions.length+(result.pagination.total>result.transactions.length?'. Open Activity to view all matching records.':'.')},
      {title:'Completed money received in this search',amountCents:result.totals.incomeCents},
      {title:'Completed money paid in this search',amountCents:result.totals.outgoingCents},
      ...result.transactions.map(t=>({title:t.description,amountCents:t.amountCents,status:t.status,date:t.createdAt,detail:t.counterparty}))],
    actions:[{type:'navigate',page:'activity',label:'View matching transactions',filters}]};
}
module.exports={balances,search};
