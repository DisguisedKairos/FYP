'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {fixture}=require('./dft-helpers');
const {launchChrome}=require('./chrome');
const {codeForCounter,PERIOD_MS}=require('../banking/totp');
const exists=selector=>`!!document.querySelector(${JSON.stringify(selector)})`;
const submit=(page,id)=>page.click(`${id} button[type=submit]`);
const heading=(page,title)=>page.waitFor(`document.querySelector('#modal[open] h2')?.textContent===${JSON.stringify(title)}`,title);

test('DFT browser password, authenticator, recovery and all-device revocation flows preserve privacy',async t=>{
  let clock=Date.now();
  const f=await fixture(t,{now:()=>clock,authEncryptionKey:randomBytes(32).toString('hex')}),page=await launchChrome(t,{});
  const login=async(password,code)=>{await page.fill('#email','alex@greenlink.demo');await page.fill('#password',password);if(code){await page.evaluate("document.querySelector('#auth-factor-details').open=true");await page.fill('#auth-recovery',code);}await submit(page,'#auth-form');};
  await page.navigate(f.baseUrl+'/login');await page.waitFor(exists('#auth-form'));await login('Greenlink123!');await page.waitFor(exists('.balance-card'));
  await page.click('[data-action=profile]');await heading(page,'Your profile and security');
  await page.click('[data-action=security-password]');await page.fill('#security-current-password','Greenlink123!');await page.fill('#security-new-password','UpdatedPass456!');await page.fill('#security-confirm-password','UpdatedPass456!');
  await submit(page,'#security-password-form');await heading(page,'Your profile and security');
  await page.click('[data-action=security-mfa-setup]');await page.fill('#security-setup-password','UpdatedPass456!');await submit(page,'#security-mfa-setup-form');await heading(page,'Connect your authenticator');
  const secret=await page.evaluate("document.querySelector('#authenticator-secret').value");assert.match(secret,/^[A-Z2-7]{32}$/);
  const code=()=>codeForCounter(secret,Math.floor(clock/PERIOD_MS));
  await page.fill('#security-otp',code());await submit(page,'#security-mfa-confirm-form');await heading(page,'Save your recovery codes');
  const recovery=(await page.evaluate("document.querySelector('#mfa-recovery-codes').value")).split('\n');assert.equal(recovery.length,10);
  await page.click('#modal .modal-actions [data-action=close-dialog]');await page.waitFor('!document.querySelector("#modal").open');
  assert.equal(await page.evaluate('document.querySelector("#modal").textContent.length===0'),true, 'Enrollment and recovery secrets clear when the dialog closes.');
  await page.click('[data-action=logout]');await page.waitFor(exists('#auth-form'));await login('UpdatedPass456!');
  await page.waitFor("document.querySelector('#auth-factor-details').open && document.querySelector('#auth-error').textContent.length>0",'MFA challenge');
  clock+=PERIOD_MS;await page.fill('#auth-otp',code());await submit(page,'#auth-form');await page.waitFor(exists('.balance-card'));
  await page.click('[data-action=logout]');await page.waitFor(exists('#auth-form'));await login('UpdatedPass456!',recovery[0]);await page.waitFor(exists('.balance-card'));
  await page.click('[data-action=profile]');await heading(page,'Your profile and security');await page.click('[data-action=security-mfa-disable]');
  clock+=PERIOD_MS;await page.fill('#security-disable-password','UpdatedPass456!');await page.fill('#security-otp',code());await submit(page,'#security-mfa-disable-form');await heading(page,'Your profile and security');
  assert.equal(await page.evaluate('!!document.querySelector("[data-action=security-mfa-setup]")'),true);
  await page.click('[data-action=security-revoke]');await page.fill('#security-revoke-password','UpdatedPass456!');await submit(page,'#security-revoke-form');await page.waitFor(exists('#auth-form'),'all sessions revoked');
  await page.navigate(f.baseUrl+'/dashboard');await page.waitFor(exists('#auth-form'));await login('UpdatedPass456!');await page.waitFor(exists('.balance-card'));
  const exceptions=page.events.filter(event=>event.method==='Runtime.exceptionThrown');assert.deepEqual(exceptions,[]);
  const requests=page.events.filter(event=>event.method==='Network.requestWillBeSent').map(event=>event.params.request.url).filter(url=>/^https?:/.test(url));assert.ok(requests.every(url=>new URL(url).hostname==='127.0.0.1'));
});


