'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers');
const {launchChrome}=require('./chrome');
async function open(t,width,email){
  const f=await fixture(t),page=await launchChrome(t,{width,height:900,mobile:width<760});
  await page.navigate(f.baseUrl+'/login');await page.waitFor('!!document.querySelector("#email")');
  await page.fill('#email',email);await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');
  return {f,page};
}
async function visit(page,base,route){
  if(route==='/assistant'){
    if(!await page.evaluate('!!document.querySelector("#assistant-popup:not([hidden])")'))await page.click('[data-action="assistant-toggle"]');
    await page.waitFor('!!document.querySelector("#assistant-popup:not([hidden])")');return;
  }
  await page.navigate(base+route);await page.waitFor('!!document.querySelector(".app-shell")');
}
test('Business users project liquidity, inspect reconciliation and build a multi-turn draft on mobile',async t=>{
  const {f,page}=await open(t,390,'jamie@greenlink.demo');
  await visit(page,f.baseUrl,'/banking-insights');await page.waitFor('document.querySelector("[data-agent-status]")?.textContent.includes("OpenAI ready")');
  assert.equal(await page.evaluate('!!document.querySelector("#agent-fraud-form,#agent-simulation-form")'),false);
  await page.fill('#agent-days','14');
  await page.click('#agent-liquidity-form button[type=submit]');await page.waitFor('!!document.querySelector("[data-agent-report]")');
  assert.equal(await page.evaluate('document.querySelector("#agent-days").value'),'14');
  assert.match(await page.evaluate('document.querySelector("[data-agent-report]").textContent'),/liquidity projection/);
  assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
  await page.click('#agent-reconciliation-form button[type=submit]');await page.waitFor('document.querySelector("[data-agent-report]")?.textContent.includes("Reconciliation and exception")');
  await page.screenshot(path.resolve('test-results','agents-business-mobile.png'));
  await visit(page,f.baseUrl,'/assistant');
  await page.evaluate(`window.originalAgentFetch=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).endsWith('/agents/assistant'))await new Promise(resolve=>{window.releaseAgentResponse=resolve;});return window.originalAgentFetch(...args);};`);
  await page.fill('#assistant-message','What is my balance?');await page.click('#assistant-form button[type=submit]');
  await page.waitFor('document.querySelector("#assistant-form button[type=submit]").disabled===true && !!window.releaseAgentResponse');
  await page.evaluate('window.releaseAgentResponse();window.fetch=window.originalAgentFetch;');
  await page.waitFor('document.querySelector("#assistant-form").getAttribute("aria-busy")==="false" && !document.querySelector("#assistant-form button[type=submit]").disabled');
  async function ask(message){const n=await page.evaluate('document.querySelectorAll(".from-assistant").length');await page.fill('#assistant-message',message);await page.click('#assistant-form button[type=submit]');await page.waitFor('document.querySelectorAll(".from-assistant").length>'+n+' && document.querySelector("#assistant-form").getAttribute("aria-busy")==="false"');}
  await ask('Transfer');assert.match(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/amount/);
  await ask('SGD 1');await ask('1020001001');
  await page.click('.from-assistant:last-child [data-assistant-action]');await page.waitFor('location.pathname==="/transfers" && document.querySelector("#amount")?.value==="1.00"');
  assert.equal(await page.evaluate('document.querySelector("#toAccountNumber").value'),'1020001001');
  assert.deepEqual(page.errors,[]);
});
test('Bank staff investigate payments and preview rules with persisted evidence and no policy changes',async t=>{
  const {f,page}=await open(t,1280,'reviewer@greenlink.demo');
  const client=f.client();await client.login();const source=(await client.dashboard()).accounts[0];
  const paid=await client.request('/api/payments',{method:'POST',body:{fromAccountId:source.id,billerId:'pub',reference:'AGENT-BROWSER',amount:'100.00',requestId:randomUUID()}});assert.equal(paid.status,200);
  const policy=await f.riskClient.getRules();
  const held=await client.request('/api/payments',{method:'POST',body:{fromAccountId:source.id,billerId:'pub',reference:'AGENT-QUEUE',amount:'10000.00',requestId:randomUUID()}});assert.equal(held.status,200);assert.equal(held.data.transaction.status,'pending_review');
  await visit(page,f.baseUrl,'/banking-insights');await page.waitFor('document.querySelectorAll("#agent-rule option").length===5');
  await page.fill('#agent-transaction',paid.data.transaction.id);await page.click('#agent-fraud-form button[type=submit]');await page.waitFor('document.querySelector("[data-agent-report]")?.textContent.includes("Fraud investigation brief")');
  await visit(page,f.baseUrl,'/fraud-monitoring');await page.waitFor('!!document.querySelector("[data-investigate-transaction]")');
  await page.waitFor('!!document.querySelector("[data-model-activity]")');
  assert.match(await page.evaluate('document.querySelector("[data-model-activity]").textContent'),/AI model activity/);
  assert.match(await page.evaluate('document.querySelector("[data-model-monitoring-status]").textContent'),/current configured model/);
  await page.click('[data-investigate-transaction]');await page.waitFor('location.pathname==="/banking-insights" && document.querySelector("[data-agent-report]")?.textContent.includes("'+held.data.transaction.id+'")');
  await page.waitFor('document.querySelectorAll("#agent-rule option").length===5 && !document.querySelector("#agent-simulation-form fieldset").disabled');
  await page.fill('#agent-threshold','50');await page.click('#agent-simulation-form button[type=submit]');await page.waitFor('document.querySelector("[data-agent-report]")?.textContent.includes("Historical fraud rule impact analysis")');
  assert.match(await page.evaluate('document.querySelector("[data-agent-report]").textContent'),/changed decisions/);
  assert.equal(await page.evaluate('document.querySelector("#agent-threshold").value'),'50');
  await page.waitFor('document.querySelectorAll("[data-agent-run]").length>=2');
  await page.screenshot(path.resolve('test-results','agents-staff-desktop.png'));
  assert.deepEqual(await f.riskClient.getRules(),policy);assert.deepEqual(page.errors,[]);
});

