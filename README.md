# Green Link Digital Bank — DFT application

Republic Polytechnic C300 FYP prototype based on **Green Link Digital Bank (GLDB)**. The interface uses the bank's official blue/orange identity and locally served logos. See [branding sources and coverage](docs/branding.md). Screens and statements identify the application as a student project using sample funds.

C300 Final Year Project: **digital wholesale banking for registered businesses and institutions**, using Node.js 22.13+, Express 5, PostgreSQL 16+ and Python 3.11+ FastAPI. People sign in as authorized business operators or bank staff; the registered business is the account holder. The browser uses JavaScript, HTML and CSS. Deployment pipelines, Docker, Terraform and cloud provisioning remain outside this DFT package.

Registration collects business details and submits them for independent bank review. Account changes and payments require approval. This version supports one primary operator per business; team membership and corporate payment mandates are future work. See [wholesale banking scope](docs/wholesale-banking.md).

## Run locally

Install PostgreSQL, Node.js and Python. Then:

```sh
npm ci
python -m venv .venv
```

Install Python dependencies using `.venv\Scripts\python -m pip install -r requirements.txt` on Windows, or `.venv/bin/python -m pip install -r requirements.txt` on macOS/Linux.

```sh
npm run setup
```

Keep the generated `SERVICE_TOKEN` and `AUTH_ENCRYPTION_KEY` private in `.env`. Use the exact `PUBLIC_ORIGIN` you open in your browser, normally `http://localhost:3000`. Start your PostgreSQL server, copy `database/admin.env.example` to ignored `.env.database-admin` and set its administrator connection URL. Database setup creates the database, migrations and separate restricted runtime/migration logins. See the [database guide](docs/database.md) for local server initialization, pgAdmin and the full data model.

```sh
npm run db:setup
npm run db:check
npm run db:seed
npm start
```

Open **http://localhost:3000**. Startup launches the private Python scoring service and the Express banking application. PostgreSQL must already be running. On this machine, `npm run db:start` starts the project-owned server at `127.0.0.1:55432`; its existing `greenlink_dft` database is ready and needs no seeding. Stop the application with Ctrl+C. Demo seeding is explicit and only inserts into an empty customer database. Future schema changes use `npm run db:migrate` with the separately saved migration credentials.

| Demo identity | Email | Password | Purpose |
| --- | --- | --- | --- |
| Alex Morgan | `alex@greenlink.demo` | `Greenlink123!` | Meridian Logistics: funded business accounts; broad demo administrator access |
| Sam Rivera | `reviewer@greenlink.demo` | `Greenlink123!` | Independent bank onboarding/fraud reviewer for demo workflows |
| Jamie Lee | `jamie@greenlink.demo` | `Greenlink123!` | Harbour Supplies: recipient business account `1020002001` |

New registrations receive a pending business application, one zero-balance business savings record and the business operator role (internal value `customer`). They cannot send/receive funds or change accounts before bank approval. Dedicated staff accounts can be created with the local `admin:create` command; see the installation guide. Demo money and bill payments are simulations with no external payment provider.

## Banking and security

- Business profiles, independent onboarding review and approved-business payment restrictions.
- Business savings creation, renaming and safe closure; company dashboard and balance enquiry.
- Password-authorized internal transfers and bills with integer cents, database row locks, atomic ledger entries and mandatory idempotency keys.
- One-time, weekly and monthly schedules with durable execution records, recovery after interruption and bounded transient retries.
- Searchable transaction history, filtered CSV downloads and reconciled account statements that can be printed or saved as PDF.
- Durable notification outbox, in-app alerts, independent review and versioned fraud-rule audit history.
- Salted scrypt password hashes, hashed session tokens, login throttling, ownership checks, role checks, CSRF/origin controls, password changes and session revocation.
- Optional authenticator verification with encrypted secrets, replay prevention and one-use recovery codes, available through Profile & security.
- Private assistant for owned balances/history, explanations and payment drafts. It never executes a payment or sends a conversation to an external AI provider.

