# Green Link Digital Bank - C300 FYP

**AI-Enabled Cloud-Native Digital Banking Platform - Version 2.11.4**

Republic Polytechnic wholesale banking prototype. The stack is Node.js, Express, PostgreSQL, Python FastAPI, JavaScript, HTML/CSS and **OpenAI API**. Sample funds, business checks and bill settlement are educational project flows.

## OpenAI integration

The default AI provider is now **OpenAI**, using the configurable **gpt-6-luna** model through the Responses API. The assistant, fraud scoring, suspicious-activity analysis, fraud investigation, liquidity planning, rule impact analysis and reconciliation interpretation use the configured provider. FastAPI validates structured fraud output.

Set `OPENAI_API_KEY` privately in `.env` or your hosting secrets, with `OPENAI_MODEL=gpt-6-luna`. The key stays on the server. OpenAI receives chat and permitted banking evidence; fraud prompts contain limited aggregates without customer/account identifiers. See [OpenAI setup, privacy and verification](docs/openai.md). OpenAI is the only inference provider; no simulated fallback is supported.

Unavailable inference fails closed. AI scores are qualitative indicators, not validated fraud probabilities. Financial rules, integer-cent calculations, database locks, password authorization and independent human review remain application controls. The model has no payment execution or rule-changing tool. Historical evidence is preserved with its original provider.

Version 2.11.4 rechecks session authorization inside account and schedule-cancellation transactions, prevents delayed notification responses from restoring old read state, and separates new scheduled instructions from retries. Service caches and draft state clear on session termination, and delayed banking responses cannot replace the next operator's workspace. Open **AI audit log** in the sidebar or **View AI audit** below an assistant response.

## Features

| Area | Implemented features |
| --- | --- |
| Accounts | Business registration and independent approval, savings management, dashboard and balance enquiry |
| Transactions | Password-authorized internal transfers, simulated bill settlement, one-time/weekly/monthly schedules |
| Experience | History/search, CSV exports, printable/PDF statements, private banking assistant and payment drafts |
| Operations | Durable notifications, independent payment review, versioned fraud rules, financial audit history and AI evaluation audit |
| Fraud | OpenAI risk scores using authoritative historical aggregates, grounded explanation codes, automatic monitoring, human-review cases |
| Banking insights | AI investigation, liquidity scenarios, historical rule comparisons and reconciliation findings |
| Security | Scrypt hashes, role/ownership checks, CSRF/origin protection, durable limits, session revocation, TOTP/recovery codes |
| Financial controls | Atomic settlement, integer cents, row locking, payload-bound request keys, replay protection and reconciled statements |

There are two permission roles: customer (authorized business operator) and admin (bank staff). Registration creates a pending business with no spendable opening funds. Approved business ownership is required for banking changes and payments. Makers cannot independently approve their own flagged requests.

## Test accounts and passwords

Open **http://localhost:3000**. The current workspace uses **Neon PostgreSQL**, so use the verified email/password table in [the Neon testing guide](data/testing/neon/README.md). The detailed Neon walkthrough and MFA details are in `data/testing/neon/FEATURE-TESTING.md`; its JSON credential file is `data/testing/neon/feature-accounts.json` (the `password` field). These synthetic demo login files are included in Git for project testing and excluded from release packages. Anyone with repository access can use these demo credentials; rotate or remove the demo accounts before public deployment.

Use the full email as the username. There are two permission roles: `customer` and `admin`. The separate staff, reviewer and maker identities exercise different workflows under the administrator role.

| Login email | Permission role | What to test |
| --- | --- | --- |
| `business-tester@greenlink.demo` | `customer` | Everyday business banking, payments, schedules, statements and assistant |
| `recipient-tester@greenlink.demo` | `customer` | Receive transfers and verify business/account isolation |
| `pending-tester@greenlink.demo` | `customer` | Pending onboarding and blocked financial actions |
| `rejected-tester@greenlink.demo` | `customer` | Rejected application, review explanation and resubmission |
| `profile-tester@greenlink.demo` | `customer` | Existing operator completing a missing registered-business profile |
| `empty-tester@greenlink.demo` | `customer` | Zero balance, insufficient funds and failed scheduled instruction |
| `staff-tester@greenlink.demo` | `admin` | Bank operations, business approvals, fraud rules and monitoring |
| `reviewer-tester@greenlink.demo` | `admin` | Independent approve/reject decisions and fraud-rule audit |
| `maker-tester@greenlink.demo` | `admin` | Administrator payment maker; own held payment cannot be self-approved |
| `mfa-tester@greenlink.demo` | `customer` | Authenticator login, recovery codes and profile security |

All ten Neon test identities initially share the password in the Neon testing guide. `mfa-tester@greenlink.demo` additionally requires an authenticator code or unused recovery code; run `npm run test:accounts:otp:neon` for a current code. Use separate browser profiles to test independent maker/reviewer decisions. Replace any older password saved by your browser.

**Original native database only:** `data/testing/README.md`, `data/testing/feature-accounts.json` and `data/testing/FEATURE-TESTING.md` contain the retained native database credentials. Their passwords do not work on Neon. The original `alex@greenlink.demo`, `jamie@greenlink.demo` and `bankops@greenlink.demo` users are not present in the current Neon database; use the business tester for customer banking or the staff/reviewer tester for bank operations.

For a new Neon development database, `npm run test:accounts:neon` prepares synthetic test identities with the app and configured AI/scoring services running. Use `npm run test:accounts` only when configured for native PostgreSQL. Rerunning either setup preserves changed passwords, MFA and existing banking records. Follow the [feature-testing walkthrough](docs/feature-testing.md) for each use case. Passwords cannot be recovered from PostgreSQL hashes; this documentation update does not reset any account.

## AI evaluation audit

