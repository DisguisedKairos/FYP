'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {fixture}=require('./dft-helpers'),{launchChrome}=require('./chrome');
const publicResearch=require('../banking/public-research');
function model(){return {mode:'openai',model:'controlled-insights-browser',inspect:async()=>({available:true}),research:async spec=>({status:'ready',kind:spec.kind,title:spec.title,checkedAt:spec.checkedAt,parts:[{text:'Public company context. Company source',annotations:[{url:'https://www.dbs.com/',title:'Company source',start:24,end:38}]}],sources:[{url:'https://www.dbs.com/',title:'Company source'}],scope:'Public context; no banking authorization.',modelResponse:{model:'controlled-insights-browser'}}),chat:async messages=>{
 const message=messages.find(m=>m.role==='user').content,calls=messages.filter(m=>m.role==='tool');
 let name,args={};
 if(!calls.length){if(/public.*DBS/i.test(message)){name='research_public_company';args.companyName='DBS Group';}else if(/my (?:business|company) profile/i.test(message))name='get_business_profile';else if(/^(?:add|save|pin)/i.test(message))name='save_company_dashboard';else name='get_company_activity';}
 if(name)return {role:'assistant',content:'',tool_calls:[{function:{name,arguments:args}}]};
 return {role:'assistant',content:(calls.some(c=>c.tool_name==='save_company_dashboard')?'Your dashboard is saved privately':'Review the retrieved context and its stated scope')+' [E'+calls.length+'].'};
}};}
async function login(page,email='alex@greenlink.demo'){await page.waitFor('!!document.querySelector("#email")');await page.fill('#email',email);await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');}
async function open(t,width=1280){const f=await fixture(t,{agentModel:model()}),page=await launchChrome(t,{width,height:1000,mobile:width<760});await page.navigate(f.baseUrl+'/login');await login(page);return {f,page};}
async function ask(page,value){if(!await page.evaluate('!!document.querySelector("#assistant-popup:not([hidden])")'))await page.click('[data-action="assistant-toggle"]');const count=await page.evaluate('document.querySelectorAll(".from-assistant").length');await page.fill('#assistant-message',value);await page.click('#assistant-form button[type=submit]');await page.waitFor('document.querySelectorAll(".from-assistant").length>'+count+'&&!document.querySelector("#assistant-form button[type=submit]").disabled');}
test('A chart can be added in chat, customized on its own page and refreshed weekly without financial actions',async t=>{
 const {f,page}=await open(t);
 await ask(page,'Show my transaction trends over the past 6 months');await page.waitFor('!!document.querySelector("[data-company-dashboard]")');
 await ask(page,'Add this chart to my customized dashboard and refresh it weekly as "My supplier trends"');
 await page.waitFor('document.querySelector(".from-assistant:last-child .assistant-saved-notice")?.textContent.includes("My supplier trends")');
 await page.click('.from-assistant:last-child [data-nav="customDashboard"]');await page.waitFor('!!document.querySelector("[data-custom-card] .activity-month-card")');
 assert.equal(await page.evaluate('location.pathname'),'/custom-dashboard');
 assert.match(await page.evaluate('document.querySelector("[data-custom-card]").textContent'),/My supplier trends.*Weekly refresh/s);
 const id=await page.evaluate('document.querySelector("[data-custom-card]").dataset.customCard');
 await page.click('.custom-chart-settings>summary');
 await page.fill('[name="title"]','Renamed supplier trends');
 await page.evaluate('document.querySelector(".custom-chart-form [name=chartType]").value="line"');
 await page.click('.custom-chart-form button[type=submit]');
 await page.waitFor('!!document.querySelector(".trend-line-chart")&&document.querySelector("[data-custom-title]").textContent==="Renamed supplier trends"');
 await page.click('[data-custom-command="refresh"]');await page.waitFor('document.querySelector("[data-custom-card] [data-custom-command=refresh]")?.disabled===false');
 const row=(await f.db.query('SELECT title,refresh_cadence,presentation_json,version FROM saved_dashboard_views WHERE id=$1',[id])).rows[0];
 assert.equal(row.title,'Renamed supplier trends');assert.equal(row.refresh_cadence,'weekly');assert.equal(row.presentation_json.chartType,'line');assert.equal(row.version,2);
 assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".trend-line.received")).stroke===getComputedStyle(document.querySelector("[data-custom-card] .activity-swatch.received")).backgroundColor'),true);
 await page.screenshot(path.resolve('test-results','customized-dashboard-desktop.png'));assert.deepEqual(page.errors,[]);
});
test('Assistant preferences persist and control later chart style and default trend period on mobile',async t=>{
 const {f,page}=await open(t,390);await page.navigate(f.baseUrl+'/custom-dashboard');await page.waitFor('!!document.querySelector("#assistant-preferences-form")');
 await page.evaluate('document.querySelector("#assistant-style").value="detailed";document.querySelector("#assistant-months").value="6";document.querySelector("#assistant-chart").value="table";document.querySelector("#assistant-topic").value="trade"');
 await page.click('#assistant-preferences-form button[type=submit]');
 await page.waitFor('document.querySelector("#toast")?.textContent==="Assistant preferences saved."');
 await ask(page,'Show my transaction trends over the past few months');await page.waitFor('!!document.querySelector(".from-assistant:last-child .company-months[open]")');
 const result=await page.evaluate('({rows:document.querySelectorAll(".from-assistant:last-child .company-months tbody tr").length,bars:document.querySelectorAll(".from-assistant:last-child .activity-month-bar").length})');
 assert.equal(result.rows,6);assert.equal(result.bars,0);assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
 await page.screenshot(path.resolve('test-results','customized-dashboard-mobile.png'));assert.deepEqual(page.errors,[]);
});
test('Public company research displays clickable source annotations and the business-profile report stays private',async t=>{
 const {page}=await open(t);
 await ask(page,'Research the public company profile of DBS Group');
 await page.waitFor('!!document.querySelector(".public-research-citation")');
 assert.equal(await page.evaluate('document.querySelector(".public-research-citation").getAttribute("href")'),'https://www.dbs.com/');
 assert.equal(await page.evaluate('document.querySelector(".public-research-citation").getAttribute("rel")'),'noopener noreferrer');
 await ask(page,'Analyze my business profile');
 assert.match(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/Meridian Logistics/);
 assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child .public-research-card").length'),0);assert.deepEqual(page.errors,[]);
});
test('Customized dashboard contents clear on sign-out and cannot be listed by another operator',async t=>{
 const {f,page}=await open(t),client=f.client();await client.login();
 await client.request('/api/dashboard-views',{method:'POST',body:{title:'Private first operator chart',definition:{scope:'all',company:'',period:{kind:'months',months:3}}}});
 await page.navigate(f.baseUrl+'/custom-dashboard');await page.waitFor('!!document.querySelector("[data-custom-card]")');
 await page.click('[data-action="logout"]');await page.waitFor('!!document.querySelector("#auth-form")');await login(page,'jamie@greenlink.demo');
 await page.navigate(f.baseUrl+'/custom-dashboard');await page.waitFor('!!document.querySelector("#assistant-preferences-form")');
 assert.equal(await page.evaluate('document.querySelectorAll("[data-custom-card]").length'),0);
 assert.doesNotMatch(await page.evaluate('document.querySelector("#main-content").textContent'),/Private first operator chart/);assert.deepEqual(page.errors,[]);
});