test('Model connection checks and banking replies omit evidence while preserving saved records',async t=>{
  const agentModel={mode:'openai',model:'controlled-openai',inspect:async()=>({mode:'openai',available:true,configured:true,model:'controlled-openai'}),chat:async messages=>messages.some(m=>m.role==='user' && m.content==='test')?{role:'assistant',content:'Hello.'}:messages.some(m=>m.role==='tool')?{role:'assistant',content:'Inspect the owned account balances before authorizing a payment [E1].'}:{role:'assistant',content:'',tool_calls:[{function:{name:'get_accounts',arguments:{}}}]}};
  const f=await fixture(t,{agentModel}),page=await launchChrome(t,{width:390,height:900,mobile:true});
  await page.navigate(f.baseUrl+'/login');await page.waitFor('!!document.querySelector("#email")');
  await page.fill('#email','jamie@greenlink.demo');await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');
  await visit(page,f.baseUrl,'/banking-insights');await page.waitFor('document.querySelector("[data-agent-status]")?.textContent.includes("OpenAI ready")');
  await visit(page,f.baseUrl,'/assistant');assert.equal(await page.evaluate('!!document.querySelector("#assistant-engine")'),false);
  await page.fill('#assistant-message','test');await page.click('#assistant-form button[type=submit]');
  await page.waitFor('document.querySelector(".from-assistant:last-child")?.textContent.includes("Assistant is responding")');
  assert.equal(await page.evaluate('document.querySelector("#assistant-error").textContent'),'');
  assert.match(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/no banking records retrieved/);
  assert.equal(await page.evaluate('document.querySelectorAll(".assistant-evidence").length'),0);
  assert.equal(await page.evaluate('document.querySelectorAll("[data-assistant-suggestion]").length'),4);
  await page.fill('#assistant-message','Check my balance');await page.click('#assistant-form button[type=submit]');await page.waitFor('document.querySelectorAll(".from-assistant").length===2 && !document.querySelector("#assistant-form button[type=submit]").disabled');
  assert.doesNotMatch(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/\[E\d+\]|Evidence for this response|View saved evidence/);
  assert.equal(await page.evaluate('document.querySelectorAll(".assistant-evidence,#assistant-thread [data-agent-run]").length'),0);
  await page.click('[data-action="assistant-close"]');await page.click('[data-action="assistant-toggle"]');
  assert.equal(await page.evaluate('document.querySelectorAll(".assistant-evidence").length'),0);
  const previousRun=await page.evaluate("import('/js/core.js').then(({state})=>state.assistant.previousRunId)");
  const saved=(await f.db.query('SELECT report_json FROM agent_runs WHERE id=$1',[previousRun])).rows[0].report_json;
  assert.match(saved.reply,/\[E1\]/);assert.equal(saved.evidenceReferences[0].tool,'get_accounts');
  const financialBefore=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
  await f.db.query("UPDATE agent_runs SET created_at=now()-interval '16 minutes' WHERE id=$1",[previousRun]);
  await page.fill('#assistant-message','Check my balance');await page.click('#assistant-form button[type=submit]');
  await page.waitFor('document.querySelector("#assistant-error").textContent.includes("expired") && !document.querySelector("#assistant-form button[type=submit]").disabled');
  assert.equal(await page.evaluate("import('/js/core.js').then(({state})=>state.assistant.previousRunId)"),null,'Expired context must not be resent on retry');
  const replies=await page.evaluate('document.querySelectorAll(".from-assistant").length');
  await page.click('[data-action="assistant-retry"]');
  await page.waitFor('document.querySelectorAll(".from-assistant").length>'+replies+' && !document.querySelector("#assistant-form button[type=submit]").disabled');
  assert.equal(await page.evaluate('document.querySelector("#assistant-error").textContent'),'');
  assert.notEqual(await page.evaluate("import('/js/core.js').then(({state})=>state.assistant.previousRunId)"),previousRun);
  assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),financialBefore);
  const currentRun=await page.evaluate("import('/js/core.js').then(({state})=>state.assistant.previousRunId)");
  await visit(page,f.baseUrl,'/banking-insights');
  const runSelector='[data-agent-run="'+currentRun+'"]';
  await page.waitFor('!!document.querySelector('+JSON.stringify(runSelector)+')');await page.click(runSelector);
  await page.waitFor('location.pathname==="/banking-insights" && !!document.querySelector("[data-agent-report]")');
  assert.match(await page.evaluate('document.querySelector("[data-agent-report]").textContent'),/\[E1\] Owned account balances/);
  assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
  const unexpected=page.errors.filter(e=>!(e.source==='network' && e.url?.endsWith('/api/agents/assistant') && /status of 409/.test(e.text)));
  assert.deepEqual(unexpected,[]);
});


