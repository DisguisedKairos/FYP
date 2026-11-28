'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers');
const {launchChrome}=require('./chrome');
async function open(t,width,email,options={}){
  const f=await fixture(t,options),page=await launchChrome(t,{width,height:900,mobile:width<760});
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

test('General banking explanations are labelled on mobile and support a simple contextual follow-up',async t=>{
 const agentModel={mode:'openai',model:'controlled-openai',inspect:async()=>({available:true}),chat:async()=>({role:'assistant',content:'Liquidity means having readily available funds to meet business obligations.'})};
 const {f,page}=await open(t,390,'alex@greenlink.demo',{agentModel});
 const before=(await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;
 await visit(page,f.baseUrl,'/assistant');
 for(const question of ['What is liquidity in wholesale digital banking?','Explain that more simply.']){
  const count=await page.evaluate('document.querySelectorAll(".from-assistant").length');
  await page.fill('#assistant-message',question);await page.click('#assistant-form button[type=submit]');
  await page.waitFor('document.querySelectorAll(".from-assistant").length>'+count+'&&!document.querySelector("#assistant-form button[type=submit]").disabled');
  assert.match(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/General banking explanation; no account records checked/);
 }
 assert.deepEqual((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,before);assert.deepEqual(page.errors,[]);
});
test('Popup accepts value-free security help, blocks appended credentials and opens permitted guidance screens',async t=>{
  const {f,page}=await open(t,390,'jamie@greenlink.demo');
  await visit(page,f.baseUrl,'/assistant');
  await page.evaluate(`window.guidanceRequests=0;const original=window.fetch;window.fetch=(...args)=>{if(String(args[0]).endsWith('/agents/assistant'))window.guidanceRequests++;return original(...args);};`);
  async function ask(message){
    const count=await page.evaluate('document.querySelectorAll(".from-assistant").length');
    await page.fill('#assistant-message',message);await page.click('#assistant-form button[type=submit]');
    await page.waitFor('document.querySelectorAll(".from-assistant").length>'+count+' && document.querySelector("#assistant-form").getAttribute("aria-busy")==="false"');
    return page.evaluate('document.querySelector(".from-assistant:last-child").textContent');
  }
  assert.match(await ask('How do I change my password?'),/Profile & security/);
  assert.equal(await page.evaluate('window.guidanceRequests'),1);
  await page.fill('#assistant-message','How do I change my password? My OTP is 123456');
  await page.click('#assistant-form button[type=submit]');
  await page.waitFor('document.querySelector("#assistant-error").textContent.length>0');
  assert.equal(await page.evaluate('window.guidanceRequests'),1,'Credential values must never reach the assistant endpoint');
  assert.match(await ask('Open Notifications, follow owned receipt, mark read and refresh.'),/Open Notifications/);
  assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child [data-assistant-action]").length'),1);
  await page.click('.from-assistant:last-child [data-assistant-action]');
  await page.waitFor('location.pathname==="/notifications"');
  await visit(page,f.baseUrl,'/assistant');
  assert.match(await ask('How do I approve a held payment?'),/independent bank reviewer/);
  await page.click('.from-assistant:last-child [data-assistant-action]');
  await page.waitFor('location.pathname==="/activity"');
  assert.equal(await page.evaluate('!!document.querySelector("[data-nav=fraud],[data-nav=rules],[data-nav=aiAudit]")'),false);
  assert.deepEqual(page.errors,[]);
});

test('Business users build a multi-turn draft on mobile without an insights workspace',async t=>{
  const {f,page}=await open(t,390,'jamie@greenlink.demo');
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


test('Evidence starts collapsed, follows explicit requests and preserves manual toggles without exposing customer audit controls',async t=>{
  const agentModel={mode:'openai',model:'controlled-openai',inspect:async()=>({mode:'openai',available:true,configured:true,model:'controlled-openai'}),chat:async messages=>messages.some(m=>m.role==='user' && m.content==='test')?{role:'assistant',content:'Hello.'}:messages.some(m=>m.role==='tool')?{role:'assistant',content:'Inspect the owned account balances before authorizing a payment [E1].\n\nCheck upcoming obligations before deciding on a payment.'}:{role:'assistant',content:'',tool_calls:[{function:{name:'get_accounts',arguments:{}}}]}};
  const f=await fixture(t,{agentModel}),page=await launchChrome(t,{width:390,height:900,mobile:true});
  await page.navigate(f.baseUrl+'/login');await page.waitFor('!!document.querySelector("#email")');
  await page.fill('#email','jamie@greenlink.demo');await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');
  await visit(page,f.baseUrl,'/assistant');assert.equal(await page.evaluate('!!document.querySelector("#assistant-engine")'),false);
  await page.fill('#assistant-message','test');await page.click('#assistant-form button[type=submit]');
  await page.waitFor('document.querySelector(".from-assistant:last-child")?.textContent.includes("Assistant is responding")');
  assert.equal(await page.evaluate('document.querySelector("#assistant-error").textContent'),'');
  assert.match(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/no banking records retrieved/);
  assert.equal(await page.evaluate('document.querySelectorAll(".assistant-evidence").length'),0);
  assert.equal(await page.evaluate('document.querySelectorAll("[data-assistant-suggestion]").length'),4);
  await page.fill('#assistant-message','Check my balance');await page.click('#assistant-form button[type=submit]');await page.waitFor('document.querySelectorAll(".from-assistant").length===2 && !document.querySelector("#assistant-form button[type=submit]").disabled');
  assert.doesNotMatch(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/\[E\d+\]|Evidence for this response|View saved evidence/);
  assert.equal(await page.evaluate('document.querySelectorAll(".assistant-evidence").length'),1);
  assert.equal(await page.evaluate('document.querySelector(".from-assistant:last-child .assistant-message-text").textContent.split(/\\n\\n/).length'),2);
  assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".from-assistant:last-child .assistant-message-text")).whiteSpace'),'pre-line');
  assert.equal(await page.evaluate('document.querySelector(".assistant-evidence").open'),false);
  assert.equal(await page.evaluate('document.querySelectorAll("#assistant-thread [data-agent-run],[data-ai-audit-id]").length'),0);
  await page.click('.assistant-evidence summary');await page.waitFor('document.querySelector(".assistant-evidence").open');
  await page.click('[data-action="assistant-close"]');await page.click('[data-action="assistant-toggle"]');
  assert.equal(await page.evaluate('document.querySelector(".assistant-evidence").open'),true);
  for(const [message,expanded]of [["Check my balance; don't minimize the evidence tab.",true],['Check my balance',true],['Check my balance; do not show evidence.',false],['Check my balance; leave the evidence section expanded.',true],['Check my balance; keep the evidence panel collapsed.',false]]){
    const count=await page.evaluate('document.querySelectorAll(".from-assistant").length');
    await page.fill('#assistant-message',message);await page.click('#assistant-form button[type=submit]');
    await page.waitFor('document.querySelectorAll(".from-assistant").length>'+count+' && !document.querySelector("#assistant-form button[type=submit]").disabled');
    assert.equal(await page.evaluate('document.querySelector(".from-assistant:last-child .assistant-evidence").open'),expanded,message);
  }
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




test('Customers cannot open the AI audit page or trigger audit reads and do not see assistant audit links',async t=>{
 const {f,page}=await open(t,390,'jamie@greenlink.demo');
 assert.equal(await page.evaluate('!!document.querySelector("[data-nav=aiAudit]")'),false);
 await visit(page,f.baseUrl,'/ai-audit');await page.waitFor('location.pathname==="/dashboard"');
 assert.equal(await page.evaluate('!!document.querySelector(".ai-audit-panel,[data-nav=aiAudit]")'),false);
 await page.evaluate("window.auditFetchCount=0;const original=window.fetch;window.fetch=(...args)=>{if(String(args[0]).includes('/api/ai-audit'))window.auditFetchCount++;return original(...args);};");
 const denied=await page.evaluate("(async()=>{const m=await import('/js/ai-audit.js');await m.loadAiAudit();await m.showAiAudit('agent','customer-forged-link');m.downloadAiAudit();return {requests:window.auditFetchCount,page:m.aiAuditPage(),dialog:document.querySelector('#modal').open};})()");
 assert.deepEqual(denied,{requests:0,page:'',dialog:false});
 await visit(page,f.baseUrl,'/assistant');await page.fill('#assistant-message','What is my balance?');await page.click('#assistant-form button[type=submit]');await page.waitFor('!!document.querySelector(".from-assistant")');
 assert.equal(await page.evaluate('!!document.querySelector("[data-ai-audit-id],[data-nav=aiAudit]")'),false);
 assert.deepEqual(page.errors,[]);
});

async function pausePopupReply(page){
 await page.evaluate(`const popupFetch=window.fetch;window.fetch=async(...args)=>{const response=await popupFetch(...args);if(String(args[0])==='/api/agents/assistant'){window.fetch=popupFetch;const body=await response.text();await new Promise(resolve=>window.releasePopupReply=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};`);
}

test('Assistant timestamps use Singapore time and survive retries, reopening and viewport changes',async t=>{
 const {page}=await open(t,390,'jamie@greenlink.demo');
 await page.send('Emulation.setTimezoneOverride',{timezoneId:'America/Los_Angeles'});
 await page.click('[data-action="assistant-toggle"]');
 await page.evaluate(`const timestampFetch=window.fetch;window.fetch=(...args)=>{if(String(args[0])==='/api/agents/assistant'){window.fetch=timestampFetch;return Promise.resolve(new Response(JSON.stringify({error:'Temporary assistant error.'}),{status:503,headers:{'Content-Type':'application/json'}}));}return timestampFetch(...args);};`);
 const sentAfter=Date.now();
 await page.fill('#assistant-message','What is my balance?');await page.click('#assistant-form button[type=submit]');
 await page.waitFor('document.querySelector("#assistant-error").textContent.includes("Temporary assistant error")');
 const sentAt=await page.evaluate('document.querySelector(".from-user time").dateTime');
 assert.ok(Date.parse(sentAt)>=sentAfter && Date.parse(sentAt)<=Date.now());
 assert.equal(await page.evaluate('document.querySelector(".from-user time").getAttribute("aria-label").startsWith("Sent ")'),true);
 await pausePopupReply(page);await page.click('[data-action="assistant-retry"]');
 await page.waitFor('typeof window.releasePopupReply==="function"');
 assert.equal(await page.evaluate('document.querySelectorAll(".from-user").length'),1);
 assert.equal(await page.evaluate('document.querySelector(".from-user time").dateTime'),sentAt);
 assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant time").length'),0);
 const receivedAfter=Date.now();
 await page.evaluate('window.releasePopupReply()');await page.waitFor('!!document.querySelector(".from-assistant time")');
 const readTimes=()=>page.evaluate('Array.from(document.querySelectorAll(".assistant-message time"),t=>({at:t.dateTime,text:t.textContent,label:t.getAttribute("aria-label")}))');
 const times=await readTimes();assert.equal(times.length,2);
 assert.ok(Date.parse(times[1].at)>=receivedAfter && Date.parse(times[1].at)<=Date.now());
 assert.match(times[1].label,/^Received /);
 const singapore=new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 for(const time of times)assert.equal(time.text,singapore.format(new Date(time.at))+' SGT');
 await page.click('[data-action="assistant-close"]');await page.click('[data-action="assistant-toggle"]');
 assert.deepEqual(await readTimes(),times);
 for(const [width,height] of [[1280,900],[360,640]]){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<760});
  assert.equal(await page.evaluate('Array.from(document.querySelectorAll(".assistant-message time")).every(t=>{const a=t.getBoundingClientRect(),b=t.closest(".assistant-message").getBoundingClientRect();return a.left>=b.left && a.right<=b.right;})'),true);
  assert.equal(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  assert.deepEqual(await readTimes(),times);
 }
 await page.screenshot(path.resolve('test-results','assistant-message-timestamps.png'));
 await page.click('[data-action="assistant-clear"]');
 assert.equal(await page.evaluate('document.querySelectorAll(".assistant-message time").length'),0);
 assert.deepEqual(page.errors,[]);
});

async function popupSize(page){
 return page.evaluate('({width:document.querySelector("#assistant-popup").getBoundingClientRect().width,height:document.querySelector("#assistant-popup").getBoundingClientRect().height})');
}
async function resizePopup(page,dx,dy){
 const point=await page.evaluate('(()=>{const r=document.querySelector(".assistant-resize-handle").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
 await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
 await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:point.x+dx,y:point.y+dy});
 await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:point.x+dx,y:point.y+dy});
}
test('Assistant expands, restores and resizes without losing drafts, replies or the chosen size',async t=>{
 const {f,page}=await open(t,1280,'jamie@greenlink.demo');
 const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
 await page.click('[data-action="assistant-toggle"]');
 const initial=await popupSize(page);
 await page.evaluate('window.originalPopup=document.querySelector("#assistant-popup")');
 await page.fill('#assistant-message','Keep my working note');
 await resizePopup(page,-160,-80);
 const resized=await popupSize(page);
 assert.deepEqual(resized,{width:initial.width+160,height:initial.height+80});
 assert.equal(await page.evaluate('document.querySelector("#assistant-popup").classList.contains("assistant-resizing")'),false);
 await page.press('ArrowLeft');assert.equal((await popupSize(page)).width,resized.width+20);
 await page.press('ArrowRight');await page.press('ArrowDown');await page.press('ArrowUp');
 assert.deepEqual(await popupSize(page),resized);
 assert.equal(await page.evaluate('document.querySelector("#assistant-message").value'),'Keep my working note');
 await pausePopupReply(page);await page.fill('#assistant-message','What is my balance?');await page.click('#assistant-form button[type=submit]');
 await page.waitFor('typeof window.releasePopupReply==="function"');
 await page.fill('#assistant-message','My next unsent question');
 const sentAt=await page.evaluate('document.querySelector(".from-user time").dateTime');
 await page.click('[data-action="assistant-expand"]');
 assert.equal(await page.evaluate('document.querySelector("[data-action=assistant-expand]").getAttribute("aria-pressed")'),'true');
 assert.equal(await page.evaluate('document.querySelector("[data-action=assistant-expand]").getAttribute("aria-label")'),'Restore assistant size');
 assert.equal(await page.evaluate('document.querySelector(".assistant-resize-handle").hidden'),true);
 const expanded=await popupSize(page);assert.ok(expanded.width>resized.width && expanded.height>resized.height);
 assert.equal(await page.evaluate('document.activeElement.dataset.action'),'assistant-expand');
 await page.screenshot(path.resolve('test-results','assistant-expanded.png'));
 await page.click('[data-action="assistant-expand"]');assert.deepEqual(await popupSize(page),resized);
 await page.evaluate('window.releasePopupReply()');await page.waitFor('!!document.querySelector(".from-assistant time")');
 assert.equal(await page.evaluate('document.querySelector("#assistant-message").value'),'My next unsent question');
 assert.equal(await page.evaluate('document.querySelector(".from-user time").dateTime'),sentAt);
 assert.equal(await page.evaluate('window.originalPopup===document.querySelector("#assistant-popup")'),true);
 await page.click('[data-action="assistant-close"]');await page.click('[data-action="assistant-toggle"]');
 assert.deepEqual(await popupSize(page),resized);
 await page.click('.nav-items [data-nav="accounts"]');await page.waitFor('location.pathname==="/accounts"');
 assert.deepEqual(await popupSize(page),resized);
 assert.equal(await page.evaluate('document.querySelector("#assistant-message").value'),'My next unsent question');
 await page.screenshot(path.resolve('test-results','assistant-resized-desktop.png'));
 await page.send('Emulation.setDeviceMetricsOverride',{width:360,height:640,deviceScaleFactor:1,mobile:true});
 await page.waitFor('document.querySelector("#assistant-popup").getBoundingClientRect().width<=336');
 assert.equal(await page.evaluate('(()=>{const p=document.querySelector("#assistant-popup").getBoundingClientRect();return p.left>=0 && p.top>=0 && p.right<=innerWidth && p.bottom<=innerHeight;})()'),true);
 await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await page.waitFor('document.querySelector("#assistant-popup").getBoundingClientRect().width==='+resized.width);
 assert.deepEqual(await popupSize(page),resized);
 await page.click('[data-action="assistant-clear"]');assert.deepEqual(await popupSize(page),resized);
 await resizePopup(page,-3000,-3000);
 assert.equal(await page.evaluate('(()=>{const p=document.querySelector("#assistant-popup").getBoundingClientRect();return p.left>=11 && p.top>=11 && p.right<=innerWidth && p.bottom<=innerHeight;})()'),true);
 await resizePopup(page,3000,3000);assert.deepEqual(await popupSize(page),{width:340,height:420});
 assert.equal(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
 assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
 assert.deepEqual(page.errors,[]);
});

test('Assistant touch resizing keeps mobile controls reachable and cancels cleanly',async t=>{
 const {page}=await open(t,390,'jamie@greenlink.demo');await page.click('[data-action="assistant-toggle"]');
 const initial=await popupSize(page),point=await page.evaluate('(()=>{const p=document.querySelector(".assistant-resize-handle").getBoundingClientRect();return {x:p.x+13,y:p.y+13};})()');
 await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});
 await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+20,y:point.y+80,id:1}]});
 await page.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
 assert.deepEqual(await popupSize(page),{width:initial.width-20,height:initial.height-80});
 assert.equal(await page.evaluate('document.querySelector("#assistant-popup").classList.contains("assistant-resizing")'),false);
 await page.click('[data-action="assistant-expand"]');
 for(const height of [640,420]){
  await page.send('Emulation.setDeviceMetricsOverride',{width:360,height,deviceScaleFactor:1,mobile:true});
  await page.waitFor('document.querySelector("#assistant-popup").getBoundingClientRect().bottom<=innerHeight');
  assert.equal(await page.evaluate('(()=>{const p=document.querySelector("#assistant-popup").getBoundingClientRect();return p.left>=0 && p.top>=0 && p.right<=innerWidth;})()'),true);
  assert.equal(await page.evaluate('Array.from(document.querySelectorAll(".assistant-window-actions button,#assistant-form button[type=submit]")).every(e=>{const r=e.getBoundingClientRect(),p=document.querySelector("#assistant-popup").getBoundingClientRect();return r.left>=p.left && r.right<=p.right && r.top>=p.top && r.bottom<=p.bottom;})'),true);
 }
 await page.screenshot(path.resolve('test-results','assistant-expanded-mobile.png'));
 await page.click('[data-action="assistant-expand"]');
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
 await page.waitFor('document.querySelector("#assistant-popup").getBoundingClientRect().height==='+ (initial.height-80));
 await page.press('Escape');assert.equal(await page.evaluate('document.activeElement.classList.contains("assistant-launcher")'),true);
 assert.deepEqual(page.errors,[]);
});

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
 await page.waitFor('typeof window.releasePopupReply==="function"');await page.click('[data-action="assistant-expand"]');await page.click('[data-action="assistant-close"]');
 await page.click('[data-action="menu-open"]');await page.click('[data-action="logout"]');await page.waitFor('!!document.querySelector("#auth-form")');
 assert.equal(await page.evaluate('document.querySelector("#assistant-root").childElementCount'),0);
 await page.fill('#email','alex@greenlink.demo');await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');
 await page.click('[data-action="assistant-toggle"]');await page.evaluate('window.releasePopupReply();window.pendingPopupSend');
 assert.equal(await page.evaluate('document.querySelector("[data-action=assistant-expand]").getAttribute("aria-pressed")'),'false');
 assert.equal(await page.evaluate('document.querySelector("#assistant-popup").classList.contains("assistant-sized")'),false);
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


