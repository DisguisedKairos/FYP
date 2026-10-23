# Greenlink Digital Bank

A Node.js, JavaScript, HTML and CSS banking platform with savings accounts, authorized payments, scheduled payments, a private banking assistant, explainable fraud scoring and independent review. Runtime services use SQLite and Node's built-in modules; no runtime package installation is required. Use Node.js **22.13 or later**.

## Run locally

```sh
npm start
```

Open **http://localhost:3000**. This starts the API gateway, banking, fraud, notification and schedule/event-worker processes. Internal services bind to loopback; their authentication token is generated in memory. Stop them together with Ctrl+C.

| Demo identity | Email | Password | Purpose |
| --- | --- | --- | --- |
| Alex Morgan | `alex@greenlink.demo` | `Greenlink123!` | Funded banking account and administrator. |
| Independent reviewer | `reviewer@greenlink.demo` | `Greenlink123!` | Review another user's held transactions. |
| Jamie Lee | `jamie@greenlink.demo` | `Greenlink123!` | Recipient account `1020002001`. |

New registrations are customers with a zero-balance savings account. Use a small transfer from Alex to fund one. Payments and schedules require the user's current password at confirmation. Administrators cannot approve their own held payment.

## Containerised services

With Docker Compose installed:

```sh
npm run setup
docker compose up --build
```

The setup command creates an ignored `.env` with a random service token. Only the gateway is published, at `127.0.0.1:3000`. Separate volumes preserve banking, fraud and notification data. `docker compose down` stops the platform without deleting those volumes.

## Included workflows

- Register, sign in/out, manage savings accounts and enquire about balances.
- Transfer to owned or registered accounts, pay supported bills, authorize requests and view receipts.
- Create/cancel one-time, weekly and monthly schedules; inspect individual run results.
- Search and paginate transaction history on the server, download matching CSV and print/save authoritative date-range statements as PDF.
- Read notification updates and mark them as read.
- Ask Greenlink Assistant about your own accounts, search activity, understand a flagged payment and prepare a transfer or bill draft. Chat runs locally with no external AI account; it never authorizes a payment or stores the conversation.
- Score new payments from historical activity, retain explanations and hold suspicious requests without debiting funds.
- Review another user's flagged request; configure versioned fraud rules, inspect their change history and view model provenance.

The provided logistic-regression baseline is trained on synthetic labelled history. Its held-out metrics are visible and reproducible; they do not establish real-world fraud-detection performance. Regenerate the model with `npm run train:fraud`.

## Verification

```sh
npm test
npm run test:browser
```

The browser checks require an installed Chrome, Chromium or Edge; `CHROME_PATH` can select it. Test databases are isolated from normal data, and screenshots/downloads go to ignored `test-results/`.

GitHub Actions runs API/service/control tests, desktop/mobile browser checks, release-package verification, infrastructure validation and a container smoke flow. A `v*` version tag publishes the tested image to GHCR. Actual cloud provisioning remains deferred, as requested. A deployable single-host AWS template and TLS Compose overlay are included; see [cloud instructions](cloud/README.md). This runtime uses SQLite, not an AWS database service.

## Application package

```sh
npm run package
npm run package:verify -- releases/greenlink-digital-bank-1.1.0.zip
```

The ZIP in `releases/` includes the app, model, synthetic dataset, tests, containers, cloud templates and documentation. Its SHA-256 companion and per-file manifest verify integrity. Release builds require clean tracked source. Extract the archive, install Node.js and run `npm start`; user databases, private credentials, `.env` and dependency folders are excluded. The documented demo credentials remain available for sample accounts. See [installation and upgrades](docs/installation.md).

For a database without demo identities, set `SEED_DEMO=false` before the first start. Register the intended administrator, then run `npm run admin:grant -- --email registered@example.com` on the trusted ledger host. This operator-only command records the role grant. Register and grant a second administrator to support independent payment review.

## Project layout

```text
app.js                 Banking HTTP service
db.js                  Ledger schema, migrations and demo seed
controllers/           API handlers
models/                Money, schedules, sessions and outbox
public/                CSS, SVG and modular browser JavaScript
views/                 HTML entrypoint
services/              Gateway, fraud, notifications and worker
scripts/               Startup, packaging, operator setup and model training
datasets/              Synthetic labelled fraud observations
tests/                 Financial, API, service and browser checks
docs/                  Architecture, controls, model and requirement map
cloud/                 Deferred AWS infrastructure and TLS deployment guide
Dockerfile, compose.yaml
.github/workflows/     Automated checks and image delivery
```

See [API reference](docs/api.md), [architecture](docs/architecture.md), [financial controls](docs/financial-controls.md), [fraud model](docs/fraud-model.md), and [requirements/contributions](docs/requirements.md). Configuration keys are in `.env.example`; native data lives in ignored `data/`. `npm run start:banking` runs the core with embedded fraud/notification adapters for focused development; scheduled jobs need the full `npm start` worker.

The source repository retains `evergreen-site/`, the earlier unpublished hosted prototype. It is excluded from the Greenlink application package.

This is an educational project using sample funds. Real banks, payment providers, email and SMS delivery are not connected.