test('AI audit supports mobile search, model timeline, owned tool evidence and JSON download',async t=>{
 const fs=require('node:fs'),downloadPath=path.resolve('test-results','ai-audit-download');fs.mkdirSync(downloadPath,{recursive:true});
 const {f,page}=await open(t,390,'reviewer@greenlink.demo');
 await page.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath});
 await visit(page,f.baseUrl,'/assistant');await page.fill('#assistant-message','What is my balance?');await page.click('#assistant-form button[type=submit]');await page.waitFor('!!document.querySelector(".from-assistant [data-ai-audit-id]")');
 const runId=await page.evaluate('document.querySelector(".from-assistant [data-ai-audit-id]").dataset.aiAuditId');
 await page.click('.from-assistant [data-ai-audit-id]');await page.waitFor('location.pathname==="/ai-audit" && !!document.querySelector("#modal .ai-audit-timeline")');
 assert.match(await page.evaluate('document.querySelector("#modal").textContent'),/Model request timeline/);assert.match(await page.evaluate('document.querySelector("#modal").textContent'),/get_accounts/);assert.match(await page.evaluate('document.querySelector("#modal").textContent'),/not a transcript of hidden model thoughts/);
 assert.ok(await page.evaluate('document.querySelectorAll(".ai-audit-timeline li").length>=3'));assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
 await page.click('[data-action="ai-audit-download"]');
 const filename=path.join(downloadPath,'greenlink-ai-audit-agent-'+runId+'.json');
 const deadline=Date.now()+5000;while(!fs.existsSync(filename) && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,60));
 assert.ok(fs.existsSync(filename));const saved=JSON.parse(fs.readFileSync(filename,'utf8'));assert.equal(saved.id,runId);assert.ok(saved.modelCalls.length);assert.equal(saved.evidence.tools[0].tool,'get_accounts');fs.unlinkSync(filename);
 await page.click('[data-action="close-dialog"]');await page.fill('#ai-audit-query',runId);await page.click('#ai-audit-filters button[type=submit]');await page.waitFor('document.querySelector("[data-ai-audit-count]")?.textContent.startsWith("1 matching")');
 assert.equal(await page.evaluate('document.querySelector("[data-ai-audit-id]").dataset.aiAuditId'),runId);
 await page.fill('#ai-audit-query','NO-SUCH-AUDIT-RECORD');await page.click('#ai-audit-filters button[type=submit]');await page.waitFor('document.querySelector(".empty-state")?.textContent.includes("No matching AI records")');
 await page.screenshot(path.resolve('test-results','ai-audit-mobile.png'));assert.deepEqual(page.errors,[]);
});


async function auditFixture(t){const opened=await open(t,1280,'reviewer@greenlink.demo'),client=opened.f.client();await client.login('reviewer@greenlink.demo');const run=await client.request('/api/agents/assistant',{method:'POST',body:{message:'What is my balance?'}});assert.equal(run.status,200);await visit(opened.page,opened.f.baseUrl,'/ai-audit');await opened.page.waitFor('!!document.querySelector("[data-ai-audit-id]")');return {...opened,runId:run.data.runId};}
test('AI audit does not reopen dismissed details after leaving and returning to the page',async t=>{
 const {page,runId}=await auditFixture(t);
 await page.evaluate("window.auditOriginalFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.auditOriginalFetch(...args);if(String(args[0]).includes('/api/ai-audit/agent/')){const body=await response.text();await new Promise(resolve=>window.releaseAuditDetail=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};");
 await page.evaluate("import('/js/ai-audit.js').then(m=>{window.pendingAuditDetail=m.showAiAudit('agent',"+JSON.stringify(runId)+");return true;})");await page.waitFor('typeof window.releaseAuditDetail==="function"');
 if(await page.evaluate('document.querySelector("#modal").open'))await page.click('[data-action="close-dialog"]');
 await page.click('[data-nav="overview"]');await page.click('[data-nav="aiAudit"]');await page.waitFor('!!document.querySelector("[data-ai-audit-count]")');
 await page.evaluate('window.releaseAuditDetail();window.pendingAuditDetail');
 assert.equal(await page.evaluate('document.querySelector("#modal").open'),false,'A stale detail response must not reopen the dialog after navigation.');assert.deepEqual(page.errors,[]);
});
test('AI audit failed searches do not display the previous query results',async t=>{
 const {page}=await auditFixture(t);await page.evaluate("window.auditOriginalFetch=window.fetch;window.fetch=(...args)=>String(args[0]).includes('/api/ai-audit?')?Promise.resolve(new Response(JSON.stringify({error:'Audit search temporarily unavailable.'}),{status:503,headers:{'Content-Type':'application/json'}})):window.auditOriginalFetch(...args);");
 await page.fill('#ai-audit-query','NONEXISTENT-NEW-QUERY');await page.click('#ai-audit-filters button[type=submit]');await page.waitFor('document.querySelector(".ai-audit-panel .error-message")?.textContent.includes("temporarily unavailable")');
 assert.equal(await page.evaluate('document.querySelectorAll("[data-ai-audit-id]").length'),0,'Results from the previous query must be hidden after a failed search.');assert.equal(await page.evaluate('!!document.querySelector("[data-ai-audit-count]")'),false);assert.deepEqual(page.errors,[]);
});


