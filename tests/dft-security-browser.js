'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {fixture,businessProfile}=require('./dft-helpers');
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

test('A delayed notification read cannot restore unread state or replace the next session results',async t=>{
  const f=await fixture(t),page=await launchChrome(t,{width:1280,height:900});
  const owner=(await f.db.query("SELECT id FROM users WHERE email='alex@greenlink.demo'")).rows[0];
  const note=await require('../banking/ledger').enqueue(f.db,{userId:owner.id,type:'account.update',title:'Notification ordering check',message:'Read state must remain current.'});await require('../banking/workflows').dispatch(f.db);
  await page.navigate(f.baseUrl+'/login');await page.waitFor(exists('#auth-form'));await page.fill('#email','alex@greenlink.demo');await page.fill('#password','Greenlink123!');await submit(page,'#auth-form');await page.waitFor(exists('.app-shell'));await page.click('[data-nav=notifications]');await page.waitFor(exists('[data-read-notification]'));
  await page.evaluate("window.noticeFetch=window.fetch;window.holdNotice=true;window.fetch=async(...args)=>{const response=await window.noticeFetch(...args);if(window.holdNotice && String(args[0])==='/api/notifications'){window.holdNotice=false;const body=await response.text();await new Promise(resolve=>window.releaseNotice=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};");
  await page.evaluate("import('/js/services.js').then(m=>{window.oldNoticeRead=m.loadNotifications({renderPage:true});return true;})");await page.waitFor('typeof window.releaseNotice==="function"');
  await page.click('[data-read-notification="'+note.id+'"]');await page.waitFor('!document.querySelector("[data-read-notification]")');
  await page.evaluate('window.releaseNotice();window.oldNoticeRead');
  assert.equal(await page.evaluate('document.querySelectorAll(".notification-item.unread").length'),0,'An older read must not undo the read confirmation.');
  await page.evaluate("window.holdNotice=true;delete window.releaseNotice;import('/js/services.js').then(m=>{window.previousSessionNotice=m.loadNotifications();return true;})");await page.waitFor('typeof window.releaseNotice==="function"');
  await page.click('[data-action=logout]');await page.waitFor(exists('#auth-form'));
  await f.db.query('UPDATE notifications SET title=$2 WHERE id=$1',[note.id,'Current session notification']);
  await page.fill('#email','alex@greenlink.demo');await page.fill('#password','Greenlink123!');await submit(page,'#auth-form');await page.waitFor(exists('.app-shell'));await page.click('[data-nav=notifications]');await page.waitFor('document.querySelector(".notification-list")?.textContent.includes("Current session notification")');
  await page.evaluate('window.releaseNotice();window.previousSessionNotice');
  assert.ok((await page.evaluate('document.querySelector(".notification-list").textContent')).includes('Current session notification'));assert.deepEqual(page.errors,[]);
});

test('Starting a new schedule after an interrupted confirmation creates a distinct authorized instruction',async t=>{
  const f=await fixture(t),page=await launchChrome(t,{width:1280,height:900});await page.navigate(f.baseUrl+'/login');await page.waitFor(exists('#auth-form'));await page.fill('#email','alex@greenlink.demo');await page.fill('#password','Greenlink123!');await submit(page,'#auth-form');await page.waitFor(exists('.app-shell'));await page.click('[data-nav=schedules]');await page.waitFor(exists('[data-action=new-schedule]'));
  await page.evaluate("window.scheduleFetch=window.fetch;window.interruptSchedule=true;window.scheduleKeys=[];window.fetch=async(...args)=>{const response=await window.scheduleFetch(...args);if(String(args[0])==='/api/scheduled-payments' && args[1]?.method==='POST'){window.scheduleKeys.push(JSON.parse(args[1].body).requestId);if(window.interruptSchedule){window.interruptSchedule=false;await response.text();throw new TypeError('Controlled loss of a committed confirmation response');}}return response;};");
  const review=async()=>{await page.click('[data-action=new-schedule]');await page.fill('#schedule-recipient','1020002001');await page.fill('#schedule-amount','1.00');await page.fill('#schedule-description','Distinct instruction');await submit(page,'#schedule-form');await page.fill('#authorizationPassword','Greenlink123!');};
  await review();await submit(page,'#confirm-schedule-form');await page.waitFor('document.querySelector("#confirm-schedule-form .error-message")?.textContent.includes("Retry this confirmation")');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM scheduled_payments')).rows[0].count),1);
  await page.click('#modal [data-action=close-dialog]');await review();await submit(page,'#confirm-schedule-form');await page.waitFor('!document.querySelector("#modal").open && document.querySelector(".schedule-list")');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM scheduled_payments')).rows[0].count),2,'A freshly opened form is a new authorized instruction, not a retry of the abandoned confirmation.');
  const keys=await page.evaluate('window.scheduleKeys');assert.equal(new Set(keys).size,2);assert.deepEqual(page.errors,[]);
});

