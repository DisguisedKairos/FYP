'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers'),{launchChrome}=require('./chrome');
function model(){return {mode:'openai',model:'controlled-chat-dashboard',inspect:async()=>({available:true}),chat:async messages=>{
 const text=messages.find(row=>row.role==='user').content,calls=messages.filter(row=>row.role==='tool');
 let name,args={};
 if(!calls.length){
  if(/saved dashboards|open my saved dashboard/i.test(text))name='list_saved_dashboards';
  else if(/balance/i.test(text))name='get_accounts';
  else {name='get_company_activity';if(/Harbour Supplies/i.test(text))args.company='Harbour Supplies';else if(/Pte\. Ltd\./i.test(text))args.company='Pte. Ltd.';}
 }else if(calls.at(-1).tool_name==='get_company_activity' && /save/i.test(text))name='save_company_dashboard';
 else if(calls.at(-1).tool_name==='list_saved_dashboards' && /open my saved dashboard/i.test(text)){
  const views=JSON.parse(calls.at(-1).content).data.views;if(views.length){name='open_saved_dashboard';args.viewId=views[0].id;}
 }
 if(name)return {role:'assistant',content:'',tool_calls:[{function:{name,arguments:args}}]};
 return {role:'assistant',content:(calls.some(row=>row.tool_name==='save_company_dashboard')?'Your dashboard is saved and shown here in chat':calls.at(-1)?.tool_name==='list_saved_dashboards'?'Choose a saved dashboard below':'Review the retrieved activity here in chat')+' [E'+calls.length+'].'};
}};}
async function login(page,email){await page.waitFor('!!document.querySelector("#email")');await page.fill('#email',email);await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');}
async function open(t,width=390){const f=await fixture(t,{agentModel:model()}),page=await launchChrome(t,{width,height:1000,mobile:width<760});await page.navigate(f.baseUrl+'/login');await login(page,'alex@greenlink.demo');return {f,page};}
async function chat(page){if(!await page.evaluate('!!document.querySelector("#assistant-popup:not([hidden])")'))await page.click('[data-action="assistant-toggle"]');}
async function ask(page,text){await chat(page);const count=await page.evaluate('document.querySelectorAll(".from-assistant").length');await page.fill('#assistant-message',text);await page.click('#assistant-form button[type=submit]');await page.waitFor('document.querySelectorAll(".from-assistant").length>'+count+' && !document.querySelector("#assistant-form button[type=submit]").disabled');}
async function logout(page){await page.click('[data-action="assistant-close"]');if(await page.evaluate('innerWidth<760'))await page.click('[data-action="menu-open"]');await page.click('[data-action="logout"]');await page.waitFor('!!document.querySelector("#auth-form")');}

test('Requested company charts render inside chat, resolve ambiguity and never navigate away',async t=>{
 const {f,page}=await open(t,1280),url=await page.evaluate('location.pathname');
 assert.equal(await page.evaluate('document.querySelectorAll("[data-nav=companyActivity],[data-nav=dashboardViews]").length'),0);
 assert.equal(await page.evaluate('document.querySelectorAll("[data-company-dashboard]").length'),0);
 await ask(page,'Show a transaction dashboard with Harbour Supplies for the last 30 days');
 await page.waitFor('!!document.querySelector("#assistant-popup [data-company-dashboard]")');
 assert.equal(await page.evaluate('location.pathname'),url);
 assert.match(await page.evaluate('document.querySelector(".from-assistant:last-child [data-company-dashboard]").textContent'),/Harbour Supplies.*85\.00/s);
 assert.ok(await page.evaluate('[...document.querySelectorAll(".activity-month-bar.paid")].some(el=>el.getBoundingClientRect().height>1)'));
 assert.doesNotMatch(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/\[E\d+\]|Evidence for this response|Open company dashboard/);
 await page.screenshot(path.resolve('test-results','assistant-inline-dashboard-desktop.png'));
 await ask(page,'Show a dashboard with Pte. Ltd.');
 await page.waitFor('document.querySelector(".from-assistant:last-child .company-choice-list button")');
 await page.click('.from-assistant:last-child [data-company-choice="Acme Trading Pte. Ltd."]');
 await page.waitFor('document.querySelector(".from-assistant:last-child [data-company-dashboard] h3")?.textContent==="Acme Trading Pte. Ltd."');
 assert.equal(await page.evaluate('location.pathname'),url);
 await ask(page,'Save this dashboard');await page.waitFor('!!document.querySelector(".from-assistant:last-child .assistant-saved-notice")');
 assert.equal((await f.db.query('SELECT config_json FROM saved_dashboard_views')).rows[0].config_json.company,'Acme Trading Pte. Ltd.');
 assert.equal(Number((await f.db.query('SELECT count(*) FROM saved_dashboard_views')).rows[0].count),1);
 assert.equal(await page.evaluate('new Set([...document.querySelectorAll(".assistant-dashboard [id]")].map(el=>el.id)).size===document.querySelectorAll(".assistant-dashboard [id]").length'),true);
 await page.click('[data-action="assistant-close"]');await chat(page);
 assert.equal(await page.evaluate('document.querySelectorAll("#assistant-popup [data-company-dashboard]").length'),3);
 await ask(page,'What is my balance?');assert.equal(await page.evaluate('document.querySelector(".from-assistant:last-child [data-company-dashboard]")===null'),true);
 assert.deepEqual(page.errors,[]);
});

test('Saved dashboards reopen and refresh in chat across sign-ins while staying private',async t=>{
 const {f,page}=await open(t),url=await page.evaluate('location.pathname');
 const setup=f.client();await setup.login();assert.equal((await setup.request('/api/dashboard-views',{method:'POST',body:{title:'<img src=x onerror=alert(1)>',definition:{scope:'all',company:'',period:{kind:'rolling',days:90}}}})).status,200);
 await ask(page,'Summarize my transactions with other companies in a dashboard and save it for future use');
 await page.waitFor('!!document.querySelector(".assistant-saved-notice")');
 assert.equal(await page.evaluate('document.querySelectorAll(".activity-company-bar").length'),5);
 await logout(page);await login(page,'jamie@greenlink.demo');await ask(page,'Show my saved dashboards');
 assert.match(await page.evaluate('document.querySelector(".from-assistant:last-child .assistant-saved-dashboards").textContent'),/No saved dashboards/);
 assert.equal(await page.evaluate('document.querySelectorAll("[data-company-dashboard]").length'),0);
 await logout(page);await login(page,'alex@greenlink.demo');await ask(page,'Show my saved dashboards');
 assert.equal(await page.evaluate('document.querySelectorAll(".assistant-saved-card").length'),1);
 assert.equal(await page.evaluate('document.querySelectorAll(".assistant-saved-card img").length'),0);assert.match(await page.evaluate('document.querySelector(".assistant-saved-card").textContent'),/<img src=x onerror=alert\(1\)>/);
 await page.click('.assistant-saved-card [data-dashboard-command="open"]');await page.waitFor('!!document.querySelector(".from-assistant:last-child [data-company-dashboard]")');
 assert.equal(await page.evaluate('location.pathname'),url);
 const client=f.client();await client.login();const account=(await client.dashboard()).accounts[0];
 assert.equal((await client.request('/api/payments',{method:'POST',body:{fromAccountId:account.id,billerId:'pub',reference:'INLINE-REFRESH',amount:'1.25',requestId:randomUUID()}})).status,200);
 await page.click('.from-assistant:last-child [data-dashboard-command="refresh"]');await page.waitFor('document.querySelectorAll(".from-assistant:last-child .activity-company-bar").length===6');
 assert.match(await page.evaluate('document.querySelector(".from-assistant:last-child .activity-company-card").textContent'),/PUB/);
 assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
 await page.click('.assistant-saved-card [data-dashboard-command="remove"]');await page.waitFor('document.querySelectorAll(".assistant-saved-card").length===0');
 assert.equal(Number((await f.db.query('SELECT count(*) FROM saved_dashboard_views')).rows[0].count),0);
 assert.deepEqual(page.errors,[]);
});

test('A delayed inline dashboard cannot return after logout or overwrite another operator chat',async t=>{
 const {page}=await open(t);
 await ask(page,'Show my company transaction dashboard');await page.waitFor('!!document.querySelector("[data-company-dashboard]")');
 await page.evaluate('window.originalChartFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.originalChartFetch(...args);if(String(args[0]).includes("/company-activity?"))await new Promise(resolve=>window.releaseChart=resolve);return response;};');
 await page.click('[data-dashboard-command="refresh"]');await page.waitFor('!!window.releaseChart');
 await logout(page);await login(page,'jamie@greenlink.demo');await chat(page);
 await page.evaluate('window.releaseChart();window.fetch=window.originalChartFetch;');await page.waitFor('document.querySelector("#assistant-form").getAttribute("aria-busy")==="false"');
 assert.equal(await page.evaluate('document.querySelectorAll("[data-company-dashboard]").length'),0);
 assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant").length'),0);
 assert.deepEqual(page.errors,[]);
});

test('Inline charts retain real amounts, status counts, pagination and empty states on mobile',async t=>{
 const {f,page}=await open(t),client=f.client();await client.login();const account=(await client.dashboard()).accounts[0];
 for(const status of ['pending_review','rejected'])await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,created_at,requested_at) VALUES($1,$2,'transfer','Chat status fixture',-100000,'Harbour Supplies Pte. Ltd.',$3,$4,$4)",[randomUUID(),account.id,status,new Date().toISOString()]);
 for(let index=0;index<7;index++)await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,'credit','Chart receipt',100,$3,'completed',$4,$4,$4,nextval('settlement_sequence'))",[randomUUID(),account.id,'Additional Company '+index,new Date().toISOString()]);
 const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),expected=(await client.request('/api/company-activity?scope=all')).data.dashboard;
 await ask(page,'Show a company transaction dashboard for the last 366 days');
 await page.waitFor('!!document.querySelector(".activity-company-bar")');
 assert.equal(await page.evaluate('document.querySelectorAll(".activity-company-bar").length'),10);
 assert.equal(await page.evaluate('document.querySelector(".activity-status-total").textContent'),String(expected.totals.transactionCount));
 assert.match(await page.evaluate('document.querySelector(".activity-status-ring").getAttribute("aria-label")'),/Awaiting review: 1.*Rejected: 1/);
 assert.ok(await page.evaluate('document.querySelector(".activity-month-scroll").scrollWidth>document.querySelector(".activity-month-scroll").clientWidth'));
 assert.ok(await page.evaluate('[...document.querySelectorAll(".activity-month-bar.received")].some(el=>el.getBoundingClientRect().height>1)'));
 await page.click('[data-dashboard-command="save"]');await page.waitFor('!!document.querySelector(".assistant-saved-notice")');
 await page.click('[data-dashboard-command="next"]');await page.waitFor('document.querySelectorAll(".activity-company-bar").length===2');
 assert.match(await page.evaluate('document.querySelector(".activity-company-card").textContent'),/Companies 11-12 of 12/);
 assert.equal(await page.evaluate('document.querySelector(".activity-status-total").textContent'),String(expected.totals.transactionCount));
 await ask(page,'Show Harbour Supplies dashboard from 2000-01-01 to 2000-01-01');
 await page.waitFor('!!document.querySelector(".from-assistant:last-child .activity-chart-empty")');
 assert.equal(await page.evaluate('document.querySelector(".from-assistant:last-child .activity-status-total").textContent'),'0');
 assert.doesNotMatch(await page.evaluate('document.querySelector(".from-assistant:last-child .company-visual-grid").innerHTML'),/NaN|Infinity/);
 assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
 await page.screenshot(path.resolve('test-results','assistant-inline-dashboard-mobile.png'));
 assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
 assert.deepEqual(page.errors,[]);
});

test('Former company dashboard URLs open chat without an automatic dashboard',async t=>{
 const {f,page}=await open(t);
 for(const route of ['/company-activity?scope=all','/saved-dashboards']){
  await page.navigate(f.baseUrl+route);await page.waitFor('!!document.querySelector("#assistant-popup:not([hidden])")');
  assert.equal(await page.evaluate('location.pathname'),'/dashboard');
  assert.equal(await page.evaluate('document.querySelectorAll("[data-company-dashboard]").length'),0);
  assert.equal(await page.evaluate('document.querySelectorAll("[data-nav=companyActivity],[data-nav=dashboardViews]").length'),0);
 }
 assert.deepEqual(page.errors,[]);
});