The audit screen at `/ai-audit` shows assistant/insight runs, payment assessments, staff monitoring evidence and failed AI-provider requests. Inspect a record to compare selected reasons, AI and combined scores, matched financial rules, validated input/policy snapshots and permitted tool results. New model requests record their model name, prompt-template digest, duration, proposed tool names and completion/failure status. A completed request means a response was received; the separate guardrail result determines whether the application accepted its interpretation.

Business operators see their own runs and outgoing-payment evidence. Staff see bank-wide payment and monitoring evidence, plus only their own assistant/insight runs. Conversations remain private to their initiating user, including from other staff. Search is paginated and limited to the previous 90 days; older known records remain accessible by their permitted detail URL. JSON exports contain banking evidence and should be handled as private records.

This is an evidence trace, not hidden model reasoning. Raw prompts, user messages, passwords and hidden thoughts are not copied into the new metadata log. Existing reports can contain generated paraphrases and tool arguments can contain permitted search/draft details. Earlier records show their saved evidence with an explicit notice when detailed timing was never recorded. No historical trace is invented. Existing PostgreSQL tables are reused; model metadata is appended to `audit_log`, which the restricted runtime role cannot update or delete. Failed screening still changes no balances.

## Neon database

The current workspace is connected to the Neon production branch of greenlink-dft (dry-glitter-49989056), database neondb. The web app and Express/FastAPI services still run on this computer. PostgreSQL is the only Neon service configured.

~~~sh
npm run db:check
npm run build
npm start
~~~

Open **http://localhost:3000**. For fresh synthetic Neon logins, run `npm run test:accounts:neon` with the app running, then open `data/testing/neon/FEATURE-TESTING.md`. These credentials are separate from the original native database logins. Use `npm run test:accounts:otp:neon` for its MFA tester.

After `neon deploy` or a CLI environment pull, run `npm run db:setup:neon` before starting the app to restore the restricted application connection. See [Neon setup and verification](docs/neon.md) for the complete commands, permissions and backup locations. Existing local accounts and transactions have not been uploaded.

## Original native PostgreSQL installation

The following describes the retained native installation. The current `.env` selects Neon; native configuration copies are preserved in the private pre-Neon backup described above. Restore the matching native application/operator configuration before using these commands for the native app.

The native installation uses PostgreSQL on 127.0.0.1:55432 and database greenlink_dft. Existing accounts and credentials are preserved; do not reseed for an ordinary restart.

~~~sh
npm run db:start
npm run db:check
npm run ai:check
~~~

After installing the Python requirements and setting the OpenAI key, start the banking platform:

~~~sh
npm start
~~~

Open **http://localhost:3000**. The launcher starts Express and the private FastAPI validation gateway. Both use the configured OpenAI model. No local language-model server is required.

~~~dotenv
OPENAI_API_KEY=your-private-api-key
OPENAI_MODEL=gpt-6-luna
~~~

For a fresh checkout, run npm ci, install requirements.txt in .venv, run npm run setup and provision PostgreSQL using [database setup](docs/database.md). Supply your own OpenAI API key privately. Keep PostgreSQL operator credentials, OpenAI keys and application secrets out of source control.

When the AI provider is unavailable, banking reads remain available, while new AI analysis and payment screening fail explicitly. No funds move on failed screening. Scheduled attempts use bounded retry/recovery rather than a substitute AI engine.

## Testing and real inference

~~~sh
npm test
npm run test:python
npm run test:browser
npm run check
npm run demo:agents
~~~

Functional/security tests use clearly isolated controlled model adapters. They do not measure language-model quality. demo:agents uses actual configured AI provider and the private scoring gateway in a disposable PostgreSQL schema, then removes that schema. The real-process integration command is node scripts/platform-smoke.js with the configured separate TEST_DATABASE_URL; without usable model credentials it verifies the explicit unavailable path, never simulated success.

The original native login table is in `data/testing/README.md`; Neon logins are in `data/testing/neon/FEATURE-TESTING.md`; generated initial passwords and MFA material are in `data/testing/FEATURE-TESTING.md`. See [feature testing](docs/feature-testing.md). The selected synthetic test login files under `data/testing/` are included in Git. Application secrets, PostgreSQL credentials and live database files remain excluded; source packages exclude the entire data directory.

## Vercel multi-service hosting

**Work in progress:** the Vercel CLI static-routing issue described in [Vercel setup](docs/vercel.md) must be resolved before deployment. The proposed `vercel.json` configures the Express website/banking API as `banking` and FastAPI scoring as an internal `fraud` service. Banking calls fraud through the runtime-injected `FRAUD_SERVICE_BINDING_URL`. Tests are not deployed as services. The free Hobby configuration uses a daily authenticated job for scheduled payments, monitoring and notifications. See [Vercel setup, environment variables and verification](docs/vercel.md). Service names, public routing and binding await confirmation before deployment.

## Delivery and package

The requested [reference CI/container pipeline](docs/devops.md) verifies the application and its Docker boundaries. Compose defaults to OpenAI. Set OPENAI_API_KEY privately before starting:

~~~sh
npm run devops:setup
npm run devops:up
~~~

Set OPENAI_MODEL deliberately to choose another compatible model. Both banking and scoring use that same setting. DIT owns deployment, networking/TLS and infrastructure operation.

~~~sh
npm run package
npm run package:verify
~~~

The source archive is releases/greenlink-digital-bank-2.11.4.zip, with a SHA-256 companion and file manifest. It excludes secrets, local environments, database files, installed dependencies and model weights.

See [banking agents](docs/banking-agents.md), [fraud scoring contract](docs/fraud-model.md), [AI verification and limits](docs/ai-evaluation.md), [financial controls](docs/financial-controls.md) and [APIs](docs/api.md).
