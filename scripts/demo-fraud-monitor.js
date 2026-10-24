'use strict';
// Real private Python inference and isolated PostgreSQL data; no native payments.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('../tests/dft-helpers');
const { createRiskClient } = require('../banking/risk');
const { authorize } = require('../banking/auth');
const ledger = require('../banking/ledger');
const monitor = require('../banking/fraud-cases');
const workflows = require('../banking/workflows');
async function main() {
  const cleanup = [];
  try {
    const f = await fixture({ after: fn => cleanup.push(fn) }, { http: false });
    const people = Object.fromEntries((await f.db.query('SELECT id,name,role,auth_version,email FROM users')).rows.map(u => [u.email.split('@')[0], u]));
    const risk = createRiskClient({ db: f.db }), account = (await f.db.query('SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1', [people.alex.id])).rows[0];
    const policy = await risk.getRules(); await risk.updateRule('high_value', { version: policy.version, threshold: 3000 }, people.alex);
    const payments = [];
    for (let i = 0; i < 3; i++) {
      const payment = await ledger.submit(f.db, people.alex, 'bill', { fromAccountId: String(account.id), billerId: 'pub', reference: 'SPLIT-DEMO-' + i, amount: '1000', requestId: randomUUID(), authorizationPassword: 'Greenlink123!' }, { riskClient: risk });
      assert.equal(payment.status, 'completed', 'Demo instructions should individually pass pre-payment screening.'); payments.push(payment);
    }
    const highRisk = await ledger.submit(f.db, people.alex, 'transfer', { fromAccountId: String(account.id), toAccountNumber: '1020009001', description: 'AI high-risk demonstration', amount: '21000', requestId: randomUUID(), authorizationPassword: 'Greenlink123!' }, { riskClient: risk });
    assert.ok(highRisk.risk.modelScore >= 65, 'The contrasting sample should trigger actual AI review.');
    const before = JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
    const summary = await monitor.scan(f.db, risk, { force: true });
    const flagged = (await monitor.list(f.db, people.reviewer)).cases.find(c => c.transactionId === payments[2].id);
    const aiFlag = (await monitor.list(f.db, people.reviewer)).cases.find(c => c.transactionId === highRisk.id);
    assert.ok(aiFlag.evidence.signals.some(s => s.code === 'ai_risk'));
    assert.ok(flagged.evidence.signals.some(s => s.code === 'split_payments'));
    assert.ok(Number.isInteger(flagged.evidence.model.score));
    console.log(JSON.stringify({ scenario: 'AI-risk flag plus individually allowed payments that aggregate above the high-value threshold', payments: payments.map(p => ({ id: p.id, status: p.status, originalModelScore: p.risk.modelScore })), aiFlag: { transactionStatus: highRisk.status, modelScore: aiFlag.evidence.model.score, signals: aiFlag.evidence.signals }, scan: summary, case: { id: flagged.id, score: flagged.score, signals: flagged.evidence.signals, aiReasons: flagged.evidence.model.reasons } }, null, 2));
    const claimed = await monitor.decide(f.db, people.reviewer, flagged.id, { action: 'claim', version: flagged.version });
    const authorization = await authorize(f.db, people.reviewer, 'Greenlink123!', Date.now, { purpose: 'fraud_case_review' });
    const closed = await monitor.decide(f.db, people.reviewer, flagged.id, { action: 'close', version: claimed.version, outcome: 'inconclusive', reason: 'Pattern identified. Await independent business evidence and recipient verification.' }, { authorization });
    await workflows.dispatch(f.db);
    const notifications = await workflows.notifications(f.db, people.reviewer);
    assert.ok(notifications.notifications.some(n => n.metadata.fraudCaseId === flagged.id));
    assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows), before);
    assert.equal((await monitor.scan(f.db, risk, { force: true })).created, 0);
    console.log(JSON.stringify({ humanReview: closed.outcome, caseStatus: closed.status, paymentStatus: closed.transaction.status, reviewerNotified: true, financialBalancesUnchanged: true, duplicateCases: false }));
  } finally { for (const fn of cleanup.reverse()) await fn(); }
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error('Fraud-monitor demo failed:', error.message); process.exitCode = 1; });