test('A delayed initial custom chart cannot overwrite a newer manual refresh',async t=>{
 const {f,page}=await open(t),client=f.client();await client.login();
 const saved=await client.request('/api/dashboard-views',{method:'POST',body:{definition:{scope:'all',company:'',period:{kind:'rolling',days:90}}}});
 const id=saved.data.view.id,before=(await client.request('/api/dashboard-views/'+id)).data.dashboard.totals.outgoingCents;
 await page.evaluate('window.originalInitialFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.originalInitialFetch(...args);if(!window.initialHeld&&String(args[0]).includes("/api/dashboard-views/")&&args[1]?.method==="GET"){window.initialHeld=true;await new Promise(resolve=>window.releaseInitial=resolve);}return response;};');
 await page.click('[data-nav="customDashboard"]');await page.waitFor('!!window.releaseInitial');
 const account=(await client.dashboard()).accounts[0];
 const paid=await client.request('/api/payments',{method:'POST',body:{fromAccountId:account.id,billerId:'pub',reference:'CUSTOM-FRESHNESS',amount:'1.25',requestId:require('node:crypto').randomUUID()}});
 assert.equal(paid.status,200);
 await page.click('[data-custom-command="refresh"]');
 const expected=new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD'}).format((before+125)/100);
 await page.waitFor('document.querySelector("[data-custom-card] .company-metrics")?.textContent.includes('+JSON.stringify(expected)+')');
 await page.evaluate('window.releaseInitial();window.fetch=window.originalInitialFetch;new Promise(resolve=>setTimeout(resolve,180));');
 assert.ok((await page.evaluate('document.querySelector("[data-custom-card] .company-metrics").textContent')).includes(expected));
 assert.deepEqual(page.errors,[]);
});

