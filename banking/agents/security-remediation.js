
'use strict';

// Greenlink Security Remediation Agent
// Read-only: never changes application files.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

const SEVERITIES = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'UNKNOWN'
];

const MAX_FINDINGS = 5000;

const SCANNERS = {
  npm_audit: 'npmAudit',
  gitleaks_scan: 'gitleaks',
  semgrep_scan: 'semgrep'
};

const AGENT_TOOLS = [
  ['npm_audit', 'Check installed production npm dependencies for vulnerabilities'],
  ['gitleaks_scan', 'Find exposed credentials in tracked Git history'],
  ['semgrep_scan', 'Find insecure source-code patterns'],
  ['verify_tests', 'Run the Security Remediation Agent unit tests']
].map(([name, description]) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  }
}));

// --------------------------------------------------
// Severity classification
// --------------------------------------------------

function severity(value) {
  const name = String(value || 'UNKNOWN').toUpperCase();

  if (['MODERATE', 'WARNING'].includes(name)) {
    return 'MEDIUM';
  }

  if (name === 'ERROR') {
    return 'HIGH';
  }

  if (['INFO', 'INFORMATIONAL'].includes(name)) {
    return 'LOW';
  }

  return SEVERITIES.includes(name) ? name : 'UNKNOWN';
}

// --------------------------------------------------
// Clean and redact sensitive information
// --------------------------------------------------

function clean(value, maximum = 300) {
  return String(value ?? '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g,
      '[REDACTED]'
    )
    .slice(0, maximum);
}

// --------------------------------------------------
// Security remediation recommendations
// --------------------------------------------------

function recommendation(type) {
  const recommendations = {
    secret_leak:
      'Revoke and rotate the exposed credential, remove it from source/history as appropriate, and use a secret manager.',

    sql_injection:
      'Use parameterized SQL, restrict database permissions, and add a regression test.',

    access_control:
      'Enforce server-side authorization and ownership checks; test unauthorized requests.',

    vulnerable_dependency:
      'Review the advisory, upgrade to a patched compatible dependency, and rerun npm audit.',

    insecure_code:
      'Review the flagged code, apply least privilege, and add regression tests.'
  };

  return recommendations[type] ||
    'Investigate this finding manually and verify the proposed fix.';
}

// --------------------------------------------------
// Execute security scanner commands
// Includes Windows npm and Python UTF-8 fixes
// --------------------------------------------------

function executeCommand(
  command,
  args,
  root = ROOT,
  env = process.env
) {
  const windows = process.platform === 'win32';

  // npm.cmd cannot reliably run with shell:false on Windows.
  // Only permit the fixed npm audit command used by this agent.

  const isWindowsNpm =
    windows && command.toLowerCase() === 'npm.cmd';

  const expectedNpmArgs = [
    'audit',
    '--json',
    '--omit=dev'
  ];

  if (
    isWindowsNpm &&
    JSON.stringify(args) !== JSON.stringify(expectedNpmArgs)
  ) {
    return {
      status: null,
      error: 'UNSUPPORTED_NPM_ARGUMENTS',
      stdout: '',
      stderr: ''
    };
  }

  const actualCommand = isWindowsNpm
    ? (env.ComSpec || 'cmd.exe')
    : command;

  const actualArgs = isWindowsNpm
    ? ['/d', '/s', '/c', 'npm audit --json --omit=dev']
    : args;

  const result = spawnSync(actualCommand, actualArgs, {
    cwd: root,
    encoding: 'utf8',
    shell: false,

    // Fix Windows Python encoding for Semgrep.
    env: {
      ...env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8'
    },

    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });

  return {
    status: result.status,

    error: result.error
      ? (result.error.code || 'EXECUTION_ERROR')
      : null,

    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

// --------------------------------------------------
// Parse JSON safely
// --------------------------------------------------

function maybeParseJson(value) {
  try {
    return value && JSON.parse(value);
  } catch {
    return null;
  }
}

// --------------------------------------------------
// Convert npm audit results into findings
// --------------------------------------------------

function fromNpmAudit(audit) {
  if (
    !audit ||
    typeof audit.vulnerabilities !== 'object' ||
    Array.isArray(audit.vulnerabilities) ||
    !audit.vulnerabilities
  ) {
    throw new TypeError(
      'Expected npm audit JSON with vulnerabilities object.'
    );
  }

  return Object.entries(audit.vulnerabilities).map(
    ([name, issue]) => ({
      source: 'npm audit',
      id: name,
      type: 'vulnerable_dependency',
      severity: issue?.severity,
      location: `dependency:${name}`,
      description: `Dependency security advisory for ${name}.`
    })
  );
}

// --------------------------------------------------
// Convert Gitleaks results into findings
// Never include the actual secret
// --------------------------------------------------

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
      item.File,
      item.StartLine
    ].filter(Boolean).join(':'),

    description: 'Possible exposed credential.'
  }));
}