test('An insights refresh preserves focus and typing in a draft rule form',async t=>{
 const {f,page}=await open(t,1280,'reviewer@greenlink.demo');await visit(page,f.baseUrl,'/banking-insights');await page.waitFor('document.querySelectorAll("#agent-rule option").length===5');
 await page.evaluate("window.focusOriginalFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.focusOriginalFetch(...args);if(String(args[0])==='/api/agents/status'){const body=await response.text();await new Promise(resolve=>window.releaseInsightStatus=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};");
 await page.evaluate("import('/js/agents.js').then(m=>{window.pendingInsightRefresh=m.loadAgents();return true;})");await page.waitFor('typeof window.releaseInsightStatus==="function"');
 await page.evaluate('document.querySelector("#agent-threshold").focus();document.querySelector("#agent-threshold").select();window.releaseInsightStatus();window.pendingInsightRefresh');
 const focused=await page.evaluate('document.activeElement.id');await page.send('Input.insertText',{text:'50'});
 assert.deepEqual({focused,threshold:await page.evaluate('document.querySelector("#agent-threshold").value')},{focused:'agent-threshold',threshold:'50'});assert.deepEqual(page.errors,[]);
});

test('Customers cannot open the AI audit page or trigger audit reads and do not see assistant or insight audit links',async t=>{
 const {f,page}=await open(t,390,'jamie@greenlink.demo');
 assert.equal(await page.evaluate('!!document.querySelector("[data-nav=aiAudit]")'),false);
 await visit(page,f.baseUrl,'/ai-audit');await page.waitFor('location.pathname==="/dashboard"');
 assert.equal(await page.evaluate('!!document.querySelector(".ai-audit-panel,[data-nav=aiAudit]")'),false);
 await page.evaluate("window.auditFetchCount=0;const original=window.fetch;window.fetch=(...args)=>{if(String(args[0]).includes('/api/ai-audit'))window.auditFetchCount++;return original(...args);};");
 const denied=await page.evaluate("(async()=>{const m=await import('/js/ai-audit.js');await m.loadAiAudit();await m.showAiAudit('agent','customer-forged-link');m.downloadAiAudit();return {requests:window.auditFetchCount,page:m.aiAuditPage(),dialog:document.querySelector('#modal').open};})()");
 assert.deepEqual(denied,{requests:0,page:'',dialog:false});
 await visit(page,f.baseUrl,'/assistant');await page.fill('#assistant-message','What is my balance?');await page.click('#assistant-form button[type=submit]');await page.waitFor('!!document.querySelector(".from-assistant")');
 assert.equal(await page.evaluate('!!document.querySelector("[data-ai-audit-id],[data-nav=aiAudit]")'),false);
 await visit(page,f.baseUrl,'/banking-insights');await page.waitFor('document.querySelector("[data-agent-status]")?.textContent.includes("OpenAI ready")');await page.click('#agent-liquidity-form button[type=submit]');await page.waitFor('!!document.querySelector("[data-agent-report]")');
 assert.equal(await page.evaluate('!!document.querySelector("[data-ai-audit-id],[data-nav=aiAudit]")'),false);
 assert.deepEqual(page.errors,[]);
});

async function pausePopupReply(page){
 await page.evaluate(`const popupFetch=window.fetch;window.fetch=async(...args)=>{const response=await popupFetch(...args);if(String(args[0])==='/api/agents/assistant'){window.fetch=popupFetch;const body=await response.text();await new Promise(resolve=>window.releasePopupReply=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};`);
}

