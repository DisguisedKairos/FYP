# Local installation and migration

Required: Node.js 22.13+, PostgreSQL 16+ and Python 3.11+ with a virtual environment. The application uses Express and `pg`; run `npm ci`. Create `.venv` and install `requirements.txt` using its interpreter. The local launcher discovers `.venv`, or accepts `PYTHON` as an executable path.

Run `npm run setup` once. It preserves existing configuration and generates missing private service/encryption keys. Edit `.env` with a PostgreSQL `DATABASE_URL`; do not place real values in `.env.example`. `PUBLIC_ORIGIN` is the exact browser origin, including scheme and port. An HTTPS origin enables Secure cookies. Local HTTP uses ordinary HttpOnly/SameSite cookies. Direct use does not require proxy trust.

Run `npm run db:migrate`, optionally `npm run db:seed`, then `npm start`. There is no SQLite runtime fallback. Startup requires the configured PostgreSQL server, usable secrets and a healthy authenticated Python scorer. The scorer binds to loopback by default. Scheduled payments and outbox delivery run inside the banking process with persistent PostgreSQL leases and records. An external email/SMS sender is not included; notifications are in-app.

## Migration from the previous SQLite application

Stop the previous application before importing its store. Leave the source and its WAL/SHM files together so SQLite can read a consistent view. Select an empty PostgreSQL database in `.env`, run migrations, then:

```sh
npm run db:import-sqlite -- --source data/banking.sqlite --confirm-empty-target
```

Optional `--with-adjacent-stores` imports compatible notification and historical fraud information found beside the source. Historical model responses are archives, never current reusable authorization assessments. The importer opens SQLite read-only, validates all records before commit, and preserves IDs, balances, password hashes and valid historical requests. It records an explicit verified opening balance; it rejects a negative baseline, invalid money chronology or unexplained drift. All writes are one PostgreSQL transaction. An unrelated populated target is refused. Repeating the same completed import is a no-op. Sessions are intentionally discarded and users sign in again.

Do not run demo seeding before an import. Imported identities, passwords and roles are preserved; demo credentials are available only in a separately seeded empty database. The sign-in page advertises the sample login only when its original seeded identity is available. If the imported database has no administrator, use the explicit local operator command below for the intended existing user. Never substitute a customer database for test fixtures. The old store remains available as reference; the new application accesses only PostgreSQL.

## Administration and secrets

For a separate bank operations login, set a private strong `GREENLINK_STAFF_PASSWORD` environment variable and run `npm run admin:create -- --email operator@example.com --name "Bank Operations"`. The script creates staff access without a business or deposit account, refuses existing emails, hashes the password and records an operator audit event. The password is never accepted as a command-line argument or printed. Clear the temporary password environment variable afterwards. Do not use public demo passwords outside sample data.

Imported business operators can sign in with their existing credentials, open **Business profile**, submit registered entity details and await an independent staff decision in **Business onboarding**. Pending or missing business identity blocks financial changes and receiving funds. Existing balances/history remain readable. An old standing schedule waits for approval instead of losing its due occurrence. No existing customer is automatically promoted to staff.

Registration always creates `customer`. Grant an existing user's administrator role locally with `npm run admin:grant -- --email registered@example.com`. Role changes invalidate sessions and create an audit event. Do not expose this script through a customer API.

`SERVICE_TOKEN` protects private scoring calls; both processes receive the same value. `AUTH_ENCRYPTION_KEY` is 64 hexadecimal characters and encrypts authenticator secrets with AES-256-GCM and a user binding. Keep it stable and privately recoverable; changing or losing it prevents verification of existing authenticator codes. Never commit `.env`, test credentials, raw tokens, recovery codes or database files. The release builder excludes them.

DIT handles deployment credentials, network access, certificates and cloud database operations. Application integration needs `DATABASE_URL`, the scoring address/token, stable encryption key, exact public origin and narrowly trusted proxy addresses. An arbitrary client-supplied `X-Forwarded-For` does not become authoritative by default.

## Testing

Set `TEST_DATABASE_URL` to a separate database. The tests use unique `dft_...` schemas with local search paths, run migrations, and drop only their own schema after verification. `npm test` does not implicitly read `.env`; invoke `node --env-file=.env --test tests/dft-*.test.js` or export the variable in your shell. Python tests need `tests_python/requirements.txt` installed. Browser tests similarly need the variable plus an installed Chrome/Edge. Screenshots, downloads and test logs go to ignored `test-results/`.
