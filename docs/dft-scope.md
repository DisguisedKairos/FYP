# DFT banking scope and acceptance map

The DFT application covers customer banking workflows, authorization, financial controls, transaction history, statements, and fraud-review decisions. Express handles HTTP, PostgreSQL owns the persistent banking records and transaction boundary, and the Python scoring endpoint is a private assessment dependency. Cloud provisioning, container deployment, infrastructure management, and release delivery are outside the active DFT implementation.

Green Link Digital Bank is a digital wholesale banking project. Customer access represents a registered business and its authorized primary operator. Business identity, independent bank onboarding approval, company ownership checks, restricted pending applications and a separate staff workspace are described in `wholesale-banking.md`; they are exercised in `tests/dft-business.test.js` and the browser flows. Internal `customer` role values do not imply consumer accounts.

## Authentication and security

`banking/security.js` provides password validation, salted scrypt hashing and verification, opaque tokens, cookie handling, exact-origin checks, and CSRF validation. Authentication uses the pure password verifier and accepts no legacy demo-password alias. New passwords contain 8–128 characters with uppercase, lowercase and a digit, without silent trimming. Existing password hashes remain valid at login. Registration ignores client-supplied roles and creates a customer with one zero-balance savings account.

`banking/auth.js` stores only session-token hashes in PostgreSQL. Login, logout, password change, and session revocation rotate the browser token and CSRF token. Cookies use `HttpOnly`, `SameSite=Lax`, and `Path=/`; configured HTTPS origins enable `Secure`. Authenticated sessions expire after 24 hours even with activity, and after 30 minutes without activity. Password change revokes every previous session and creates a fresh current session. Revoking all sessions returns the browser to an anonymous session. `auth_version` invalidates a stale session or authorization following either action.

Express determines the client address through `req.ip`. Its proxy-trust configuration must identify only the explicitly trusted proxy; authentication does not read forwarded address headers itself. Browser writes use exact-origin checks and session CSRF. Login and registration retain the application's same-origin entry-point policy without requiring an existing CSRF token.

Attempt counters persist in PostgreSQL, and overlapping account/IP counters are locked in a consistent order on independent connections. Attempts consume quota before expensive password verification. A successful verification clears the corresponding account counter while retaining the IP quota.

| Operation | Account quota | Client IP quota | Window |
| --- | --- | --- | --- |
| Login | 8 attempts | 40 attempts | 15 minutes |
| Payment, review, rule or security reauthorization combined | 8 attempts | 40 attempts | 15 minutes |
| Authenticator enrollment confirmation or disable | 8 attempts | 40 attempts | 15 minutes |
| Registration | — | 20 attempts | 15 minutes |
| New anonymous session | — | 60 creations | 15 minutes |

Login, failed and successful reauthorization, password change, session revocation, registration, and logout write audit events without passwords, raw session tokens, or security codes.

## Optional authenticator verification

`banking/totp.js` implements RFC6238 SHA-1 TOTP with six digits, 30-second periods and a one-period clock tolerance. Enrollment requires the current password, creates a ten-minute pending setup, and enables the factor only after a valid code. Confirmation revokes prior sessions, rotates the current session and returns ten recovery codes once. Every accepted authenticator counter is consumed atomically, including concurrent login attempts. Recovery codes are user-bound hashes with one atomic use each.

Active and pending secrets are encrypted with AES-256-GCM under `AUTH_ENCRYPTION_KEY`, a 64-character hexadecimal operator key, and bound to the owning user through authenticated additional data. Missing or incorrect keys fail closed for authenticator verification. The key must remain outside source control and be backed up independently with access controls; losing it prevents authenticator-code verification. Recovery codes remain a separate login factor.

Login accepts the current password plus either `otp` or `recoveryCode` when enabled. Disabling requires the current password and a fresh authenticator code, removes encrypted/recovery material, and revokes previous sessions. Password changes preserve the enabled factor. Enrollment is optional unless the HTTP application's privileged-operation policy requires it; no mandatory enrollment is implied by merely having an administrator role.

## Security acceptance evidence

`tests/dft-auth.test.js` contains pure security checks and integration cases against an isolated PostgreSQL schema. PostgreSQL cases require `TEST_DATABASE_URL`; a run without it explicitly skips those cases and does not prove database behavior.

| Acceptance requirement | Test coverage |
| --- | --- |
| Salted password hashes and no legacy password fallback | Independent salts, correct/incorrect password, malformed stored hashes, bounded input |
| Registration policy and role integrity | 8/128-character boundaries, identity validation, concurrent case-insensitive duplicate registration, ignored role input |
| Exact browser origin and CSRF | Scheme, host, port and path changes; cross-site metadata; wrong or missing session token |
| Cookie and token privacy | Opaque single cookie, duplicate-cookie rejection, security attributes, hashed database tokens |
| Session fixation and revocation | Rotation through registration/login/logout; previous token invalidation |
| Durable authentication limits | Concurrent login attempts on separate PostgreSQL connections; adapter recreation; expiry recovery |
| Financial reauthorization limits | Shared quota across purposes and client addresses; no secret in audit metadata |
| Idle and absolute expiry | Exact idle boundary and repeated activity unable to extend the 24-hour limit |
| Password change | Current password and CSRF required; failed request preserves sessions; old password and other sessions invalidated |
| Revoke all sessions | Password required, anonymous replacement, other sessions and stale authorization invalidated |

`tests/dft-totp.test.js` adds RFC6238 reference vectors, counter tolerance and replay checks, encrypted-secret tamper/owner binding, recovery-code hashing, password/CSRF enrollment, expiry, session revocation, concurrent TOTP/recovery consumption, disable authorization, and rollback when session insertion fails. Its database cases use the same explicit PostgreSQL test requirement.

`tests/dft-http.test.js` verifies the actual Express routes use the same write guards and authoritative client address. It covers source ownership, role checks, injection attempts, safe exports, statement reconciliation, malformed URLs, proxy trust and password changes during in-flight screening. Ledger/workflow checks also reject stale authorization at review and schedule creation. Existing standing schedules keep their saved consent across password/session changes; future occurrences still run through current financial and fraud controls.

`tests/dft-security-browser.js` verifies password change, authenticator enrollment, login challenge, recovery login, disable and all-device revocation through the real browser screens. Enrollment/recovery secrets clear when the dialog closes. The desktop/mobile banking browser tests cover ordinary account, transfer, bill, schedule, assistant and administrator-review flows.
