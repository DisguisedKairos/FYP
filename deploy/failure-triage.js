'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const AGENT_TOOLS = [
  { type: 'function', function: { name: 'source_check', description: 'Run the repository JavaScript syntax checks.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'python_check', description: 'Compile the Python application and deployment modules.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'compose_check', description: 'Validate the Docker Compose configuration without starting containers.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'node_tests', description: 'Run the Node functional and security tests.', parameters: { type: 'object', properties: {} } } }
];

const SAFE_COMMANDS = {
  source_check: { executable: 'npm', args: ['run', 'check'] },
  python_check: { executable: process.platform === 'win32' ? 'python' : 'python3', args: ['-m', 'compileall', '-q', 'main.py', 'fraud_service', 'deploy', 'tests_python'] },
  compose_check: { executable: 'docker', args: ['compose', 'config', '--quiet'] },
  node_tests: { executable: 'npm', args: ['test'] }
};

function executeAgentTool(name) {
  const command = SAFE_COMMANDS[name];
  if (!command) return `Tool ${name} is not permitted.`;
  const result = require('node:child_process').spawnSync(command.executable, command.args, { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 120000, windowsHide: true });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return `exit=${result.status ?? (result.error ? 1 : 0)}\n${output.slice(-12000)}`;
}

const SIGNATURES = [
  { id: 'compose', pattern: /docker compose|container.*(?:failed|exited)|buildx/i, title: 'Compose or container failure', commands: ['docker compose config --quiet', 'node deploy/configuration.js', 'docker compose build banking fraud'], fix: 'Fix the Compose service configuration or container startup error, then validate the configuration with `docker compose config --quiet`.' },
  { id: 'postgres', pattern: /postgres(?:ql)?|ECONNREFUSED.*5432|database check failed/i, title: 'PostgreSQL connectivity or schema failure', commands: ['npm run db:check', 'npm run db:migrate'], fix: 'Check the database host, port, credentials, health-check command, and migration state; do not run migrations until the database is healthy.' },
  { id: 'python', pattern: /python|pytest|unittest|traceback|fastapi/i, title: 'Python service or test failure', commands: ['python -m compileall -q main.py fraud_service deploy tests_python', 'npm run test:python'], fix: 'Correct the traceback location or failing assertion in the Python service, then rerun the focused Python test.' },
  { id: 'browser', pattern: /playwright|puppeteer|chrome|browser|ERR_CONNECTION/i, title: 'Browser workflow failure', commands: ['npm run test:browser'], fix: 'Fix the browser selector, application URL, or server readiness issue shown in the Playwright failure and rerun `npm run test:browser`.' },
  { id: 'node-test', pattern: /npm test|node --test|AssertionError|FAIL\s/i, title: 'Node functional or security test failure', commands: ['npm test'], fix: 'Update the implementation or test expectation at the assertion shown in the failed log, then rerun the focused Node test.' },
  { id: 'source-check', pattern: /syntax checked|npm run check|SyntaxError/i, title: 'Source validation failure', commands: ['npm run check'], fix: 'Fix the reported syntax or source-validation error and rerun `npm run check`.' },
  { id: 'package', pattern: /npm run package|verify-package|SHA-256|releases\/.*\.zip/i, title: 'Package creation or verification failure', commands: ['npm run package', 'npm run package:verify'], fix: 'Correct the package manifest, missing release file, or checksum mismatch, then rerun package verification.' }
];

function redact(text) {
  return String(text || '')
    .replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, '[database connection redacted]')
    .replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[token redacted]')
    .replace(/(SERVICE_TOKEN|AUTH_ENCRYPTION_KEY|PASSWORD|postgres_password)\s*[=:]\s*[^\s]+/gi, '$1=[redacted]');
}

function classify(log) {
  const matches = SIGNATURES.filter(signature => signature.pattern.test(log));
  if (!matches.length) return [{ id: 'unknown', title: 'Unknown CI failure', commands: ['npm run check', 'npm test'], fix: 'Compare the first failing command and its error with the repository configuration, then fix the smallest identified root cause and rerun the focused check.' }];
  return matches;
}

function evidence(log, limit = 18) {
  const lines = redact(log).split(/\r?\n/).map(line => line.trimEnd()).filter(line => /(?:error|failed|failure|exception|assert|refused|exit code|syntax|unable)/i.test(line));
  return [...new Set(lines)].slice(-limit);
}

