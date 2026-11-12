'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers'),{launchChrome}=require('./chrome');
async function login(page,email='alex@greenlink.demo'){await page.waitFor('!!document.querySelector("#email")');await page.fill('#email',email);await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');}
async function open(t,width=1280){const f=await fixture(t),page=await launchChrome(t,{width,height:950,mobile:width<760});await page.navigate(f.baseUrl+'/login');await login(page);await page.click('[data-action=assistant-toggle]');return {f,page};}
async function ask(page,message){const n=await page.evaluate('document.querySelectorAll(".from-assistant").length');await page.fill('#assistant-message',message);await page.click('#assistant-form button[type=submit]');await page.waitFor('document.querySelectorAll(".from-assistant").length>'+n+' && !document.querySelector("#assistant-form button[type=submit]").disabled');}
async function due(f){const client=f.client();await client.login();const source=(await client.dashboard()).accounts[0];const result=await client.request('/api/scheduled-payments',{method:'POST',body:{type:'bill',fromAccountId:source.id,billerId:'pub',reference:'VISIBLE-FUNDING',amount:'40000.00',scheduledAt:new Date(Date.now()+86400000).toISOString(),frequency:'once',requestId:randomUUID()}});assert.equal(result.status,201);return source;}
test('Insufficient payment funds appear as an explicit chat warning with exact source balance and gap',async t=>{
  const {f,page}=await open(t),client=f.client();await client.login();const source=(await client.dashboard()).accounts[0],amount=((source.balanceCents+1)/100).toFixed(2),before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
  await ask(page,'Transfer SGD '+amount+' from '+source.number+' to 1020002001');
  const text=await page.evaluate('document.querySelector(".from-assistant:last-child .assistant-funding-warning").textContent');assert.match(text,/Insufficient funds for this payment draft/);assert.match(text,/Available now/);assert.match(text,/Funding shortfall.*0\.01/s);
  assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child [data-assistant-action]").length'),1);assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
  await ask(page,'Can I afford SGD '+amount+' from '+source.number+'?');assert.match(await page.evaluate('document.querySelector(".from-assistant:last-child .assistant-funding-warning").textContent'),/Funding shortfall.*0\.01/s);assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child [data-assistant-action]").length'),0);
  await page.click('[data-action=assistant-clear]');assert.equal(await page.evaluate('document.querySelectorAll(".assistant-message").length'),0);assert.deepEqual(page.errors,[]);
});
test('Balance and finance-report replies show scheduled shortfall warnings on mobile without a separate view',async t=>{
  const {f,page}=await open(t,390);await due(f);const route=await page.evaluate('location.pathname');
  await ask(page,'What is my balance?');let text=await page.evaluate('document.querySelector(".from-assistant:last-child .assistant-funding-warning").textContent');assert.match(text,/Scheduled payments may have insufficient funds/);assert.match(text,/Largest projected shortfall/);assert.match(text,/First projected shortfall \(SGT\)/);assert.match(text,/30 days/);
  await ask(page,'Generate a downloadable finance report');assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child .assistant-funding-warning").length'),1);assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child [data-finance-format]").length'),2);assert.equal(await page.evaluate('location.pathname'),route);
  assert.equal(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);assert.doesNotMatch(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/\[E\d+\]|Evidence for this response/);assert.deepEqual(page.errors,[]);
});
test('Low balances alone do not trigger an arbitrary customer warning when no entered payments need funding',async t=>{
  const {f,page}=await open(t),client=f.client();await client.login();assert.equal((await client.request('/api/accounts',{method:'POST',body:{name:'No obligations'}})).status,201);
  await ask(page,'Am I low on funds?');assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child .assistant-funding-warning").length'),0);assert.deepEqual(page.errors,[]);
});
test('A delayed funding warning from an ended session cannot appear in the next operator conversation',async t=>{
  const {f,page}=await open(t);await due(f);
  await page.evaluate(`window.fundingFetch=window.fetch;window.holdFunding=true;window.fetch=async(...args)=>{const response=await window.fundingFetch(...args);if(window.holdFunding && String(args[0])==='/api/agents/assistant'){window.holdFunding=false;const body=await response.text();await new Promise(resolve=>window.releaseOldFunding=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};`);
  await page.evaluate(`import('/js/assistant.js').then(m=>{window.oldFunding=m.sendAssistant('What is my balance?');return true;})`);await page.waitFor('typeof window.releaseOldFunding==="function"');
  await page.evaluate(`import('/js/core.js').then(m=>m.ui.endSession('Session ended.'))`);await login(page,'jamie@greenlink.demo');await page.click('[data-action=assistant-toggle]');await ask(page,'What is my balance?');
  await page.evaluate('window.releaseOldFunding();window.oldFunding');assert.equal(await page.evaluate('document.querySelectorAll(".assistant-funding-warning").length'),0);assert.deepEqual(page.errors,[]);
});

