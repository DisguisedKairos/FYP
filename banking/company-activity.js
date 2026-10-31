'use strict';

const {HttpError}=require('../models/errors');
const {assertCurrentUser}=require('./auth');
const {snapshot,dateRange,pagination}=require('./history');
const {cents,transactionView}=require('./ledger');
const DAY=86400000;
const day=value=>new Date(value+8*3600000).toISOString().slice(0,10);
const normalize=value=>value.trim().replace(/\s+/g,' ').toLowerCase();
// Group receipt labels, not a global customer directory or a model-generated query.
const LABEL="btrim(regexp_replace(t.counterparty,'[[:space:]]+',' ','g'))";
const WHEN='COALESCE(t.completed_at,t.requested_at)';
const BASE="FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.user_id=$1 AND NOT t.internal AND NOT(t.type='credit' AND (t.reference='DEMO-OPENING' OR lower(btrim(t.description))='opening balance'))";
function parameter(params,key){if(params.getAll(key).length>1)throw new HttpError(400,'Supply '+key+' only once.');return params.get(key)||'';}
function period(params,now){
  const today=day(now()),requested=dateRange(params),to=requested.to||today;
  const from=requested.from||day(Date.parse(to+'T00:00:00+08:00')-89*DAY);
  const range=dateRange(new URLSearchParams({from,to}));
  if(from>to || to>today || Date.parse(range.end)-Date.parse(range.start)>366*DAY)throw new HttpError(400,'Choose a past or current date range of at most 366 days.');
  return range;
}
function requestedPeriod(message,{now=Date.now}={}){
  const dates=message.match(/\b\d{4}-\d{2}-\d{2}\b/g)||[];
  if(dates.length){
    if(dates.length!==2)throw new HttpError(400,'Use two YYYY-MM-DD dates, or adjust the dates on Company activity.');
    return {from:dates[0],to:dates[1]};
  }
  const today=day(now()),relative=/\b(?:last|past)\s+(\d+)\s+days?\b/i.exec(message);
  if(relative){const days=Number(relative[1]);if(days<1 || days>366)throw new HttpError(400,'Choose between 1 and 366 days.');return {from:day(now()-(days-1)*DAY),to:today};}
  if(/\b(?:this|current) month\b/i.test(message))return {from:today.slice(0,7)+'-01',to:today};
  if(/\blast month\b/i.test(message)){
    const end=Date.parse(today.slice(0,7)+'-01T00:00:00+08:00')-DAY,to=day(end);return {from:to.slice(0,7)+'-01',to};
  }
  // The dashboard always displays its explicit default window; other periods
  // can be selected in its date form rather than guessed by the model.
  return {};
}
async function dashboard(db,user,params=new URLSearchParams(),{now=Date.now,exactCompany=false}={}){
  for(const key of params.keys())if(!['company','scope','from','to','page','pageSize'].includes(key))throw new HttpError(400,'Unsupported company activity filter.');
  const scope=parameter(params,'scope');
  if(scope && !['all','company'].includes(scope))throw new HttpError(400,'Choose all companies or a specific company.');
  if(scope==='all' && parameter(params,'company'))throw new HttpError(400,'An all-company summary cannot also select a company.');
  if(scope==='all')return summary(db,user,params,{now});
  const query=parameter(params,'company').trim().replace(/\s+/g,' ');
  if(query && (query.length<2 || query.length>120 || /[\x00-\x1f\x7f]/.test(query)))throw new HttpError(400,'Enter a company name of 2-120 characters.');
  const range=period(params,now),paging=pagination(params);
  return snapshot(db,async client=>{
    await assertCurrentUser(client,user);
    const values=[user.id],escaped=query.replace(/[\\%_]/g,c=>'\\'+c);
    let match='';
    if(query){values.push('%'+escaped+'%');match=' AND '+LABEL+" ILIKE $2 ESCAPE '\\'";}
    // All-time owned labels let a known company still return an empty period.
    const candidates=(await client.query('SELECT MIN('+LABEL+') AS name '+BASE+' AND '+LABEL+"<>''"+match+' GROUP BY lower('+LABEL+') ORDER BY lower('+LABEL+') LIMIT 21',values)).rows;
    const exact=candidates.find(row=>normalize(row.name)===normalize(query));
    let selected=exact;
    // An exact label can sort past the bounded suggestion page.
    if(query && !selected){selected=(await client.query('SELECT MIN('+LABEL+') AS name '+BASE+' AND lower('+LABEL+')=lower($2) GROUP BY lower('+LABEL+')',[user.id,query])).rows[0];}
    if(!exactCompany && !selected && query && candidates.length===1)selected=candidates[0];
    const common={query,period:{from:range.from,to:range.to,timeZone:'Asia/Singapore',dateBasis:'Completed date for settled payments; request date for pending or rejected payments.'},currency:'SGD',generatedAt:new Date(now()).toISOString(),scope:'Only transactions on your accounts. Names are grouped by recorded counterparty label, not verified company identity. Own-account transfers and opening balances are excluded.'};
    if(!selected)return {...common,status:query?(candidates.length?'ambiguous':'not_found'):'choose_company',companies:candidates.slice(0,20).map(row=>row.name),moreCompanies:candidates.length>20};
    const paramsValues=[user.id,selected.name,range.start,range.end];
    const where=BASE+' AND lower('+LABEL+')=lower($2) AND '+WHEN+'>=$3::timestamptz AND '+WHEN+'<$4::timestamptz';
    const sums=(await client.query("SELECT count(*) AS total,count(*) FILTER(WHERE t.status='completed') AS completed,count(*) FILTER(WHERE t.status='pending_review') AS pending,count(*) FILTER(WHERE t.status='rejected') AS rejected,COALESCE(SUM(t.amount_cents) FILTER(WHERE t.status='completed' AND t.amount_cents>0),0) AS incoming,COALESCE(SUM(-t.amount_cents) FILTER(WHERE t.status='completed' AND t.amount_cents<0),0) AS outgoing "+where,paramsValues)).rows[0];
    const monthly=(await client.query("SELECT to_char("+WHEN+" AT TIME ZONE 'Asia/Singapore','YYYY-MM') AS month,COALESCE(SUM(t.amount_cents) FILTER(WHERE t.amount_cents>0),0) AS incoming,COALESCE(SUM(-t.amount_cents) FILTER(WHERE t.amount_cents<0),0) AS outgoing "+where+" AND t.status='completed' GROUP BY month ORDER BY month",paramsValues)).rows;
    const months=[];
    for(let current=range.from.slice(0,7);current<=range.to.slice(0,7);){
      const row=monthly.find(row=>row.month===current);months.push({month:current,incomeCents:cents(row?.incoming||0),outgoingCents:cents(row?.outgoing||0)});
      const date=new Date(current+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+1);current=date.toISOString().slice(0,7);
    }
    const total=cents(sums.total),totalPages=Math.ceil(total/paging.pageSize),page=totalPages?Math.min(paging.page,totalPages):1;
    const rows=(await client.query('SELECT t.*,a.name AS account_name,a.number AS account_number '+where+' ORDER BY '+WHEN+' DESC,t.insert_seq DESC LIMIT $5 OFFSET $6',[...paramsValues,paging.pageSize,(page-1)*paging.pageSize])).rows;
    const incomeCents=cents(sums.incoming),outgoingCents=cents(sums.outgoing);
    return {...common,status:'ready',company:selected.name,totals:{incomeCents,outgoingCents,netCents:cents(BigInt(sums.incoming)-BigInt(sums.outgoing)),completedCount:cents(sums.completed),pendingCount:cents(sums.pending),rejectedCount:cents(sums.rejected)},months,transactions:rows.map(transactionView),pagination:{page,pageSize:paging.pageSize,total,totalPages}};
  });
}