Every new payment is screened by the Python model and current deterministic rules. High-risk requests are held or rejected without debiting funds; an independent administrator must authorize an approval. Unavailable or malformed scoring fails closed. The model is a reproducible **synthetic-data baseline**, not evidence of real-world fraud detection performance. See [model documentation](docs/fraud-model.md).

## Existing data

All retained banking records are in PostgreSQL. Retired application sources, non-PostgreSQL database files and their import command have been removed. A verified PostgreSQL backup taken before cleanup is stored privately under `data/backups/`.

Migration 006 renames only the known project demo logins to `alex@greenlink.demo`, `jamie@greenlink.demo` and, if present, `reviewer@greenlink.demo`. It preserves passwords, customer IDs, roles, balances and transaction history, records an audit event and revokes affected sessions. Existing operators sign in again using their current passwords and the corrected email. Freshly seeded demo passwords in the table above apply only to newly seeded data.

Operators without a business profile must submit one and obtain bank approval before financial writes resume. See [installation and data maintenance](docs/installation.md).

## Verification and package

Run `npm run demo:fraud` for real Python/Express/PostgreSQL fraud scenarios with a printable evidence report, or `npm run demo:fraud:serve` to inspect the resulting rules, audit and pending reviews in a separate banking app at `http://127.0.0.1:3001`. The script uses a newly created disposable database and verifies the existing application's financial data is unchanged. See [fraud simulation and presentation steps](docs/fraud-simulation.md).

Put `TEST_DATABASE_URL` in ignored `.env.test`, pointing to a separate local PostgreSQL test/maintenance database. Most tests create/drop unique schemas; provisioning tests additionally create/drop uniquely named disposable databases and roles and require local database/role creation privileges. Test and operator credentials are never loaded by `npm start`.

```sh
npm test
npm run test:browser
```

Run Python tests with the virtual environment interpreter: `python -m unittest discover -s tests_python -v` (install `tests_python/requirements.txt` for test dependencies). `PYTHON` may select that interpreter for the launcher or platform smoke test. Run `node --env-file=.env --env-file=.env.test scripts/platform-smoke.js` for an actual Express/PostgreSQL/FastAPI integration check. Browser checks need Chrome, Chromium or Edge; `CHROME_PATH` can select it. PostgreSQL-dependent tests explicitly skip when `TEST_DATABASE_URL` is missing; such a run does not validate financial persistence.

```sh
npm run package
npm run package:verify
```

The source archive includes a locked npm dependency manifest, Python requirements, migrations, application sources and DFT tests. Credentials, databases, dependency installations, older prototypes and infrastructure files are excluded. Build from a clean committed checkout; use the builder's documented dirty-tree override only for local review.

## Project map

```text
app.js                  Express HTTP routes and application lifecycle
db.js                   Canonical PostgreSQL adapter entry point
banking/                Auth, ledger, risk, history, assistant, schedules and outbox
database/               PostgreSQL provisioning, permissions, checks and migrations
main.py, fraud_service/ FastAPI model assessment service
public/, views/         Browser application
scripts/                Local setup, seed/import/admin, model training and packaging
tests/, tests_python/   DFT functional/security tests and browser checks
docs/                   Requirements, API, controls and scope evidence
```

[Wholesale scope](docs/wholesale-banking.md) · [DFT security](docs/dft-scope.md) · [Requirements](docs/requirements.md) · [Architecture](docs/architecture.md) · [API](docs/api.md) · [Financial controls](docs/financial-controls.md) · [Verification record](docs/verification.md)

The checkout contains the active Express/PostgreSQL/FastAPI application and its tests. DIT owns infrastructure delivery, TLS termination, networks and cloud database operations. DFT supplies environment-variable, health and private scoring contracts for that integration; shared secrets must be injected privately by the operator.