test('An existing scheduled shortfall produces an automatic mobile notice without sending a chat message',async t=>{
  const f=await fixture(t);await due(f);
  const page=await launchChrome(t,{width:390,height:950,mobile:true});
  await page.navigate(f.baseUrl+'/login');await login(page);
  await page.waitFor('!!document.querySelector(".assistant-funding-preview:not([hidden])")');
  assert.equal(await page.evaluate('document.querySelector("#assistant-popup").hidden'),true);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM agent_runs')).rows[0].count),0);
  await page.screenshot('test-results/automatic-funding-mobile.png');
  await page.click('[data-action=funding-open]');
  await page.waitFor('!!document.querySelector("#automatic-funding .assistant-funding-warning")');
  const text=await page.evaluate('document.querySelector("#automatic-funding").textContent');
  assert.match(text,/Automatic funding check/);assert.match(text,/Largest projected shortfall/);assert.match(text,/First projected shortfall/);
  assert.equal(await page.evaluate('document.querySelectorAll(".assistant-message").length'),0);
  await page.fill('#assistant-message','Keep this unfinished question');
  await page.evaluate("import('/js/core.js').then(({state,ui})=>{state.hiddenBalance=true;ui.render();})");
  assert.equal(await page.evaluate('document.querySelector("#automatic-funding dd").textContent'),'\u2022\u2022\u2022\u2022\u2022\u2022');
  assert.equal(await page.evaluate('document.querySelector("#assistant-message").value'),'Keep this unfinished question');
  assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));assert.deepEqual(page.errors,[]);
});
test('Creating and cancelling a schedule in the banking form updates the automatic notice immediately',async t=>{
  const {page}=await open(t);
  await page.click('[data-action=assistant-close]');await page.click('[data-nav=schedules]');
  await page.waitFor('!!document.querySelector(".schedules-panel")');await page.click('[data-action=new-schedule]');
  await page.fill('#schedule-recipient','1020002001');await page.fill('#schedule-amount','40000.00');
  await page.fill('#schedule-description','Automatic funding check');
  await page.click('#schedule-form button[type=submit]');await page.waitFor('!!document.querySelector("#confirm-schedule-form")');
  await page.fill('#authorizationPassword','Greenlink123!');await page.click('#confirm-schedule-form button[type=submit]');
  await page.waitFor('!!document.querySelector(".schedule-card") && !!document.querySelector(".assistant-funding-preview:not([hidden])")');
  assert.equal(await page.evaluate('document.querySelector("#assistant-popup").hidden'),true);
  await page.click('[data-cancel-schedule]');await page.click('#cancel-schedule-form button[type=submit]');
  await page.waitFor('document.querySelector(".schedule-card")?.textContent.includes("Cancelled") && document.querySelector(".assistant-funding-preview").hidden');
  assert.deepEqual(page.errors,[]);
});
test('Automatic polling preserves a typed question, retains stale warnings on failure and clears them on a successful refresh',async t=>{
  const {f,page}=await open(t);
  await page.waitFor("import('/js/core.js').then(({state})=>Boolean(state.funding?.check))");
  await due(f);await page.fill('#assistant-message','Still writing my question');
  await page.waitFor('!!document.querySelector("#automatic-funding .assistant-funding-warning")','The 30-second automatic check detects a schedule added elsewhere.',38000);
  assert.equal(await page.evaluate('document.activeElement.id'),'assistant-message');
  assert.equal(await page.evaluate('document.querySelector("#assistant-message").value'),'Still writing my question');
  const client=f.client();await client.login();const list=await client.request('/api/scheduled-payments');
  await client.request('/api/scheduled-payments/'+list.data.schedules[0].id,{method:'DELETE',body:{}});
  await page.evaluate("window.fundingOriginalFetch=window.fetch;window.failFundingRefresh=true;window.fetch=(...args)=>window.failFundingRefresh&&String(args[0])==='/api/funding-check'?Promise.resolve(new Response(JSON.stringify({error:'Controlled check failure.'}),{status:503,headers:{'Content-Type':'application/json'}})):window.fundingOriginalFetch(...args);");
  await page.evaluate("import('/js/funding.js').then(m=>m.loadFunding({force:true}))");
  assert.match(await page.evaluate('document.querySelector("#automatic-funding").textContent'),/may be out of date/);
  assert.equal(await page.evaluate('document.querySelectorAll("#automatic-funding .assistant-funding-warning").length'),1);
  await page.evaluate('window.failFundingRefresh=false;document.dispatchEvent(new Event("visibilitychange"));');
  await page.waitFor('document.querySelector("#automatic-funding").hidden');
  assert.equal(await page.evaluate('document.querySelector("#assistant-message").value'),'Still writing my question');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM agent_runs')).rows[0].count),0);
  assert.deepEqual(page.errors,[]);
});
test('Older automatic responses cannot restore a resolved warning or leak into the next operator session',async t=>{
  const {f,page}=await open(t);await page.waitFor("import('/js/core.js').then(({state})=>Boolean(state.funding?.check))");await due(f);
  await page.evaluate("window.autoFundingFetch=window.fetch;window.holdAutoFunding=true;window.fetch=async(...args)=>{const response=await window.autoFundingFetch(...args);if(window.holdAutoFunding && String(args[0])==='/api/funding-check'){window.holdAutoFunding=false;const body=await response.text();await new Promise(resolve=>window.releaseAutoFunding=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};");
  await page.evaluate("import('/js/funding.js').then(m=>{window.oldAutoFunding=m.loadFunding({force:true});return true;})");
  await page.waitFor('typeof window.releaseAutoFunding==="function"');
  const client=f.client();await client.login();const list=await client.request('/api/scheduled-payments');
  await client.request('/api/scheduled-payments/'+list.data.schedules[0].id,{method:'DELETE',body:{}});
  await page.evaluate("import('/js/funding.js').then(m=>m.loadFunding({force:true}))");
  await page.evaluate('window.releaseAutoFunding();window.oldAutoFunding');
  assert.equal(await page.evaluate('document.querySelector("#automatic-funding").hidden'),true);
  await due(f);
  await page.evaluate("window.holdAutoFunding=true;window.releaseAutoFunding=null;import('/js/funding.js').then(m=>{window.oldAutoFunding=m.loadFunding({force:true});return true;})");
  await page.waitFor('typeof window.releaseAutoFunding==="function"');
  await page.evaluate("import('/js/core.js').then(m=>m.ui.endSession('Session ended.'))");
  await login(page,'jamie@greenlink.demo');
  await page.evaluate('window.releaseAutoFunding();window.oldAutoFunding');
  await page.waitFor("import('/js/core.js').then(({state})=>Boolean(state.funding?.check))");
  assert.equal(await page.evaluate('document.querySelector(".assistant-funding-preview").hidden'),true);
  assert.equal(await page.evaluate('document.querySelector("#assistant-root").textContent.includes("Operating savings")'),false);
  assert.deepEqual(page.errors,[]);
});
