# Green Link Digital Bank - C300 FYP

**AI-Enabled Cloud-Native Digital Banking Platform | Version 2.8.0**

Republic Polytechnic C300 Final Year Project based on **Green Link Digital Bank (GLDB)**, a digital wholesale bank. The application serves registered businesses and institutions through authorized business operators and bank staff. Screens and statements identify it as a student project using sample funds. See [branding sources](docs/branding.md) and [wholesale banking scope](docs/wholesale-banking.md).

The stack is **Node.js, Express, PostgreSQL, Python FastAPI, JavaScript, HTML and CSS**. The repository includes a private fraud scorer, functional/security tests, Docker Compose and a GitHub Actions verification/container-delivery pipeline.

## Implemented features

| Area | Features |
| --- | --- |
| Accounts | Business registration, independent onboarding review, savings creation/renaming/closure, dashboard and balance enquiry |
| Transactions | Password-authorized internal transfers, simulated bill payments, one-time/weekly/monthly schedules and independent review |
| Customer experience | Transaction history/search, filtered CSV exports, printable/PDF statements and private assistant |
| Operations | Durable in-app notifications, fraud monitoring, versioned rule management and audit history |
| Application security | Salted scrypt hashes, role/ownership checks, CSRF/origin guards, durable throttling, session revocation, password changes, optional TOTP and recovery codes |
| Financial controls | Integer cents, row locking, atomic settlement, mandatory request keys, replay protection and reconciled statements |
| Fraud scoring | Real private Python inference, transaction-history features, scores/explanations and current deterministic guardrails |

There are two permission roles: **`customer`** (authorized business operator) and **`admin`** (administrator). Registration creates a customer with a pending business application and a zero-balance savings record. Bank approval is required for account changes and sending/receiving payments. Each business currently has one primary operator.

High-risk instructions are held or rejected without a debit; an independent administrator must authorize an approval. Scoring failures fail closed. The AI model is a reproducible **synthetic-data baseline**, not validated production fraud detection. The private assistant reads owned data and prepares form drafts; payments use the ordinary authorization flow. See [financial controls](docs/financial-controls.md) and [model documentation](docs/fraud-model.md).

## AI evaluation and reliability (2.8.0)

Staff **Fraud monitoring** now includes threshold comparisons, confusion counts, calibration diagnostics, a separate chronological synthetic experiment and recent feature-distribution monitoring. The approved fraud model and live thresholds are unchanged. Run `npm run evaluate:fraud`; a timestamped labelled private CSV can also be evaluated locally.

Assistant answers now cite saved tool evidence and expose a link to inspect it. Additional checks withhold misleading interpretations, require relevant tools for recognised questions and prevent a model from inventing draft amounts or recipients. Run `npm run evaluate:assistant` for the controlled adversarial suite. See [evaluation methods, demonstrations and limits](docs/ai-evaluation.md).

Verification covers Node functional/security tests, eight browser workflows, 18 Python tests and real Express/PostgreSQL/FastAPI integration. The model remains a synthetic educational baseline; evaluation does not establish live banking fraud performance.

## Maintenance release 2.7.1

Fixes exact assistant amount parsing, source selection, Singapore schedule times, draft task switching, persistent analysis-form values and assistant mode controls. Optional AI wording failures retain verified evidence, and migration locks are scoped to the target schema. Verification: 116 Node tests, seven browser workflows, 18 Python tests, real process integration and zero npm advisories.

The local Python runtime now uses `.venv`; obsolete tooling, the stopped old cluster, caches and extracted packages were removed. Native PostgreSQL data, backups, test logins and required runtimes remain intact. Historical staff credentials are preserved privately in `data/testing/bank-operations-login.txt`. Current evidence remains under ignored `test-results/`; credential files there are explicitly preserved.

## Banking agents and insights

Version 2.7.0 adds fraud investigation, a multi-step banking assistant, liquidity planning, historical fraud-rule simulation and reconciliation investigation. Open **http://localhost:3000/banking-insights**. Staff investigation/simulation tools are role-restricted; operators see owned liquidity and reconciliation.

