# DFT requirements and verification

| Requirement | Active implementation | Evidence |
| --- | --- | --- |
| Register/login/logout and password security | Express routes, scrypt, hashed tokens, durable throttles | `dft-auth.test.js`, `dft-http.test.js` |
| Authorization and customer isolation | Server roles, owned queries, password reauthorization, CSRF/origin | Auth, ledger, HTTP and browser tests |
| Savings management and balance enquiry | Create/rename/close safeguards, PostgreSQL dashboard | HTTP and browser tests |
| Internal transfers and bill payments | Integer cents, account locks, atomic ledger and mandatory request keys | `dft-ledger.test.js`, HTTP/browser |
| Scheduled payments | Once/weekly/monthly, occurrence leases, retries and cancellation recovery | `dft-workflows.test.js`, mobile browser |
| History, search and statements | Bound filters, pagination, safe CSV, explicit reconciled baseline | HTTP and browser export checks |
| Notifications | Transactional outbox and owned read acknowledgement | Workflow/HTTP/browser checks |
| Transaction authorization | Current password, auth version, independent maker/checker review | Auth and ledger tests |
| Fraud rules | Admin-only versioned changes and audit, current blocking rules at commit | Risk/ledger and admin browser |
| Fraud score, flags and explanations | Private FastAPI, bound history, strict schema, deterministic controls | `dft-risk.test.js`, `tests_python/`, real platform smoke |
| Private banking assistant | Owned reads and form drafts, no chat execution or external provider | HTTP and desktop/mobile browser |
| Authenticator and recovery | Encrypted TOTP secrets, atomic counter/recovery consumption | `dft-totp.test.js`, security browser |
| PostgreSQL data connection | Migrations, bounded pool and transaction helper | All database integration tests |
| Previous data migration | Explicit read-only SQLite importer, empty-target gate, reconciliation | `dft-import.test.js` |
| Reviewable application package | Locked dependencies, source allowlist and integrity checks | `dft-package.test.js` |

Tests against PostgreSQL require `TEST_DATABASE_URL`; skipped cases are not acceptance evidence. Browser tests need a local Chrome-compatible browser. Python tests use the provided pinned test requirements.

## Responsibility boundary

DFT owns banking workflows, financial controls, authentication, roles, fraud guardrails, SQL injection prevention, functional/security tests and application audit records. DIT owns containerisation, CI/CD, cloud provisioning, TLS/network configuration and cloud database operations/backups. Secrets are shared: DFT excludes them from source and protects application use; the delivery team injects and operates private values.

The project uses simulated funds and configured demonstration billers, with no live banking/biller integration. Email verification, forgotten-password delivery, external notification delivery, real customer identity/KYC, production model validation and operational support workflows remain future scope. Optional TOTP does not by itself establish regulatory compliance or production readiness.