function createReport({ run, log }) {
  const hypotheses = classify(log);
  const evidenceLines = evidence(log);
  const commands = [...new Set(hypotheses.flatMap(item => item.commands))];
  const lines = [
    '## Automated DevOps failure triage',
    '',
    'An evidence-based CI triage agent analyzed the failed workflow logs.',
    '',
    `- Workflow: [${run.name || 'Greenlink CI and container delivery'}](${run.url || ''})`,
    `- Run: #${run.id}`,
    `- Conclusion: **${run.conclusion || 'failure'}**`,
    '',
    '### Likely cause areas',
    ...hypotheses.map(item => `- **${item.title}**`),
    '',
    '### Suggested fix',
    ...hypotheses.map(item => `- ${item.fix}`),
    '',
    '### Suggested checks',
    ...commands.map(command => `1. \`${command}\``),
    ''
  ];
  if (evidenceLines.length) {
    lines.push('### Relevant evidence', '', '```text', ...evidenceLines.slice(0, 12), '```', '');
  }
  lines.push('> Triage is advisory. Review the complete job logs before changing infrastructure or application code.', '');
  return lines.join('\n');
}

async function runAgent(log, run, env = process.env) {
  const endpoint = env.AGENTIC_TRIAGE_ENDPOINT;
  const token = env.AGENTIC_TRIAGE_TOKEN;
  const model = env.AGENTIC_TRIAGE_MODEL;
  if (!endpoint || !token || !model) return null;

  const messages = [
    { role: 'system', content: 'You are a read-only CI failure triage agent. Diagnose only from failed log evidence. Use tools to verify hypotheses. Never invent evidence, modify files, deploy, publish, rerun infrastructure, or recommend deleting data. In the final report, include a concrete but cautious `### Suggested fix` section: identify the likely code or configuration change, name the exact file or command when evidence supports it, and label uncertainty. Do not provide a diff or apply the fix. Keep the final report concise Markdown and label uncertainty. After at most four tool iterations, return the final report only.' },
    { role: 'user', content: `Workflow: ${run.name || 'Greenlink CI and container delivery'}\nConclusion: ${run.conclusion || 'failure'}\nRedacted failed logs:\n${redact(log).slice(-50000)}` }
  ];

  for (let iteration = 0; iteration < 4; iteration++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools: AGENT_TOOLS, tool_choice: 'auto' }),
      signal: AbortSignal.timeout(90000)
    });
    if (!response.ok) throw new Error(`Agent endpoint returned HTTP ${response.status}`);
    const payload = await response.json();
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error('Agent endpoint returned no assistant message.');

    if (message.tool_calls?.length) {
      messages.push(message);
      for (const call of message.tool_calls.slice(0, 3)) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: executeAgentTool(call.function?.name) });
      }
      continue;
    }
    return message.content || null;
  }
  throw new Error('Agent reached the bounded tool iteration limit without a final report.');
}

function gitHub(args, env = process.env) {
  return execFileSync('gh', args, { encoding: 'utf8', env, maxBuffer: 20 * 1024 * 1024 }).trim();
}

async function main() {
  const runId = process.env.WORKFLOW_RUN_ID;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!runId || !repository) throw new Error('WORKFLOW_RUN_ID and GITHUB_REPOSITORY are required.');
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required for workflow-log access and pull-request comments.');

  const run = JSON.parse(gitHub(['run', 'view', runId, '--repo', repository, '--json', 'databaseId,name,url,headSha,conclusion']));
  let log;
  try { log = gitHub(['run', 'view', runId, '--repo', repository, '--log-failed']); }
  catch (error) { log = error.stdout ? String(error.stdout) : String(error.stderr || error.message); }
  const triageRun = { ...run, id: runId, conclusion: run.conclusion || 'failure' };
  let report;
  try { report = await runAgent(log, triageRun); }
  catch (error) { report = null; console.error(`Agentic triage unavailable; deterministic fallback used: ${error.message}`); }
  report ||= createReport({ run: triageRun, log });
  if (!/^## /m.test(report)) report = `## Automated DevOps failure triage\n\n${report}`;
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/failure-triage.md', report);

  let pullNumber;
  try {
    const pulls = JSON.parse(gitHub(['api', `repos/${repository}/commits/${run.headSha}/pulls`, '--jq', '[.[] | select(.state == "open") | .number]']));
    pullNumber = Array.isArray(pulls) ? pulls[0] : undefined;
  } catch {}
  if (pullNumber) gitHub(['pr', 'comment', String(pullNumber), '--repo', repository, '--body-file', path.resolve('artifacts/failure-triage.md')]);
  process.stdout.write(report);
}

module.exports = { redact, classify, evidence, createReport, executeAgentTool, runAgent };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