The native app is configured for local Ollama with installed `qwen3.5:4b`. Run `npm run agent:start` separately if the local model server is stopped. Report forms also offer clearly labelled offline evidence workflows. Payments, schedules and policy changes retain the ordinary banking authorization flow. Raw messages are not saved; investigation summaries, tool evidence and structured draft context are retained privately. See the [complete agent walkthrough and safeguards](docs/banking-agents.md).

Use `npm run demo:agents` for all five features against real local Ollama and private Python scoring in an isolated, disposable PostgreSQL schema. The onboarding agent is excluded.

## Start the existing local project

The configured native installation uses PostgreSQL at `127.0.0.1:55432`, database `greenlink_dft`. Its records and feature-testing identities already exist; no seeding is needed for a normal restart.

```sh
npm run db:start
npm run db:check
npm start
```

Open **http://localhost:3000**. The launcher starts Express and the private Python scorer; PostgreSQL runs independently. Stop the application with Ctrl+C, then use `npm run db:stop` when you also want to stop the project-owned database. These database helpers manage this project's native cluster; an external PostgreSQL installation is managed separately.

| Application | Address | Accounts/data |
| --- | --- | --- |
| Native banking app | `http://localhost:3000` | Existing PostgreSQL records and the ten feature-testing identities below |
| Separate fraud demonstration | `http://127.0.0.1:3001` | Disposable demonstration database and its own sample logins |
| Docker Compose app | `http://localhost:8080` | Separate Docker PostgreSQL volume; initially empty unless demo seeding is explicitly enabled |
| Private FastAPI scorer | `http://127.0.0.1:4011` | Authenticated native service endpoint with no banking database credentials |

Use the credentials for the selected application. The native, fraud-demo and container databases are independent.

## Install a fresh checkout

Required: **Node.js 22.13+, PostgreSQL 16+ and Python 3.11+**. The verified development environment uses Node.js 22.14, PostgreSQL 18.6 and Python 3.13.

```sh
npm ci
python -m venv .venv
```

Install runtime requirements using `.venv\Scripts\python.exe -m pip install -r requirements.txt` on Windows or `.venv/bin/python -m pip install -r requirements.txt` on macOS/Linux. Then run:

```sh
npm run setup
```

Setup preserves configuration and generates missing `SERVICE_TOKEN` and `AUTH_ENCRYPTION_KEY` values in ignored `.env`. Keep the encryption key stable so existing authenticator enrollments remain usable. Set `PUBLIC_ORIGIN` to the exact browser origin, normally `http://localhost:3000`.

Start PostgreSQL, copy `database/admin.env.example` to ignored `.env.database-admin` and set its administrator maintenance connection URL. Provision the database and separate restricted runtime/migration roles:

```sh
npm run db:setup
npm run db:check
npm start
```

For the project-owned native cluster, follow the initialization steps in the [database guide](docs/database.md). Existing data needs no seed. Future schema changes use `npm run db:migrate` before restarting the app. The launcher discovers `.venv`, or accepts `PYTHON` as an interpreter path. See [installation and staff administration](docs/installation.md) for full configuration.

## Feature-testing accounts

The ten identities below were created for the native app on port 3000. For a fresh local installation, keep `npm start` running and execute this in another terminal:

```sh
npm run test:accounts
```

The command generates a shared random **initial password for these ten test users** and saves it in ignored **`data/testing/FEATURE-TESTING.md`**, alongside the login table, authenticator setup and unused recovery codes. The corresponding private JSON is `data/testing/feature-accounts.json`. Generated credentials are excluded from Git, source archives and container images.

