'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./dft-helpers'),{launchChrome}=require('./chrome'),news=require('../banking/news-insights');
const NOW=Date.parse('2026-11-12T04:00:00Z'),now=()=>NOW;
function provider(){return {mode:'openai',model:'controlled-news-browser',inspect:async()=>({available:true}),chat:async messages=>{
 const calls=messages.filter(m=>m.role==='tool');if(calls.some(m=>m.tool_name==='analyze_news_insights'))return {role:'assistant',content:'Review the sourced implications and independent checks [E2].'};
 const name=calls.length?'analyze_news_insights':'get_market_insights';return {role:'assistant',content:'',tool_calls:[{function:{name,arguments:calls.length?{}:{topic:'industry'}}}]};
 },research:async request=>{const text='A sourced industry advisory describes supplier disruption. Publication dates and legal entity identity require independent confirmation. Source';return {status:'ready',kind:'market',title:request.title,checkedAt:request.checkedAt,parts:[{text,annotations:[{url:'https://www.csa.gov.sg/',title:'Official source',start:text.length-6,end:text.length}]}]};},assessNews:async input=>news.validate({tool_calls:[{function:{name:'submit_news_advisory',arguments:{summary:'Review relevant operating dependencies and independently confirm the news context.',insights:[['human_review','supply_chain','Supplier disruption needs verification'],['watch','market','Watch subsequent developments'],['insufficient_evidence','compliance','Identity remains unverified']].map(([flag,category,headline])=>({flag,category,headline,why:'The retrieved summary identifies an issue to check independently before applying it to the business.',evidence:[{partId:input.parts[0].partId,quote:'Publication dates and legal entity identity require independent confirmation.'}],actions:['verify_source','verify_identity']}))}}}]},input)};}
