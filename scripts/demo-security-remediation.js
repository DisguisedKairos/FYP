'use strict';
const { runSecurityAgent } = require('../banking/agents/security-remediation');
const scans = { npmAudit: 'passed', gitleaks: 'passed', semgrep: 'passed' };
const before = runSecurityAgent({ scans, gitleaks: [{ RuleID: 'demo-api-key', File: 'demo-config.js', StartLine: 8,
  Secret: 'FAKE_DEMO_SECRET', Match: 'FAKE_DEMO_SECRET' }], npmAudit: { vulnerabilities: { 'demo-package': { severity: 'high' } } } });
const after = runSecurityAgent({ scans, verification: { tests: 'passed', rescan: 'passed' } });
console.log('DEMO: simulated scanner findings, not a live scan');
console.log(JSON.stringify(before, null, 2));
console.log('Secret hidden:', !JSON.stringify(before).includes('FAKE_DEMO_SECRET'));
console.log('DEMO: simulated after-fix scan + verification (not real remediation)');
console.log(JSON.stringify(after, null, 2));
