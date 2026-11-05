'use strict';

// Security Remediation Agent
// Reads security scanner results and recommends fixes.
// Does not automatically modify banking source code.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const MAX_FINDINGS = 5000;

// Convert severity values into a standard format
function severity(value) {
    const name = String(value || 'UNKNOWN').toUpperCase();

    if (name === 'MODERATE' || name === 'WARNING') {
        return 'MEDIUM';
    }

    if (name === 'ERROR') {
        return 'HIGH';
    }

    if (name === 'INFO' || name === 'INFORMATIONAL') {
        return 'LOW';
    }

    return SEVERITIES.includes(name) ? name : 'UNKNOWN';
}

// Clean scanner text and hide common secret formats
function clean(value, maximum = 300) {
    return String(value == null ? '' : value)
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .replace(
            /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g,
            '[REDACTED]'
        )
        .slice(0, maximum);
}

// Recommend a fix based on vulnerability type
function recommendation(type) {
    switch (type) {
        case 'secret_leak':
            return 'Revoke or rotate the exposed credential, remove it from source and history where appropriate, and store replacements in a secrets manager.';

        case 'sql_injection':
            return 'Use parameterized queries, enforce database permissions, and add a regression test.';

        case 'access_control':
            return 'Enforce authorization and record ownership on the server, and add tests for unauthorized access.';

        case 'vulnerable_dependency':
            return 'Review the advisory and upgrade to a compatible patched version, then rerun tests and dependency scans.';

        case 'insecure_code':
            return 'Review the flagged code path, implement a least-privilege fix, and add regression tests.';

        default:
            return 'Manually investigate this scanner finding and verify any proposed fix.';
    }
}

function executeCommand(command, args, root = path.resolve(__dirname, '..', '..'), env = process.env) {
    const result = spawnSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        env: { ...env },
        timeout: 120000,
        windowsHide: true
    });

    return {
        command: [command, ...args].join(' '),
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        status: result.status ?? (result.error ? 1 : 0),
        signal: result.signal || null,
        error: result.error ? String(result.error.message || result.error) : null
    };
}

function maybeParseJson(text) {
    if (!text || !text.trim()) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function readReportFile(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return null;
        const text = fs.readFileSync(filePath, 'utf8');
        return maybeParseJson(text) || text;
    } catch {
        return null;
    }
}

const AGENT_TOOLS = [
    { type: 'function', function: { name: 'npm_audit', description: 'Run npm audit to identify vulnerable dependencies.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'gitleaks_scan', description: 'Scan the repository for exposed secrets with gitleaks.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'semgrep_scan', description: 'Run static code scanning for insecure patterns.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'verify_tests', description: 'Verify the security remediation tests still pass.', parameters: { type: 'object', properties: {} } } }
];

function executeAgentTool(name, root = path.resolve(__dirname, '..', '..'), env = process.env) {
    const isWindows = process.platform === 'win32';
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-agent-'));
    const outfile = path.join(tempDir, 'scan.json');

    switch (name) {
        case 'npm_audit': {
            const result = executeCommand(isWindows ? 'npm.cmd' : 'npm', ['audit', '--json', '--omit=dev'], root, env);
            const parsed = maybeParseJson(result.stdout) || maybeParseJson(result.stderr) || null;
            return JSON.stringify({ tool: 'npm_audit', ...result, parsed }, null, 2);
        }
        case 'gitleaks_scan': {
            const command = isWindows ? 'gitleaks.exe' : 'gitleaks';
            const result = executeCommand(command, ['detect', '--no-banner', '--redact', '--source', root, '--report-format', 'json', '--report-path', outfile], root, env);
            return JSON.stringify({ tool: 'gitleaks_scan', ...result, report: readReportFile(outfile) }, null, 2);
        }
        case 'semgrep_scan': {
            const command = isWindows ? 'semgrep.exe' : 'semgrep';
            const result = executeCommand(command, ['--config', 'auto', '--json', '--error', '--output', outfile, root], root, env);
            return JSON.stringify({ tool: 'semgrep_scan', ...result, report: readReportFile(outfile) }, null, 2);
        }
        case 'verify_tests': {
            const result = executeCommand(isWindows ? 'node.exe' : 'node', ['--test', 'tests/security-remediation.test.js'], root, env);
            return JSON.stringify({ tool: 'verify_tests', ...result }, null, 2);
        }
        default:
            return `Tool ${name} is not permitted.`;
    }
}

async function runAgent({ root = path.resolve(__dirname, '..', '..'), env = process.env, endpoint = env.AGENTIC_SECURITY_ENDPOINT, token = env.AGENTIC_SECURITY_TOKEN, model = env.AGENTIC_SECURITY_MODEL } = {}) {
    if (endpoint && token && model) {
        const response = await fetch(endpoint, {
            method: 'POST',
                        headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                messages: [{
                    role: 'system',
                    content: 'You are a security remediation agent. Run only the approved scanner tools, redact secrets, and report the results as a concise remediation report. Never invent vulnerabilities or copy raw secrets.'
                }, {
                    role: 'user',
                    content: `Scan the repository at ${root} and return a security remediation report.`
                }],
                tools: AGENT_TOOLS,
                tool_choice: 'auto'
            }),
            signal: AbortSignal.timeout(90000)
        });

        if (!response.ok) throw new Error(`Security agent endpoint returned HTTP ${response.status}`);
        const payload = await response.json();
        const message = payload.choices?.[0]?.message;
        if (!message) throw new Error('Security agent endpoint returned no assistant message.');
        return message.content || null;
    }

    const autoReport = await runAutonomousScan({ root, env });
    return runSecurityAgent(autoReport);
}