// --------------------------------------------------
// Convert Semgrep results into findings
// --------------------------------------------------

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
    severity: item.extra?.severity,

    location: [
      item.path,
      item.start?.line
    ].filter(Boolean).join(':'),

    description:
      'Static analysis rule matched; review the scanner finding.'
  }));
}

// --------------------------------------------------
// Normalize findings
// --------------------------------------------------

function normalizeFinding(item) {
  if (
    !item ||
    typeof item !== 'object' ||
    Array.isArray(item)
  ) {
    throw new TypeError('Finding must be an object.');
  }

  const allowedTypes = [
    'secret_leak',
    'sql_injection',
    'access_control',
    'vulnerable_dependency',
    'insecure_code'
  ];

  const type = allowedTypes.includes(item.type)
    ? item.type
    : 'other';

  return {
    source: clean(item.source || 'unknown', 50),
    id: clean(item.id || 'unclassified', 100),
    type,
    severity: severity(item.severity),
    location: clean(item.location || '', 200),

    description: type === 'secret_leak'
      ? 'Potential secret exposure; matched content intentionally excluded.'
      : clean(
          item.description || 'Review scanner finding.',
          400
        ),

    recommendation: recommendation(type),
    status: 'REQUIRES_REVIEW'
  };
}

// --------------------------------------------------
// Generate the security remediation report
// --------------------------------------------------

function runSecurityAgent({
  findings = [],
  npmAudit,
  gitleaks,
  semgrep,
  scans = {},
  verification = {},
  scanErrors = {}
} = {}) {

  if (!Array.isArray(findings)) {
    throw new TypeError('findings must be an array.');
  }

  const all = [...findings];

  if (npmAudit != null) {
    all.push(...fromNpmAudit(npmAudit));
  }

  if (gitleaks != null) {
    all.push(...fromGitleaks(gitleaks));
  }

  if (semgrep != null) {
    all.push(...fromSemgrep(semgrep));
  }

  if (all.length > MAX_FINDINGS) {
    throw new RangeError(
      'Too many findings; split the scan.'
    );
  }

  // Remove duplicate findings.
  const unique = new Map();

  for (const finding of all.map(normalizeFinding)) {
    const key = JSON.stringify([
      finding.source,
      finding.id,
      finding.type,
      finding.location
    ]);

    if (!unique.has(key)) {
      unique.set(key, finding);
    }
  }

  const processed = [...unique.values()];

  // Count vulnerabilities by severity.
  const severitySummary = Object.fromEntries(
    SEVERITIES.map(s => [s, 0])
  );

  for (const finding of processed) {
    severitySummary[finding.severity]++;
  }

  // Check scanner completion.
  const scanStatus = Object.fromEntries(
    ['npmAudit', 'gitleaks', 'semgrep'].map(name => [
      name,
      ['passed', 'failed', 'not_run'].includes(scans[name])
        ? scans[name]
        : 'not_run'
    ])
  );

  const scansComplete = Object.values(scanStatus)
    .every(status => status === 'passed');

  const verified =
    verification.tests === 'passed' &&
    verification.rescan === 'passed';

  let status;

  if (!scansComplete) {
    status = 'INCOMPLETE_SCAN';
  } else if (processed.length > 0) {
    status = 'REQUIRES_REVIEW';
  } else if (!verified) {
    status = 'PENDING_VERIFICATION';
  } else {
    status = 'NO_FINDINGS_DETECTED';
  }

  return {
    title: 'Banking Security Remediation Report',
    generatedAt: new Date().toISOString(),
    status,
    totalFindings: processed.length,
    severitySummary,
    scanStatus,

    scanErrors: Object.fromEntries(
      Object.entries(scanErrors).map(([key, value]) => [
        clean(key, 30),
        clean(value, 120)
      ])
    ),

    verification: {
      tests: verification.tests || 'not_run',
      rescan: verification.rescan || 'not_run'
    },

    findings: processed,

    limitations:
      'No findings does not prove the application is secure. Human review is required.'
  };
}

// --------------------------------------------------
// Run individual security scanner
// --------------------------------------------------

