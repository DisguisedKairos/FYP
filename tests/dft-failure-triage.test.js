'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, redact, createReport, evidence, runAgent } = require('../deploy/failure-triage');

test('classifies PostgreSQL failures and suggests database checks', () => {
  const classifications = classify('ECONNREFUSED 127.0.0.1:5432 PostgreSQL database check failed');
  assert.ok(classifications.some(item => item.id === 'postgres'));
});

test('classifies Compose failures before generic unknown failures', () => {
  const classifications = classify('docker compose up failed because the container exited');
  assert.ok(classifications.some(item => item.id === 'compose'));
});

test('redacts database URLs and credential assignments', () => {
  const text = redact('postgresql://owner:secret@db/greenlink SERVICE_TOKEN=abcdef github_pat_123456');
  assert.doesNotMatch(text, /secret/);
  assert.doesNotMatch(text, /github_pat_/);
  assert.match(text, /SERVICE_TOKEN=\[redacted\]/);
});

test('creates an actionable report without raw secrets', () => {
  const report = createReport({
    run: { id: 42, name: 'Greenlink CI', url: 'https://example.test/run/42', conclusion: 'failure' },
    log: 'npm test failed: AssertionError\npostgresql://owner:secret@db/greenlink'
  });
  assert.match(report, /Automated DevOps failure triage/);
  assert.match(report, /npm test/);
  assert.match(report, /### Suggested fix/);
  assert.match(report, /Update the implementation or test expectation/);
  assert.doesNotMatch(report, /secret@db/);
});

test('evidence selects unique failure lines', () => {
  const lines = evidence('Build failed\nBuild failed\nTests passed\nAssertionError on result');
  assert.deepEqual(lines, ['Build failed', 'AssertionError on result']);
});

test('agent returns its final report when the model is configured', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { role: 'assistant', content: '## Agent report\n\nLikely source failure.' } }] }) });
  try {
    const report = await runAgent('npm run check failed', { conclusion: 'failure' }, {
      AGENTIC_TRIAGE_ENDPOINT: 'https://model.example.test', AGENTIC_TRIAGE_TOKEN: 'test-token', AGENTIC_TRIAGE_MODEL: 'test-model'
    });
    assert.match(report, /Agent report/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('agent is disabled when model configuration is absent', async () => {
  assert.equal(await runAgent('failed', { conclusion: 'failure' }, {}), null);
});