async function open(t,width){const f=await fixture(t,{now,agentModel:provider()}),page=await launchChrome(t,{width,height:950,mobile:width<760});await page.navigate(f.baseUrl+'/login');await page.waitFor('!!document.querySelector("#email")');await page.fill('#email','jamie@greenlink.demo');await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');await page.click('[data-action=assistant-toggle]');return {f,page};}
async function ask(page){await page.fill('#assistant-message','Show current news for my industry and advise what concerns to flag');await page.click('#assistant-form button[type=submit]');await page.waitFor('!!document.querySelector(".news-insights")&&!document.querySelector("#assistant-form button[type=submit]").disabled');}
test('Mobile news advice renders sourced flags and independent checks in chat without financial or staff-case actions',async t=>{
 const {f,page}=await open(t,390),before=(await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;
 await ask(page);const text=await page.evaluate('document.querySelector(".news-insights").textContent');
 assert.match(text,/Consider human review/);assert.match(text,/Watch this development/);assert.match(text,/Insufficient evidence/);assert.match(text,/Chat-only advisory flags/);assert.match(text,/Verify source dates and legal identity independently/);
 assert.equal(await page.evaluate('document.querySelector(".news-insights").open'),false);
 assert.match(await page.evaluate('document.querySelector(".news-insights>summary").innerText'),/Human review: 1.*Watch: 1.*Uncertain: 1/);
 assert.equal(await page.evaluate('document.querySelector(".news-insight p").checkVisibility()'),false);
 await page.click('.news-insights>summary');assert.equal(await page.evaluate('document.querySelector(".news-insights").open'),true);
 assert.equal(await page.evaluate('document.querySelector(".news-insight").open'),false);
 await page.click('.news-insight>summary');assert.equal(await page.evaluate('document.querySelector(".news-insight p").checkVisibility()'),true);
 await page.click('[data-action=assistant-close]');await page.click('[data-action=assistant-toggle]');
 assert.equal(await page.evaluate('document.querySelector(".news-insights").open&&document.querySelector(".news-insight").open'),true);
 await page.click('.news-insights>summary');assert.equal(await page.evaluate('document.querySelector(".news-insights").open'),false);
 assert.equal(await page.evaluate('document.querySelectorAll(".news-insights .news-insight-source a").length'),3);assert.equal(await page.evaluate('document.querySelector(".news-insight-source a").getAttribute("href")'),'https://www.csa.gov.sg/');
 assert.equal(await page.evaluate('document.querySelectorAll(".from-assistant:last-child [data-assistant-action],.from-assistant:last-child [data-ai-audit-id]").length'),0);
 assert.equal(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);assert.deepEqual((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,before);assert.equal((await f.db.query('SELECT count(*)::int AS count FROM fraud_cases')).rows[0].count,0);
 assert.equal(await page.evaluate('(()=>{const heading=document.querySelector(".news-insights>summary").getBoundingClientRect(),thread=document.querySelector("#assistant-thread").getBoundingClientRect();return heading.top<thread.bottom&&heading.bottom>thread.top;})()'),true);
 await page.screenshot('test-results/news-advice-mobile.png');assert.deepEqual(page.errors,[]);
});
test('News advice is cleared with the chat and cannot persist into another operator session',async t=>{
 const {page}=await open(t,1280);await ask(page);await page.click('[data-action=assistant-clear]');assert.equal(await page.evaluate('document.querySelectorAll(".news-insights").length'),0);
 await ask(page);await page.click('[data-action=assistant-close]');await page.click('[data-action=logout]');await page.waitFor('!!document.querySelector("#email")');
 await page.fill('#email','alex@greenlink.demo');await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');await page.click('[data-action=assistant-toggle]');
 assert.equal(await page.evaluate('document.querySelectorAll(".news-insights").length'),0);assert.deepEqual(page.errors,[]);
});


test('Business news preferences save on mobile and the briefing button opens a company-specific chat',async t=>{
 const {seedIndustryBusinesses,CASES,PASSWORD}=require('../scripts/seed-industry-businesses');
 const f=await fixture(t,{now,agentModel:provider()});await seedIndustryBusinesses(f.db,{now});
 const page=await launchChrome(t,{width:390,height:950,mobile:true});
 await page.navigate(f.baseUrl+'/login');await page.waitFor('!!document.querySelector("#email")');
 await page.fill('#email',CASES[0].email);await page.fill('#password',PASSWORD);await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');
 await page.navigate(f.baseUrl+'/business');await page.waitFor('!!document.querySelector("[data-action=business-advisory]")');await page.click('[data-action=business-advisory]');await page.waitFor('!!document.querySelector("#business-advisory-form")');
 assert.match(await page.evaluate('document.querySelector("#modal").textContent'),/Meridian Logistics/);
 await page.evaluate('(()=>{const form=document.querySelector("#business-advisory-form");for(const input of form.querySelectorAll("input[type=checkbox]"))input.checked=input.name==="markets"?input.value==="MY":input.name==="operations"?input.value==="warehouse":input.value==="liquidity";})()');
 await page.click('#business-advisory-form button[type=submit]');await page.waitFor('!document.querySelector("#modal").open');
 const user=(await f.db.query('SELECT * FROM users WHERE email=$1',[CASES[0].email])).rows[0];
 const saved=await require('../banking/business-advisory').read(f.db,user);assert.deepEqual(saved.settings,{markets:['MY'],operations:['warehouse'],priorities:['liquidity']});
 await page.click('[data-action=business-news]');await page.waitFor('!!document.querySelector(".news-insights")&&!document.querySelector("#assistant-form button[type=submit]").disabled');
 const text=await page.evaluate('document.querySelector(".news-insights").textContent');assert.match(text,/Meridian Logistics/);assert.match(text,/Malaysia/);assert.match(text,/Warehousing/);assert.doesNotMatch(text,/Nimbus Cloud/);
 assert.equal(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);assert.deepEqual(page.errors,[]);
 await page.screenshot('test-results/industry-business-news-mobile.png');
});

test('Missing public-company evidence shows a coverage explanation without invented news flags on mobile',async t=>{
 const {seedIndustryBusinesses,CASES,PASSWORD}=require('../scripts/seed-industry-businesses');let searches=0,assessments=0;
 const model={...provider(),chat:async messages=>{
  const calls=messages.filter(m=>m.role==='tool');
  if(calls.some(m=>m.tool_name==='analyze_news_insights'))return {role:'assistant',content:'No cited news is available in this request, so no news advisory flags were generated. Verify the legal company names or ask for sourced industry news [E2].'};
  return {role:'assistant',content:'',tool_calls:[{function:{name:calls.length?'analyze_news_insights':'scan_counterparty_news',arguments:{}}}]};
 },research:async()=>{searches++;throw Error('No public company may be searched');},assessNews:async()=>{assessments++;throw Error('No sourced news may be assessed');}};
 const f=await fixture(t,{now,agentModel:model});await seedIndustryBusinesses(f.db,{now});
 const page=await launchChrome(t,{width:390,height:950,mobile:true});
 await page.navigate(f.baseUrl+'/login');await page.waitFor('!!document.querySelector("#email")');await page.fill('#email',CASES[0].email);await page.fill('#password',PASSWORD);await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');await page.click('[data-action=assistant-toggle]');
 const before=(await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;
 await page.fill('#assistant-message','Scan news for my counterparties and advise what concerns to flag.');await page.click('#assistant-form button[type=submit]');
 await page.waitFor('!!document.querySelector(".news-insights-unavailable")&&!document.querySelector("#assistant-form button[type=submit]").disabled');
 const text=await page.evaluate('document.querySelector(".news-insights-unavailable").textContent');assert.match(text,/No sourced news advice available/);assert.match(text,/No news-based flags were generated/);assert.match(text,/does not establish company safety/);
 assert.equal(await page.evaluate('document.querySelectorAll("[data-news-flag]").length'),0);assert.equal(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
 assert.equal(searches,2);assert.equal(assessments,0);assert.deepEqual((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,before);assert.deepEqual(page.errors,[]);
});
