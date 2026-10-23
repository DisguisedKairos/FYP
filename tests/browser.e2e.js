const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createFixture, accountNamed, totalBalance } = require('./dft-helpers');
const { launchChrome } = require('./chrome');

const routes = { overview:'/dashboard',business:'/business',onboarding:'/business-onboarding', accounts:'/accounts', transfers:'/transfers', payments:'/payments', activity:'/activity', schedules:'/scheduled-payments', notifications:'/notifications', fraud:'/fraud-monitoring', rules:'/fraud-rules', assistant:'/assistant' };
const snapshot = page => page.evaluate("fetch('/api/dashboard').then(response => response.json())");
const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
const exists = selector => `!!document.querySelector(${JSON.stringify(selector)})`;
const submit = (page, form) => page.click(`${form} button[type="submit"]`);

async function bankingPage(t, name, options, flow) {
  const fixture = await createFixture(t, { riskClient: null });
  const downloads = resolve('test-results', name, 'downloads', `${process.pid}-${Date.now()}`);
  const page = await launchChrome(t, { ...options, downloads });
  try {
    await page.navigate(`${fixture.baseUrl}/login`);
    await page.waitFor(exists('#auth-form'), 'sign-in form');
    await flow(page, fixture, downloads);
    const requests = page.events.filter(event => event.method === 'Network.requestWillBeSent').map(event => event.params.request.url).filter(url => /^https?:/.test(url));
    assert.ok(requests.every(url => new URL(url).hostname === '127.0.0.1'), 'banking and assistant traffic stays on the local application');
    const unexpected = page.errors.filter(error => !(error.source === 'network' && error.url?.endsWith('/api/transfers') && /status of 403/.test(error.text)));
    assert.deepEqual([...new Set(unexpected.map(error => error.text ? `${error.url || error.source}: ${error.text}` : JSON.stringify(error)))], [], 'No JavaScript, unexpected network or CSP errors');
  } catch (error) {
    await page.screenshot(resolve('test-results', `${name}-failure.png`)).catch(() => {});
    throw error;
  }
}
async function login(page, email = 'alex@greenlink.demo') {
  await page.fill('#email', email); await page.fill('#password', 'Greenlink123!'); await submit(page, '#auth-form');
  await page.waitFor(exists('.balance-card'), 'authenticated dashboard');
}
async function openMenu(page) {
  if (await page.evaluate('document.querySelector(".sidebar")?.inert')) {
    await page.click('[data-action="menu-open"]');
    await page.waitFor('document.querySelector(".mobile-menu").getAttribute("aria-expanded") === "true"', 'mobile navigation open');
  }
}
async function nav(page, route) {
  await openMenu(page); await page.click(`.nav-items [data-nav="${route}"]`);
  await page.waitFor(`location.pathname === ${JSON.stringify(routes[route])} && !!document.querySelector('#main-content')`, route);
}
async function logout(page) { await openMenu(page); await page.click('[data-action="logout"]'); await page.waitFor(exists('#auth-form'), 'signed out'); }
async function layout(page, context) {
  const size = await page.evaluate('({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,modal:document.querySelector("dialog[open]")?.getBoundingClientRect().toJSON()})');
  assert.ok(size.document <= size.width + 1 && size.body <= size.width + 1, `${context}: horizontal overflow ${JSON.stringify(size)}`);
  if (size.modal) assert.ok(size.modal.x >= -1 && size.modal.right <= size.width + 1, `${context}: dialog fits viewport`);
}
async function confirm(page, title) {
  await page.fill('#authorizationPassword', 'Greenlink123!'); await submit(page, '#confirm-money-form');
  await page.waitFor(`document.querySelector('#modal[open] h2')?.textContent === ${JSON.stringify(title)}`, title);
}
async function done(page) { await page.click('#modal .modal-actions [data-action="close-dialog"]'); await page.waitFor('!document.querySelector("#modal").open', 'dialog closed'); }
async function recipientTransfer(page, amount, description) {
  await nav(page, 'transfers'); await page.fill('#toAccountNumber', '1020002001'); await page.fill('#amount', amount); await page.fill('#description', description);
  await submit(page, '#money-form'); await page.waitFor(exists('#confirm-money-form'), 'transfer review');
}
async function ask(page, message) {
  const count = await page.evaluate('document.querySelectorAll("#assistant-thread .from-assistant").length');
  await page.fill('#assistant-message', message); await submit(page, '#assistant-form');
  await page.waitFor(`document.querySelectorAll('#assistant-thread .from-assistant').length > ${count} && document.querySelector('#assistant-form').getAttribute('aria-busy') === 'false'`, 'private assistant reply');
  return text(page, '#assistant-thread .from-assistant:last-child');
}

