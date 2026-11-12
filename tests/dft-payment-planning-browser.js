'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers'),{launchChrome}=require('./chrome');
const NOW=Date.parse('2026-11-12T04:00:00Z'),now=()=>NOW;
async function login(page,email='alex@greenlink.demo'){
  await page.waitFor('!!document.querySelector("#email")');await page.fill('#email',email);await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');
}
async function open(t,{email='alex@greenlink.demo',width=1280}={}){
  const f=await fixture(t,{now}),page=await launchChrome(t,{width,height:950,mobile:width<760});await page.navigate(f.baseUrl+'/login');await login(page,email);await page.click('[data-action=assistant-toggle]');return {f,page};
}
async function ask(page,message){
  const n=await page.evaluate('document.querySelectorAll(".from-assistant").length');await page.fill('#assistant-message',message);await page.click('#assistant-form button[type=submit]');
  await page.waitFor('document.querySelectorAll(".from-assistant").length>'+n+' && !document.querySelector("#assistant-form button[type=submit]").disabled');
}
test('Mobile chat shows completed cash flow and a company payment deadline together, while pure summaries still support downloads',async t=>{
  const {f,page}=await open(t,{email:'jamie@greenlink.demo',width:390}),route=await page.evaluate('location.pathname');
  await ask(page,'Summarize my inflow and outflow this month. Do I have enough funds to pay SGD 100 to Harbour Supplies Pte. Ltd. from Operating savings by this month?');
  const text=await page.evaluate('document.querySelector(".from-assistant:last-child [data-payment-readiness]").textContent');
  assert.match(text,/Current funds cover this conservative/);assert.match(text,/Inflow received/);assert.match(text,/Outflow paid/);assert.match(text,/Harbour Supplies Pte. Ltd./);assert.match(text,/2026-11-30/);assert.match(text,/Future credits/);
  assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child [data-assistant-action]").length'),0);assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));assert.equal(await page.evaluate('location.pathname'),route);
  assert.ok(await page.evaluate('(()=>{const card=document.querySelector(".from-assistant:last-child [data-payment-readiness]"),thread=document.querySelector("#assistant-thread");return card.getBoundingClientRect().top<thread.getBoundingClientRect().bottom;})()'));
  await page.screenshot('test-results/payment-planning-mobile.png');
  await ask(page,'Summarize inflow and outflow this month');
  assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child [data-payment-readiness]").length'),0);
  assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child [data-finance-format]").length'),2);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM scheduled_payments')).rows[0].count),0);assert.deepEqual(page.errors,[]);
});
test('A scheduled bill changes dated payment coverage and shortening the deadline clears the shortfall without sending money',async t=>{
  const {f,page}=await open(t),client=f.client();await client.login();const source=(await client.dashboard()).accounts[0];
  const created=await client.request('/api/scheduled-payments',{method:'POST',body:{type:'bill',fromAccountId:source.id,billerId:'pub',reference:'CHAT-PLAN',amount:(source.balanceCents/100).toFixed(2),scheduledAt:'2026-11-20T00:00:00Z',frequency:'once',requestId:randomUUID()}});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
  await ask(page,'Summarize inflow and outflow. Can I pay SGD 0.01 to Harbour Supplies Pte. Ltd. from '+source.number+' by this month?');
  const text=await page.evaluate('document.querySelector(".from-assistant:last-child [data-payment-readiness]").textContent');
  assert.match(text,/More settled funds are needed/);assert.match(text,/Additional settled funds needed.*0\.01/s);assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child [data-assistant-action]").length'),0);
  await ask(page,'Can I pay SGD 0.01 to Harbour Supplies Pte. Ltd. from '+source.number+' by 2026-11-19?');
  assert.match(await page.evaluate('document.querySelector(".from-assistant:last-child [data-payment-readiness]").textContent'),/Current funds cover this conservative/);
  assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);assert.deepEqual(page.errors,[]);
});
test('An incomplete company question shows missing details and still returns historical cash flow, then accepts a complete new question',async t=>{
  const {page}=await open(t);
  await ask(page,'Summarize inflow and outflow. Do I have enough funds to pay another company by this date?');
  let text=await page.evaluate('document.querySelector(".from-assistant:last-child [data-payment-readiness]").textContent');
  assert.match(text,/More details are needed/);assert.match(text,/one proposed payment amount/);assert.match(text,/source account/);assert.match(text,/deadline/);assert.match(text,/Completed business cash flow/);
  await ask(page,'Can I pay SGD 100 to Harbour Supplies Pte. Ltd. from Operating savings by 2026-11-20?');
  text=await page.evaluate('document.querySelector(".from-assistant:last-child [data-payment-readiness]").textContent');
  assert.match(text,/Current funds cover this conservative/);assert.doesNotMatch(text,/\[E\d+\]|Evidence for this response/);assert.deepEqual(page.errors,[]);
});
test('Chat asks for one deadline when relative alternatives are given and accepts the clarified date',async t=>{
  const {f,page}=await open(t),before=(await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;
  await ask(page,'Can I pay SGD 100 to Harbour Supplies Pte. Ltd. from Operating savings by tomorrow or next month?');
  let text=await page.evaluate('document.querySelector(".from-assistant:last-child [data-payment-readiness]").textContent');
  assert.match(text,/More details are needed/);assert.match(text,/one payment deadline/);
  assert.doesNotMatch(text,/Current funds cover this conservative|More settled funds are needed/);
  assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child [data-assistant-action]").length'),0);
  await ask(page,'Can I pay SGD 100 to Harbour Supplies Pte. Ltd. from Operating savings by tomorrow?');
  text=await page.evaluate('document.querySelector(".from-assistant:last-child [data-payment-readiness]").textContent');
  assert.match(text,/Current funds cover this conservative/);assert.match(text,/2026-11-13/);
  assert.deepEqual((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,before);assert.deepEqual(page.errors,[]);
});
test('A company funding report delayed across sign-out cannot appear in the next operator chat',async t=>{
  const {page}=await open(t);
  await page.evaluate("window.planningFetch=window.fetch;window.holdPlanning=true;window.fetch=async(...args)=>{const r=await window.planningFetch(...args);if(window.holdPlanning&&String(args[0])==='/api/agents/assistant'){window.holdPlanning=false;const body=await r.text();await new Promise(resolve=>window.releasePlanning=resolve);return new Response(body,{status:r.status,headers:r.headers});}return r;};");
  await page.evaluate("import('/js/assistant.js').then(m=>{window.oldPlanning=m.sendAssistant('Can I pay SGD 100 to Harbour Supplies Pte. Ltd. from Operating savings by this month?');return true;})");
  await page.waitFor('typeof window.releasePlanning==="function"');
  await page.evaluate("import('/js/core.js').then(({ui})=>ui.endSession('Session ended.'))");
  await login(page,'jamie@greenlink.demo');await page.click('[data-action=assistant-toggle]');
  await page.evaluate('window.releasePlanning();window.oldPlanning');
  assert.equal(await page.evaluate('document.querySelectorAll("[data-payment-readiness]").length'),0);assert.equal(await page.evaluate('document.querySelector("#assistant-root").textContent.includes("Harbour Supplies")'),false);assert.deepEqual(page.errors,[]);
});
