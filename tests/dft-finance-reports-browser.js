'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers'),{launchChrome}=require('./chrome');
async function login(page,email='alex@greenlink.demo'){await page.waitFor('!!document.querySelector("#email")');await page.fill('#email',email);await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');}
async function open(t,width=1280){const f=await fixture(t),page=await launchChrome(t,{width,height:950,mobile:width<760});await page.navigate(f.baseUrl+'/login');await login(page);await page.click('[data-action=assistant-toggle]');return {f,page};}
async function ask(page){await page.fill('#assistant-message','Pull a real time finance report for the last 30 days that I can download');await page.click('#assistant-form button[type=submit]');await page.waitFor('!!document.querySelector("[data-finance-report]") && !document.querySelector("#assistant-form button[type=submit]").disabled');}
async function capture(page){await page.evaluate(`window.financeBlobs=[];window.financeNames=[];window.originalObjectURL=URL.createObjectURL;URL.createObjectURL=blob=>{blob.arrayBuffer().then(bytes=>window.financeBlobs.push({mime:blob.type,body:new TextDecoder().decode(bytes)}));return window.originalObjectURL(blob);};window.originalAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download?.startsWith('greenlink-finance-')){window.financeNames.push(this.download);return;}return window.originalAnchorClick.call(this);};`);}
test('Assistant finance CSV and PDF downloads remain in chat and retrieve changes committed after the preview',async t=>{
  const {f,page}=await open(t,390);await capture(page);const route=await page.evaluate('location.pathname');await ask(page);
  assert.match(await page.evaluate('document.querySelector("[data-finance-report]").textContent'),/Each download refreshes the latest committed ledger data/);
  const client=f.client();await client.login();const account=(await client.dashboard()).accounts[0];
  assert.equal((await client.request('/api/payments',{method:'POST',body:{fromAccountId:account.id,billerId:'pub',reference:'AFTER-CHAT-FINANCE',amount:'0.01',requestId:randomUUID()}})).status,200);
  await page.click('[data-finance-format=csv]');await page.waitFor('window.financeBlobs.length===1 && !document.querySelector("[data-finance-format=csv]").disabled');
  const csv=await page.evaluate('window.financeBlobs[0]');assert.match(csv.mime,/^text\/csv/);assert.ok(csv.body.includes('AFTER-CHAT-FINANCE'));
  await page.click('[data-finance-format=pdf]');await page.waitFor('window.financeBlobs.length===2 && !document.querySelector("[data-finance-format=pdf]").disabled');
  const document=await page.evaluate('window.financeBlobs[1]');assert.equal(document.mime,'application/pdf');assert.match(document.body,/^%PDF-/);assert.match(document.body,/%%EOF\s*$/);
  assert.deepEqual(await page.evaluate('window.financeNames.map(name=>name.split(".").at(-1))'),['csv','pdf']);assert.equal(await page.evaluate('location.pathname'),route);
  assert.equal(await page.evaluate('[...document.querySelectorAll("[data-finance-format]")].every(el=>{const r=el.getBoundingClientRect();return r.x>=0 && r.right<=innerWidth;})'),true);
  assert.doesNotMatch(await page.evaluate('document.querySelector(".from-assistant:last-child").textContent'),/\[E\d+\]|Evidence for this response/);assert.deepEqual(page.errors,[]);
});
test('Failed finance downloads stay retryable and clearing chat cancels an unfinished download',async t=>{
  const {page}=await open(t);await capture(page);await ask(page);
  await page.evaluate(`window.financeFetch=window.fetch;window.failFinance=true;window.fetch=(...args)=>{if(String(args[0]).startsWith('/api/reports/finance') && window.failFinance){window.failFinance=false;return Promise.resolve(new Response(JSON.stringify({error:'Report temporarily unavailable.'}),{status:503,headers:{'Content-Type':'application/json'}}));}return window.financeFetch(...args);};`);
  await page.click('[data-finance-format=csv]');await page.waitFor('document.querySelector("[data-finance-report] .error-message").textContent.includes("temporarily unavailable") && !document.querySelector("[data-finance-format=csv]").disabled');
  assert.equal(await page.evaluate('window.financeBlobs.length'),0);await page.click('[data-finance-format=csv]');await page.waitFor('window.financeBlobs.length===1');
  await page.evaluate(`window.fetch=(...args)=>String(args[0]).startsWith('/api/reports/finance')?new Promise((resolve,reject)=>{window.pendingFinanceSignal=args[1].signal;window.releaseFinance=()=>resolve(new Response('late',{headers:{'Content-Type':'text/csv'}}));args[1].signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});}):window.financeFetch(...args);`);
  await page.click('[data-finance-format=csv]');await page.waitFor('!!window.pendingFinanceSignal');await page.click('[data-action=assistant-clear]');await page.waitFor('!document.querySelector("[data-finance-report]")');
  assert.equal(await page.evaluate('window.pendingFinanceSignal.aborted'),true);await page.evaluate('window.releaseFinance()');assert.equal(await page.evaluate('window.financeBlobs.length'),1);assert.deepEqual(page.errors,[]);
});
test('An ended-session finance response cannot download private records or unlock the next operator report',async t=>{
  const {page}=await open(t);await capture(page);await ask(page);
  await page.evaluate(`window.savedFinanceFetch=window.fetch;window.financeRead=0;window.fetch=async(...args)=>{const response=await window.savedFinanceFetch(...args);if(String(args[0]).startsWith('/api/reports/finance')){const body=await response.arrayBuffer(),ordinal=++window.financeRead;await new Promise(resolve=>{if(ordinal===1)window.releaseOlderFinance=resolve;else window.releaseNewFinance=resolve;});return new Response(body,{status:response.status,headers:response.headers});}return response;};`);
  await page.evaluate(`import('/js/finance-reports.js').then(m=>{window.olderFinance=m.financeReportControl(document.querySelector('[data-finance-format=csv]'));return true;})`);await page.waitFor('typeof window.releaseOlderFinance==="function"');
  await page.evaluate(`import('/js/core.js').then(m=>m.ui.endSession('Session ended while downloading.'))`);await login(page,'jamie@greenlink.demo');await page.click('[data-action=assistant-toggle]');await ask(page);
  await page.evaluate(`import('/js/finance-reports.js').then(m=>{window.newFinance=m.financeReportControl(document.querySelector('[data-finance-format=csv]'));return true;})`);await page.waitFor('typeof window.releaseNewFinance==="function"');
  await page.evaluate('window.releaseOlderFinance();window.olderFinance');assert.equal(await page.evaluate('window.financeBlobs.length'),0);assert.equal(await page.evaluate('document.querySelector("[data-finance-format=csv]").disabled'),true);
  await page.evaluate('window.releaseNewFinance();window.newFinance');await page.waitFor('window.financeBlobs.length===1 && !document.querySelector("[data-finance-format=csv]").disabled');
  const exported=await page.evaluate('window.financeBlobs[0].body');assert.match(exported,/Harbour Supplies/);assert.doesNotMatch(exported,/Meridian Commerce/);assert.deepEqual(page.errors,[]);
});