test('A completed schedule response from an ended session cannot close the next operator draft',async t=>{
  const f=await fixture(t),page=await launchChrome(t,{width:1280,height:900});
  const login=async email=>{await page.fill('#email',email);await page.fill('#password','Greenlink123!');await submit(page,'#auth-form');await page.waitFor(exists('.app-shell'));};
  await page.navigate(f.baseUrl+'/login');await page.waitFor(exists('#auth-form'));await login('alex@greenlink.demo');await page.click('[data-nav=schedules]');await page.waitFor(exists('[data-action=new-schedule]'));
  await page.evaluate("window.oldScheduleFetch=window.fetch;window.holdSchedule=true;window.fetch=async(...args)=>{const response=await window.oldScheduleFetch(...args);if(window.holdSchedule && String(args[0])==='/api/scheduled-payments' && args[1]?.method==='POST'){window.holdSchedule=false;const body=await response.text();await new Promise(resolve=>window.releaseSchedule=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};");
  await page.click('[data-action=new-schedule]');await page.fill('#schedule-recipient','1020002001');await page.fill('#schedule-amount','1.00');await submit(page,'#schedule-form');await page.fill('#authorizationPassword','Greenlink123!');await page.evaluate("import('/js/services.js').then(m=>{window.oldScheduleConfirmation=m.confirmSchedule(document.querySelector('#confirm-schedule-form'));return true;})");await page.waitFor('typeof window.releaseSchedule==="function"');
  await page.evaluate("import('/js/core.js').then(m=>{m.ui.endSession('Session ended during confirmation.');return true;})");await page.waitFor(exists('#auth-form'));await login('jamie@greenlink.demo');
  await page.evaluate("import('/js/services.js').then(m=>{m.scheduleDialog();return true;})");await page.fill('#schedule-description','Current operator private draft');
  await page.evaluate('window.releaseSchedule();window.oldScheduleConfirmation');
  assert.equal(await page.evaluate('document.querySelector("#modal").open && document.querySelector("#schedule-description")?.value'),'Current operator private draft');
  assert.equal(await page.evaluate('location.pathname'),'/dashboard');assert.deepEqual(page.errors,[]);
});

test('An ended session account response cannot update the next operator accounts or dismiss their form',async t=>{
  const f=await fixture(t),page=await launchChrome(t,{width:1280,height:900});
  const login=async email=>{await page.fill('#email',email);await page.fill('#password','Greenlink123!');await submit(page,'#auth-form');await page.waitFor(exists('.app-shell'));};
  await page.navigate(f.baseUrl+'/login');await page.waitFor(exists('#auth-form'));await login('alex@greenlink.demo');
  await page.evaluate("window.accountFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.accountFetch(...args);if(String(args[0])==='/api/accounts' && args[1]?.method==='POST'){const body=await response.text();await new Promise(resolve=>window.releaseAccount=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};");
  await page.evaluate("import('/js/workflows.js').then(m=>{m.accountNameDialog();return true;})");await page.fill('#account-name','Prior operator private account');await page.evaluate("import('/js/workflows.js').then(m=>{window.oldAccountWrite=m.submitAccount(document.querySelector('#account-form'));return true;})");await page.waitFor('typeof window.releaseAccount==="function"');
  await page.evaluate("import('/js/core.js').then(m=>{m.ui.endSession('Previous session ended.');return true;})");await page.waitFor(exists('#auth-form'));await login('jamie@greenlink.demo');
  await page.evaluate("import('/js/workflows.js').then(m=>{m.accountNameDialog();return true;})");await page.fill('#account-name','Current operator draft');await page.evaluate('window.releaseAccount();window.oldAccountWrite');
  assert.equal(await page.evaluate('document.querySelector("#modal").open && document.querySelector("#account-name")?.value'),'Current operator draft');
  assert.equal(await page.evaluate("import('/js/core.js').then(m=>m.state.data.accounts.some(a=>a.name==='Prior operator private account'))"),false);assert.deepEqual(page.errors,[]);
});


