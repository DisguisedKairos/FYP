# Local installation and migration

Required: Node.js 22.13+, PostgreSQL 16+, Python 3.11+ with a virtual environment, and an OpenAI API key. The application uses Express and `pg`; run `npm ci`. Create `.venv` and install `requirements.txt` using its interpreter. The local launcher discovers `.venv`, or accepts `PYTHON` as an executable path.

For Windows PowerShell, install Python dependencies from the project root using the project interpreter:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -c "import fastapi, uvicorn; print('FastAPI and Uvicorn ready')"
```

Create `.venv` only if it does not exist. On macOS/Linux, use `python3 -m venv .venv` and `.venv/bin/python -m pip install -r requirements.txt`. Activating the environment is optional when its interpreter is used explicitly. Both `npm start` and `npm run start:fraud` select `.venv` automatically; an explicit `PYTHON` setting overrides that choice. If you see `No module named fastapi`, install the requirements using the same interpreter that starts the service. `npm ci` installs Node dependencies only.

Run `npm run setup` once. It preserves existing configuration and generates missing private service/encryption keys. Follow the [database guide](database.md): start PostgreSQL, copy `database/admin.env.example` to ignored `.env.database-admin`, set the administrator maintenance URL, then run `npm run db:setup` and `npm run db:check`. Setup preserves existing Green Link Digital Bank data and saves a restricted `DATABASE_URL` in `.env`; do not place real values in examples. `PUBLIC_ORIGIN` is the exact browser origin, including scheme and port. An HTTPS origin enables Secure cookies. Local HTTP uses ordinary HttpOnly/SameSite cookies. Direct use does not require proxy trust.

Configure `OPENAI_MODEL=gpt-6-luna` and a private `OPENAI_API_KEY` in `.env`. Run `npm run ai:check` to check model access, then `npm start`. No model installation or download is required. Chat and permitted banking evidence are sent to OpenAI; the fraud prompt uses limited historical aggregates without customer/account identifiers. See [OpenAI setup and guardrails](openai.md). Failed inference never moves funds or substitutes a preset score.

Optionally seed a new empty demo database with `npm run db:seed`, then `npm start`. Existing data needs no seed. Future migrations use `npm run db:migrate`, which loads migration credentials only for that command. Startup requires the configured PostgreSQL server, usable secrets and a healthy authenticated Python validation gateway. The scorer binds to loopback by default and receives no database or MFA encryption credentials. Scheduled payments and outbox delivery run inside the banking process with persistent PostgreSQL leases and records. An external email/SMS sender is not included; notifications are in-app.

## Existing PostgreSQL records

The previous database import is complete. The old stores, importer, retired services and prototype source have been removed. Import provenance remains in PostgreSQL for auditability, and applied SQL migrations remain checksum-protected. A verified pre-cleanup PostgreSQL dump is retained privately under `data/backups/`; this is separate from the active `data/postgresql` cluster.

Migration 006 corrects the old domain only for known project demo identities whose names and account numbers match. It refuses an email collision, preserves credential hashes and financial records, records the change and revokes affected sessions. Existing operators use their current passwords with the `@greenlink.demo` email. A new empty seeded database uses the documented sample credentials; cleanup never resets an existing password or assigns staff access.

Use `npm run db:check` for restricted-role and balance reconciliation checks. Do not seed an already populated database. The sign-in page advertises a sample login only when its original seeded identity is available. Never substitute customer data for test fixtures.

## Administration and secrets

For a separate bank operations login, set a private strong `GREENLINK_STAFF_PASSWORD` environment variable and run `npm run admin:create -- --email operator@example.com --name "Bank Operations"`. The script creates staff access without a business or deposit account, refuses existing emails, hashes the password and records an operator audit event. The password is never accepted as a command-line argument or printed. Clear the temporary password environment variable afterwards. Do not use public demo passwords outside sample data.

Imported business operators can sign in with their existing credentials, open **Business profile**, submit registered entity details and await an independent staff decision in **Business onboarding**. Pending or missing business identity blocks financial changes and receiving funds. Existing balances/history remain readable. An old standing schedule waits for approval instead of losing its due occurrence. No existing customer is automatically promoted to staff.

Registration always creates `customer`. Grant an existing user's administrator role locally with `npm run admin:grant -- --email registered@example.com`. Role changes invalidate sessions and create an audit event. Do not expose this script through a customer API.

`SERVICE_TOKEN` protects private scoring calls; both processes receive the same value. `AUTH_ENCRYPTION_KEY` is 64 hexadecimal characters and encrypts authenticator secrets with AES-256-GCM and a user binding. Keep it stable and privately recoverable; changing or losing it prevents verification of existing authenticator codes. Never commit `.env`, test credentials, raw tokens, recovery codes or database files. The release builder excludes them.

DIT handles deployment credentials, network access, certificates and cloud database operations. Application integration needs `DATABASE_URL`, the scoring address/token, stable encryption key, exact public origin and narrowly trusted proxy addresses. An arbitrary client-supplied `X-Forwarded-For` does not become authoritative by default.

## Testing

Set `TEST_DATABASE_URL` in ignored `.env.test` to a separate local database. Most tests use unique `dft_...` schemas, run migrations, and drop only their own schema. Provisioning tests additionally create/drop uniquely named disposable databases and roles; use a local test operator with those privileges. `npm test` and `npm run test:browser` load `.env.test`, never the bootstrap secrets file. Python tests need `tests_python/requirements.txt` installed. Browser tests need an installed Chrome/Edge. Screenshots, downloads and logs go to ignored `test-results/`.

## Source cleanup

The banking server imports the PostgreSQL adapter directly from database/index.js; the old root db.js forwarding file has been removed, and container/package inputs follow the same structure. Canonical browser pages are /scheduled-payments and /fraud-monitoring. Statements open from Activity; obsolete /schedules, /fraud and /statements page aliases return 404. The /api/statements endpoint remains active. SQL migrations, import provenance, retained audit evidence, private configuration and the active PostgreSQL data remain required.
