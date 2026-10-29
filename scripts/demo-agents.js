'use strict';

// Explicit local demonstration in a disposable PostgreSQL schema. Never seeds
// the native banking database. Uses the actual configured AI provider and Python services.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture}=require('../tests/dft-helpers');
const {createAgents}=require('../banking/agents');
const {createOpenAIModel}=require('../banking/agents/openai');
const {createRiskClient}=require('../banking/risk');
const ledger=require('../banking/ledger');
async function main(){
  const cleanup=[];
  try{
    const model=createOpenAIModel();
    const status=await model.inspect();assert.ok(status.available,'Configure the AI provider and verify model access.');
    const chat=model.chat;let modelCalls=0;
    model.chat=async(...args)=>{
      const started=Date.now(),call=++modelCalls;
      try{const result=await chat(...args);console.log(JSON.stringify({modelCall:call,durationMs:Date.now()-started,tools:(result.tool_calls || []).map(c=>c.function?.name),status:'responded'}));return result;}
      catch(error){console.log(JSON.stringify({modelCall:call,durationMs:Date.now()-started,status:'unavailable'}));throw error;}
    };
    const f=await fixture({after:fn=>cleanup.push(fn)},{http:false});
    const users=Object.fromEntries((await f.db.query('SELECT id,name,email,role,auth_version FROM users')).rows.map(u=>[u.email.split('@')[0],u]));
    const risk=createRiskClient({db:f.db});
    const account=(await f.db.query('SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1',[users.alex.id])).rows[0];
    const payment=await ledger.submit(f.db,users.alex,'bill',{fromAccountId:String(account.id),billerId:'pub',reference:'AGENT-REAL-SCORER',amount:'100.00',requestId:randomUUID(),authorizationPassword:'Greenlink123!'},{riskClient:risk});
    assert.ok(Number.isInteger(payment.risk.modelScore));assert.equal(payment.risk.provider,status.mode);assert.equal(payment.risk.modelName,status.model);
    console.log(JSON.stringify({feature:'fraud_scoring',provider:payment.risk.provider,model:payment.risk.modelName,score:payment.risk.modelScore,reasons:payment.risk.reasons}));
    const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
    const agent=createAgents({db:f.db,model});let withheld=0;
    for(const [kind,body,user] of [
      ['liquidity',{days:30,engine:status.mode},users.jamie],
      ['fraud_investigation',{transactionId:payment.id,engine:status.mode},users.reviewer],
      ['rule_simulation',{ruleId:'high_value',threshold:50,days:30,engine:status.mode},users.reviewer],
      ['reconciliation',{engine:status.mode},users.reviewer],
      ['assistant',{message:'Show my current balances and check whether I can cover my scheduled payments over the next seven days. Use tools for the facts.'},users.jamie],
    ]){
      const callsBefore=modelCalls;
      const result=await agent.execute(user,kind,body);
      const run=result.run || await agent.detail(user,result.runId);
      assert.equal(run.engine,status.mode);assert.ok(modelCalls>callsBefore,'Every AI feature must actually call configured AI provider.');
      assert.equal(run.status,'completed');
      assert.ok(run.report.evidenceReferences?.length,'Every tool run should expose its saved evidence.');
      if(run.report.narrativeWithheld)withheld++;
      console.log(JSON.stringify({feature:kind,engine:run.engine,status:run.status,narrativeStatus:run.report.narrativeWithheld?'withheld':'passed_checks',narrativeIssue:run.report.narrativeIssue || null,tools:run.steps.map(s=>s.tool),evidence:run.report.evidenceReferences.map(e=>e.id),title:run.report.title,summary:run.report.interpretation || run.report.reply || null}));
    }
    assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
    console.log(`All five workflows completed; ${withheld} model interpretations withheld. Real configured AI provider assistant and fraud scoring verified; financial records unchanged after investigations. This is a smoke demonstration, not a statistical model-quality benchmark.`);
  }finally{for(const fn of cleanup.reverse())await fn();}
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error('Agent demonstration failed:',error.message);process.exitCode=1;});
