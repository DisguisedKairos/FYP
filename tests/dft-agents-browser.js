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
async function visit(page,base,route){await page.navigate(base+route);await page.waitFor('!!document.querySelector(".app-shell")');}
test('Business users project liquidity, inspect reconciliation and build a multi-turn draft on mobile',async t=>{
  const {f,page}=await open(t,390,'jamie@greenlink.demo');
  await visit(page,f.baseUrl,'/banking-insights');await page.waitFor('document.querySelector("[data-agent-status]")?.textContent.includes("Offline workflows")');
  assert.equal(await page.evaluate('!!document.querySelector("#agent-fraud-form,#agent-simulation-form")'),false);
  await page.click('#agent-liquidity-form button[type=submit]');await page.waitFor('!!document.querySelector("[data-agent-report]")');
  assert.match(await page.evaluate('document.querySelector("[data-agent-report]").textContent'),/liquidity projection/);
  assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
  await page.click('#agent-reconciliation-form button[type=submit]');await page.waitFor('document.querySelector("[data-agent-report]")?.textContent.includes("Reconciliation and exception")');
  await page.screenshot(path.resolve('test-results','agents-business-mobile.png'));
  await visit(page,f.baseUrl,'/assistant');
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
  await page.click('[data-investigate-transaction]');await page.waitFor('location.pathname==="/banking-insights" && document.querySelector("[data-agent-report]")?.textContent.includes("'+held.data.transaction.id+'")');
  await page.fill('#agent-threshold','50');await page.click('#agent-simulation-form button[type=submit]');await page.waitFor('document.querySelector("[data-agent-report]")?.textContent.includes("Historical fraud rule simulation")');
  assert.match(await page.evaluate('document.querySelector("[data-agent-report]").textContent'),/changed decisions/);
  await page.waitFor('document.querySelectorAll("[data-agent-run]").length>=2');
  await page.screenshot(path.resolve('test-results','agents-staff-desktop.png'));
  assert.deepEqual(await f.riskClient.getRules(),policy);assert.deepEqual(page.errors,[]);
});
