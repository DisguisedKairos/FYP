'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers');
const {contextFixture,marketModel}=require('./dft-market-fixtures');
const {createMarketContext,parseFx,parseNews,parseAlerts,SOURCES}=require('../banking/market-context');
const marketRisk=require('../banking/market-risk');
const NOW=Date.parse('2026-10-30T12:00:00Z');
const XML='<Cube time="2026-10-29"><Cube currency="USD" rate="1.10"/><Cube currency="SGD" rate="1.43"/><Cube currency="GBP" rate="0.85"/></Cube><Cube time="2026-10-28"><Cube currency="USD" rate="1.10"/><Cube currency="SGD" rate="1.42"/><Cube currency="GBP" rate="0.85"/></Cube>';
const HTML='<a href="/resources/scam-alert/investment/"><p>27 October 2026</p><h2>Investment impersonation scams</h2></a>';
const RSS='<rss><channel><item><title>Market news &amp; policy</title><link>https://www.ecb.europa.eu/press/test.en.html</link><pubDate>Thu, 29 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>';
const pg=(name,work)=>test(name,{skip:!process.env.TEST_DATABASE_URL&&'TEST_DATABASE_URL required.'},work);
const request=(client,message='Check my transactions for fraud using daily market trends')=>client.request('/api/agents/assistant',{method:'POST',body:{message}});
const financial=async db=>JSON.stringify({accounts:(await db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,transactions:(await db.query('SELECT id,status,amount_cents,risk_json FROM transactions ORDER BY id')).rows});
async function payment(f,{email='jamie@greenlink.demo',amount='100.00',description='Investment trading top-up'}={}){
 const client=f.client();await client.login(email);const data=await client.dashboard(),source=data.accounts[0];
 const to=email==='jamie@greenlink.demo'?'1020001001':'1020002001';
 const paid=await client.request('/api/transfers',{method:'POST',body:{fromAccountId:source.id,toAccountNumber:to,amount,description,requestId:randomUUID()}});
 assert.equal(paid.status,200,JSON.stringify(paid.data));return {client,id:paid.data.transaction.id};
}
test('Official context uses only fixed public GET URLs, deduplicates cache refreshes and derives dated SGD crosses',async()=>{
 let clock=NOW,calls=[];
 const provider=createMarketContext({now:()=>clock,fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(url===SOURCES.fx?XML:url===SOURCES.alerts?HTML:RSS);}});
 const [a,b]=await Promise.all([provider.get(),provider.get()]);assert.deepEqual(a,b);assert.equal(a.status,'available');assert.equal(calls.length,3);
 assert.equal(a.sources.fx.records[0].rate,1.3);assert.equal(a.sources.fx.records[0].asOf,'2026-10-29');assert.ok(a.sources.fx.records[0].changePercent>0);
 assert.deepEqual(calls.map(c=>c.url).sort(),Object.values(SOURCES).sort());assert.ok(calls.every(c=>c.options.method==='GET'&&!c.options.body&&!c.options.headers.Authorization&&c.options.redirect==='error'));
 a.sources.fx.records[0].rate=999;assert.equal((await provider.get()).sources.fx.records[0].rate,1.3);
 clock+=3600001;await provider.get();assert.equal(calls.length,6);
});
test('Invalid, stale, future and redirected sources cannot become current market evidence',async()=>{
 assert.throws(()=>parseFx('<!DOCTYPE x>'+XML,NOW));assert.throws(()=>parseFx(XML.replace('rate="1.43"','rate="0"'),NOW));assert.throws(()=>parseFx(XML,NOW+9*86400000));
 assert.throws(()=>parseFx(XML.replace('rate="1.10"','rate="0.'+'0'.repeat(307)+'1"').replace('rate="1.43"','rate="1000000000"'),NOW));
 assert.throws(()=>parseNews(RSS.replace('www.ecb.europa.eu','attacker.example'),NOW));assert.throws(()=>parseNews(RSS.replace('29 Oct 2026','31 Oct 2026'),NOW));
 assert.throws(()=>parseAlerts(HTML.replace('27 October','31 October'),NOW));assert.throws(()=>parseAlerts(HTML.replace('27 October 2026','27 January 2026'),NOW));
 const provider=createMarketContext({now:()=>NOW,fetchImpl:async()=>new Response('',{status:302,headers:{Location:'http://127.0.0.1/private'}})});
 const value=await provider.get();assert.equal(value.status,'unavailable');assert.ok(Object.values(value.sources).every(s=>!s.available&&!s.records.length));
});
test('Malformed or oversized feeds degrade explicitly without fictional values',async()=>{
 assert.equal(marketRisk.fraudIntent('Check my transactions for fraud using daily market trends'),true);
 assert.equal(marketRisk.fraudIntent('I was scammed; check my account activity'),true);
 assert.equal(marketRisk.fraudIntent('Show the latest scam alerts and financial news'),false);
 assert.equal(marketRisk.fraudIntent('Analyze fraud trends in the news'),false);
 const provider=createMarketContext({now:()=>NOW,fetchImpl:async url=>new Response(url===SOURCES.fx?XML:'x'.repeat(1000001))});
 const value=await provider.get();assert.equal(value.status,'partial');assert.equal(value.sources.fx.available,true);assert.equal(value.sources.alerts.available,false);assert.equal(value.sources.news.available,false);
 assert.match(marketRisk.publicItems(value).map(i=>i.title).join(' '),/Scam alerts unavailable/);
});
pg('Market-assisted AI flags an owned suspicious payment once, preserves financial state and respects closed human decisions',async t=>{
 const context=contextFixture(NOW),f=await fixture(t,{now:()=>NOW,agentModel:marketModel(),marketContext:{get:async()=>structuredClone(context)}}),{client,id}=await payment(f);
 const before=await financial(f.db),first=await request(client);assert.equal(first.status,200,JSON.stringify(first.data));assert.deepEqual(first.data.steps.map(s=>s.tool),['analyze_market_transactions','flag_transaction_for_review']);
 const saved=(await f.db.query('SELECT * FROM fraud_cases WHERE transaction_id=$1',[id])).rows[0];assert.equal(saved.status,'open');assert.equal(saved.score,null);
 const evidence=(await f.db.query('SELECT evidence_json FROM fraud_screenings WHERE id=$1',[saved.screening_id])).rows[0].evidence_json;
 assert.equal(evidence.assessmentKind,'market_assisted_review');assert.equal(evidence.agent.provider,'openai');assert.equal(evidence.dailyContext.asOf,context.asOf);assert.equal(evidence.signals[0].code,'trend_advisory_investment');
 const events=Number((await f.db.query("SELECT count(*) FROM notification_outbox WHERE payload_json->>'type'='fraud.flagged'")).rows[0].count);assert.ok(events>0);
 const duplicates=await Promise.all([request(client),request(client)]);assert.ok(duplicates.every(r=>r.status===200));assert.equal(Number((await f.db.query('SELECT count(*) FROM fraud_cases')).rows[0].count),1);assert.equal(Number((await f.db.query("SELECT count(*) FROM notification_outbox WHERE payload_json->>'type'='fraud.flagged'")).rows[0].count),events);
 assert.equal((await client.request('/api/ai-audit')).status,403);
 const reviewer=f.client();await reviewer.login('reviewer@greenlink.demo');
 const claimed=await reviewer.request('/api/fraud/cases/'+saved.id+'/review',{method:'POST',body:{action:'claim',version:saved.version}});assert.equal(claimed.status,200,JSON.stringify(claimed.data));
 const closed=await reviewer.request('/api/fraud/cases/'+saved.id+'/review',{method:'POST',body:{action:'close',version:claimed.data.case.version,outcome:'legitimate',reason:'Verified the business purpose using an independent contact.',authorizationPassword:'Greenlink123!'}});assert.equal(closed.status,200,JSON.stringify(closed.data));
 const repeated=await request(client);assert.equal(repeated.status,200);assert.match(repeated.data.reply,/already reviewed/);assert.equal((await f.db.query('SELECT status FROM fraud_cases WHERE id=$1',[saved.id])).rows[0].status,'closed');assert.equal(await financial(f.db),before);
});
pg('Market tools cannot inspect another customer payment',async t=>{
 let target;const f=await fixture(t,{now:()=>NOW,agentModel:marketModel({initialArgs:()=>({transactionId:target})}),marketContext:{get:async()=>contextFixture(NOW)}});
 target=(await payment(f,{email:'alex@greenlink.demo'})).id;
 const other=f.client();await other.login('jamie@greenlink.demo');assert.equal((await request(other)).status,404);assert.equal(Number((await f.db.query('SELECT count(*) FROM fraud_cases')).rows[0].count),0);
});
pg('Fabricated signal codes and requests without fraud intent cannot create flags',async t=>{
 const config={signalCode:'market_move_only'},f=await fixture(t,{now:()=>NOW,agentModel:marketModel(config),marketContext:{get:async()=>contextFixture(NOW)}}),{client}=await payment(f);
 const before=await financial(f.db);assert.equal((await request(client)).status,409);
 delete config.signalCode;assert.equal((await request(client,'Show me daily market trends')).status,400);
 assert.equal(Number((await f.db.query('SELECT count(*) FROM fraud_cases')).rows[0].count),0);assert.equal(await financial(f.db),before);
});
pg('Market movement alone cannot flag an ordinary payment with no supported suspicious signal',async t=>{
 const f=await fixture(t,{now:()=>NOW,agentModel:marketModel({signalCode:'historical_pattern'}),marketContext:{get:async()=>contextFixture(NOW)}}),{client}=await payment(f,{amount:'1.00',description:'Normal supplier payment'});
 const before=await financial(f.db);assert.equal((await request(client)).status,409);assert.equal(Number((await f.db.query('SELECT count(*) FROM fraud_cases')).rows[0].count),0);assert.equal(await financial(f.db),before);
});
pg('Revoked sessions cannot persist an AI review flag after analyzing context',async t=>{
 let f;f=await fixture(t,{now:()=>NOW,agentModel:marketModel({afterAnalysis:async data=>{if(data.transactions.length)await f.db.query("UPDATE users SET auth_version=auth_version+1 WHERE email='jamie@greenlink.demo'");}}),marketContext:{get:async()=>contextFixture(NOW)}});
 const {client}=await payment(f),before=await financial(f.db);const result=await request(client);assert.equal(result.status,401);assert.equal(Number((await f.db.query('SELECT count(*) FROM fraud_cases')).rows[0].count),0);assert.equal(await financial(f.db),before);
});
pg('Stale context and mismatched historical snapshots cannot qualify a market review flag',async t=>{
 const f=await fixture(t,{now:()=>NOW}),{client,id}=await payment(f),user=(await f.db.query("SELECT * FROM users WHERE email='jamie@greenlink.demo'")).rows[0],context=contextFixture(NOW);
 const analysis=await marketRisk.analyze(f.db,user,{transactionId:id,context,now:()=>NOW});assert.equal(analysis.transactions[0].eligibleSignals[0].code,'advisory_investment');
 await assert.rejects(marketRisk.flag(f.db,user,{transactionId:id,signalCode:'advisory_investment',analysis,runId:randomUUID(),model:'controlled',now:()=>NOW+3600001}),e=>e.status===409);
 const row=(await f.db.query('SELECT t.*,a.user_id,f.input_json FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN fraud_assessments f ON f.id=t.id WHERE t.id=$1',[id])).rows[0];row.input_json={...row.input_json,userId:'someone_else'};
 assert.deepEqual(marketRisk.eligibleSignals(row,context),[]);assert.equal(Number((await f.db.query('SELECT count(*) FROM fraud_cases')).rows[0].count),0);assert.equal((await client.request('/api/fraud/cases')).status,403);
});