async function runAutonomousScan({ root = path.resolve(__dirname, '..', '..'), env = process.env } = {}) {
    const scans = { npmAudit: 'not_run', gitleaks: 'not_run', semgrep: 'not_run' };
    const findings = [];
    const verification = { tests: 'not_run', rescan: 'not_run' };

    const npmResult = executeCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--json', '--omit=dev'], root, env);
    if (!npmResult.error) {
        scans.npmAudit = npmResult.status === 0 ? 'passed' : 'failed';
        const parsed = maybeParseJson(npmResult.stdout) || maybeParseJson(npmResult.stderr);
        if (parsed && parsed.vulnerabilities && typeof parsed.vulnerabilities === 'object') {
            findings.push(...fromNpmAudit(parsed));
        }
    }

    const gitleaksResult = executeCommand(process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks', ['detect', '--no-banner', '--redact', '--source', root, '--report-format', 'json'], root, env);
    if (!gitleaksResult.error) {
        scans.gitleaks = gitleaksResult.status === 0 ? 'passed' : 'failed';
        const report = maybeParseJson(gitleaksResult.stdout) || maybeParseJson(gitleaksResult.stderr);
        if (Array.isArray(report)) findings.push(...fromGitleaks(report));
    }

    const semgrepResult = executeCommand(process.platform === 'win32' ? 'semgrep.exe' : 'semgrep', ['--config', 'auto', '--json', '--error', root], root, env);
    if (!semgrepResult.error) {
        scans.semgrep = semgrepResult.status === 0 ? 'passed' : 'failed';
        const report = maybeParseJson(semgrepResult.stdout) || maybeParseJson(semgrepResult.stderr);
        if (report && Array.isArray(report.results)) findings.push(...fromSemgrep(report));
    }

    const tests = executeCommand(process.platform === 'win32' ? 'node.exe' : 'node', ['--test', 'tests/security-remediation.test.js'], root, env);
    verification.tests = tests.status === 0 ? 'passed' : 'failed';
    verification.rescan = verification.tests;

    return {
        findings,
        scans,
        verification,
        npmAudit: maybeParseJson(npmResult.stdout) || maybeParseJson(npmResult.stderr),
        gitleaks: maybeParseJson(gitleaksResult.stdout) || maybeParseJson(gitleaksResult.stderr),
        semgrep: maybeParseJson(semgrepResult.stdout) || maybeParseJson(semgrepResult.stderr)
    };
}

// Convert findings into a consistent report format
function normalizeFinding(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new TypeError('Each finding must be an object.');
    }

    const supportedTypes = [
        'secret_leak',
        'sql_injection',
        'access_control',
        'vulnerable_dependency',
        'insecure_code'
    ];

    const type = supportedTypes.includes(item.type)
        ? item.type
        : 'other';

    return {
        source: clean(item.source || 'unknown', 50),
        id: clean(item.id || 'unclassified', 100),
        type: type,
        severity: severity(item.severity),
        location: clean(item.location || '', 200),

        description: type === 'secret_leak'
            ? 'Potential secret exposure detected; raw matched content is intentionally excluded.'
            : clean(item.description || 'Scanner finding requires review.', 400),

        recommendation: recommendation(type),
        status: 'REQUIRES_REVIEW'
    };
}