test('Assistant popup preserves drafts across banking navigation and receives replies while minimized',async t=>{
 const {f,page}=await open(t,1280,'jamie@greenlink.demo');
 const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
 assert.equal(await page.evaluate('!!document.querySelector("[data-nav=assistant]")'),false);
 assert.equal(await page.evaluate('document.querySelector("#assistant-popup").hidden'),true);
 await page.click('[data-action="assistant-toggle"]');
 assert.deepEqual(await page.evaluate('({path:location.pathname,focused:document.activeElement.id,expanded:document.querySelector(".assistant-launcher").getAttribute("aria-expanded"),modal:document.querySelector("#assistant-popup").getAttribute("aria-modal")})'),{path:'/dashboard',focused:'assistant-message',expanded:'true',modal:'false'});
 await page.fill('#assistant-message','Unsent working note');
 await page.evaluate('window.originalPopup=document.querySelector("#assistant-popup")');
 await page.click('.nav-items [data-nav="accounts"]');await page.waitFor('location.pathname==="/accounts"');
 assert.equal(await page.evaluate('document.querySelector("#assistant-message").value'),'Unsent working note');
 assert.equal(await page.evaluate('window.originalPopup===document.querySelector("#assistant-popup")'),true);
 await pausePopupReply(page);await page.fill('#assistant-message','What is my balance?');await page.click('#assistant-form button[type=submit]');
 await page.waitFor('typeof window.releasePopupReply==="function"');
 await page.click('[data-action="assistant-close"]');
 assert.equal(await page.evaluate('document.activeElement.classList.contains("assistant-launcher")'),true);
 assert.equal(await page.evaluate('!!document.querySelector("#assistant-thread")'),false);
 await page.click('.nav-items [data-nav="activity"]');await page.waitFor('location.pathname==="/activity"');
 await page.evaluate('window.releasePopupReply()');await page.waitFor('!!document.querySelector(".assistant-unread:not([hidden])")');
 await page.click('[data-action="assistant-toggle"]');await page.waitFor('!!document.querySelector(".from-assistant")');
 assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant").length'),1);
 assert.equal(await page.evaluate('document.querySelector(".assistant-unread").hidden'),true);
 await page.press('Escape');assert.equal(await page.evaluate('document.querySelector("#assistant-popup").hidden'),true);
 await page.click('[data-action="assistant-toggle"]');await page.click('[data-action="assistant-clear"]');
 assert.equal(await page.evaluate('document.querySelectorAll(".assistant-message").length'),0);
 assert.equal(await page.evaluate('document.activeElement.id'),'assistant-message');
 await page.screenshot(path.resolve('test-results','assistant-popup-desktop.png'));
 assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
 await page.navigate(f.baseUrl+'/assistant');await page.waitFor('!!document.querySelector("#assistant-popup:not([hidden])")');assert.equal(await page.evaluate('location.pathname+location.search'),'/dashboard');
 assert.deepEqual(page.errors,[]);
});

test('Mobile popup clears session data and rejects a delayed reply after another operator signs in',async t=>{
 const {f,page}=await open(t,390,'jamie@greenlink.demo');
 await page.click('[data-action="assistant-toggle"]');await pausePopupReply(page);
 await page.evaluate('import("/js/assistant.js").then(m=>{window.pendingPopupSend=m.sendAssistant("What is my balance?");return true;})');
 await page.waitFor('typeof window.releasePopupReply==="function"');await page.click('[data-action="assistant-close"]');
 await page.click('[data-action="menu-open"]');await page.click('[data-action="logout"]');await page.waitFor('!!document.querySelector("#auth-form")');
 assert.equal(await page.evaluate('document.querySelector("#assistant-root").childElementCount'),0);
 await page.fill('#email','alex@greenlink.demo');await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');
 await page.click('[data-action="assistant-toggle"]');await page.evaluate('window.releasePopupReply();window.pendingPopupSend');
 assert.equal(await page.evaluate('document.querySelectorAll(".assistant-message").length'),0);
 assert.equal(await page.evaluate('document.querySelector("#assistant-form").getAttribute("aria-busy")'),'false');
 for(const height of [640,420]){
  await page.send('Emulation.setDeviceMetricsOverride',{width:360,height,deviceScaleFactor:1,mobile:true});
  const bounds=await page.evaluate('({width:innerWidth,height:innerHeight,popup:document.querySelector("#assistant-popup").getBoundingClientRect().toJSON(),send:document.querySelector("#assistant-form button[type=submit]").getBoundingClientRect().toJSON(),page:document.documentElement.scrollWidth})');
  assert.ok(bounds.popup.x>=0 && bounds.popup.right<=bounds.width && bounds.popup.top>=0 && bounds.popup.bottom<=bounds.height,JSON.stringify(bounds));
  assert.ok(bounds.send.top>=bounds.popup.top && bounds.send.bottom<=bounds.popup.bottom,JSON.stringify(bounds));assert.ok(bounds.page<=bounds.width+1);
 }
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await page.screenshot(path.resolve('test-results','assistant-popup-mobile.png'));
 await page.click('[data-action="menu-open"]');assert.equal(await page.evaluate('document.querySelector("#assistant-root").inert && getComputedStyle(document.querySelector("#assistant-root")).visibility==="hidden"'),true);
 await page.click('[data-action="menu-close"].sidebar-close');assert.equal(await page.evaluate('!document.querySelector("#assistant-popup").hidden && !document.querySelector("#assistant-root").inert'),true);
 await page.press('Escape');assert.equal(await page.evaluate('document.activeElement.classList.contains("assistant-launcher")'),true);
 assert.deepEqual(page.errors,[]);
});