| Login email | Actual role | Starting test case |
| --- | --- | --- |
| `business-tester@greenlink.demo` | `customer` | Approved, funded business; savings, payments, statements and assistant |
| `recipient-tester@greenlink.demo` | `customer` | Incoming transfers and business/account isolation |
| `pending-tester@greenlink.demo` | `customer` | Pending onboarding and restricted financial actions |
| `rejected-tester@greenlink.demo` | `customer` | Rejection reason, correction and resubmission |
| `profile-tester@greenlink.demo` | `customer` | Existing operator completing a missing business profile |
| `empty-tester@greenlink.demo` | `customer` | Zero balance, insufficient funds and failed scheduled instruction |
| `staff-tester@greenlink.demo` | `admin` | Bank operations, onboarding, fraud monitoring and rules |
| `reviewer-tester@greenlink.demo` | `admin` | Independent approve/reject decisions |
| `maker-tester@greenlink.demo` | `admin` | Combined-access test case demonstrating self-approval denial |
| `mfa-tester@greenlink.demo` | `customer` | Authenticator and recovery login |

Staff, reviewer and maker are separate test identities using the existing administrator role. Dedicated staff/reviewer accounts have no deposit accounts. Use different browser profiles/private windows for sender and reviewer.

The business tester's operating account is **`1088800101`**, its reserve is **`1088800102`**, and the recipient's account is **`1088800201`**. Examples include completed, held, policy-blocked and independently reviewed payments; active one-time/weekly/monthly schedules; and cancelled, completed and failed instructions. New payment examples use the configured Python scorer.

Only the MFA tester initially requires a second factor. Use an authenticator configured from the private guide, an unused recovery code, or a fresh local test code:

```sh
npm run test:accounts:otp
```

Repeating `test:accounts` preserves changed passwords, MFA, balances, onboarding decisions and payment reviews. It checks that owner/runtime connections target the same local database and refuses reserved-identity collisions. The initial setup preserves original records and fraud-rule settings. Follow the [complete feature walkthrough](docs/feature-testing.md) for every screen and security case.

### Optional fresh-seed identities

`npm run db:seed` creates the following identities **only in an empty sample database**, before starting the app. Freshly seeded identities use password **`Greenlink123!`**. Existing/imported users retain their passwords and roles; use the feature-testing guide for the populated native installation.

| Email | Seeded role | Purpose |
| --- | --- | --- |
| `alex@greenlink.demo` | `admin` | Meridian Logistics sender with broad demo administrator access |
| `reviewer@greenlink.demo` | `admin` | Independent demo reviewer |
| `jamie@greenlink.demo` | `customer` | Harbour Supplies recipient account `1020002001` |

Dedicated staff can also be created explicitly using `npm run admin:create`; see the [installation guide](docs/installation.md). Customer registration cannot assign administrator access.

## Fraud simulation

Choose one mode:

```sh
npm run demo:fraud
```

This runs the scenarios, writes printable HTML/JSON evidence and removes its disposable database. For an interactive demonstration instead:

```sh
npm run demo:fraud:serve
```

The interactive app stays at `http://127.0.0.1:3001` until Ctrl+C. Both modes use the separate test/maintenance configuration and require PostgreSQL database/role creation privileges.

The demonstration covers normal payments, new-recipient and high-value review, rule review/block changes, an AI-only historical anomaly, rapid-payment detection, independent decisions, request replay and scorer-outage handling. Its original verified run passed **42 assertions**. Native banking data is checked for preservation. See [simulation logins and presentation steps](docs/fraud-simulation.md).

## Functional and security verification

Put `TEST_DATABASE_URL` in ignored `.env.test`, pointing to a separate local test/maintenance database. Tests create/drop isolated schemas; provisioning cases also create/drop uniquely named databases and roles. Operator/test credentials are excluded from normal service startup.

```sh
npm run check
npm test
npm run test:browser
node --env-file=.env --env-file=.env.test scripts/platform-smoke.js
```

Install `tests_python/requirements.txt` with the virtual-environment interpreter, then use that interpreter to run `-m unittest discover -s tests_python -v`. `npm run test:python` uses `python` on `PATH`. Browser tests require Chrome, Chromium or Edge; `CHROME_PATH` can select it. Missing `TEST_DATABASE_URL` causes PostgreSQL-dependent tests to skip and does not establish database acceptance.

