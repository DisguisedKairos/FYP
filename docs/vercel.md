# Vercel multi-service deployment

## Configuration and verification

The project owner confirmed the service names, public paths, private binding and free-plan daily cron on 30 October 2026. The repository is configured for two services. Local verification is documented below; a successful local run does not establish that a cloud deployment has its private environment configured.

The local routing issue is resolved with an early service handoff before filesystem fallback. Website JavaScript and CSS match their public source assets, backend files return 404, and missing-host requests return 400. An authenticated synthetic staff login reached the dashboard and the private FastAPI service, which returned the available configured OpenAI model metadata.

| Service | Entrypoint | Public routing | Calls |
| --- | --- | --- | --- |
| banking | app.js via deploy/vercel.js, Express | All website pages, assets, /api/* and /health | fraud through FRAUD_SERVICE_BINDING_URL |
| fraud | main:app, FastAPI | None; internal service only | OpenAI Responses API |

Both service roots are the repository root because package.json, requirements.txt, main.py and the shared runtime modules already live there. Explicit framework and entrypoint settings prevent FastAPI detection from replacing the Express banking website. The shared application.js module owns the banking factory, and both app.js and deploy/vercel.js import it directly. The hosted adapter must never import app.js: that creates a circular dependency when the production entry is loaded. app.js constructs a thin Express wrapper so the framework builder can discover it. The callable app.js export also matches the Express adapter's root-file discovery, while its named factories remain available for native startup and tests. tests_python is a test suite and is not deployed.

## Routing order and security headers

The top-level rewrite targets banking. Vercel CLI 65.7.0 evaluates its filesystem phase before ordinary rewrites, which otherwise exposes repository source and creates a collision between backend app.js and public/app.js. The explicit top-level routes first apply the existing response security headers with continue: true, then hand every request to banking before filesystem fallback. Keep this early handoff and the public rewrite consistent when changing service names or public routing. Fraud has no public destination.

The Express builder uses root entrypoint discovery. app.js therefore exports a callable Express application and retains the named native factories. The unused devCommand override was removed because the CLI selects its framework builder first.

## Binding and request paths

Vercel injects FRAUD_SERVICE_BINDING_URL into the banking function at runtime. **Do not create or override this environment variable yourself.** Banking resolves relative internal/health, internal/model and internal/assess routes against that base, preserving any binding path prefix. The binding takes priority over local FRAUD_SERVICE_URL. Local npm start and Compose keep their existing loopback/private-host configuration.

The caller still sends Authorization: Bearer SERVICE_TOKEN. FastAPI authenticates that token before reading a request body. It has no public rewrite. A public /internal/* request enters banking and receives its existing 404 response. All /api/* paths retain their existing prefixes, and browser requests remain on the same origin.

## Environment variables

Configure these privately in the Vercel project before running the services:

| Variable | Value |
| --- | --- |
| DATABASE_URL | Restricted greenlink_app Neon pooled PostgreSQL URL with TLS verification |
| AUTH_ENCRYPTION_KEY | Existing persistent 64-character hexadecimal MFA encryption key; do not rotate casually |
| SERVICE_TOKEN | Persistent 24-512 character token, identical for banking and fraud |
| OPENAI_API_KEY | Your server-side OpenAI API key |
| OPENAI_MODEL | Your configured supported OpenAI model |
| PUBLIC_ORIGIN | Exact HTTPS app origin for the environment, for example https://your-project.vercel.app |
| CRON_SECRET | Separate random 32-512 character token protecting /api/jobs/run |

Use letters, digits and . _ ~ - in SERVICE_TOKEN and CRON_SECRET. Do not set migration/owner PostgreSQL credentials on the hosted runtime. Run migrations and permission setup separately before deployment. Startup verifies installed migrations with the restricted login and never seeds demo users automatically.

Without PUBLIC_ORIGIN, the adapter uses Vercel's environment-provided production domain, or the deployment URL for previews. Set PUBLIC_ORIGIN explicitly for a custom domain and keep preview configuration separate from production. Local development uses an HTTP localhost origin. Runtime startup requires the private binding; builds do not connect to Neon or the scoring service.

The PostgreSQL pool is reused across concurrent requests, limited to five connections per instance and attached to Vercel's official lifecycle helper. The adapter uses Vercel's platform client IP header only in hosted Vercel requests; local execution keeps Express socket addresses. Existing password, role, CSRF, session and transaction controls apply.

## When the hosted website returns 503

If Runtime Logs report an unavailable createApplication export inside a circular dependency, deploy the current entrypoint layout: app.js and deploy/vercel.js share application.js rather than importing one another. Include application.js in source packages and the banking container.

The hosted error response intentionally stays generic. Runtime Logs now include a fixed diagnostic code and guidance without printing environment values, driver messages, stack traces or connection URLs:

| Log code | Action |
| --- | --- |
| CONFIGURATION_DATABASE_URL | Set the restricted Neon runtime DATABASE_URL in the correct Vercel environment. |
| CONFIGURATION_AUTH_ENCRYPTION_KEY | Copy the existing persistent MFA encryption key from the private local configuration. |
| CONFIGURATION_SERVICE_TOKEN | Configure the same service token for banking and fraud. |
| CONFIGURATION_FRAUD_SERVICE_BINDING_URL | Check the banking-to-fraud binding in vercel.json; do not manually supply its injected URL. |
| CONFIGURATION_PUBLIC_ORIGIN | Use the exact HTTPS website origin, without a path, or unset it to use Vercel's domain fallback. Do not copy the localhost origin into production. |
| 28P01 / 28000 | Verify the restricted database login and password privately. |
| 42501 | Apply the documented runtime-role grants using the separate migration credentials. |
| MIGRATION_REQUIRED / 42P01 | Apply migrations before deploying, using the migration role outside the hosted function. |
| MIGRATION_CHANGED | Restore migration files matching the checksums already installed in the database. |
| ENOENT | Check function bundling of the SQL migrations and views. |
| BANKING_STARTUP_FAILED | Investigate application initialization or the hosted job; unexpected private errors remain redacted. |

Configure variables under the Vercel project's Settings ? Environment Variables, select the appropriate Production or Preview environment, and redeploy after changes. Private .env files are excluded from Git and deployments; cloning or importing the repository does not upload their values. Check /health and /login on the new deployment before testing login. Sharing the diagnostic code is sufficient; do not share private configuration values.

## Free-plan scheduled jobs

The Hobby-compatible cron is GET /api/jobs/run at 00:00 UTC, or 08:00 Asia/Singapore, daily. Hobby timing can fall anywhere in that hour. Vercel cron runs on production deployments, and automatically supplies the bearer token from CRON_SECRET. The endpoint rejects a missing or incorrect token, duplicate authorization headers and methods other than GET.

The endpoint awaits scheduled-payment processing, background fraud scanning and notification-outbox delivery before completing. Hosted functions do not start an in-memory timer. Existing database leases and request identities continue to prevent duplicate financial settlement. Work is bounded per invocation; remaining and retrying instructions wait for the next invocation. With the free daily schedule, jobs are not minute-accurate and retry/backlog handling can be delayed until the following day. Use a more frequent authenticated external scheduler or a suitable paid cron plan if needed.

## Local verification

Install Node.js dependencies with npm ci and Python dependencies with python -m pip install -r requirements.txt (normally inside .venv). Configure the existing ignored .env for Neon, persistent secrets and OpenAI.

Run the services together with **vercel dev --local** (or **vercel dev** for a linked project). The local flag runs without a Vercel login. Vercel injects the same binding variable locally. npm start remains the standalone launcher. Set PUBLIC_ORIGIN to match the local listening origin if choosing a different port.

Run npm run test:vercel for asset and routing verification. Use npm run test:vercel:neon to verify the current synthetic Neon staff login, dashboard and private fraud-model binding, or node scripts/verify-vercel.js --native for native synthetic credentials. Set VERCEL_TEST_ORIGIN to an HTTP loopback origin if using a different port; the verifier refuses remote origins. It never prints credentials or authorizes a job invocation, so it does not execute due payments. The configured database and selected credential fixture must match.

Check /login, /health and /api/session; /api/dashboard requires a signed-in session. The verifier compares every public asset byte-for-byte, checks backend-source URLs using GET and HEAD, verifies job authentication and refuses a missing Host header. Run /api/jobs/run with CRON_SECRET only when intending to execute due schedules; vercel dev does not automatically run cron schedules.

Run npm run build, npm test, npm run test:python and npm run test:browser for application validation. Deployment requires a Vercel project and its private environment configuration; local tests alone do not prove a cloud deployment works.

## Verified results on 30 October 2026

- npm run build: passed; 95 JavaScript source files checked.
- npm test: 211 passed, 0 failed, 0 skipped, using isolated schemas in the local PostgreSQL test database.
- npm run test:python: 21 passed.
- npm run test:vercel:neon: 60 HTTP checks passed, including all 19 public assets, source privacy, missing-host rejection, synthetic staff login and the authenticated private fraud-model binding.
- Headless browser through vercel dev: customer login, dashboard rendering, frontend modules and logout passed without JavaScript, unexpected network or CSP errors.

The hosted client-IP regression also verifies the Node-to-Web Headers conversion required by the pinned Vercel helper and confirms that local forwarded headers remain untrusted. The Vercel configuration was accepted by CLI 65.7.0 and both services ran together locally. These checks validate the local Vercel runtime. Verify the cloud deployment separately after setting its private environment variables.

The startup regression suite includes the default hosted factory against PostgreSQL, acyclic entrypoint imports, private source isolation and safe configuration/driver diagnostics. The first full test run had one concurrent TOTP login failure; its isolated 10-test suite and the subsequent full 211-test run passed. Concurrency assertions now include safe error types and codes to make any recurrence diagnosable. The intermittent first-run failure was not reproduced.

## Files and delivery

.vercelignore excludes all data, including the shared demo login folder, private environment files, local PostgreSQL storage, backups, dependencies, logs, test artifacts and source release archives from uploads. Tests remain in Git and run in CI; they are not runtime services. The source ZIP includes vercel.json, .vercelignore and the adapter, and continues to exclude data and credentials.

The service names, public routing and binding are confirmed. Import this repository as one Vercel project with its root at this directory. Keep service build/runtime settings inside their service objects rather than setting a top-level framework or build command.

References: [Vercel services](https://vercel.com/docs/services), [bindings](https://vercel.com/docs/services/bindings), [service configuration](https://vercel.com/docs/services/config-reference), [Express](https://vercel.com/docs/frameworks/backend/express), [FastAPI](https://vercel.com/docs/frameworks/backend/fastapi), [Hobby cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [PostgreSQL pooling](https://vercel.com/guides/connection-pooling-with-functions).