test('Daily market review in the popup queues suspicious owned payments for independent staff without showing evidence panels',async t=>{
 const {contextFixture,marketModel}=require('./dft-market-fixtures');
 const f=await fixture(t,{agentModel:marketModel(),marketContext:{get:async()=>contextFixture()}}),client=f.client();await client.login('jamie@greenlink.demo');
 const source=(await client.dashboard()).accounts[0];
 const paid=await client.request('/api/transfers',{method:'POST',body:{fromAccountId:source.id,toAccountNumber:'1020001001',amount:'100.00',description:'Investment trading top-up',requestId:require('node:crypto').randomUUID()}});assert.equal(paid.status,200);
 const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
 const page=await launchChrome(t,{width:390,height:844,mobile:true});await page.navigate(f.baseUrl+'/login');await page.waitFor('!!document.querySelector("#auth-form")');
 const login=async email=>{await page.fill('#email',email);await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');};
 await login('jamie@greenlink.demo');await page.click('[data-action="assistant-toggle"]');await page.click('[data-assistant-suggestion="Check my transactions for fraud using daily market trends"]');
 await page.waitFor('document.querySelector(".from-assistant:last-child")?.textContent.includes("referred") && !document.querySelector("#assistant-form button[type=submit]").disabled');
 const reply=await page.evaluate('document.querySelector(".from-assistant:last-child").textContent');assert.match(reply,/USD\/SGD/);assert.match(reply,/ScamShield/);assert.match(reply,/Human review requested/);assert.doesNotMatch(reply,/Evidence for this response|\[E\d+\]/);
 assert.equal(await page.evaluate('!!document.querySelector(".assistant-evidence,[data-ai-audit-id]")'),false);assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
 await page.click('[data-action="assistant-close"]');await page.click('[data-action="menu-open"]');await page.click('[data-action="logout"]');await page.waitFor('!!document.querySelector("#auth-form")');await login('reviewer@greenlink.demo');
 await page.click('[data-action="menu-open"]');await page.click('[data-nav="fraud"]');await page.waitFor('!!document.querySelector("[data-fraud-case]")');await page.click('[data-fraud-case]');
 await page.waitFor('document.querySelector("#modal").textContent.includes("qualitative human review")');assert.match(await page.evaluate('document.querySelector("#modal").textContent'),/No new numeric fraud score/);assert.ok(await page.evaluate('!!document.querySelector("[data-claim-fraud-case]")'));
 assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);assert.deepEqual(page.errors,[]);
});


