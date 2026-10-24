'use strict';

// Explicit local demonstration in a disposable PostgreSQL schema. Never seeds
// the native banking database. Uses the actual local Ollama and Python services.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture}=require('../tests/dft-helpers');
const {createAgents}=require('../banking/agents');
const {createLocalModel}=require('../banking/agents/model');
const {createRiskClient}=require('../banking/risk');
const ledger=require('../banking/ledger');
async function main(){
  const cleanup=[];
  try{
    const model=createLocalModel({mode:'ollama',model:process.env.AGENT_MODEL || 'qwen3.5:4b'});
    const status=await model.inspect();assert.ok(status.available,'Start local Ollama with the configured tool-capable model.');
    const f=await fixture({after:fn=>cleanup.push(fn)},{http:false});
    const users=Object.fromEntries((await f.db.query('SELECT id,name,email,role,auth_version FROM users')).rows.map(u=>[u.email.split('@')[0],u]));
    const risk=createRiskClient({db:f.db});
    const account=(await f.db.query('SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1',[users.alex.id])).rows[0];
    const payment=await ledger.submit(f.db,users.alex,'bill',{fromAccountId:String(account.id),billerId:'pub',reference:'AGENT-REAL-SCORER',amount:'100.00',requestId:randomUUID(),authorizationPassword:'Greenlink123!'},{riskClient:risk});
    assert.ok(Number.isInteger(payment.risk.modelScore));
    const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
    const agent=createAgents({db:f.db,model});
    for(const [kind,body,user] of [
      ['liquidity',{days:30,engine:'ollama'},users.jamie],
      ['fraud_investigation',{transactionId:payment.id,engine:'ollama'},users.reviewer],
      ['rule_simulation',{ruleId:'high_value',threshold:50,days:30,engine:'ollama'},users.reviewer],
      ['reconciliation',{engine:'ollama'},users.reviewer],
      ['assistant',{message:'Show my current balances and check whether I can cover my scheduled payments over the next seven days. Use tools for the facts.'},users.jamie],
    ]){
      const result=await agent.execute(user,kind,body);
      const run=result.run || await agent.detail(user,result.runId);
      assert.equal(run.status,'completed');
      console.log(JSON.stringify({feature:kind,engine:run.engine,status:run.status,tools:run.steps.map(s=>s.tool),title:run.report.title,summary:run.report.interpretation || run.report.reply || null}));
    }
    assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
    console.log('All five banking-agent features passed; real local Ollama and Python scoring verified; financial records unchanged after investigations.');
  }finally{for(const fn of cleanup.reverse())await fn();}
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error('Agent demonstration failed:',error.message);process.exitCode=1;});
