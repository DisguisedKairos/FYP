'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const {createDatabase}=require('../database');
const {seedDemo}=require('../scripts/seed-demo');
const {createRiskClient}=require('../banking/risk');
const MODEL_INFO={provider:'openai',localOnly:false,available:true,modelName:'controlled-openai',version:'test-model',modelIdentitySha256:require('../banking/ai-provider').identity('controlled-openai'),promptSha256:'b'.repeat(64),reviewThreshold:65,algorithm:'Controlled test adapter',limitations:[]};
function modelStub(score=2){return async input=>({...input,modelScore:score,score,decision:score>=65?'review':'allow',provider:'openai',modelName:'controlled-openai',modelIdentitySha256:MODEL_INFO.modelIdentitySha256,promptSha256:MODEL_INFO.promptSha256,features:{amountLog:0,amountDeviation:0,velocity:0,newPayee:0,balanceUtilization:0,unusualHour:0,recentValue:0},context:{historicalTransactions:input.historySummary.historyCount,averageOutgoingCents:Math.round(input.historySummary.averageOutgoingCents),outgoingCount10m:input.historySummary.outgoingCount10m,dailyOutgoingCents:input.historySummary.dailyOutgoingCents,knownPayee:Boolean(input.isInternal || input.historySummary.knownPayee)},reasons:[{code:'test_model',message:'Controlled model fixture.',contribution:0}],modelVersion:'test-model',assessedAt:input.createdAt});}
async function fixture(t,{http=true,seed=true,now=Date.now,riskClient,assessModel,...options}={}){
  const agentModel=options.agentModel || require('./dft-agent-model').createTestAgentModel();
  if(!process.env.TEST_DATABASE_URL)throw new Error('TEST_DATABASE_URL is required for real PostgreSQL tests.');
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL}),schema=`dft_${randomUUID().replace(/-/g,'')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db=createDatabase({connectionString:process.env.TEST_DATABASE_URL,poolOptions:{options:`-c search_path=${schema}`,max:16}});
  let server,baseUrl;
  const stop=async()=>{if(server?.listening){await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});await server.closeResources();}};
  t.after(async()=>{await stop();await db.close();assert.match(schema,/^dft_[a-f0-9]{32}$/);await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
  await db.migrate();if(seed)await seedDemo(db,{now});
  const actualRisk=riskClient || createRiskClient({db,assessModel:assessModel || modelStub(),modelInfo:MODEL_INFO});
  const start=async(extra={})=>{const {createApplication}=require('../app');server=await createApplication({db,migrate:false,seed:false,backgroundJobs:false,publicOrigin:'',trustProxy:'',now,riskClient:actualRisk,agentModel,...options,...extra});for(let attempt=0;attempt<10;attempt++){
    await new Promise((resolve,reject)=>{const failed=error=>reject(error);server.once('error',failed);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',failed);resolve();});});
    baseUrl='http://127.0.0.1:'+server.address().port;
    try{await fetch(baseUrl+'/health',{signal:AbortSignal.timeout(5000)});break;}
    catch(error){
      // The OS can assign a port forbidden by browsers and Fetch. Retry that
      // port rather than disabling the browser's port protections.
      if(error.cause?.message!=='bad port' || attempt===9)throw error;
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  }};
  if(http)await start();
  return {db,dbPath:null,schema,riskClient:actualRisk,agentModel,start,stop,get server(){return server;},get baseUrl(){return baseUrl;},client:()=>new Client(()=>baseUrl),runJobs:()=>server.runJobs()};
}
async function approveBusiness(db,user,{legalName=`Test Business ${user.id} Pte. Ltd.`,registrationNumber=`TEST${String(user.id).padStart(8,'0')}`}={}) {
  return require('../banking/business').create(db,user,{legalName,registrationNumber,country:'SG',legalForm:'company',industry:'Test business services',registeredAddress:'1 Test Business Road, Singapore 000001'},{status:'approved'});
}
function businessProfile(registrationNumber='TESTCOMPANY001'){return {legalName:'Test Company Pte. Ltd.',registrationNumber,country:'SG',legalForm:'company',industry:'Business services',registeredAddress:'1 Test Business Road, Singapore 000001'};}
class Client{
  constructor(base){this.base=base;this.cookies=new Map();this.csrfToken=null;this.password='Greenlink123!';}
  async request(path,{method='GET',body,csrf=true,authorize=true,headers={},responseType='json'}={}){
    if(authorize && ['POST','PATCH'].includes(method) && (/^\/api\/(?:transfers|payments|scheduled-payments)$/.test(path)||/^\/api\/fraud\/(?:reviews|rules)\//.test(path)))body={authorizationPassword:this.password,...body};
    const response=await fetch(`${this.base()}${path}`,{method,headers:{...(this.cookies.size?{Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(csrf && this.csrfToken && !['GET','HEAD'].includes(method)?{'X-CSRF-Token':this.csrfToken}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'manual'});
    for(const raw of response.headers.getSetCookie()){const [pair]=raw.split(';'),at=pair.indexOf('=');this.cookies.set(pair.slice(0,at),pair.slice(at+1));}
    const text=await response.text();let data=text;if(responseType!=='text'){try{data=JSON.parse(text);}catch{assert.fail(`${method} ${path}: ${response.status} ${text.slice(0,100)}`);}if(data.csrfToken)this.csrfToken=data.csrfToken;}
    return {status:response.status,data,headers:response.headers};
  }
  async session(){const result=await this.request('/api/session');assert.equal(result.status,200,JSON.stringify(result.data));return result;}
  async login(email='alex@greenlink.demo',password='Greenlink123!'){await this.session();const result=await this.request('/api/auth/login',{method:'POST',body:{email,password}});assert.equal(result.status,200,JSON.stringify(result.data));this.password=password;return result;}
  async dashboard(){const result=await this.request('/api/dashboard');assert.equal(result.status,200,JSON.stringify(result.data));return result.data;}
  async history(filters={}){const result=await this.request(`/api/transactions?${new URLSearchParams(filters)}`);assert.equal(result.status,200,JSON.stringify(result.data));return result.data;}
  async ledger(filters={}){const rows=[];for(let page=1;;page++){const result=await this.history({...filters,page,pageSize:100});rows.push(...result.transactions);if(page>=result.pagination.totalPages)return rows;}}
}
module.exports={MODEL_INFO,fixture,createFixture:fixture,Client,modelStub,approveBusiness,businessProfile,accountNamed:(data,name)=>{const account=data.accounts.find(row=>row.name===name);assert.ok(account);return account;},totalBalance:data=>data.accounts.reduce((sum,row)=>sum+row.balanceCents,0)};