test('Assistant opens company activity dashboards on mobile with owned totals, ambiguity choices and safe refreshes',async t=>{
  const agentModel={mode:'openai',model:'controlled-company-browser',inspect:async()=>({available:true,mode:'openai',model:'controlled-company-browser'}),chat:async messages=>messages.some(m=>m.role==='tool')?{role:'assistant',content:'Open the company dashboard to inspect your recorded activity [E1].'}:{role:'assistant',content:'',tool_calls:[{function:{name:'get_company_activity',arguments:{company:'Harbour Supplies'}}}]}};
  const f=await fixture(t,{agentModel}),page=await launchChrome(t,{width:390,height:900,mobile:true});
  await page.navigate(f.baseUrl+'/login');await page.waitFor('!!document.querySelector("#email")');
  await page.fill('#email','alex@greenlink.demo');await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');
  const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
  await page.click('[data-action="assistant-toggle"]');await page.fill('#assistant-message','Generate a transaction activity dashboard with Harbour Supplies for the last 30 days');await page.click('#assistant-form button[type=submit]');
  await page.waitFor('!!document.querySelector(".from-assistant:last-child [data-assistant-action]")');
  assert.doesNotMatch(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/\[E\d+\]|Evidence for this response/);
  await page.click('.from-assistant:last-child [data-assistant-action]');await page.waitFor('location.pathname==="/company-activity" && !!document.querySelector("[data-company-dashboard]")');
  assert.equal(await page.evaluate('new URL(location.href).searchParams.get("company")'),'Harbour Supplies Pte. Ltd.');
  assert.match(await page.evaluate('document.querySelector("[data-company-dashboard]").textContent'),/Harbour Supplies Pte. Ltd\.[\s\S]*85\.00/);
  assert.equal(await page.evaluate('document.querySelectorAll(".company-transactions tbody tr").length'),1);
  assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
  await page.click('.company-transactions [data-transaction]');await page.waitFor('document.querySelector("#modal").open && !!document.querySelector("#modal .review-list")');await page.click('#modal [data-action="close-dialog"]');
  await page.fill('#company-name','Pte. Ltd.');await page.click('#company-activity-filters button[type=submit]');await page.waitFor('document.querySelector(".company-choices h2")?.textContent==="Choose a company."');
  assert.ok(await page.evaluate('document.querySelectorAll("[data-company-choice]").length>=3'));
  await page.click('[data-company-choice="Acme Trading Pte. Ltd."]');await page.waitFor('document.querySelector(".company-summary h2")?.textContent==="Acme Trading Pte. Ltd."');
  assert.match(await page.evaluate('document.querySelector(".company-metrics").textContent'),/5,200\.00/);
  await page.navigate(await page.evaluate('location.href'));await page.waitFor('document.querySelector(".company-summary h2")?.textContent==="Acme Trading Pte. Ltd."');
  await page.evaluate('window.originalCompanyFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.originalCompanyFetch(...args);if(String(args[0]).includes("/company-activity?") && new URL(args[0],location.origin).searchParams.get("company")==="Studio North")await new Promise(resolve=>{window.releaseCompanyResponse=resolve;});return response;};');
  await page.fill('#company-name','Studio North');await page.click('#company-activity-filters button[type=submit]');await page.waitFor('!!window.releaseCompanyResponse');
  await page.fill('#company-name','Harbour Supplies');await page.click('#company-activity-filters button[type=submit]');await page.waitFor('document.querySelector(".company-summary h2")?.textContent==="Harbour Supplies Pte. Ltd."');
  await page.evaluate('window.releaseCompanyResponse();window.fetch=window.originalCompanyFetch;');
  await page.waitFor('document.querySelector("#company-activity-results").getAttribute("aria-busy")==="false"');
  assert.equal(await page.evaluate('document.querySelector(".company-summary h2").textContent'),'Harbour Supplies Pte. Ltd.');
  await page.fill('#company-name','Not A Customer Company');await page.click('#company-activity-filters button[type=submit]');await page.waitFor('document.querySelector(".company-choices h2")?.textContent==="No matching counterparty."');
  assert.equal(await page.evaluate('document.querySelectorAll("[data-company-choice],[data-company-dashboard]").length'),0);
  await page.fill('#company-name','Harbour Supplies');await page.click('#company-activity-filters button[type=submit]');await page.waitFor('!!document.querySelector("[data-company-dashboard]")');
  await page.screenshot(path.resolve('test-results','company-activity-mobile.png'));
  assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
  assert.deepEqual(page.errors,[]);
});


