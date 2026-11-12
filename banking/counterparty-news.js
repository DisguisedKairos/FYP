'use strict';
const {HttpError}=require('../models/errors');
const {assertCurrentUser}=require('./auth');
const {snapshot}=require('./history');
const publicResearch=require('./public-research');
const LIMIT=5,DAY=86400000;
const normalized=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const requested=message=>/\b(?:news|sanctions?|compliance|regulatory|regulators?|enforcement|adverse media)\b/i.test(message);
function industryTopic(value=''){
 const topics=[[/logistic|freight|transport|shipping|supply.chain/i,'logistics and transport'],[/manufactur|industrial|engineering/i,'manufacturing and engineering'],[/retail|wholesale|trading|commerce/i,'retail and wholesale trade'],[/technology|software|information|digital|comput/i,'technology and software'],[/construct|property|real.estate/i,'construction and property'],[/financial|bank|insurance|investment/i,'financial services'],[/food|hospitality|hotel|restaurant/i,'food and hospitality'],[/health|medical|pharma/i,'healthcare'],[/professional|consult|legal|accounting/i,'professional services']];
 return topics.find(([pattern])=>pattern.test(value))?.[1]||'general business';
}
function safeName(value){
 try{publicResearch.requestFor('company',{companyName:value},value);return true;}catch{return false;}
}
async function prepare(db,user,args,message,{now=Date.now}={}){
 if(!requested(message))throw new HttpError(400,'Ask explicitly for company news, sanctions or compliance research.');
 const company=args.company;
 if(company!==undefined&&(typeof company!=='string'||!safeName(company)||!normalized(message).includes(normalized(company))))throw new HttpError(400,'Use an exact recorded company name from your question.');
 const end=now(),start=end-90*DAY;
 return snapshot(db,async client=>{
  await assertCurrentUser(client,user);
  const fictional=new Set((await client.query('SELECT company_key FROM demo_counterparties WHERE user_id=$1',[user.id])).rows.map(r=>r.company_key));
  const industry=(await client.query('SELECT industry FROM businesses WHERE primary_user_id=$1',[user.id])).rows[0]?.industry;
  const rows=(await client.query("WITH labels AS (SELECT MIN(btrim(regexp_replace(t.counterparty,'[[:space:]]+',' ','g'))) AS company,MAX(t.completed_at) AS latest FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.user_id=$1 AND t.status='completed' AND NOT t.internal AND t.completed_at>=$2 AND t.completed_at<=$3 AND btrim(t.counterparty)<>'' AND NOT(t.type='credit' AND (t.reference='DEMO-OPENING' OR lower(btrim(t.description))='opening balance')) GROUP BY lower(btrim(regexp_replace(t.counterparty,'[[:space:]]+',' ','g')))) SELECT company,count(*) OVER()::int AS total FROM labels WHERE ($4::text IS NULL OR lower(company)=lower($4)) ORDER BY latest DESC,lower(company) LIMIT 51",[user.id,new Date(start).toISOString(),new Date(end).toISOString(),company?.trim().replace(/\s+/g,' ')||null])).rows;
  const fictionalCompaniesExcluded=rows.filter(row=>fictional.has(normalized(row.company))||/^gldb\s+demo\b/i.test(row.company)).length;
  const eligible=rows.filter(row=>safeName(row.company)&&!fictional.has(normalized(row.company))),companies=eligible.slice(0,LIMIT).map(row=>row.company),totalCompanyCount=rows[0]?.total||0;
  return {status:companies.length?'prepared':'no_counterparties',checkedAt:new Date(end).toISOString(),period:{from:new Date(start).toISOString(),to:new Date(end).toISOString(),days:90},companies,totalCompanyCount,omittedCompanyCount:Math.max(0,totalCompanyCount-companies.length),unsafeLabelsSkipped:rows.length-eligible.length-fictionalCompaniesExcluded,fictionalCompaniesExcluded,selectionLimit:LIMIT,industryTopic:industryTopic(industry),officialSources:publicResearch.OFFICIAL_SOURCES,scope:'Names from your completed external receipts in the last 90 days. A receipt label does not verify legal identity. Research is on demand; human identity matching and jurisdiction checks are required.'};
 });
}
function requestsFor(scan){
 if(!scan.companies.length)return [];
 const names=JSON.stringify(scan.companies);
 return [
  {kind:'counterparty_sanctions',title:'Official sanctions and compliance source check',checkedAt:scan.checkedAt,query:'Research each of these public company names individually: '+names+'. Search official sanctions list records and regulator enforcement notices, prioritizing Singapore MAS, UN Security Council and US OFAC. Cite company-specific primary records with issuer, publication/update date and identifiers visible in the source. State inaccessible or inconclusive sources and similarly named entities. A general list landing page does not establish a name search or a match. Never declare a company cleared, compliant, sanctioned or safe to pay based only on these names.'},
  {kind:'counterparty_news',title:'Counterparty and industry news',checkedAt:scan.checkedAt,query:'Find reliably dated recent public news about each of these company names: '+names+'. Separately summarize relevant public company developments in the '+JSON.stringify(scan.industryTopic)+' industry, prioritizing Singapore and reputable primary sources. Label older background, allegations and unresolved company identity. Other industry companies are public examples, not claimed banking counterparties. Give linked sources and explain any gaps. No payment or compliance decision is requested.'}
 ];
}
function finish(scan,outcomes){
 const reports=outcomes.filter(row=>row.status==='fulfilled').map(row=>row.value);
 const failures=outcomes.flatMap((row,index)=>row.status==='rejected'?[{kind:index===0?'counterparty_sanctions':'counterparty_news',message:index===0?'Official-source research was unavailable or unverified. Use the official source links for manual checks.':'Company and industry news research was unavailable or unverified. Retry later.'}]:[]);
 return {...scan,status:!scan.companies.length?'no_counterparties':failures.length===outcomes.length?'unavailable':failures.length?'partial':'completed',reports,failures,reviewRequired:true,items:[]};
}
module.exports={prepare,requestsFor,finish,requested,industryTopic,LIMIT};