test('Daily market review retains visible findings with supporting evidence collapsed and audit controls private',async t=>{
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
 assert.equal(await page.evaluate('document.querySelector(".assistant-evidence").open'),false);
 assert.equal(await page.evaluate('!!document.querySelector("[data-ai-audit-id]")'),false);assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
 await page.click('[data-action="assistant-close"]');await page.click('[data-action="menu-open"]');await page.click('[data-action="logout"]');await page.waitFor('!!document.querySelector("#auth-form")');await login('reviewer@greenlink.demo');
 await page.click('[data-action="menu-open"]');await page.click('[data-nav="fraud"]');await page.waitFor('!!document.querySelector("[data-fraud-case]")');await page.click('[data-fraud-case]');
 await page.waitFor('document.querySelector("#modal").textContent.includes("qualitative human review")');assert.match(await page.evaluate('document.querySelector("#modal").textContent'),/No new numeric fraud score/);assert.ok(await page.evaluate('!!document.querySelector("[data-claim-fraud-case]")'));
 assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);assert.deepEqual(page.errors,[]);
});





test('Recent transaction replies display the entire bounded receipt list with its full-history action',async t=>{
 const {f,page}=await open(t,390,'jamie@greenlink.demo');
 const account=(await f.db.query("SELECT a.id FROM accounts a JOIN users u ON u.id=a.user_id WHERE u.email='jamie@greenlink.demo' ORDER BY a.id LIMIT 1")).rows[0];
 for(let i=0;i<24;i++)await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,created_at,requested_at) VALUES($1,$2,'bill',$3,-100,'Browser Receipt Supplier','pending_review',now(),now())",[randomUUID(),account.id,'Browser receipt '+i]);
 await visit(page,f.baseUrl,'/assistant');await page.fill('#assistant-message','Show my recent transactions');await page.click('#assistant-form button[type=submit]');
 await page.waitFor('document.querySelectorAll(".from-assistant").length===1 && document.querySelector("#assistant-form").getAttribute("aria-busy")==="false"');
 const shown=await page.evaluate('[...document.querySelectorAll(".from-assistant .assistant-items > li strong")].map(n=>n.textContent)');
 assert.equal(shown.filter(t=>t.startsWith('Browser receipt ')).length,20);
 assert.match(await page.evaluate('document.querySelector(".from-assistant").textContent'),/showing 20.*Open Activity/);
 assert.equal(await page.evaluate('document.querySelector(".from-assistant [data-assistant-action]").textContent.includes("View matching transactions")'),true);
 assert.deepEqual(page.errors,[]);
});