function scanTool(
  name,
  root = ROOT,
  env = process.env
) {
  const windows = process.platform === 'win32';

  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'greenlink-security-')
  );

  try {
    let result;
    let data;
    let findings = [];

    // ----------------------------------------------
    // npm audit
    // ----------------------------------------------

    if (name === 'npm_audit') {
      result = executeCommand(
        windows ? 'npm.cmd' : 'npm',
        ['audit', '--json', '--omit=dev'],
        root,
        env
      );

      if (result.error) {
        return {
          tool: name,
          status: 'failed',
          error: `npm audit could not start: ${result.error}`
        };
      }

      data = maybeParseJson(result.stdout);

      if (
        data?.vulnerabilities &&
        typeof data.vulnerabilities === 'object' &&
        !Array.isArray(data.vulnerabilities)
      ) {
        findings = fromNpmAudit(data);
      } else {
        return {
          tool: name,
          status: 'failed',
          error: 'npm audit returned invalid JSON'
        };
      }

    // ----------------------------------------------
    // Gitleaks
    // ----------------------------------------------

    } else if (name === 'gitleaks_scan') {
      const output = path.join(dir, 'gitleaks.json');

      result = executeCommand(
        windows ? 'gitleaks.exe' : 'gitleaks',
        [
          'git',
          '--redact',
          '--report-format',
          'json',
          '--report-path',
          output,
          root
        ],
        root,
        env
      );

      data = fs.existsSync(output)
        ? maybeParseJson(fs.readFileSync(output, 'utf8'))
        : null;

      // Gitleaks may not create a report when no
      // findings are detected.
      if (result.status === 0 && data === null) {
        data = [];
      }

      if (!Array.isArray(data)) {
        return {
          tool: name,
          status: 'failed',
          error: 'Gitleaks report missing or invalid'
        };
      }

      findings = fromGitleaks(data);

    // ----------------------------------------------
    // Semgrep
    // ----------------------------------------------

    } else if (name === 'semgrep_scan') {
      const output = path.join(dir, 'semgrep.json');

      result = executeCommand(
        windows ? 'semgrep.exe' : 'semgrep',
        [
          'scan',
          '--config',
          'p/security-audit',
          '--exclude',
          'Dockerfile',
          '--json',
          '--output',
          output,
          root
        ],
        root,
        env
      );

      data = fs.existsSync(output)
        ? maybeParseJson(fs.readFileSync(output, 'utf8'))
        : maybeParseJson(result.stdout);

      if (result.error) {
        return {
          tool: name,
          status: 'failed',
          error: `Semgrep execution failed: ${result.error}`
        };
      }

      if (!data || !Array.isArray(data.results)) {
        return {
          tool: name,
          status: 'failed',
          error: 'Semgrep did not produce a valid JSON report'
        };
      }

      if (
        Array.isArray(data.errors) &&
        data.errors.length > 0
      ) {
        return {
          tool: name,
          status: 'failed',
          error:
            `Semgrep reported ${data.errors.length} scanner error(s)`
        };
      }

      findings = fromSemgrep(data);

    // ----------------------------------------------
    // Verify unit tests
    // ----------------------------------------------

    } else if (name === 'verify_tests') {
      result = executeCommand(
        'node',
        [
          '--test',
          'tests/security-remediation.test.js'
        ],
        root,
        env
      );

      return {
        tool: name,

        status:
          result.status === 0 && !result.error
            ? 'passed'
            : 'failed',

        error: result.error ||
          (result.status !== 0
            ? 'Unit tests failed'
            : undefined)
      };

    } else {
      throw new Error('Tool is not allowlisted.');
    }

    // npm audit and Gitleaks may return exit code 1
    // when findings are detected.
    // Semgrep should normally return 0.

    if (
      result.error ||
      ![0, 1].includes(result.status) ||
      (name === 'semgrep_scan' && result.status !== 0)
    ) {
      return {
        tool: name,
        status: 'failed',
        error: result.error ||
          `${name} exited with status ${result.status}`
      };
    }

    return {
      tool: name,
      status: 'passed',
      findings
    };

  } finally {
    // Delete temporary scanner reports.
    fs.rmSync(dir, {
      recursive: true,
      force: true
    });
  }
}

// --------------------------------------------------
// Allowlisted tool execution for AI
// --------------------------------------------------