The earlier verified 2.6.0 [GitHub run](https://github.com/DisguisedKairos/FYP/actions/runs/40018091472) passed **99 Node tests, 18 Python tests, five browser tests**, real Express/PostgreSQL/FastAPI integration, package checks and the complete Compose payment/permissions check. The 2.7.0 local regression passed 111 Node tests and seven browser tests; all five new features were also exercised with real local Ollama and private Python scoring. Four additional live-browser checks confirmed the prepared native business, staff, pending-onboarding and MFA screens. See the [verification record](docs/verification.md).

## Containers and delivery pipeline

Install Docker Desktop with Linux containers, or Docker Engine with Compose. Then:

```sh
npm run devops:setup
npm run devops:up
```

Open **http://localhost:8080**. The stack contains Nginx, separate non-root banking/scorer images, PostgreSQL and a one-shot schema/permissions job. Its database starts empty by default. The [DevOps guide](docs/devops.md) covers explicit demo seeding, container staff creation, published images and configuration. Stop it with `npm run devops:down`; its data volume and private secret files are retained.

[`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) runs verification and container checks on pushes/pull requests to `main`. Image publication is an explicit **Actions > Greenlink CI and container delivery > Run workflow > publish_images** operation on `main`, after both checks pass. It publishes separate banking/fraud images to the repository's GitHub Container Registry using scoped `GITHUB_TOKEN` permissions. Cloud deployment is configured separately by the DIT team.

## PostgreSQL records and source package

PostgreSQL is the sole banking database: **25 tables and seven checksum-verified migrations**. Retired database stores, importer and prototype code have been removed. Existing records are retained, and migration 006 corrects recognized historical demo email aliases while preserving passwords, IDs, roles and money. A verified pre-cleanup PostgreSQL backup is kept privately under `data/backups/`. See [database design and maintenance](docs/database.md).

Keep `.env`, `.env.database-admin`, `.env.test`, `data/` and `test-results/` private. The web service uses restricted runtime credentials; provisioning and staff administration use separate operator credentials. The scorer receives no database or MFA encryption credentials.

Build from a clean committed checkout:

```sh
npm run package
npm run package:verify
```

The current archive is generated as `releases/greenlink-digital-bank-2.7.1.zip` with a SHA-256 companion and per-file manifest. It includes application source, the dependency lockfile, Python requirements, SQL migrations, tests, walkthroughs, workflow and delivery configuration. Private credentials, database files, installed dependencies and generated reports are excluded. Native database binaries and Python environments are installed separately.

## Project map and responsibility boundary

```text
app.js, db.js           Express routes and PostgreSQL adapter
banking/                Auth, business profiles, ledger, risk, history and jobs
database/               Provisioning, restricted grants, checks and migrations
main.py, fraud_service/ Private FastAPI scoring service
public/, views/         Browser application and local GLDB branding
scripts/                Setup, sample/feature fixtures, staff tools and packaging
tests/, tests_python/   Functional/security, browser and model tests
deploy/, compose.yaml  Container entrypoints, private services and Nginx
.github/workflows/     Verification, container checks and optional image delivery
docs/                  Installation, feature walkthroughs, design and evidence
```

DFT owns banking workflows, customer requirements, authentication/authorization, financial controls, fraud guardrails, application audit and functional/security tests. DIT owns infrastructure delivery, TLS/network configuration and cloud database operations/backups; this repository provides the requested reference pipeline/container handoff. Secrets management is shared.

Funds, business checks and bill settlement are simulated. Live settlement, external KYB/sanctions checks, email/SMS delivery, multi-user corporate mandates and production fraud-model validation remain outside the implemented scope.

[Wholesale scope](docs/wholesale-banking.md) | [Feature walkthrough](docs/feature-testing.md) | [DFT security](docs/dft-scope.md) | [Requirements](docs/requirements.md) | [Architecture](docs/architecture.md) | [API](docs/api.md) | [Financial controls](docs/financial-controls.md) | [DevOps](docs/devops.md)
