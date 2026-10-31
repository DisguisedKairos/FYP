'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers');
const company=require('../banking/company-activity');
const {createAgents,toolSchema}=require('../banking/agents');
const {relevanceIssue}=require('../banking/agents/evidence');
const pg=(name,work)=>test(name,{skip:!process.env.TEST_DATABASE_URL},work);
async function actors(db){return Object.fromEntries((await db.query('SELECT * FROM users')).rows.map(user=>[user.email.split('@')[0],user]));}
async function snapshot(db){return {accounts:(await db.query('SELECT * FROM accounts ORDER BY id')).rows,transactions:(await db.query('SELECT * FROM transactions ORDER BY id')).rows,schedules:(await db.query('SELECT * FROM scheduled_payments ORDER BY id')).rows,rules:(await db.query('SELECT * FROM fraud_rules ORDER BY id')).rows};}
async function receipt(db,{userId=1,label='Chronos Ltd',amount=-100,status='completed',created='2026-10-30T03:00:00Z',completed=created,requested=created,internal=false,description='Supplier payment',reference='COMPANY-TEST'}={}){
 const account=(await db.query('SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1',[userId])).rows[0];
 const id=randomUUID();await db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,internal,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12,$11,CASE WHEN $7='completed' THEN nextval('settlement_sequence') END)",[id,account.id,amount>0?'credit':'transfer',description,amount,label,status,reference,internal,created,status==='completed'?completed:null,requested]);return id;
}
function modelFor(companyName){return {mode:'openai',model:'controlled-company-test',inspect:async()=>({available:true}),chat:async(messages,tools)=>{
 if(!messages.some(m=>m.role==='tool')){assert.ok(tools.some(t=>t.function.name==='get_company_activity'));return {role:'assistant',content:'',tool_calls:[{function:{name:'get_company_activity',arguments:{company:companyName}}}]};}
 return {role:'assistant',content:'Open the company dashboard to inspect activity recorded on your accounts [E1].'};
}};}
pg('Company dashboard reconciles both transfer directions and never changes the ledger',async t=>{
 const f=await fixture(t),alex=f.client(),jamie=f.client();await alex.login();await jamie.login('jamie@greenlink.demo');
 const a=(await alex.dashboard()).accounts[0],j=(await jamie.dashboard()).accounts[0];
 for(const [client,from,to,amount] of [[alex,a,j,'20.00'],[jamie,j,a,'12.00']])assert.equal((await client.request('/api/transfers',{method:'POST',body:{fromAccountId:from.id,toAccountNumber:to.number,amount,requestId:randomUUID(),description:'Company dashboard test'}})).status,200);
 const before=await snapshot(f.db),result=await alex.request('/api/company-activity?'+new URLSearchParams({company:'harbour supplies',pageSize:'1'}));
 assert.equal(result.status,200,JSON.stringify(result.data));const data=result.data.dashboard;
 assert.equal(data.status,'ready');assert.equal(data.company,'Harbour Supplies Pte. Ltd.');
 assert.deepEqual(data.totals,{incomeCents:1200,outgoingCents:10500,netCents:-9300,completedCount:3,pendingCount:0,rejectedCount:0});
 assert.equal(data.transactions.length,1);assert.equal(data.pagination.totalPages,3);
 const end=await alex.request('/api/company-activity?'+new URLSearchParams({company:data.company,pageSize:'1',page:'999'}));assert.equal(end.data.dashboard.pagination.page,3);
 assert.equal(data.months.reduce((s,m)=>s+m.incomeCents,0),1200);assert.equal(data.months.reduce((s,m)=>s+m.outgoingCents,0),10500);
 assert.deepEqual(await snapshot(f.db),before);
});
pg('Company activity applies Singapore settlement boundaries and excludes unsettled values and internal funding',async t=>{
 const f=await fixture(t,{http:false,now:()=>Date.parse('2026-10-31T01:00:00Z')}),user=(await actors(f.db)).alex;
 const input=[{amount:1000,created:'2026-10-28T01:00:00Z',completed:'2026-10-29T16:00:00Z'},{amount:-300,created:'2026-10-30T15:59:59.999Z'},{amount:-400,created:'2026-10-30T16:00:00Z'},{amount:-500,status:'pending_review',created:'2026-10-29T16:00:00Z'},{amount:-700,status:'pending_review',created:'2026-10-30T16:00:01Z',requested:'2026-10-30T15:59:59Z'},{amount:-600,status:'rejected',created:'2026-10-30T15:59:59Z'},{amount:9000,internal:true},{amount:8000,description:'Opening balance'}];
 for(const item of input)await receipt(f.db,item);
 const data=await company.dashboard(f.db,user,new URLSearchParams({company:'CHRONOS LTD',from:'2026-10-30',to:'2026-10-30'}),{now:()=>Date.parse('2026-10-31T01:00:00Z')});
 assert.deepEqual(data.totals,{incomeCents:1000,outgoingCents:300,netCents:700,completedCount:2,pendingCount:2,rejectedCount:1});assert.equal(data.pagination.total,5);assert.deepEqual(data.months,[{month:'2026-10',incomeCents:1000,outgoingCents:300}]);
 const empty=await company.dashboard(f.db,user,new URLSearchParams({company:'Chronos Ltd',from:'2026-01-01',to:'2026-01-02'}));assert.equal(empty.status,'ready');assert.equal(empty.pagination.total,0);assert.equal(empty.totals.netCents,0);
});
pg('Company names are resolved within owned receipts and ambiguous labels are not merged',async t=>{
 const f=await fixture(t,{http:false}),users=await actors(f.db);
 for(const label of ['Atlas North Ltd','Atlas South Ltd','Atlas'])await receipt(f.db,{label,created:new Date().toISOString()});
 const exact=await company.dashboard(f.db,users.alex,new URLSearchParams({company:'ATLAS'}));assert.equal(exact.company,'Atlas');assert.equal(exact.pagination.total,1);
 const ambiguous=await company.dashboard(f.db,users.alex,new URLSearchParams({company:'Atlas '}));assert.equal(ambiguous.company,'Atlas');
 const choices=await company.dashboard(f.db,users.alex,new URLSearchParams({company:'Atlas S'}));assert.equal(choices.company,'Atlas South Ltd');
 const split=await company.dashboard(f.db,users.alex,new URLSearchParams({company:'Ltd'}));assert.equal(split.status,'ambiguous');assert.ok(split.companies.includes('Atlas North Ltd'));assert.equal(split.totals,undefined);
 const other=await company.dashboard(f.db,users.jamie,new URLSearchParams({company:'Atlas'}));assert.equal(other.status,'not_found');assert.deepEqual(other.companies,[]);assert.equal(other.totals,undefined);
 const admin=await company.dashboard(f.db,users.reviewer,new URLSearchParams({company:'Atlas'}));assert.equal(admin.status,'not_found','Admin role alone does not expand this personal relationship dashboard');
 const known=await company.dashboard(f.db,users.alex);assert.ok(!known.companies.includes('Welcome deposit'));
});
pg('Company selection is bounded, prefers an exact name outside suggestions and treats search patterns literally',async t=>{
 const f=await fixture(t,{http:false}),user=(await actors(f.db)).alex;
 for(let i=0;i<23;i++)await receipt(f.db,{label:'Vendor '+String(i).padStart(2,'0'),created:new Date().toISOString()});
 await receipt(f.db,{label:'100%_Supply',created:new Date().toISOString()});
 const many=await company.dashboard(f.db,user,new URLSearchParams({company:'Vendor'}));assert.equal(many.status,'ambiguous');assert.equal(many.companies.length,20);assert.equal(many.moreCompanies,true);
 const exact=await company.dashboard(f.db,user,new URLSearchParams({company:'Vendor 22'}));assert.equal(exact.company,'Vendor 22');assert.equal(exact.pagination.total,1);
 const literal=await company.dashboard(f.db,user,new URLSearchParams({company:'%_'}));assert.equal(literal.company,'100%_Supply');
 const injected=await company.dashboard(f.db,user,new URLSearchParams({company:"' OR 1=1 --"}));assert.equal(injected.status,'not_found');
});
pg('Company dashboard validates dates, pagination, unknown arguments, revoked sessions and HTTP access',async t=>{
 const f=await fixture(t),client=f.client();assert.equal((await client.request('/api/company-activity')).status,401);await client.login('jamie@greenlink.demo');
 const invalid=['company=A','company='+encodeURIComponent('\u0000bad'),'company='+('A'.repeat(121)),'company=Acme&company=Harbour','from=2026-02-30','from=2026-10-31&to=2026-10-01','from=2020-01-01&to=2026-10-01','to=2099-01-01','page=0','pageSize=101','userId=1'];
 for(const query of invalid){const result=await client.request('/api/company-activity?'+query);assert.equal(result.status,400,query+': '+JSON.stringify(result.data));}
 assert.equal((await client.request('/company-activity',{responseType:'text'})).status,200);
 const user=(await actors(f.db)).jamie;await f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[user.id]);
 await assert.rejects(company.dashboard(f.db,user,new URLSearchParams({company:'Meridian'})),error=>error.status===409);
 assert.equal((await client.request('/api/company-activity')).status,401);
});
pg('Assistant generates grounded company dashboard actions and retains private audit records',async t=>{
 const f=await fixture(t,{http:false}),users=await actors(f.db),before=await snapshot(f.db),agents=createAgents({db:f.db,model:modelFor('Harbour Supplies')});
 const response=await agents.execute(users.alex,'assistant',{message:'Generate a dashboard for transaction activity with Harbour Supplies for the last 30 days'});
 assert.equal(response.narrativeWithheld,undefined);assert.deepEqual(response.steps.map(s=>s.tool),['get_company_activity']);assert.equal(response.items[1].amountCents,8500);
 const action=response.actions[0];assert.equal(action.page,'companyActivity');assert.equal(action.type,'navigate');assert.equal(action.filters.company,'Harbour Supplies Pte. Ltd.');assert.ok(action.filters.from);assert.ok(action.filters.to);
 const saved=await agents.detail(users.alex,response.runId);assert.equal(saved.steps[0].result.company,action.filters.company);
 await assert.rejects(agents.detail(users.jamie,response.runId),e=>e.status===404);
 assert.deepEqual(await snapshot(f.db),before);
 const forged=createAgents({db:f.db,model:modelFor('Acme Trading')});await assert.rejects(forged.execute(users.alex,'assistant',{message:'Show a dashboard for Harbour Supplies'}),e=>e.status===400);
 assert.deepEqual(toolSchema('get_company_activity').function.parameters.required,[]);
});
test('Company period parser grounds supported user dates and cash flow evidence accepts the relationship tool',()=>{
 const now=()=>Date.parse('2026-10-31T01:00:00Z');
 assert.deepEqual(company.requestedPeriod('with Acme for the last 7 days',{now}),{from:'2026-10-25',to:'2026-10-31'});
 assert.deepEqual(company.requestedPeriod('with Acme this month',{now}),{from:'2026-10-01',to:'2026-10-31'});
 assert.deepEqual(company.requestedPeriod('with Acme last month',{now}),{from:'2026-09-01',to:'2026-09-30'});
 assert.deepEqual(company.requestedPeriod('Acme between 2026-08-01 and 2026-09-30',{now}),{from:'2026-08-01',to:'2026-09-30'});
 assert.throws(()=>company.requestedPeriod('Acme since 2026-09-30',{now}),e=>e.status===400);
 assert.throws(()=>company.requestedPeriod('Acme last 999 days',{now}),e=>e.status===400);
 assert.equal(relevanceIssue('Show transaction history and cash flow with Harbour Supplies',[{tool:'get_company_activity'}]),null);
});
