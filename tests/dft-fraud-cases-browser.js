'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { fixture, modelStub } = require('./dft-helpers');
const { launchChrome } = require('./chrome');
test('Staff analyse a completed payment, inspect its AI flag and record an independent human decision on mobile', async t => {
  let score = 2;
  const f = await fixture(t, { assessModel: input => modelStub(score)(input) }), client = f.client(); await client.login();
  const source = (await client.dashboard()).accounts[0];
  const result = await client.request('/api/payments', { method: 'POST', body: { fromAccountId: source.id, billerId: 'pub', reference: 'MOBILE-AI-FLAG', amount: '100', requestId: randomUUID() } }); assert.equal(result.status, 200); assert.equal(result.data.transaction.status, 'completed');
  const before = (await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;
  score = 80;
  const page = await launchChrome(t, { width: 390, height: 900, mobile: true });
  await page.navigate(f.baseUrl + '/login'); await page.waitFor('!!document.querySelector("#email")');
  await page.fill('#email', 'reviewer@greenlink.demo'); await page.fill('#password', 'Greenlink123!'); await page.click('#auth-form button[type=submit]'); await page.waitFor('!!document.querySelector(".app-shell")');
  await page.navigate(f.baseUrl + '/fraud-monitoring'); await page.waitFor('!!document.querySelector("#fraud-scan-transaction") && !!document.querySelector("#fraud-case-filter")');
  await page.fill('#fraud-scan-transaction', result.data.transaction.id); await page.click('[data-action=fraud-scan]');
  await page.waitFor('!!document.querySelector("#modal[open] [data-claim-fraud-case]")');
  assert.match(await page.evaluate('document.querySelector("#modal").textContent'), /AI model identified/);
  assert.match(await page.evaluate('document.querySelector("#modal").textContent'), /completed/);
  await page.click('[data-claim-fraud-case]'); await page.waitFor('!!document.querySelector("#fraud-case-review-form")');
  await page.select('#fraud-case-outcome', 'legitimate'); await page.fill('#fraud-case-reason', 'Business invoice and recipient independently verified.'); await page.fill('#fraud-case-review-form [name=authorizationPassword]', 'Greenlink123!');
  await page.click('#fraud-case-review-form button[type=submit]'); await page.waitFor('!document.querySelector("#modal[open]") && document.querySelector("[data-fraud-cases]").textContent.includes("No cases match")');
  await page.select('#fraud-case-filter', 'closed'); await page.waitFor('!!document.querySelector("[data-fraud-case]")');
  await page.click('[data-fraud-case]'); await page.waitFor('document.querySelector("#modal[open]")?.textContent.includes("Legitimate activity")');
  assert.match(await page.evaluate('document.querySelector("#modal").textContent'), /Business invoice and recipient independently verified/);
  assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
  await page.screenshot(path.resolve('test-results', 'fraud-case-review-mobile.png'));
  assert.deepEqual((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows, before);
  await page.click('#modal [data-action=close-dialog]');
  await page.click('[data-action=menu-open]'); await page.click('[data-action=logout]');
  await page.waitFor('!!document.querySelector("#auth-form")');
  assert.equal(await page.evaluate('document.querySelector("#modal").textContent.includes("independently verified")'), false);
  assert.deepEqual(page.errors, []);
});


test('Delayed fraud case reads and completed scans do not reopen dialogs after navigation',async t=>{
 const f=await fixture(t,{assessModel:modelStub(80)}),client=f.client();await client.login();const account=(await client.dashboard()).accounts[0];
 const paid=await client.request('/api/payments',{method:'POST',body:{fromAccountId:account.id,billerId:'pub',reference:'DELAYED-CASE',amount:'1.00',requestId:randomUUID()}});assert.equal(paid.status,200);
 await require('../banking/fraud-cases').scan(f.db,f.riskClient,{force:true,transactionId:paid.data.transaction.id});
 const page=await launchChrome(t,{width:1280,height:900});await page.navigate(f.baseUrl+'/login');await page.waitFor('!!document.querySelector("#email")');await page.fill('#email','reviewer@greenlink.demo');await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');await page.click('[data-nav=fraud]');await page.waitFor('!!document.querySelector("[data-fraud-case]")');
 const caseId=await page.evaluate('document.querySelector("[data-fraud-case]").dataset.fraudCase');
 await page.evaluate("window.originalCaseFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.originalCaseFetch(...args);if(/\\/api\\/fraud\\/cases\\/[^/?]+$/.test(String(args[0]))){const body=await response.text();await new Promise(resolve=>window.releaseCaseRead=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};");
 await page.evaluate("import('/js/fraud-cases.js').then(m=>{window.pendingCaseRead=m.openFraudCase("+JSON.stringify(caseId)+");return true;})");await page.waitFor('typeof window.releaseCaseRead==="function"');if(await page.evaluate('document.querySelector("#modal").open'))await page.click('#modal [data-action=close-dialog]');await page.click('[data-nav=overview]');await page.click('[data-nav=fraud]');await page.evaluate('window.releaseCaseRead();window.pendingCaseRead');
 const caseReopened=await page.evaluate('document.querySelector("#modal").open');if(caseReopened)await page.click('#modal [data-action=close-dialog]');
 await page.evaluate("window.fetch=async(...args)=>{const response=await window.originalCaseFetch(...args);if(String(args[0])==='/api/fraud/scan'){const body=await response.text();await new Promise(resolve=>window.releaseScanRead=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};");
 await page.waitFor('!!document.querySelector("#fraud-scan-transaction")');await page.fill('#fraud-scan-transaction',paid.data.transaction.id);await page.evaluate("import('/js/fraud-cases.js').then(m=>{window.pendingScan=m.runFraudScan();return true;})");await page.waitFor('typeof window.releaseScanRead==="function"');await page.click('[data-nav=overview]');await page.click('[data-nav=fraud]');await page.evaluate('window.releaseScanRead();window.pendingScan');
 assert.deepEqual({caseReopened,scanReopened:await page.evaluate('document.querySelector("#modal").open')},{caseReopened:false,scanReopened:false});
 await page.waitFor('!!document.querySelector("[data-fraud-case]")');
 await page.evaluate("window.fetch=(...args)=>String(args[0]).startsWith('/api/fraud/cases?')?Promise.resolve(new Response(JSON.stringify({error:'Case search temporarily unavailable.'}),{status:503,headers:{'Content-Type':'application/json'}})):window.originalCaseFetch(...args);");
 await page.select('#fraud-case-filter','closed');await page.waitFor('document.querySelector("[data-fraud-cases]")?.textContent.includes("Case search temporarily unavailable")');
 assert.equal(await page.evaluate('document.querySelectorAll("[data-fraud-case]").length'),0,'A failed filter must not show cases from the previous selection.');
 await page.evaluate('window.fetch=window.originalCaseFetch');await page.click('[data-action=fraud-cases-retry]');await page.waitFor('!!document.querySelector("#fraud-case-filter") && document.querySelector("[data-fraud-cases]").textContent.includes("No cases match")');assert.deepEqual(page.errors,[]);
});


test('Staff notification links open the saved investigation and an outdated case page returns to available results',async t=>{
  const f=await fixture(t,{assessModel:modelStub(80)}),client=f.client();await client.login();const account=(await client.dashboard()).accounts[0];
  const paid=await client.request('/api/payments',{method:'POST',body:{fromAccountId:account.id,billerId:'pub',reference:'NOTIFICATION-CASE',amount:'1.00',requestId:randomUUID()}});assert.equal(paid.status,200);
  await require('../banking/fraud-cases').scan(f.db,f.riskClient,{force:true,transactionId:paid.data.transaction.id});await require('../banking/workflows').dispatch(f.db);
  const page=await launchChrome(t,{width:1280,height:900});await page.navigate(f.baseUrl+'/login');await page.waitFor('!!document.querySelector("#email")');await page.fill('#email','reviewer@greenlink.demo');await page.fill('#password','Greenlink123!');await page.click('#auth-form button[type=submit]');await page.waitFor('!!document.querySelector(".app-shell")');await page.click('[data-nav=notifications]');await page.waitFor('!!document.querySelector("[data-fraud-case]")');
  await page.click('[data-fraud-case]');await page.waitFor('location.pathname==="/fraud-monitoring" && !!document.querySelector("#modal[open] [data-claim-fraud-case]")');
  assert.ok((await page.evaluate('document.querySelector("#modal").textContent')).includes(paid.data.transaction.id));
  await page.click('#modal [data-action=close-dialog]');await page.waitFor('!!document.querySelector("#fraud-case-filter")');
  await page.evaluate("import('/js/fraud-cases.js').then(m=>m.loadFraudCases({direction:1}))");
  assert.deepEqual(await page.evaluate("import('/js/core.js').then(m=>({page:m.state.fraudCaseFilters.page,visible:document.querySelectorAll('[data-fraud-case]').length}))"),{page:1,visible:1});
  assert.match(await page.evaluate('document.querySelector("[data-fraud-cases] .pagination").textContent'),/Page 1 of 1/);assert.deepEqual(page.errors,[]);
});
