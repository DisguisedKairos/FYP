# Active DFT test suite

Run `node --env-file=.env --test tests/dft-*.test.js` against a separate `TEST_DATABASE_URL`. Run `node --env-file=.env --test tests/browser.e2e.js tests/dft-security-browser.js` for browser workflows. Python cases live in `tests_python/`; the real two-process integration check is `scripts/platform-smoke.js`.

Older files without the `dft-` prefix, except `browser.e2e.js` and its `chrome.js` helper, describe the former SQLite/native-service implementation. They are retained as historical reference, excluded from npm's active test command and the release package, and do not validate the current Express/PostgreSQL/FastAPI application. Use the documented active commands rather than a broad `tests/*.test.js` glob.
