# Greenlink Digital Bank — DFT application

C300 Final Year Project: banking features and financial security using **Node.js 22.13+, Express 5, PostgreSQL 16+ and Python 3.11+ FastAPI**. The browser uses JavaScript, HTML and CSS. This version focuses on DFT responsibilities; deployment pipelines, Docker, Terraform and cloud provisioning have been removed from the active application and release package.

## Run locally

Install PostgreSQL and create an empty database for this project. Then:

```sh
npm ci
python -m venv .venv
```

Install Python dependencies using `.venv\Scripts\python -m pip install -r requirements.txt` on Windows, or `.venv/bin/python -m pip install -r requirements.txt` on macOS/Linux.

```sh
npm run setup
```

Edit the generated, ignored `.env`: set `DATABASE_URL` to your PostgreSQL connection string and keep the generated `SERVICE_TOKEN` and `AUTH_ENCRYPTION_KEY` private. Use the exact `PUBLIC_ORIGIN` you open in your browser, normally `http://localhost:3000`.

```sh
npm run db:migrate
npm run db:seed
npm start
```

Open **http://localhost:3000**. Startup launches the private Python scoring service and the Express banking application. PostgreSQL must already be running. Stop the application with Ctrl+C. Demo seeding is explicit and only inserts into an empty customer database.

| Demo identity | Email | Password | Purpose |
| --- | --- | --- | --- |
| Alex Morgan | `alex@greenlink.demo` | `Greenlink123!` | Funded savings account and administrator |
| Sam Patel | `reviewer@greenlink.demo` | `Greenlink123!` | Independent fraud reviewer |
| Jamie Lee | `jamie@greenlink.demo` | `Greenlink123!` | Recipient account `1020002001` |

New registrations receive one zero-balance savings account and the customer role. Demo money and bill payments are project simulations; no external payment provider is connected.

## Banking and security

- Savings account creation, renaming and safe closure; dashboard and balance enquiry.
- Password-authorized internal transfers and bills with integer cents, database row locks, atomic ledger entries and mandatory idempotency keys.
- One-time, weekly and monthly schedules with durable execution records, recovery after interruption and bounded transient retries.
- Searchable transaction history, filtered CSV downloads and reconciled account statements that can be printed or saved as PDF.
- Durable notification outbox, in-app alerts, independent review and versioned fraud-rule audit history.
- Salted scrypt password hashes, hashed session tokens, login throttling, ownership checks, role checks, CSRF/origin controls, password changes and session revocation.
- Optional authenticator verification with encrypted secrets, replay prevention and one-use recovery codes, available through Profile & security.
- Private assistant for owned balances/history, explanations and payment drafts. It never executes a payment or sends a conversation to an external AI provider.

Every new payment is screened by the Python model and current deterministic rules. High-risk requests are held or rejected without debiting funds; an independent administrator must authorize an approval. Unavailable or malformed scoring fails closed. The model is a reproducible **synthetic-data baseline**, not evidence of real-world fraud detection performance. See [model documentation](docs/fraud-model.md).

## Existing data

The original `data/banking.sqlite` is retained. It is **not** the new runtime database. Import into an empty PostgreSQL target before seeding:

```sh
npm run db:import-sqlite -- --source data/banking.sqlite --confirm-empty-target
```

The importer reads the source without modifying it, validates balances and chronology, preserves valid customer IDs/password hashes/history, and discards old sessions. It refuses an unrelated populated target. See [installation and migration](docs/installation.md).

## Verification and package

Point `TEST_DATABASE_URL` to a separate local PostgreSQL database whose owner can create/drop test schemas. Tests create unique schemas and remove only those schemas.

```sh
node --env-file=.env --test tests/dft-*.test.js
node --env-file=.env --test tests/browser.e2e.js tests/dft-security-browser.js
```

Run Python tests with the virtual environment interpreter: `python -m unittest discover -s tests_python -v` (install `tests_python/requirements.txt` for test dependencies). `PYTHON` may select that interpreter for the launcher or platform smoke test. Run `node --env-file=.env scripts/platform-smoke.js` for an actual Express/PostgreSQL/FastAPI integration check. Browser checks need Chrome, Chromium or Edge; `CHROME_PATH` can select it. PostgreSQL-dependent tests explicitly skip when `TEST_DATABASE_URL` is missing; such a run does not validate financial persistence.

```sh
npm run package
npm run package:verify
```

The source archive includes a locked npm dependency manifest, Python requirements, migrations, application sources and DFT tests. Credentials, databases, dependency installations, older prototypes and infrastructure files are excluded. Build from a clean committed checkout; use the builder's documented dirty-tree override only for local review.

## Project map

```text
app.js                  Express HTTP routes and application lifecycle
banking/                Auth, ledger, risk, history, assistant, schedules and outbox
database/               PostgreSQL pool, transactions and versioned migrations
main.py, fraud_service/ FastAPI model assessment service
public/, views/         Browser application
scripts/                Local setup, seed/import/admin, model training and packaging
tests/, tests_python/   DFT functional/security tests and browser checks
docs/                   Requirements, API, controls and scope evidence
```

[DFT scope and security evidence](docs/dft-scope.md) · [Requirements](docs/requirements.md) · [Architecture](docs/architecture.md) · [API](docs/api.md) · [Financial controls](docs/financial-controls.md) · [Verification record](docs/verification.md)

Earlier implementations under `legacy/` and `evergreen-site/` remain reference material only and are excluded from the release. DIT owns infrastructure delivery, TLS termination, networks and cloud database operations. DFT supplies environment-variable, health and private scoring contracts for that integration; shared secrets must be injected privately by the operator.
