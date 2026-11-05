'use strict';

// Test the Security Remediation Agent

const test = require('node:test');
const assert = require('node:assert/strict');

const { runSecurityAgent } =
    require('../banking/agents/security-remediation');

// Test 1: Detect secret leaks without exposing credentials
test('reports secret leaks without copying the secret', () => {

    const report = runSecurityAgent({
        gitleaks: [
            {
                RuleID: 'generic-api-key',
                File: 'config.js',
                StartLine: 4,
                Secret: 'very-secret',
                Match: 'very-secret'
            }
        ],

        scans: {
            npmAudit: 'passed',
            gitleaks: 'passed',
            semgrep: 'passed'
        }
    });

    assert.equal(report.status, 'REQUIRES_REVIEW');
    assert.equal(report.severitySummary.CRITICAL, 1);

    // The secret should not appear in the report
    assert.equal(
        JSON.stringify(report).includes('very-secret'),
        false
    );
});

// Test 2: Detect incomplete security scans
test('reports incomplete scans rather than claiming safe', () => {

    const report = runSecurityAgent();

    assert.equal(report.status, 'INCOMPLETE_SCAN');
});

// Test 3: Require verification after scanning
test('requires verification even with no findings', () => {

    const report = runSecurityAgent({
        scans: {
            npmAudit: 'passed',
            gitleaks: 'passed',
            semgrep: 'passed'
        }
    });

    assert.equal(report.status, 'PENDING_VERIFICATION');
});

// Test 4: Produce successful report after verification
test('produces no findings detected only when scans and verification passed', () => {

    const report = runSecurityAgent({
        scans: {
            npmAudit: 'passed',
            gitleaks: 'passed',
            semgrep: 'passed'
        },

        verification: {
            tests: 'passed',
            rescan: 'passed'
        }
    });

    assert.equal(report.status, 'NO_FINDINGS_DETECTED');
});

// Test 5: Read npm audit vulnerabilities
test('handles npm audit vulnerabilities', () => {

    const report = runSecurityAgent({
        npmAudit: {
            vulnerabilities: {
                example: {
                    severity: 'high'
                }
            }
        }
    });

    assert.equal(
        report.findings[0].type,
        'vulnerable_dependency'
    );

    assert.equal(report.severitySummary.HIGH, 1);
});