function executeAgentTool(
  name,
  root = ROOT,
  env = process.env
) {
  const allowed = AGENT_TOOLS.some(
    tool => tool.function.name === name
  );

  if (!allowed) {
    return JSON.stringify({
      tool: name,
      status: 'failed',
      error: 'Tool not permitted'
    });
  }

  // Only sanitized findings are returned.
  return JSON.stringify(scanTool(name, root, env));
}

// --------------------------------------------------
// Run all scanners without AI
// --------------------------------------------------

async function runAutonomousScan({
  root = ROOT,
  env = process.env
} = {}) {

  const findings = [];
  const scans = {};
  const scanErrors = {};

  for (const [tool, key] of Object.entries(SCANNERS)) {
    const result = scanTool(tool, root, env);

    scans[key] = result.status;

    if (result.error) {
      scanErrors[key] = result.error;
    }

    findings.push(...(result.findings || []));
  }

  const tests = scanTool('verify_tests', root, env);

  return {
    findings,
    scans,
    scanErrors,

    verification: {
      tests: tests.status,
      rescan: 'not_run'
    }
  };
}

// --------------------------------------------------
// Optional AI agent with tool calling
// --------------------------------------------------

async function runAgent({
  root = ROOT,
  env = process.env,
  endpoint = env.AGENTIC_SECURITY_ENDPOINT,
  token = env.AGENTIC_SECURITY_TOKEN,
  model = env.AGENTIC_SECURITY_MODEL
} = {}) {

  // Default mode runs scanners locally without AI.
  if (!(endpoint && token && model)) {
    return runSecurityAgent(
      await runAutonomousScan({ root, env })
    );
  }

  const url = new URL(endpoint);

  if (
    url.protocol !== 'https:' &&
    !(url.hostname === 'localhost' &&
      url.protocol === 'http:')
  ) {
    throw new Error(
      'AI endpoint must use HTTPS (except localhost).'
    );
  }

  const messages = [
    {
      role: 'system',
      content:
        'You are a read-only security analyst. ' +
        'Call approved scanner tools, never request secrets, ' +
        'and provide concise recommendations grounded only ' +
        'in tool results. Never claim to have fixed code.'
    },
    {
      role: 'user',
      content:
        'Analyse this repository using approved tools and explain security findings.'
    }
  ];

  const collected = {
    findings: [],
    scans: {},
    verification: {
      tests: 'not_run',
      rescan: 'not_run'
    }
  };

  const used = new Set();

  for (let round = 0; round < 6; round++) {
    const response = await fetch(url, {
      method: 'POST',

      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        model,
        messages,
        tools: AGENT_TOOLS,
        tool_choice: 'auto'
      }),

      signal: AbortSignal.timeout(90000)
    });

    if (!response.ok) {
      throw new Error(
        `AI endpoint returned HTTP ${response.status}`
      );
    }

    const payload = await response.json();
    const message = payload.choices?.[0]?.message;

    if (!message) {
      throw new Error(
        'AI endpoint returned no message.'
      );
    }

    messages.push({
      role: 'assistant',
      content: message.content || null,

      ...(message.tool_calls
        ? { tool_calls: message.tool_calls }
        : {})
    });

    // If the AI has finished requesting tools,
    // generate the final security report.
    if (!message.tool_calls?.length) {
      const report = runSecurityAgent(collected);

      return {
        ...report,
        aiSummary: clean(
          message.content || 'No AI summary returned.',
          2000
        )
      };
    }

    // Execute tools requested by the AI.
    for (const call of message.tool_calls) {
      const name = call.function?.name;

      const allowed = AGENT_TOOLS.some(
        tool => tool.function.name === name
      );

      const result = allowed && !used.has(name)
        ? scanTool(name, root, env)
        : {
            tool: name,
            status: 'failed',
            error: 'Unknown or repeated tool'
          };

      used.add(name);

      if (SCANNERS[name]) {
        const key = SCANNERS[name];

        collected.scans[key] = result.status;

        if (result.error) {
          collected.scanErrors ||= {};
          collected.scanErrors[key] = result.error;
        }

        collected.findings.push(
          ...(result.findings || [])
        );

      } else if (name === 'verify_tests') {
        collected.verification.tests = result.status;
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
  }

  throw new Error(
    'AI agent exceeded its tool-call round limit.'
  );
}

// --------------------------------------------------
// Export functions
// --------------------------------------------------

module.exports = {
  runSecurityAgent,
  runAgent,
  runAutonomousScan,
  executeAgentTool,
  normalizeFinding,
  fromNpmAudit,
  fromGitleaks,
  fromSemgrep,
  scanTool
};