test('Customized charts page through every company and open matching transactions',async t=>{
 const {f,page}=await open(t),client=f.client();await client.login();
 const account=(await client.dashboard()).accounts[0];
 for(let i=1;i<=13;i++)await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,'transfer',$3,$4,$5,'completed',now(),now(),now(),nextval('settlement_sequence'))",[require('node:crypto').randomUUID(),account.id,'Pagination supplier receipt '+i,-i*100,'Pagination Supplier '+String(i).padStart(2,'0')]);
 const saved=await client.request('/api/dashboard-views',{method:'POST',body:{definition:{scope:'all',company:'',period:{kind:'months',months:3}}}});
 await page.navigate(f.baseUrl+'/custom-dashboard');await page.waitFor('!!document.querySelector("[data-custom-card] .activity-company-bars")');
 const root='[data-custom-card="'+saved.data.view.id+'"]';
 const first=(await page.evaluate('Array.from(document.querySelectorAll('+JSON.stringify(root+' [data-company-choice]')+')).map(e=>e.dataset.companyChoice)'));
 await page.click(root+' [data-custom-command="next"]');
 await page.waitFor('document.querySelector('+JSON.stringify(root+' [data-custom-paging]')+')?.textContent.includes("Page 2")');
 const second=await page.evaluate('Array.from(document.querySelectorAll('+JSON.stringify(root+' [data-company-choice]')+')).map(e=>e.dataset.companyChoice)');
 assert.ok(second.length>0);assert.ok(second.every(name=>!first.includes(name)));
 await page.click(root+' [data-company-choice]');await page.waitFor('!!document.querySelector('+JSON.stringify(root+' .custom-dashboard-records tbody tr')+')');
 assert.match(await page.evaluate('document.querySelector('+JSON.stringify(root+' .custom-dashboard-records')+').textContent'),/Pagination supplier receipt/);
 await page.click(root+' [data-custom-command="reset"]');
 await page.waitFor('!!document.querySelector('+JSON.stringify(root+' .activity-company-bars')+')');
 await page.click(root+' [data-custom-command="next"]');
 await page.waitFor('document.querySelector('+JSON.stringify(root+' [data-custom-paging]')+')?.textContent.includes("Page 2")');
 await page.click(root+' [data-custom-command="prev"]');
 await page.waitFor('document.querySelector('+JSON.stringify(root+' [data-custom-paging]')+')?.textContent.includes("Page 1")');
 assert.deepEqual(page.errors,[]);
});