test('Delayed profile refresh cannot replace a newer dialog',async t=>{
 const f=await fixture(t),page=await launchChrome(t,{width:1280,height:900});await page.navigate(f.baseUrl+'/login');await page.waitFor(exists('#auth-form'));await page.fill('#email','alex@greenlink.demo');await page.fill('#password','Greenlink123!');await submit(page,'#auth-form');await page.waitFor(exists('.app-shell'));
 await page.evaluate("window.profileOriginalFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.profileOriginalFetch(...args);if(String(args[0])==='/api/auth/security'){const body=await response.text();await new Promise(resolve=>window.releaseProfileRead=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};");
 await page.evaluate("import('/js/security.js').then(m=>{window.pendingProfile=m.profileDialog();return true;})");await page.waitFor('typeof window.releaseProfileRead==="function"');if(await page.evaluate('document.querySelector("#modal").open'))await page.click('#modal [data-action=close-dialog]');await page.click('[data-action=help]');await heading(page,'A little guidance.');await page.evaluate('window.releaseProfileRead();window.pendingProfile');
 assert.equal(await page.evaluate('document.querySelector("#modal h2").textContent'),'A little guidance.');assert.deepEqual(page.errors,[]);
});


test('Sign-out cancels dashboard reads and anonymous callbacks cannot start new reads',async t=>{
 const f=await fixture(t),page=await launchChrome(t,{width:1280,height:900});await page.navigate(f.baseUrl+'/login');await page.waitFor(exists('#auth-form'));await page.fill('#email','alex@greenlink.demo');await page.fill('#password','Greenlink123!');await submit(page,'#auth-form');await page.waitFor(exists('.app-shell'));
 await page.evaluate("window.snapshotFetch=window.fetch;window.snapshotResponses=[];window.fetch=(path,options)=>String(path)==='/api/dashboard'?new Promise(resolve=>window.snapshotResponses.push(resolve)):window.snapshotFetch(path,options);");
 await page.evaluate("import('/js/core.js').then(m=>{window.snapshotBase=structuredClone(m.state.data);window.earlierDashboard=m.loadDashboard();window.laterDashboard=m.loadDashboard({render:false});return true;})");
 await page.evaluate("const latest=structuredClone(window.snapshotBase);latest.user.name='Latest snapshot operator';window.snapshotResponses[1](new Response(JSON.stringify(latest)));window.laterDashboard");
 await page.evaluate('window.snapshotResponses[0](new Response(JSON.stringify(window.snapshotBase)));window.earlierDashboard');
 assert.equal(await page.evaluate('document.querySelector(".profile-name").textContent'),'Latest snapshot operator','An earlier response must render the latest data rather than replacing it.');
 await page.evaluate('window.fetch=window.snapshotFetch');
 await page.evaluate("window.balanceOriginalFetch=window.fetch;window.fetch=(path,options)=>String(path)==='/api/dashboard'?new Promise((resolve,reject)=>{window.releaseBalanceRead=()=>resolve(new Response(JSON.stringify({user:null})));options.signal.addEventListener('abort',()=>{window.balanceReadAborted=true;reject(new DOMException('Cancelled','AbortError'));},{once:true});}):window.balanceOriginalFetch(path,options);");
 await page.evaluate("import('/js/core.js').then(m=>{window.pendingBalanceRead=m.loadDashboard({render:false});return true;})");await page.waitFor('typeof window.releaseBalanceRead==="function"');await page.click('[data-action=logout]');await page.waitFor(exists('#auth-form'));await page.evaluate('window.releaseBalanceRead();window.pendingBalanceRead');
 const cancelled=await page.evaluate('window.balanceReadAborted===true');
 await page.evaluate("window.anonymousBalanceReads=0;window.fetch=(...args)=>{if(String(args[0])==='/api/dashboard'){window.anonymousBalanceReads++;return Promise.resolve(new Response(JSON.stringify({error:'Sign in required.'}),{status:401}));}return window.balanceOriginalFetch(...args);};");
 await page.evaluate("import('/js/core.js').then(m=>m.loadDashboard({render:false}))");
 assert.deepEqual({cancelled,anonymousReads:await page.evaluate('window.anonymousBalanceReads')},{cancelled:true,anonymousReads:0});
});
