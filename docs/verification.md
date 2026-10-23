# DFT verification record

Verified locally on 24 October 2026 (Asia/Singapore), using Node.js 22.14, PostgreSQL 18.6 and Python 3.13. Test credentials and output are excluded from source control and the release.

| Check | Result |
| --- | --- |
| Active Node DFT functional/security suite | 87 passed, 0 failed, 0 skipped against real PostgreSQL |
| Python FastAPI/model suite | 15 passed, including 63 JavaScript parity vectors and independent held-out metric verification |
| Browser workflows | 5 passed: business registration/onboarding and banking, mobile banking, standalone bank operations workspace, administrator fraud review, password/MFA/recovery/session controls |
| Actual process integration | Express + PostgreSQL + FastAPI smoke passed with authenticated scoring, payment lifecycle, history, statements, notifications and policy audit |
| Packaged source | Archive integrity verified; fresh offline `npm ci` installed 79 locked packages; extracted application passed the actual two-process smoke |
| Existing local data | Read-only SQLite import into separate PostgreSQL database preserved 2 users, 3 accounts and 11 transactions and password hashes; no sessions imported |

The wholesale revision additionally verifies registered business eligibility, legal account ownership, independent onboarding review, staff provisioning and business approval restrictions. The suite covers concurrency/overspending, atomic rollback, request replay and payload binding, current policy enforcement, independent review, stale authorizations, scheduled recovery/cancellation, outbox deduplication, ownership, CSRF/origin, SQL injection attempts, session throttling/revocation and TOTP/recovery replay. Browser checks cover exports/PDF preview and 390/360 pixel layouts. Review notifications route administrators to the review queue while customer receipts retain ownership controls.

Use the commands in the root README to reproduce these checks. PostgreSQL tests require a separate `TEST_DATABASE_URL`, Python tests require the test requirements, and browser tests require Chrome/Edge. Older SQLite/native-service tests are reference files, not part of these counts. No infrastructure pipeline or hosted deployment is claimed by this verification.

The scorer's synthetic evaluation is a model demonstration, not real-world fraud detection validation. Live bill settlement, email/SMS, KYC and account-recovery delivery remain outside the implemented project flows; see `requirements.md`.
