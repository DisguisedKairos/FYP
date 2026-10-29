# Neon PostgreSQL


The project is linked to Neon project greenlink-dft (dry-glitter-49989056), organization org-tiny-cherry-21597265, branch production. PostgreSQL is the only declared Neon service. The database is neondb. Express and the private Python gateway still run locally; AI uses the configured OpenAI provider. No public website or external AI provider is provisioned by this setup.

## Connect and start

~~~sh
npm i -g neon@latest
neon login
neon init -y --agent codex --org-id org-tiny-cherry-21597265 --project-id dry-glitter-49989056 --branch production --services postgres
neon deploy
npm run db:setup:neon
npm run db:check
npm run build
npm start
~~~

If global installation is unavailable, use npx neon@latest in place of neon. Complete browser authentication when prompted. The explicit Codex agent selection avoids requiring an unrelated GitHub Copilot CLI installation.

neon deploy applies neon.ts and pulls PostgreSQL connection variables into the existing ignored .env file. Run db:setup:neon after that pull and before starting the banking app: CLI-pulled URLs initially belong to the bootstrap owner, while the application must use its restricted SQL login.

The app serves plain JavaScript, HTML and CSS directly, so npm run build validates the JavaScript source instead of producing a compiled frontend directory. Python tests use the project virtual environment automatically, with PYTHON available as an explicit override.

## Driver and financial permissions

The existing pg connection pool remains the driver. This long-running Express application uses interactive PostgreSQL transactions and row locks; replacing it with a one-shot HTTP query driver would not suit those workflows.

| Configuration | Purpose |
| --- | --- |
| .env: DATABASE_URL | Pooled Neon connection as restricted greenlink_app |
| .env: DATABASE_URL_UNPOOLED | Direct connection with the same restricted application role |
| .env.database-admin: MIGRATION_DATABASE_URL | Direct greenlink_owner connection for migrations and operator commands |
| .env.database-admin: ADMIN_DATABASE_URL | Direct Neon bootstrap owner, used only for setup |
| .neon | Ignored project/branch selection written by the CLI |
| neon.ts | PostgreSQL-only service configuration; no secrets |

Setup creates the application and migration roles with SQL rather than the Neon role API, so they do not inherit neon_superuser. The bootstrap owner retains ownership of the managed database. The migration role owns the application schema and its objects. Public access is revoked, and the application receives the same column-level financial restrictions as the native database. TLS uses sslmode=verify-full.

Setup saves new role credentials before database changes so an interrupted run can resume. Repeated setup reuses credentials for the same endpoint/database and refuses unknown or elevated existing roles. It does not overwrite unrelated tables, reset logins or reseed banking data. Runtime child processes do not inherit Neon API keys or the direct bootstrap URL.

## Synthetic test accounts

For this FYP demonstration, prepare new synthetic users and banking examples explicitly after the app is running:

~~~sh
npm run test:accounts:neon
npm run test:accounts:otp:neon
~~~

The account command uses the real configured AI scoring gateway and verifies login, independent authorization, customer isolation, MFA and assistant evidence. It requires a loopback application origin and matching Neon migration/runtime endpoints. Credentials and recovery codes are saved separately under data/testing/neon/. The selected synthetic test login files are shared in Git; remove or rotate demo accounts before public deployment. Database connection credentials and API keys remain private. Open data/testing/neon/FEATURE-TESTING.md for passwords and the complete walkthrough. Reruns retain changed passwords, MFA, balances and review decisions.

These are newly generated test identities. Existing local users, passwords and transactions were not uploaded. The original native PostgreSQL database remains on 127.0.0.1:55432. A private pre-setup database dump and environment copies are retained under data/backups/neon-setup-2026-10-29T05-21-25-748Z/. Keep native and Neon credential guides separate.

## Verification

~~~sh
npm run build
npm run db:check
npm run test:neon
npm test
npm run test:python
npm run test:browser
~~~

test:neon creates a uniquely named temporary schema over the direct migration connection, runs the existing real Express/FastAPI integration workflows, then removes only that schema. Production customer records are excluded. With configured model credentials, the workflow uses real inference; when unavailable it checks explicit failure without a replacement model. db:check separately verifies the actual runtime role, all tables/migrations and ledger reconciliation.

A temporary Neon branch is used to validate setup before production changes, then removed after verification. Native tests continue to use the separate TEST_DATABASE_URL in .env.test and do not target Neon production.

The free database plan has storage and compute allowances. The running banking worker polls PostgreSQL, so keeping this app running also keeps the database active. Stop the app when a demonstration is finished if you want Neon to suspend when idle.

## Verification records

Use npm run build, npm test, npm run test:python and npm run test:browser for functional/security checks. npm run test:neon exercises the real configured OpenAI provider against a disposable Neon schema. It preserves production banking records. Original native PostgreSQL data and private backups remain separate from Neon.