test('wholesale bank staff use an operations workspace without consumer or company deposit navigation',async t=>{
  await bankingPage(t,'bank-operations',{width:390,height:844,mobile:true},async(page,fixture)=>{
    await require('../scripts/create-staff').createStaff({db:fixture.db,email:'staff@bank.example.test',name:'Bank Operations',password:'Greenlink123!'});
    await page.fill('#email','staff@bank.example.test');await page.fill('#password','Greenlink123!');await submit(page,'#auth-form');
    await page.waitFor(exists('[data-bank-operations]'),'bank staff workspace');
    assert.equal(await page.evaluate('!!document.querySelector(".nav-items [data-nav=accounts],.nav-items [data-nav=payments],.balance-card")'),false);
    await layout(page,'wholesale staff mobile workspace');
    await page.click('[data-bank-operations] [data-nav=onboarding]');await page.waitFor('location.pathname==="/business-onboarding" && document.body.textContent.includes("No applications awaiting review")','bank staff application queue');
    await layout(page,'wholesale staff mobile onboarding queue');await page.screenshot(resolve('test-results','wholesale-bank-operations-mobile.png'));
  });
});

test('desktop registration, savings management, authorized money movement and activity exports work together', async (t) => {
  await bankingPage(t, 'desktop', {}, async (page, fixture, downloads) => {
    await page.click('[data-action="auth-switch"]'); await page.waitFor(exists('#confirm-password'), 'registration confirmation field');
    await page.fill('#name', 'Browser Customer'); await page.fill('#email', 'browser-customer@example.com');
    await page.fill('#business-legal-name','Browser Trading Pte. Ltd.');await page.fill('#business-registration-number','BROWSERCOMPANY001');
    await page.fill('#business-industry','Wholesale trading');await page.fill('#business-registered-address','1 Browser Business Road, Singapore 000001');
    await page.fill('#password', 'Greenlink123!'); await page.fill('#confirm-password', 'Different123!'); await submit(page, '#auth-form');
    await page.waitFor('document.querySelector("#auth-error").textContent.includes("do not match")', 'password mismatch validation');
    await page.fill('#confirm-password', 'Greenlink123!'); await page.click('[data-input="password"]');
    assert.equal(await page.evaluate('document.querySelector("#password").type'), 'text');
    await page.click('[data-input="password"]'); await submit(page, '#auth-form'); await page.waitFor(exists('.balance-card'), 'registered dashboard');
    assert.equal(totalBalance(await snapshot(page)), 0);
    assert.equal(await page.evaluate('!!document.querySelector("[data-nav=fraud], [data-nav=rules]")'), false);
    assert.match(await text(page,'#main-content'),/Business onboarding awaiting bank review/);
    await nav(page,'business');assert.match(await text(page,'#main-content'),/Browser Trading Pte\. Ltd\./);
    await logout(page);await login(page,'reviewer@greenlink.demo');await nav(page,'onboarding');
    await page.waitFor(exists('[data-review-business]'),'pending business review');await page.click('[data-review-business]');
    await page.fill('#business-review-reason','Company registration and authorized contact verified for browser testing.');
    await page.click('#business-verification-confirmed');await page.fill('#authorizationPassword','Greenlink123!');await submit(page,'#business-review-form');
    await page.waitFor('!document.querySelector("#modal").open && !document.querySelector("[data-review-business]")','business onboarding approved');
    await logout(page);await login(page,'browser-customer@example.com');
    await nav(page, 'accounts'); await page.click('[data-action="new-account"]'); await page.fill('#account-name', 'Browser goal'); await submit(page, '#account-form');
    await page.waitFor('document.querySelector("#main-content h1")?.textContent === "Browser goal"', 'new account details');
    await page.click('[data-action="rename-account"]'); await page.fill('#account-name', 'Browser travel'); await submit(page, '#account-form');
    await page.waitFor('document.querySelector("#main-content h1")?.textContent === "Browser travel"', 'renamed account');
    await page.click('[data-action="close-account-review"]'); await submit(page, '#close-account-form'); await page.waitFor(exists('.closed-accounts'), 'closed account history');
    assert.equal((await snapshot(page)).accounts.length, 1);
    await logout(page); await login(page);
    const before = await snapshot(page), main = accountNamed(before, 'Operating savings'), rainy = accountNamed(before, 'Liquidity reserve');
    await nav(page, 'assistant');
    assert.match(await ask(page, 'What is my balance?'), /30,050\.50/);
    const privateReply = await ask(page, 'What is the balance of account 1020002001?');
    assert.match(privateReply, /only accounts linked to your signed-in business/i); assert.doesNotMatch(privateReply, /1,200\.00/);
    await page.fill('#assistant-message', 'PrivateDemo123!'); await submit(page, '#assistant-form');
    await page.waitFor('document.querySelector("#assistant-error").textContent.includes("keep passwords")', 'sensitive chat input redacted');
    assert.equal((await text(page, '#assistant-thread')).includes('PrivateDemo123!'), false);
    assert.equal(await page.evaluate('document.querySelector("#assistant-message").value'), '');
    await ask(page, 'Transfer 10 to 1020002001');
    await page.click('#assistant-thread .from-assistant:last-child [data-assistant-action]');
    await page.waitFor('location.pathname === "/transfers" && document.querySelector("#amount")?.value === "10.00"', 'assistant draft opens existing transfer form');
    assert.equal(await page.evaluate('document.querySelector("#toAccountNumber").value'), '1020002001');
    await submit(page, '#money-form'); await page.waitFor(exists('#confirm-money-form'), 'assistant draft still requires review');
    assert.equal(await page.evaluate('document.querySelector("#authorizationPassword").value'), '');
    assert.equal(totalBalance(await snapshot(page)), totalBalance(before));
    await page.press('Escape'); await nav(page, 'assistant');
    await page.click('[data-action="assistant-clear"]'); await page.waitFor(exists('.assistant-welcome'), 'conversation clear');
    await ask(page, 'What is my balance?'); await logout(page); await login(page); await nav(page, 'assistant');
    assert.equal(await page.evaluate('document.querySelectorAll("#assistant-thread .assistant-message").length'), 0, 'chat clears when signing out');
    await nav(page, 'overview');
    await layout(page, 'desktop dashboard'); await page.click('[data-action="balance"]');
    assert.equal((await text(page, '.balance-amount')).trim(), '••••••'); await page.click('[data-action="balance"]');
    assert.match(await text(page, '.balance-amount'), /30,050\.50/); await page.screenshot(resolve('test-results', 'browser-desktop.png'));

    await nav(page, 'transfers'); await page.click('input[name="recipientType"][value="own"]');
    await page.select('#fromAccountId', main.id); await page.select('#toAccountNumber', rainy.number);
    await page.fill('#amount', '12.34'); await page.fill('#description', 'QA own transfer'); await submit(page, '#money-form');
    await page.waitFor(exists('#confirm-money-form'), 'own transfer review'); assert.match(await text(page, '#modal'), /Liquidity reserve/);
    await page.click('#modal [data-action="close-dialog"]'); assert.equal(await page.evaluate('document.querySelector("#amount").value'), '12.34');
    await submit(page, '#money-form'); await page.fill('#authorizationPassword', 'Incorrect123!'); await submit(page, '#confirm-money-form');
    await page.waitFor('document.querySelector("#confirm-money-form .error-message")?.textContent.includes("incorrect")', 'authorization error retains session');
    assert.equal(await page.evaluate('!!document.querySelector(".app-shell") && document.querySelector("#modal").open'), true);
    await confirm(page, 'Transfer complete.'); await layout(page, 'desktop receipt'); await page.screenshot(resolve('test-results', 'desktop-transfer-receipt.png')); await done(page);
    const own = await snapshot(page);
    assert.equal(accountNamed(own, main.name).balanceCents, main.balanceCents - 1234); assert.equal(accountNamed(own, rainy.name).balanceCents, rainy.balanceCents + 1234);
    assert.equal(totalBalance(own), totalBalance(before));
    await recipientTransfer(page, '5.67', 'QA recipient transfer'); await confirm(page, 'Transfer complete.'); await done(page);
    await nav(page, 'payments'); await page.select('#fromAccountId', main.id); await page.select('#billerId', 'sp-services'); await page.fill('#reference', 'QA-BILL-001');
    await page.fill('#amount', '9999999.00'); await submit(page, '#money-form');
    await page.waitFor('document.querySelector("#form-error").textContent.includes("available balance")', 'insufficient funds validation');
    await page.fill('#amount', '86.42'); await submit(page, '#money-form'); await confirm(page, 'Bill payment complete.');
    assert.match(await text(page, '#modal'), /QA-BILL-001/); await done(page);
    assert.equal(totalBalance(await snapshot(page)), totalBalance(before) - 567 - 8642);

    await nav(page, 'activity'); await page.fill('#transaction-search', 'QA');
    await page.waitFor('document.querySelector(".history-result-summary")?.textContent.includes("4 matching")', 'activity search');
    await page.select('#transaction-type', 'bill'); await page.select('#transaction-status', 'completed');
    await page.waitFor('document.querySelector(".history-result-summary")?.textContent.includes("1 matching")', 'combined filters');
    await page.click('[data-action="export"]');
    let csvPath;
    for (let attempt = 0; attempt < 50 && !csvPath; attempt++) {
      const file = readdirSync(downloads).find(file => file.endsWith('.csv'));
      if (file) csvPath = join(downloads, file); else await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(csvPath, 'filtered CSV downloaded'); const csv = readFileSync(csvPath, 'utf8'); assert.match(csv, /QA-BILL-001/); assert.doesNotMatch(csv, /QA own transfer/);
    await page.click('[data-action="statement"]'); await page.select('#statement-account', main.id); await page.select('#statement-from', '2020-01-01'); await submit(page, '#statement-form');
    await page.waitFor(exists('.print-statement'), 'statement preview'); assert.match(await text(page, '.print-statement'), /Opening balance/);
    const pdf = await page.send('Page.printToPDF', { printBackground:true, preferCSSPageSize:true }), bytes = Buffer.from(pdf.data, 'base64');
    assert.equal(bytes.subarray(0,5).toString(), '%PDF-'); writeFileSync(resolve('test-results', 'desktop-statement.pdf'), bytes); await done(page);
    await page.click('[data-action="clear-filters"]'); await page.waitFor('document.querySelector(".history-pagination")?.textContent.includes("Page 1 of 2")', 'pagination');
    await page.click('[data-action="history-next"]'); await page.waitFor('document.querySelector(".history-pagination")?.textContent.includes("Page 2 of 2")', 'server history second page');
    const archivedId = await page.evaluate('document.querySelector("#history-results [data-transaction]").dataset.transaction');
    assert.equal((await snapshot(page)).transactions.some(transaction => transaction.id === archivedId), false, 'archive record is outside the bounded dashboard');
    await page.click('#history-results [data-transaction]');
    await page.waitFor(`document.querySelector('#modal[open]')?.textContent.includes(${JSON.stringify(archivedId)})`, 'archived transaction loaded by identifier'); await done(page);
    await page.evaluate('history.back()'); await page.waitFor('location.pathname === "/payments"', 'browser back route');
    await page.evaluate('history.forward()'); await page.waitFor('location.pathname === "/activity"', 'browser forward route');
    await page.navigate('about:blank');
    await fixture.stop(); await fixture.start(); await page.navigate(`${fixture.baseUrl}/dashboard`); await page.waitFor(exists('.balance-card'), 'session restored after restart');
    assert.match(await text(page, '.balance-amount'), /29,958\.41/); await logout(page); await page.navigate(`${fixture.baseUrl}/dashboard`); await page.waitFor(exists('#auth-form'), 'protected route after logout');
  });
});

test('mobile navigation, payment review, schedules and notifications fit a 390 pixel viewport', async (t) => {
  await bankingPage(t, 'mobile', { width:390, height:844, mobile:true }, async (page) => {
    await layout(page, 'mobile sign in'); await page.screenshot(resolve('test-results', 'mobile-login.png'));
    await login(page); await layout(page, 'mobile overview'); await page.screenshot(resolve('test-results', 'browser-mobile.png'));
    await page.send('Emulation.setDeviceMetricsOverride', { width:360, height:800, deviceScaleFactor:1, mobile:true });
    await layout(page, '360 pixel overview'); await page.screenshot(resolve('test-results', 'mobile-360.png'));
    await page.send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true });
    await page.click('[data-action="menu-open"]'); assert.equal(await page.evaluate('document.querySelector(".workspace").inert'), true);
    await page.press('Escape'); assert.equal(await page.evaluate('document.querySelector(".mobile-menu").getAttribute("aria-expanded")'), 'false');
    await nav(page, 'payments'); assert.equal(await page.evaluate('document.querySelector(".sidebar").inert'), true);
    await page.select('#billerId', 'pub'); await page.fill('#reference', 'MOBILE123'); await page.fill('#amount', '1.23'); await submit(page, '#money-form');
    await layout(page, 'mobile payment review'); await page.screenshot(resolve('test-results', 'mobile-payment-review.png'));
    await page.press('Escape'); await page.waitFor('!document.querySelector("#modal").open', 'escape closes review');
    assert.equal(await page.evaluate('document.querySelector("#amount").value'), '1.23');
    await submit(page, '#money-form'); await confirm(page, 'Bill payment complete.'); await done(page);
    await nav(page, 'schedules'); await page.waitFor(exists('.schedules-panel'), 'scheduled payments loaded');
    await page.click('[data-action="new-schedule"]'); await page.fill('#schedule-recipient', '1020002001');
    await page.fill('#schedule-amount', '2.34'); await page.fill('#schedule-description', 'Mobile scheduled payment'); await layout(page, 'mobile schedule form');
    await submit(page, '#schedule-form'); await page.waitFor(exists('#confirm-schedule-form'), 'schedule review');
    await page.fill('#authorizationPassword', 'Greenlink123!'); await submit(page, '#confirm-schedule-form');
    await page.waitFor(exists('.schedule-card'), 'authorized schedule saved'); await page.click('[data-cancel-schedule]'); await submit(page, '#cancel-schedule-form');
    await page.waitFor('document.querySelector(".schedule-card").textContent.toLowerCase().includes("cancelled")', 'schedule cancelled');
    await nav(page, 'notifications'); await page.waitFor(exists('.notification-item.unread'), 'delivered notification'); await layout(page, 'mobile notifications');
    await page.click('[data-action="notifications-read-all"]'); await page.waitFor('!document.querySelector(".notification-item.unread")', 'notifications acknowledged');
    await nav(page, 'activity'); await layout(page, 'mobile activity filters'); await page.select('#transaction-type', 'bill'); await page.fill('#transaction-search', 'MOBILE123');
    await page.waitFor('document.querySelector(".history-result-summary")?.textContent.includes("1 matching")', 'mobile activity search');
    await page.screenshot(resolve('test-results', 'mobile-activity.png')); assert.equal(totalBalance(await snapshot(page)), 3005050 - 123);
    await nav(page, 'assistant'); assert.match(await ask(page, 'What is my balance?'), /30,049\.27/); await layout(page, 'mobile private assistant');
    await page.send('Emulation.setDeviceMetricsOverride', { width:360, height:800, deviceScaleFactor:1, mobile:true });
    await layout(page, '360 pixel private assistant'); await page.screenshot(resolve('test-results', 'mobile-assistant.png'));
    await page.click('[data-action="assistant-clear"]'); await page.waitFor(exists('.assistant-welcome'), 'mobile chat clear'); await logout(page);
  });
});

