# Active DFT test suite

Run `npm test` against the separate `TEST_DATABASE_URL` in ignored `.env.test`. Run `npm run test:browser` for browser workflows. Python cases live in `tests_python/`; the real two-process integration check is `scripts/platform-smoke.js`.

The retired database/native-service tests have been removed. The suite covers the current Express/PostgreSQL/FastAPI application, including credential-preserving identity cleanup, permissions, banking, rules, fraud review and authenticator controls. Browser workflows use `chrome.js` and include statements/PDFs and mobile layouts. Use `npm run demo:fraud` for executable simulation evidence or `npm run demo:fraud:serve` for a separate interactive demo.