test('Assistant saves an all-company dashboard that reopens across logins, refreshes and stays private on mobile',async t=>{
 const agentModel={mode:'openai',model:'controlled-save-dashboard',inspect:async()=>({available:true}),chat:async messages=>{
  const calls=messages.filter(m=>m.role==='tool');const name=!calls.length?'get_company_activity':calls.at(-1).tool_name==='get_company_activity'?'save_company_dashboard':null;
  return name?{role:'assistant',content:'',tool_calls:[{function:{name,arguments:{}}}]}:{role:'assistant',content:'Your private dashboard is saved. Open it to review the company activity [E2].'};
 }};
 const f=await fixture(t,{agentModel}),page=await launchChrome(t,{width:390,height:900,mobile:true});
 async function login(email){await page.navigate(f.baseUrl+'/login');await page.waitFor('!!document.querySelector("#email")');await page.fill('#email',email);await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');}
 async function logout(){await page.click('[data-action="menu-open"]');await page.click('[data-action="logout"]');await page.waitFor('!!document.querySelector("#auth-form")');}
 await login('alex@greenlink.demo');await page.click('[data-action="assistant-toggle"]');await page.fill('#assistant-message','Summarize my transactions with other companies in a dashboard and save it for future use');await page.click('#assistant-form button[type=submit]');
 await page.waitFor('document.querySelector(".from-assistant:last-child")?.textContent.includes("Dashboard saved") && !document.querySelector("#assistant-form button[type=submit]").disabled');
 assert.doesNotMatch(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/\[E\d+\]|Evidence for this response/);
 const action=await page.evaluate('[...document.querySelectorAll(".from-assistant:last-child [data-assistant-action]")].find(b=>b.textContent.includes("Open saved dashboard")).dataset.assistantAction');await page.click('[data-assistant-action="'+action+'"]');
 await page.waitFor('!!document.querySelector(".saved-view-notice") && document.querySelectorAll(".company-breakdown tbody tr").length===5');
 const savedId=await page.evaluate('new URL(location.href).searchParams.get("savedView")');assert.ok(savedId);
 assert.match(await page.evaluate('document.querySelector(".saved-view-notice").textContent'),/Latest 90 days/);assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
 await page.navigate(await page.evaluate('location.href'));await page.waitFor('!!document.querySelector(".saved-view-notice")');
 await visit(page,f.baseUrl,'/saved-dashboards');await page.waitFor('document.querySelectorAll(".saved-dashboard-card").length===1');
 await logout();await login('jamie@greenlink.demo');await visit(page,f.baseUrl,'/saved-dashboards');await page.waitFor('document.querySelector("#dashboard-view-list").textContent.includes("No saved dashboards")');assert.equal(await page.evaluate('document.querySelectorAll(".saved-dashboard-card").length'),0);
 await logout();await login('alex@greenlink.demo');await visit(page,f.baseUrl,'/saved-dashboards');await page.waitFor('document.querySelectorAll(".saved-dashboard-card").length===1');
 await page.click('[data-saved-dashboard="'+savedId+'"]');await page.waitFor('!!document.querySelector(".saved-view-notice")');
 const client=f.client();await client.login();const account=(await client.dashboard()).accounts[0];assert.equal((await client.request('/api/payments',{method:'POST',body:{fromAccountId:account.id,billerId:'pub',reference:'SAVED-VIEW-UPDATE',amount:'1.25',requestId:randomUUID()}})).status,200);
 await page.navigate(await page.evaluate('location.href'));await page.waitFor('document.querySelectorAll(".company-breakdown tbody tr").length===6');assert.match(await page.evaluate('document.querySelector(".company-breakdown").textContent'),/PUB/);
 await page.screenshot(path.resolve('test-results','saved-dashboard-mobile.png'));
 await visit(page,f.baseUrl,'/company-activity?scope=all');await page.waitFor('!!document.querySelector("#save-dashboard-form")');await page.fill('#dashboard-title','<img src=x onerror=alert(1)>');await page.click('#save-dashboard-form button[type=submit]');await page.waitFor('!!document.querySelector(".saved-view-notice")');
 // Saving identical filters reuses the existing view instead of creating bloat.
 assert.equal(Number((await f.db.query('SELECT count(*) FROM saved_dashboard_views')).rows[0].count),1);
 const today=await page.evaluate("import('/js/core.js').then(m=>m.singaporeDay())");
 await visit(page,f.baseUrl,'/company-activity?scope=all&from='+today.slice(0,7)+'-01&to='+today);await page.waitFor('!!document.querySelector("#save-dashboard-form")');await page.fill('#dashboard-title','<img src=x onerror=alert(1)>');await page.click('#save-dashboard-form button[type=submit]');await page.waitFor('!!document.querySelector(".saved-view-notice")');
 await visit(page,f.baseUrl,'/saved-dashboards');await page.waitFor('document.querySelectorAll(".saved-dashboard-card").length===2');assert.equal(await page.evaluate('document.querySelectorAll(".saved-dashboard-card img").length'),0);assert.match(await page.evaluate('document.querySelector("#dashboard-view-list").textContent'),/<img src=x onerror=alert\(1\)>/);
 const otherId=await page.evaluate('[...document.querySelectorAll("[data-remove-dashboard]")].map(b=>b.dataset.removeDashboard).find(id=>id!=='+JSON.stringify(savedId)+')');await page.click('[data-remove-dashboard="'+otherId+'"]');await page.waitFor('document.querySelectorAll(".saved-dashboard-card").length===1');
 await visit(page,f.baseUrl,'/saved-dashboards');await page.waitFor('!!document.querySelector("[data-remove-dashboard]")');await page.click('[data-remove-dashboard="'+savedId+'"]');await page.waitFor('document.querySelector("#dashboard-view-list").textContent.includes("No saved dashboards")');
 assert.deepEqual(page.errors,[]);
});


test('Rules arriving during another insights form edit initialize a valid preview without replacing focus',async t=>{
 const {f,page}=await open(t,1280,'reviewer@greenlink.demo');
 await page.evaluate('window.ruleFetch=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).endsWith("/fraud/rules"))await new Promise(resolve=>window.releaseRules=resolve);return window.ruleFetch(...args);};');
 await page.evaluate("import('/js/core.js').then(m=>m.navigate('agents'))");
 await page.waitFor('!!window.releaseRules && !!document.querySelector("#agent-simulation-form fieldset[disabled]")');
 assert.equal(await page.evaluate('document.querySelector("#agent-rule").value'),'');
 await page.fill('#agent-days','14');await page.evaluate('window.releaseRules();window.fetch=window.ruleFetch;');
 await page.waitFor('document.querySelectorAll("#agent-rule option").length===5 && !document.querySelector("#agent-simulation-form fieldset").disabled');
 assert.equal(await page.evaluate('document.activeElement.id'),'agent-days');assert.equal(await page.evaluate('document.querySelector("#agent-days").value'),'14');
 assert.equal(await page.evaluate('document.querySelector("#agent-rule").value'),'high_value');assert.equal(await page.evaluate('document.querySelector("#agent-simulation-form").elements.enabled.checked'),true);
 await page.fill('#agent-threshold','50');await page.click('#agent-simulation-form button[type=submit]');await page.waitFor('document.querySelector("[data-agent-report]")?.textContent.includes("Historical fraud rule impact analysis")');
 assert.deepEqual(page.errors,[]);
});