test('Onboarding refreshes cannot restore a reviewed application or an ended session',async t=>{
  const f=await fixture(t),page=await launchChrome(t,{width:1280,height:900});
  const operator=f.client();await operator.session();
  const registered=await operator.request('/api/auth/register',{method:'POST',body:{name:'Queue Operator',email:'queue-operator@example.test',password:'Greenlink123!',business:businessProfile('QUEUEORDER001')}});
  assert.equal(registered.status,201);
  const staff=f.client();await staff.login('reviewer@greenlink.demo');
  const login=async()=>{await page.fill('#email','reviewer@greenlink.demo');await page.fill('#password','Greenlink123!');await submit(page,'#auth-form');await page.waitFor(exists('.app-shell'));};
  await page.navigate(f.baseUrl+'/login');await page.waitFor(exists('#auth-form'));await login();
  await page.click('[data-nav=onboarding]');await page.waitFor(exists('[data-review-business]'));
  const hold=async()=>{
    await page.evaluate("window.queueFetch=window.fetch;window.fetch=async(path,options)=>{const response=await window.queueFetch(path,options);if(String(path)==='/api/business/applications'){window.fetch=window.queueFetch;const body=await response.text();options.signal.addEventListener('abort',()=>window.queueReadAborted=true,{once:true});await new Promise(resolve=>window.releaseQueue=resolve);return new Response(body,{status:response.status,headers:response.headers});}return response;};window.queueReadAborted=false;delete window.releaseQueue;import('/js/business.js').then(m=>{window.pendingQueue=m.loadBusinessApplications();return true;})");
    await page.waitFor('typeof window.releaseQueue==="function"');
  };
  await hold();
  const approved=await staff.request('/api/business/applications/'+registered.data.business.id+'/review',{method:'POST',body:{version:registered.data.business.version,decision:'approve',reason:'Verified registration and authorized business operator.',verificationConfirmed:true,authorizationPassword:'Greenlink123!'}});
  assert.equal(approved.status,200);
  await page.evaluate("import('/js/business.js').then(m=>m.loadBusinessApplications())");
  await page.waitFor("document.querySelector('.empty-state')?.textContent.includes('No applications awaiting review')");
  await page.evaluate('window.releaseQueue();window.pendingQueue');
  assert.equal(await page.evaluate('!!document.querySelector("[data-review-business]")'),false,'An older refresh must not bring back an approved application.');
  assert.equal(await page.evaluate('window.queueReadAborted'),true,'A superseded refresh should be cancelled.');
  await hold();await page.click('[data-action=logout]');await page.waitFor(exists('#auth-form'));await login();
  await page.click('[data-nav=onboarding]');await page.waitFor("document.querySelector('.empty-state')?.textContent.includes('No applications awaiting review')");
  await page.evaluate('window.releaseQueue();window.pendingQueue');
  assert.equal(await page.evaluate('window.queueReadAborted'),true,'Logout should cancel the previous queue request.');
  assert.equal(await page.evaluate("document.querySelector('#main-content').textContent.includes('ended session')"),false,'A cancelled request from the same operator’s previous session must not replace the new queue.');
  assert.deepEqual(page.errors,[]);
});
