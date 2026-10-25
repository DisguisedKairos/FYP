# Green Link Digital Bank - C300 FYP

**AI-Enabled Cloud-Native Digital Banking Platform - Version 2.11.2**

Republic Polytechnic wholesale banking prototype. The stack is Node.js, Express, PostgreSQL, Python FastAPI, JavaScript, HTML/CSS and **local Ollama**. Sample funds, business checks and bill settlement are educational project flows.

## Local AI only

Every new AI inference uses the configured installed Ollama model, currently **qwen3.5:4b**. This includes the assistant, fraud scoring, suspicious-activity analysis, fraud investigation, liquidity planning, rule impact analysis and reconciliation interpretation. FastAPI validates structured Ollama output; it no longer runs a separate trained fraud model.

Offline/parser engines, the logistic model and dataset, training/evaluation scripts, synthetic accuracy/calibration screens and old fraud demonstrations have been removed. No alternative model or preset score is used when Ollama fails. Historical PostgreSQL evidence remains available for audit and is excluded from current-model activity totals.

AI scores are qualitative indicators, not validated fraud probabilities. Deterministic financial rules, integer-cent calculations, database locks, password authorization and independent human review remain application controls. The model has no payment execution or rule-changing tool.

Version 2.11.2 reserves scheduled payments as each starts, preserves full search queries, and prevents delayed profile/case responses and failed case searches from showing stale results. Unused imports, obsolete page URLs, an unconditional demo-login hint and the redundant database wrapper have been removed. Open **AI audit log** in the sidebar or **View AI audit** below an assistant response.

## Features

| Area | Implemented features |
| --- | --- |
| Accounts | Business registration and independent approval, savings management, dashboard and balance enquiry |
| Transactions | Password-authorized internal transfers, simulated bill settlement, one-time/weekly/monthly schedules |
| Experience | History/search, CSV exports, printable/PDF statements, private local-model assistant and payment drafts |
| Operations | Durable notifications, independent payment review, versioned fraud rules, financial audit history and AI evaluation audit |
| Fraud | Ollama risk scores using authoritative historical aggregates, grounded explanation codes, automatic monitoring, human-review cases |
| Banking insights | Local-model investigation, liquidity scenarios, historical rule comparisons and reconciliation findings |
| Security | Scrypt hashes, role/ownership checks, CSRF/origin protection, durable limits, session revocation, TOTP/recovery codes |
| Financial controls | Atomic settlement, integer cents, row locking, payload-bound request keys, replay protection and reconciled statements |

There are two permission roles: customer (authorized business operator) and admin (bank staff). Registration creates a pending business with no spendable opening funds. Approved business ownership is required for banking changes and payments. Makers cannot independently approve their own flagged requests.

## AI evaluation audit

The audit screen at `/ai-audit` shows assistant/insight runs, payment assessments, staff monitoring evidence and failed local-model requests. Inspect a record to compare selected reasons, AI and combined scores, matched financial rules, validated input/policy snapshots and permitted tool results. New model requests record their model name, prompt-template digest, duration, proposed tool names and completion/failure status. A completed request means a response was received; the separate guardrail result determines whether the application accepted its interpretation.

Business operators see their own runs and outgoing-payment evidence. Staff see bank-wide payment and monitoring evidence, plus only their own assistant/insight runs. Conversations remain private to their initiating user, including from other staff. Search is paginated and limited to the previous 90 days; older known records remain accessible by their permitted detail URL. JSON exports contain banking evidence and should be handled as private records.

This is an evidence trace, not hidden model reasoning. Raw prompts, user messages, passwords and hidden thoughts are not copied into the new metadata log. Existing reports can contain generated paraphrases and tool arguments can contain permitted search/draft details. Earlier records show their saved evidence with an explicit notice when detailed timing was never recorded. No historical trace is invented. Existing PostgreSQL tables are reused; model metadata is appended to `audit_log`, which the restricted runtime role cannot update or delete. Failed screening still changes no balances.

## Start the existing local project

The native installation uses PostgreSQL on 127.0.0.1:55432 and database greenlink_dft. Existing accounts and credentials are preserved; do not reseed for an ordinary restart.

~~~sh
npm run db:start
npm run db:check
npm run agent:start
~~~

Leave Ollama running, then start the banking platform in another terminal:

~~~sh
npm start
~~~

Open **http://localhost:3000**. The launcher starts Express and the private FastAPI validation gateway. Both receive the same local model settings. Ollama weights stay in Ollama's own model storage, outside the source package.

~~~dotenv
AGENT_MODE=ollama
AGENT_MODEL=qwen3.5:4b
AGENT_OLLAMA_URL=http://127.0.0.1:11434
~~~

For a fresh checkout, run npm ci, install requirements.txt in .venv, run npm run setup and provision PostgreSQL using [database setup](docs/database.md). Install Ollama and the configured tool-capable model separately. Never put operator credentials in source control.

When Ollama is unavailable, banking reads remain available, while new AI analysis and payment screening fail explicitly. No funds move on failed screening. Scheduled attempts use bounded retry/recovery rather than a substitute AI engine.

## Testing and real inference

~~~sh
npm test
npm run test:python
npm run test:browser
npm run check
npm run demo:agents
~~~

Functional/security tests use clearly isolated controlled model adapters. They do not measure language-model quality. demo:agents uses actual local Ollama and the private scoring gateway in a disposable PostgreSQL schema, then removes that schema. The real-process integration command is node scripts/platform-smoke.js with the configured separate TEST_DATABASE_URL; without installed model weights it verifies the explicit unavailable path, never simulated success.

Private prepared logins and MFA material are in data/testing/FEATURE-TESTING.md. See [feature testing](docs/feature-testing.md). No credentials or live database files are included in the package.

## Delivery and package

The requested [reference CI/container pipeline](docs/devops.md) verifies the application and its Docker boundaries. Compose includes a private Ollama service with cloud inference disabled. Provision its model weights explicitly before enabling payments:

~~~sh
npm run devops:setup
npm run devops:up
docker compose exec ollama ollama pull qwen3.5:4b
~~~

Set GREENLINK_AI_MODEL deliberately when choosing another installed local model. Both banking and scoring use that same setting. Model weights use a dedicated volume and are not baked into images. DIT owns deployment, networking/TLS and infrastructure operation.

~~~sh
npm run package
npm run package:verify
~~~

The source archive is releases/greenlink-digital-bank-2.11.2.zip, with a SHA-256 companion and file manifest. It excludes secrets, local environments, database files, installed dependencies and model weights.

See [local banking agents](docs/banking-agents.md), [Ollama fraud contract](docs/fraud-model.md), [AI verification and limits](docs/ai-evaluation.md), [financial controls](docs/financial-controls.md) and [APIs](docs/api.md).