test('administrators configure real risk rules and independently review held payments', async (t) => {
  await bankingPage(t, 'risk', {}, async (page) => {
    await login(page); const before = await snapshot(page);
    await nav(page, 'rules'); await page.waitFor(exists('[data-edit-rule="high_value"]'), 'real fraud rules loaded');
    await page.click('[data-edit-rule="high_value"]'); await page.fill('#rule-threshold', '25'); await page.select('#rule-action', 'block'); await page.fill('#authorizationPassword', 'Greenlink123!'); await submit(page, '#rule-form');
    await page.waitFor('!document.querySelector("#modal").open && !!document.querySelector(".rule-card")', 'rule persisted');
    await recipientTransfer(page, '100.00', 'Browser blocked transfer'); await confirm(page, 'Transfer rejected.');
    assert.match(await text(page, '#modal'), /No funds have moved/); await layout(page, 'blocked receipt'); await done(page);
    assert.equal(totalBalance(await snapshot(page)), totalBalance(before));
    await nav(page, 'rules'); await page.waitFor(exists('[data-edit-rule="high_value"]'), 'rules reload');
    await page.click('[data-edit-rule="high_value"]'); await page.fill('#rule-threshold', '10000'); await page.select('#rule-action', 'review'); await page.fill('#authorizationPassword', 'Greenlink123!'); await submit(page, '#rule-form');
    await page.waitFor('!document.querySelector("#modal").open', 'review policy saved');
    await page.waitFor('document.querySelectorAll("#rule-audit-results .rule-audit-entry").length === 2', 'persisted rule changes shown');
    await page.select('#rule-audit-filter', 'high_value');
    await page.waitFor('document.querySelector("#rule-audit-results").getAttribute("aria-busy") === "false" && document.querySelectorAll(".rule-audit-entry").length === 2', 'audit filtered by rule');
    assert.match(await text(page, '#rule-audit-results'), /Alex Morgan/);
    await page.click('#rule-audit-results details summary');
    assert.match(await text(page, '#rule-audit-results details[open]'), /Before/);
    assert.match(await text(page, '#rule-audit-results details[open]'), /After/);
    await recipientTransfer(page, '10000.00', 'Browser independent review'); await confirm(page, 'Transfer awaiting review.');
    const held = (await snapshot(page)).transactions.find(transaction => transaction.description === 'Browser independent review');
    assert.equal(held.status, 'pending_review'); assert.equal(totalBalance(await snapshot(page)), totalBalance(before));
    await page.screenshot(resolve('test-results', 'risk-review-receipt.png')); await done(page);
    await nav(page, 'fraud'); await page.waitFor(exists('.review-queue'), 'maker review queue');
    assert.equal(await page.evaluate(`!!document.querySelector('[data-review-transaction="${held.id}"]')`), false);
    await logout(page); await login(page, 'reviewer@greenlink.demo'); await nav(page, 'notifications');
    await page.waitFor(exists('.notification-actions [data-nav="fraud"]'), 'review notification action');
    await page.click('.notification-actions [data-nav="fraud"]');
    await page.waitFor('location.pathname === "/fraud-monitoring"', 'notification opens independent review queue');
    await page.waitFor(exists(`[data-review-transaction="${held.id}"]`), 'independent reviewer queue'); await page.click(`[data-review-transaction="${held.id}"]`);
    await page.select('#review-decision', 'approve'); await page.fill('#review-reason', 'Independently verified during browser QA.');
    await page.fill('#authorizationPassword', 'Greenlink123!'); await submit(page, '#review-form');
    await page.waitFor('document.querySelector("#modal[open]")?.textContent.includes("Review decision")', 'approval receipt');
    assert.match(await text(page, '#modal'), /approve/); await done(page); await logout(page); await login(page);
    assert.equal(totalBalance(await snapshot(page)), totalBalance(before) - 1000000);
    await nav(page, 'activity'); await page.select('#transaction-status', 'completed'); await page.fill('#transaction-search', 'Browser independent review');
    await page.waitFor('document.querySelector(".history-result-summary")?.textContent.includes("1 matching")', 'approved lifecycle');
    await page.click(`[data-transaction="${held.id}"]`); await page.waitFor('document.querySelector("#modal[open]")?.textContent.includes("Independently verified during browser QA")', 'approved transaction loaded from ledger API');
    await layout(page, 'review decision receipt'); await done(page);
  });
});