// Read vulnerabilities from npm audit JSON
function fromNpmAudit(audit) {
    if (
        !audit ||
        typeof audit !== 'object' ||
        Array.isArray(audit) ||
        !audit.vulnerabilities ||
        typeof audit.vulnerabilities !== 'object'
    ) {
        throw new TypeError(
            'Expected npm audit --json output with vulnerabilities.'
        );
    }

    return Object.entries(audit.vulnerabilities).map(([name, issue]) => ({
        source: 'npm audit',
        id: name,
        type: 'vulnerable_dependency',
        severity: issue && issue.severity,
        location: 'dependency:' + name,
        description: 'Dependency security advisory for ' + name +
            '. Check the npm audit report for details.'
    }));
}

// Read findings from Gitleaks JSON
function fromGitleaks(report) {
    if (!Array.isArray(report)) {
        throw new TypeError('Expected Gitleaks JSON array.');
    }

    return report.map(item => ({
        source: 'Gitleaks',
        id: item.RuleID || 'secret',
        type: 'secret_leak',
        severity: 'CRITICAL',
        location: [
            item.File || '',
            item.StartLine || ''
        ].filter(Boolean).join(':'),
        description: 'Possible exposed credential.'

        // Never copy item.Secret, item.Match or item.Line
    }));
}

// Read findings from Semgrep JSON
function fromSemgrep(report) {
    if (!report || !Array.isArray(report.results)) {
        throw new TypeError(
            'Expected Semgrep JSON results array.'
        );
    }

    return report.results.map(item => ({
        source: 'Semgrep',
        id: item.check_id || 'rule',
        type: 'insecure_code',
        severity: item.extra && item.extra.severity,
        location: [
            item.path || '',
            (item.start && item.start.line) || ''
        ].filter(Boolean).join(':'),
        description: 'Static analysis rule matched. Review the finding in the scanner output.'

        // Avoid copying source snippets or exposed secrets
    }));
}

// Main function that coordinates the security report
function runSecurityAgent({
    findings = [],
    npmAudit,
    gitleaks,
    semgrep,
    scans = {},
    verification = {}
} = {}) {

    if (!Array.isArray(findings)) {
        throw new TypeError('findings must be an array.');
    }

    // Collect findings from all sources
    const all = [...findings];

    if (npmAudit !== undefined && npmAudit !== null) {
        all.push(...fromNpmAudit(npmAudit));
    }

    if (gitleaks !== undefined && gitleaks !== null) {
        all.push(...fromGitleaks(gitleaks));
    }

    if (semgrep !== undefined && semgrep !== null) {
        all.push(...fromSemgrep(semgrep));
    }

    if (all.length > MAX_FINDINGS) {
        throw new RangeError(
            'Too many findings. Split the report into smaller batches.'
        );
    }

    // Process findings and attach recommendations
    const processed = all.map(normalizeFinding);

    // Count vulnerabilities by severity
    const summary = Object.fromEntries(
        SEVERITIES.map(name => [name, 0])
    );

    for (const item of processed) {
        summary[item.severity]++;
    }

    // Check whether required security scans passed
    const requiredScanners = [
        'npmAudit',
        'gitleaks',
        'semgrep'
    ];

    const scanStatus = Object.fromEntries(
        requiredScanners.map(name => [
            name,
            scans[name] === 'passed'
                ? 'passed'
                : scans[name] === 'failed'
                    ? 'failed'
                    : 'not_run'
        ])
    );

    const scansComplete = Object.values(scanStatus)
        .every(status => status === 'passed');

    // Check verification results
    const testsPassed =
        verification.tests === 'passed' &&
        verification.rescan === 'passed';

    // Decide overall report status
    let status;

    if (!scansComplete) {
        status = 'INCOMPLETE_SCAN';
    } else if (processed.length > 0) {
        status = 'REQUIRES_REVIEW';
    } else if (!testsPassed) {
        status = 'PENDING_VERIFICATION';
    } else {
        status = 'NO_FINDINGS_DETECTED';
    }

    // Return the final security report
    return {
        title: 'Banking Security Remediation Report',
        generatedAt: new Date().toISOString(),
        status: status,
        totalFindings: processed.length,
        severitySummary: summary,
        scanStatus: scanStatus,
        verification: {
            tests: verification.tests || 'not_run',
            rescan: verification.rescan || 'not_run'
        },
        findings: processed,
        limitations: 'Scanner results do not prove the application is vulnerability-free. Human security review is required.'
    };
}

// Export functions for other JavaScript files
module.exports = {
    runSecurityAgent,
    runAgent,
    runAutonomousScan,
    executeAgentTool,
    normalizeFinding,
    fromNpmAudit,
    fromGitleaks,
    fromSemgrep
};