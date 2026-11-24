'use strict';
const {createHash}=require('node:crypto');
const {createOperatorDatabase}=require('../database');
const {hashPassword}=require('../banking/security');
const businesses=require('../banking/business');
const {PROFILES}=require('../banking/industry-profiles');
const FIXTURE='gldb-industry-businesses-v1',PASSWORD='IndustryDemo123!';
const CASES=Object.freeze([
 {key:'logistics',cashFlow:[[22,18],[18,21],[27,24],[24,19]],incomeDescription:'Freight customer settlement',expenseDescription:'Carrier and port charges',name:'GLDB Demo Meridian Logistics Pte. Ltd.',industry:'Logistics and freight transport',fundingCents:8000000,partner:'GLDB Demo Straits Carrier Pte. Ltd.'},
 {key:'technology',cashFlow:[[12,7],[14,8],[16,9],[17,11]],incomeDescription:'Subscription customer settlement',expenseDescription:'Cloud infrastructure charges',name:'GLDB Demo Nimbus Cloud Pte. Ltd.',industry:'Technology and software services',fundingCents:12000000,partner:'GLDB Demo Cloud Infrastructure Pte. Ltd.'},
 {key:'manufacturing',cashFlow:[[25,28],[35,30],[20,32],[40,26]],incomeDescription:'Manufacturing order settlement',expenseDescription:'Component procurement',name:'GLDB Demo Precision Electronics Pte. Ltd.',industry:'Manufacturing and electronics engineering',fundingCents:20000000,partner:'GLDB Demo Component Supply Pte. Ltd.'},
 {key:'wholesale',cashFlow:[[45,40],[35,38],[60,55],[40,46]],incomeDescription:'Wholesale customer settlement',expenseDescription:'Imported goods procurement',name:'GLDB Demo Straits Wholesale Pte. Ltd.',industry:'Wholesale import and export trade',fundingCents:15000000,partner:'GLDB Demo Regional Goods Pte. Ltd.'},
 {key:'hospitality',cashFlow:[[50,45],[62,52],[44,48],[70,58]],incomeDescription:'Hospitality customer settlement',expenseDescription:'Food and operating supplies',name:'GLDB Demo Orchard Hospitality Pte. Ltd.',industry:'Food and hospitality operations',fundingCents:5000000,partner:'GLDB Demo Fresh Produce Pte. Ltd.'},
 {key:'construction',cashFlow:[[5,18],[65,28],[3,23],[80,30]],incomeDescription:'Project milestone settlement',expenseDescription:'Materials and subcontractor costs',name:'GLDB Demo Keystone Projects Pte. Ltd.',industry:'Construction and property services',fundingCents:18000000,partner:'GLDB Demo Building Materials Pte. Ltd.'},
 {key:'healthcare',cashFlow:[[22,17],[20,19],[25,18],[23,21]],incomeDescription:'Healthcare distribution settlement',expenseDescription:'Medical product procurement',name:'GLDB Demo Clearwell Medical Pte. Ltd.',industry:'Healthcare and medical supplies',fundingCents:9000000,partner:'GLDB Demo Medical Distribution Pte. Ltd.'},
 {key:'energy',cashFlow:[[5,12],[35,8],[2,15],[55,13]],incomeDescription:'Energy project milestone settlement',expenseDescription:'Energy equipment procurement',name:'GLDB Demo Aurora Renewables Pte. Ltd.',industry:'Renewable energy services',fundingCents:25000000,partner:'GLDB Demo Solar Equipment Pte. Ltd.'}
].map((sample,index)=>Object.freeze({...sample,email:sample.key+'-business@greenlink.demo',registration:'GLDB-DEMO-'+sample.key.toUpperCase(),number:'109910'+String(index+1).padStart(2,'0')+'01',reserveNumber:'109910'+String(index+1).padStart(2,'0')+'02'})));
const idFor=value=>{const h=createHash('sha256').update(FIXTURE+':'+value).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
async function seedIndustryBusinesses(db,{now=Date.now}={}){
 return db.transaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('greenlink:industry-businesses:'||current_schema(),0))");
  const result={fixture:FIXTURE,createdUsers:0,newAccounts:0,newReceipts:0,newProfiles:0,accounts:[]};
  const date=days=>new Date(now()-days*86400000).toISOString();
  for(const sample of CASES){
   let user=(await client.query('SELECT * FROM users WHERE email=$1 FOR UPDATE',[sample.email])).rows[0],created=false;
   if(!user){user=(await client.query("INSERT INTO users(name,email,password_hash,role,created_at) VALUES($1,$2,$3,'customer',$4) RETURNING *",[PROFILES[sample.key].label+' operator',sample.email,await hashPassword(PASSWORD),date(120)])).rows[0];created=true;result.createdUsers++;}
   if(user.role!=='customer')throw new Error('An industry-demo identity must remain a customer business operator.');
   if(!created&&!(await client.query("SELECT 1 FROM audit_log WHERE target_user_id=$1 AND event_type='operator.industry_demo_seeded' AND metadata->>'fixture'=$2 AND metadata->>'key'=$3 LIMIT 1",[user.id,FIXTURE,sample.key])).rowCount)throw new Error('A reserved industry-demo email belongs to an unrelated identity; no records were changed.');
   let business=(await client.query('SELECT * FROM businesses WHERE primary_user_id=$1',[user.id])).rows[0];
   if(!business&&created)business=await businesses.create(client,user,{legalName:sample.name,registrationNumber:sample.registration,country:'SG',legalForm:'company',industry:sample.industry,registeredAddress:'1 Fictional Industry Demo Avenue, Singapore 000001'},{now:()=>now()-120*86400000,status:'approved'});
   if(!business||(business.registration_number||business.registrationNumber)!==sample.registration||business.status!=='approved')throw new Error('An industry-demo business changed or uses unrelated registration details; review is required.');
   let changed=created;
   for(const [reserve,number] of [[false,sample.number],[true,sample.reserveNumber]]){
    let account=(await client.query('SELECT * FROM accounts WHERE number=$1 FOR UPDATE',[number])).rows[0];
    if(!account){account=(await client.query("INSERT INTO accounts(user_id,business_id,name,number,opening_provenance,created_at) VALUES($1,$2,$3,$4,'seed',$5) RETURNING *",[user.id,business.id,reserve?'Industry liquidity reserve':'Industry operating savings',number,date(120)])).rows[0];result.newAccounts++;changed=true;}
    if(String(account.user_id)!==String(user.id)||String(account.business_id)!==String(business.id)||account.opening_provenance!=='seed'||account.status!=='active')throw new Error('An industry-demo account number is unavailable or changed; no funds were added.');
    let delta=0;
    async function receipt(suffix,amount,counterparty,days,opening=false){
     const id=idFor(sample.key+':'+suffix),prior=(await client.query('SELECT account_id,amount_cents,counterparty,status FROM transactions WHERE id=$1',[id])).rows[0];
     if(prior){if(String(prior.account_id)!==String(account.id)||Number(prior.amount_cents)!==amount||prior.counterparty!==counterparty||prior.status!=='completed')throw new Error('An industry-demo receipt has conflicting existing data.');return;}
     await client.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,created_at,requested_at,completed_at,settlement_seq,payee) VALUES($1,$2,$3,$4,$5,$6,'completed',$7,$8,$8,$8,nextval('settlement_sequence'),$6)",[id,account.id,amount>0?'credit':'transfer',opening?'Fictional industry demonstration opening funds':'Fictional '+(amount>0?sample.incomeDescription:sample.expenseDescription),amount,counterparty,opening?'DEMO-OPENING':'INDUSTRY-DEMO',date(days)]);
     delta+=amount;result.newReceipts++;changed=true;
    }
    await receipt(reserve?'reserve-opening':'operating-opening',reserve?Math.floor(sample.fundingCents/4):sample.fundingCents,'Demo opening funding',120,true);
    if(!reserve)for(const [index,days] of [95,65,35,5].entries()){
     await receipt('customer-'+index,Math.floor(sample.fundingCents*sample.cashFlow[index][0]/100),'GLDB Demo Industry Customer Pte. Ltd.',days);
     await receipt('supplier-'+index,-Math.floor(sample.fundingCents*sample.cashFlow[index][1]/100),sample.partner,days-1);
    }
    if(delta)await client.query('UPDATE accounts SET balance_cents=balance_cents+$2 WHERE id=$1',[account.id,delta]);
   }
   const profile=PROFILES[sample.key];
   const inserted=await client.query('INSERT INTO business_advisory_profiles(business_id,profile_key,settings_json,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(business_id) DO NOTHING',[business.id,profile.key,profile.defaults,date(0)]);
   if(inserted.rowCount){result.newProfiles++;changed=true;}
   if(changed)await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata,created_at) VALUES($1,$1,'operator.industry_demo_seeded',$2,$3)",[user.id,{fixture:FIXTURE,key:sample.key,fictionalBusiness:true,sampleFunds:true,approvedForEducationalDemo:true},date(0)]);
   result.accounts.push({email:sample.email,company:sample.name,industry:sample.industry,operatingAccount:sample.number,reserveAccount:sample.reserveNumber,existingCredentialsPreserved:!created});
  }
  return result;
 });
}
async function main(){
 const {sameTarget,secureNeonUrl}=require('../database/neon');
 if(!process.env.MIGRATION_DATABASE_URL)throw new Error('Use the private migration credentials to create the dedicated business demonstrations.');
 if(new URL(process.env.MIGRATION_DATABASE_URL).hostname.endsWith('.neon.tech')){secureNeonUrl(process.env.MIGRATION_DATABASE_URL);if(!sameTarget(process.env.MIGRATION_DATABASE_URL,process.env.DATABASE_URL))throw new Error('Runtime and migration connections must target the same Neon database.');}
 const db=createOperatorDatabase();try{await db.migrate();console.log(JSON.stringify(await seedIndustryBusinesses(db),null,2));}finally{await db.close();}
}
module.exports={seedIndustryBusinesses,CASES,PASSWORD,FIXTURE};
if(require.main===module)main().catch(error=>{console.error('Industry demonstration setup failed: '+error.message);process.exitCode=1;});
