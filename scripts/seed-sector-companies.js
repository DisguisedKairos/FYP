'use strict';
const {createHash}=require('node:crypto');
const {createOperatorDatabase}=require('../database');
const {hashPassword}=require('../banking/security');
const businesses=require('../banking/business');
const cases=require('./fixtures/sector-companies');
const FIXTURE='gldb-sector-portfolio-v1',EMAIL='sector-tester@greenlink.demo',PASSWORD='Greenlink123!',NUMBER='1099007001';
const key=value=>value.trim().replace(/\s+/g,' ').toLowerCase();
function idFor(value){const h=createHash('sha256').update(FIXTURE+':'+value).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
async function seedSectorCompanies(db,{now=Date.now}={}){
 const passwordHash=await hashPassword(PASSWORD),date=days=>new Date(now()-days*86400000).toISOString();
 return db.transaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('greenlink:sector-demo:'||current_schema(),0))");
  let user=(await client.query('SELECT * FROM users WHERE email=$1 FOR UPDATE',[EMAIL])).rows[0],created=false;
  if(!user){user=(await client.query("INSERT INTO users(name,email,password_hash,role,created_at) VALUES('Sector Portfolio Tester',$1,$2,'customer',$3) RETURNING *",[EMAIL,passwordHash,date(100)])).rows[0];created=true;}
  if(!created&&!(await client.query("SELECT 1 FROM audit_log WHERE target_user_id=$1 AND event_type='operator.sector_demo_seeded' AND metadata->>'fixture'=$2 LIMIT 1",[user.id,FIXTURE])).rowCount)throw new Error('The demonstration email is already used by an unrelated identity; no records were changed.');
  if(user.role!=='customer')throw new Error('The sector-demo identity must remain a business operator.');
  let business=(await client.query('SELECT * FROM businesses WHERE primary_user_id=$1',[user.id])).rows[0];
  if(!business&&created)business=await businesses.create(client,user,{legalName:'GLDB Demo Sector Portfolio Pte. Ltd.',registrationNumber:'GLDB-DEMO-SECTOR-PORTFOLIO',country:'SG',legalForm:'company',industry:'Wholesale business services',registeredAddress:'1 Fictional Demo Lane, Singapore 000001'},{now:()=>now()-100*86400000,status:'approved'});
  if(!business||business.registration_number&&business.registration_number!=='GLDB-DEMO-SECTOR-PORTFOLIO'||business.registrationNumber&&business.registrationNumber!=='GLDB-DEMO-SECTOR-PORTFOLIO')throw new Error('The sector-demo email is already used by another business; no records were changed.');
  if(business.status!=='approved')throw new Error('The demonstration business is no longer approved; operator review is required.');
  let account=(await client.query('SELECT * FROM accounts WHERE number=$1 FOR UPDATE',[NUMBER])).rows[0];
  if(!account)account=(await client.query("INSERT INTO accounts(user_id,business_id,name,number,opening_provenance,created_at) VALUES($1,$2,'Sector demonstration savings',$3,'seed',$4) RETURNING *",[user.id,business.id,NUMBER,date(100)])).rows[0];
  if(String(account.user_id)!==String(user.id)||account.opening_provenance!=='seed'||String(account.business_id)!==String(business.id))throw new Error('The demonstration account number belongs to another record.');
  if(account.status!=='active')throw new Error('The demonstration account is not active; no funds were added.');
  let inserted=0,delta=0,newProfiles=0;
  async function receipt(suffix,amount,company,days,opening=false){
   const id=idFor(suffix),prior=(await client.query('SELECT account_id,amount_cents,counterparty FROM transactions WHERE id=$1',[id])).rows[0];
   if(prior){if(String(prior.account_id)!==String(account.id)||Number(prior.amount_cents)!==amount||prior.counterparty!==company)throw new Error('A sector-demo receipt identifier has different existing data.');return;}
   await client.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,internal,created_at,requested_at,completed_at,settlement_seq,payee) VALUES($1,$2,$3,$4,$5,$6,'completed',$7,false,$8,$8,$8,nextval('settlement_sequence'),$6)",[id,account.id,amount>0?'credit':'transfer',opening?'Fictional demonstration opening funds':'Fictional sector portfolio receipt',amount,company,opening?'DEMO-OPENING':'SECTOR-DEMO-'+suffix,date(days)]);
   inserted++;delta+=amount;
  }
  await receipt('opening',25000000,'Demo opening funding',100,true);
  for(const sample of cases){
   const fixtureKey=FIXTURE+':'+sample.key,prior=(await client.query('SELECT * FROM demo_counterparties WHERE user_id=$1 AND company_key=$2',[user.id,key(sample.name)])).rows[0];
   if(prior&&prior.fixture_key!==fixtureKey)throw new Error('An unrelated counterparty profile already uses this demo label.');
   if(!prior){await client.query('INSERT INTO demo_counterparties(id,user_id,company,company_key,sector,flags_json,receipt_ids_json,fixture_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[idFor('profile:'+sample.key),user.id,sample.name,key(sample.name),sample.sector,JSON.stringify(sample.flags),JSON.stringify([idFor(sample.key+':paid-recent'),idFor(sample.key+':paid-earlier'),...(sample.receivedCents?[idFor(sample.key+':received')]:[])]),fixtureKey,date(100)]);newProfiles++;}
   await receipt(sample.key+':paid-recent',-Math.floor(sample.paidCents/2),sample.name,3);
   await receipt(sample.key+':paid-earlier',-(sample.paidCents-Math.floor(sample.paidCents/2)),sample.name,35);
   if(sample.receivedCents)await receipt(sample.key+':received',sample.receivedCents,sample.name,7);
  }
  if(delta)await client.query('UPDATE accounts SET balance_cents=balance_cents+$2 WHERE id=$1',[account.id,delta]);
  if(created||inserted||newProfiles)await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata,created_at) VALUES($1,$1,'operator.sector_demo_seeded',$2,$3)",[user.id,{fixture:FIXTURE,sampleFunds:true,fictionalCompanies:true,newProfiles,newReceipts:inserted},date(0)]);
  return {fixture:FIXTURE,email:EMAIL,companies:cases.length,newProfiles,newReceipts:inserted,existingCredentialsPreserved:!created};
 });
}
async function main(){
 const {sameTarget,secureNeonUrl}=require('../database/neon');
 if(!process.env.MIGRATION_DATABASE_URL)throw new Error('Use the private migration credentials to seed the dedicated demonstration account.');
 if(new URL(process.env.MIGRATION_DATABASE_URL).hostname.endsWith('.neon.tech')){secureNeonUrl(process.env.MIGRATION_DATABASE_URL);if(!sameTarget(process.env.MIGRATION_DATABASE_URL,process.env.DATABASE_URL))throw new Error('Runtime and operator connections must target the same Neon database.');}
 const db=createOperatorDatabase();try{await db.migrate();console.log(JSON.stringify(await seedSectorCompanies(db),null,2));}finally{await db.close();}
}
module.exports={seedSectorCompanies,EMAIL,PASSWORD,FIXTURE};
if(require.main===module)main().catch(error=>{console.error('Sector demonstration setup failed: '+error.message);process.exitCode=1;});
