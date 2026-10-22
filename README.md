# Evergreen — Digital Banking and Fraud Monitoring

A Node.js, JavaScript, HTML and CSS banking platform with savings accounts, authorized payments, scheduled payments, explainable fraud scoring and independent review. Runtime services use SQLite and Node's built-in modules; no runtime package installation is required. Use Node.js **22.13 or later**.

## Run locally

```sh
npm start
```

Open **http://localhost:3000**. This starts the API gateway, banking, fraud, notification and schedule/event-worker processes. Internal services bind to loopback; their authentication token is generated in memory. Stop them together with Ctrl+C.

| Demo identity | Email | Password | Purpose |
| --- | --- | --- | --- |
| Alex Morgan | `alex@evergreen.demo` | `Evergreen123!` | Funded banking account and administrator. |
| Independent reviewer | `reviewer@evergreen.demo` | `Evergreen123!` | Review another user's held transactions. |
| Jamie Lee | `jamie@evergreen.demo` | `Evergreen123!` | Recipient account `1020002001`. |

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
- Search/filter transaction history, download CSV and print/save date-range statements as PDF.
- Read notification updates and mark them as read.
- Score new payments from historical activity, retain explanations and hold suspicious requests without debiting funds.
- Review another user's flagged request; configure versioned fraud rules and inspect model provenance.

The provided logistic-regression baseline is trained on synthetic labelled history. Its held-out metrics are visible and reproducible; they do not establish real-world fraud-detection performance. Regenerate the model with `npm run train:fraud`.

## Verification

```sh
npm test
npm run test:browser
```

The browser checks require an installed Chrome, Chromium or Edge; `CHROME_PATH` can select it. Test databases are isolated from normal data, and screenshots/downloads go to ignored `test-results/`.

GitHub Actions runs API/service/control tests, desktop/mobile browser checks and a container smoke flow. A `v*` version tag publishes the tested image to GHCR. Cloud deployment and an AWS database implementation are deferred, as requested. Docker is not installed in the authoring environment, so the Compose runtime must be verified in CI or on a Docker host; the separate native service processes have been exercised.

## Project layout

```text
app.js                 Banking HTTP service
db.js                  Ledger schema, migrations and demo seed
controllers/           API handlers
models/                Money, schedules, sessions and outbox
public/                CSS, SVG and modular browser JavaScript
views/                 HTML entrypoint
services/              Gateway, fraud, notifications and worker
scripts/               Local startup, configuration and model training
datasets/              Synthetic labelled fraud observations
tests/                 Financial, API, service and browser checks
docs/                  Architecture, controls, model and requirement map
Dockerfile, compose.yaml
.github/workflows/     Automated checks and image delivery
```

See [API reference](docs/api.md), [architecture](docs/architecture.md), [financial controls](docs/financial-controls.md), [fraud model](docs/fraud-model.md), and [requirements/contributions](docs/requirements.md). Configuration keys are in `.env.example`; native data lives in ignored `data/`. `npm run start:banking` runs the core with embedded fraud/notification adapters for focused development; scheduled jobs need the full `npm start` worker.

`evergreen-site/` is the earlier hosted prototype, not the expanded platform. It is retained for future deployment work and has not been published.

This is an educational project using sample funds. Real banks, payment providers, email and SMS delivery are not connected.