function monetary(row){
  return {incomeCents:cents(row.incoming),outgoingCents:cents(row.outgoing),netCents:cents(BigInt(row.incoming)-BigInt(row.outgoing)),completedCount:cents(row.completed),pendingCount:cents(row.pending),rejectedCount:cents(row.rejected)};
}
const SUMS="count(*) AS total,count(*) FILTER(WHERE t.status='completed') AS completed,count(*) FILTER(WHERE t.status='pending_review') AS pending,count(*) FILTER(WHERE t.status='rejected') AS rejected,COALESCE(SUM(t.amount_cents) FILTER(WHERE t.status='completed' AND t.amount_cents>0),0) AS incoming,COALESCE(SUM(-t.amount_cents) FILTER(WHERE t.status='completed' AND t.amount_cents<0),0) AS outgoing";
async function summary(db,user,params,{now=Date.now}={}){
  const range=period(params,now),paging=pagination(params),values=[user.id,range.start,range.end];
  return snapshot(db,async client=>{
    await assertCurrentUser(client,user);
    const where=BASE+' AND '+LABEL+"<>'' AND "+WHEN+'>=$2::timestamptz AND '+WHEN+'<$3::timestamptz';
    const total=(await client.query('SELECT '+SUMS+',count(DISTINCT lower('+LABEL+')) AS companies '+where,values)).rows[0];
    const count=cents(total.companies),totalPages=Math.ceil(count/paging.pageSize),page=totalPages?Math.min(paging.page,totalPages):1;
    const companies=(await client.query('SELECT MIN('+LABEL+') AS company,'+SUMS+' '+where+' GROUP BY lower('+LABEL+') ORDER BY SUM(abs(t.amount_cents)) FILTER(WHERE t.status=\'completed\') DESC NULLS LAST,lower('+LABEL+') LIMIT $4 OFFSET $5',[...values,paging.pageSize,(page-1)*paging.pageSize])).rows.map(row=>({company:row.company,...monetary(row),transactionCount:cents(row.total)}));
    const monthly=(await client.query("SELECT to_char("+WHEN+" AT TIME ZONE 'Asia/Singapore','YYYY-MM') AS month,COALESCE(SUM(t.amount_cents) FILTER(WHERE t.amount_cents>0),0) AS incoming,COALESCE(SUM(-t.amount_cents) FILTER(WHERE t.amount_cents<0),0) AS outgoing "+where+" AND t.status='completed' GROUP BY month",values)).rows;
    const months=[];for(let month=range.from.slice(0,7);month<=range.to.slice(0,7);){const row=monthly.find(r=>r.month===month);months.push({month,incomeCents:cents(row?.incoming||0),outgoingCents:cents(row?.outgoing||0)});const date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+1);month=date.toISOString().slice(0,7);}
    return {status:'ready',scopeType:'all',company:'All companies',currency:'SGD',period:{from:range.from,to:range.to,timeZone:'Asia/Singapore',dateBasis:'Completed date for settled payments; request date for pending or rejected payments.'},scope:'Only transactions on your accounts. Companies and billers are grouped by recorded counterparty name, not verified legal identity. Own-account transfers and opening balances are excluded.',generatedAt:new Date(now()).toISOString(),totals:{...monetary(total),companyCount:count,transactionCount:cents(total.total)},months,companies,pagination:{page,pageSize:paging.pageSize,total:count,totalPages}};
  });
}
function definition(data,message=''){
  const selected=requestedPeriod(message),relative=/\b(?:last|past)\s+(\d+)\s+days?\b/i.exec(message);
  return {scope:data.scopeType==='all'?'all':'company',company:data.scopeType==='all'?'':data.company,period:relative?{kind:'rolling',days:Number(relative[1])}:!selected.from && !selected.to?{kind:'rolling',days:90}:{kind:'fixed',from:data.period.from,to:data.period.to}};
}
function assistantResult(data,viewDefinition){
  const filters={company:data.scopeType==='all'?'':data.company||data.query,scope:data.scopeType==='all'?'all':'company',from:data.period.from,to:data.period.to};
  const actions=data.status==='ambiguous'?data.companies.slice(0,8).map(name=>({type:'navigate',page:'companyActivity',filters:{...filters,company:name},label:'View '+name})):[{type:'navigate',page:'companyActivity',filters,label:'Open company dashboard'}];
  const items=data.status==='ready'?[{title:'Money received - '+data.company,amountCents:data.totals.incomeCents},{title:'Money paid - '+data.company,amountCents:data.totals.outgoingCents},{title:'Net movement - '+data.company,amountCents:data.totals.netCents},{title:'Completed payments',subtitle:String(data.totals.completedCount)},{title:'Awaiting review',subtitle:String(data.totals.pendingCount)},{title:'Rejected payments',subtitle:String(data.totals.rejectedCount)},...(data.scopeType==='all'?data.companies.slice(0,8).map(row=>({title:row.company,amountCents:row.netCents,subtitle:'Received '+(row.incomeCents/100).toFixed(2)+' SGD; paid '+(row.outgoingCents/100).toFixed(2)+' SGD'})):[])]:[{title:data.status==='ambiguous'?'Choose a recorded company name':data.status==='not_found'?'No matching company in your transaction history':'Choose a company',subtitle:data.scope}];
  const receipts=data.transactions?.map(t=>({id:t.id,type:t.type,description:t.description,reference:t.reference,amountCents:t.amountCents,status:t.status,date:t.completedAt||t.requestedAt}));
  return {...data,...(receipts?{transactions:receipts}:{}),actions,items:[...items,{title:'Dashboard period',subtitle:data.period.from+' to '+data.period.to+' (SGT)'}],...(data.status==='ready'?{viewDefinition}: {})};
}
async function assistantDashboard(db,user,{company},message,{now=Date.now}={}){
  if(company!==undefined && (typeof company!=='string' || !normalize(company) || !normalize(message).includes(normalize(company))))throw new HttpError(400,'Use a company name from your message.');
  const data=await dashboard(db,user,new URLSearchParams({...company?{company}:{scope:'all'},...requestedPeriod(message,{now}),pageSize:'10'}),{now});
  return assistantResult(data,data.status==='ready'?definition(data,message):null);
}
module.exports={dashboard,assistantDashboard,assistantResult,requestedPeriod,definition};
