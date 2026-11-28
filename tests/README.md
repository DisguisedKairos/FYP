# Active DFT test suite

Run `npm test` against the separate `TEST_DATABASE_URL` in ignored `.env.test`. Run `npm run test:browser` for browser workflows. Python cases live in `tests_python/`; the real two-process integration check is `scripts/platform-smoke.js`.

The retired database/native-service tests have been removed. The suite covers the current Express/PostgreSQL/FastAPI application, including credential-preserving identity cleanup, permissions, banking, rules, fraud review and authenticator controls. Browser workflows use `chrome.js` and include statements/PDFs and desktop layouts. Use npm run demo:agents for actual OpenAI inference in a disposable schema.

## Verification commands

- `npm run build`: syntax-check application source.
- `npm test`: functional and security tests with controlled provider transports and isolated PostgreSQL schemas.
- `npm run test:python`: FastAPI and scoring-contract tests using the pinned Python test requirements.
- `npm run test:browser`: desktop banking and assistant workflows in a Chrome-compatible browser.
- `npm run evaluate:assistant`: adversarial assistant checks with controlled model responses.
- `npm run test:neon`: real Express, FastAPI, OpenAI and Neon integration in a disposable schema. This uses API credits.
- `npm run demo:agents`: all five insight workflows and payment scoring with real OpenAI inference in a disposable schema. This uses API credits.

PostgreSQL integration cases require a separate `TEST_DATABASE_URL`; skipped cases do not prove database behavior. Controlled model responses verify application controls and do not measure real-world fraud accuracy. See [AI evaluation and limits](../docs/ai-evaluation.md) and [Neon setup](../docs/neon.md).

The existing native database, private backups, credentials and historical assessments remain preserved. Applied SQL migrations are immutable; historical provider names/digests are retained as audit evidence. New assessments accept OpenAI provenance only, and unavailable or invalid inference cannot authorize money movement.
