'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { runAgent } = require('../banking/agents/security-remediation');
(async () => {
  const report = await runAgent();
  const output = path.resolve(process.cwd(), 'reports/security-remediation.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`Security report: ${output}`);
  console.log(`Status: ${report.status}; findings: ${report.totalFindings}`);
  console.log('Scanners:', report.scanStatus);
  if (report.status === 'INCOMPLETE_SCAN') process.exitCode = 2;
  else if (report.status === 'REQUIRES_REVIEW') process.exitCode = 1;
})().catch(err => { console.error('Security agent failed:', err.message); process.exitCode = 2; });