test('Opening matching transactions preserves the assistant status and money-out filters',async t=>{
 const agentModel={mode:'openai',model:'controlled-openai',inspect:async()=>({available:true}),chat:async messages=>messages.some(m=>m.role==='tool')?{role:'assistant',content:'The matching receipt records are shown below [E1].'}:{role:'assistant',content:'',tool_calls:[{function:{name:'search_transactions',arguments:{q:'Filter Supplier',status:'pending_review',type:'outgoing'}}}]}};
 const {f,page}=await open(t,390,'jamie@greenlink.demo',{agentModel});
 const account=(await f.db.query("SELECT a.id FROM accounts a JOIN users u ON u.id=a.user_id WHERE u.email='jamie@greenlink.demo' ORDER BY a.id LIMIT 1")).rows[0];
 await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,created_at,requested_at) VALUES($1,$2,'bill','Awaiting filtered invoice',-123,'Filter Supplier','pending_review',now(),now())",[randomUUID(),account.id]);
 await visit(page,f.baseUrl,'/assistant');await page.fill('#assistant-message','List my money-out entries for Filter Supplier that are still waiting for approval.');await page.click('#assistant-form button[type=submit]');
 await page.waitFor('!!document.querySelector(".from-assistant [data-assistant-action]") && document.querySelector("#assistant-form").getAttribute("aria-busy")==="false"');
 await page.click('.from-assistant [data-assistant-action]');await page.waitFor('location.pathname==="/activity" && !!document.querySelector("#history-results .transaction-table")');
 assert.equal(await page.evaluate('document.querySelector("#transaction-type").value'),'outgoing');assert.equal(await page.evaluate('document.querySelector("#transaction-status").value'),'pending_review');assert.equal(await page.evaluate('document.querySelector("#transaction-search").value'),'Filter Supplier');
 assert.equal(await page.evaluate('document.querySelectorAll("#history-results tbody tr").length'),1);assert.match(await page.evaluate('document.querySelector("#history-results").textContent'),/Awaiting filtered invoice/);assert.deepEqual(page.errors,[]);
});


test('Banking insights is absent for customers and staff while the chatbot and audit access remain available',async t=>{
 for(const [width,email] of [[390,'jamie@greenlink.demo'],[1280,'reviewer@greenlink.demo']]){
  const {f,page}=await open(t,width,email);
  assert.equal(await page.evaluate('!!document.querySelector("[data-nav=agents],[data-investigate-transaction]")'),false);
  await page.navigate(f.baseUrl+'/banking-insights');await page.waitFor('location.pathname==="/dashboard" && !!document.querySelector(".app-shell")');
  assert.equal(await page.evaluate('!!document.querySelector("[data-nav=agents],[data-agent-report],form[data-agent-kind]")'),false);
  await visit(page,f.baseUrl,'/assistant');await page.fill('#assistant-message','What is my balance?');await page.click('#assistant-form button[type=submit]');await page.waitFor('!!document.querySelector(".from-assistant")');
  assert.equal(await page.evaluate('!!document.querySelector(".from-assistant [data-ai-audit-id]")'),email.startsWith('reviewer'));
  assert.deepEqual(page.errors,[]);
 }
});
