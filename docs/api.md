# DFT HTTP API

The browser uses same-origin `/api`. `GET /api/session` establishes/loads the opaque HttpOnly session and returns `csrfToken`. Include `X-CSRF-Token` on authenticated writes. JSON bodies are limited to 16 KiB. Login/register use same-origin entry guards without requiring an existing CSRF token. Customer input is validated before parameterized PostgreSQL queries.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | PostgreSQL readiness |
| GET | `/api/session` | Session user and CSRF token |
| POST | `/api/auth/register` | `{name,email,password,confirmPassword?}`; customer role only |
| POST | `/api/auth/login` | `{email,password,otp?,recoveryCode?}` |
| POST | `/api/auth/logout` | Revoke current session |
| POST | `/api/auth/password` | `{currentPassword,newPassword,confirmPassword?}`; rotate/revoke sessions |
| POST | `/api/auth/revoke-sessions` | `{currentPassword}`; revoke all and return anonymous session |
| GET | `/api/auth/security` | Own MFA state and recent security events |
| POST | `/api/auth/mfa/setup` | `{currentPassword}`; temporary secret and enrollment URI |
| POST | `/api/auth/mfa/confirm` | `{otp}`; enable and return recovery codes once |
| POST | `/api/auth/mfa/disable` | `{currentPassword,otp}`; remove factor and revoke old sessions |
| GET | `/api/dashboard` | Owned active/closed savings, recent activity and summary |
| POST | `/api/accounts` | `{name}`; zero-balance savings account |
| PATCH/DELETE | `/api/accounts/:id` | Rename `{name}` / safe zero-balance closure |
| POST | `/api/transfers` | Authorized transfer |
| POST | `/api/payments` | Authorized bill |
| GET | `/api/transactions` | Owned filtered/paginated history |
| GET | `/api/transactions/:id` | Owned transaction receipt |
| GET | `/api/transactions/export` | Filtered CSV |
| GET | `/api/statements` | Reconciled statement; required `accountId`, optional `from`,`to` |
| GET/POST | `/api/scheduled-payments` | Own instructions / create authorized instruction |
| DELETE | `/api/scheduled-payments/:id` | Cancel owned active schedule |
| GET | `/api/notifications` | Owned notifications and unread count |
| PATCH | `/api/notifications/:id` | Mark owned item or `all` read with `{read:true}` |
| POST | `/api/assistant/messages` | `{message}`; private read/draft response |
| GET | `/api/business` | Signed-in operator's business profile |
| POST | `/api/business/profile` | Submit/correct `{business,version?,authorizationPassword}` |
| GET | `/api/business/applications` | Bank staff queue; optional `status` |
| POST | `/api/business/applications/:id/review` | Independent bank `{decision,reason,version,verificationConfirmed,authorizationPassword}` |
| GET | `/api/fraud/rules` | Admin rules and version |
| PATCH | `/api/fraud/rules/:id` | Admin `{enabled?,threshold?,action?,version,authorizationPassword}` |
| GET | `/api/fraud/rules/audit` | Admin paginated policy history |
| GET | `/api/fraud/model` | Admin model provenance and evaluation |
| GET | `/api/fraud/reviews` | Admin review queue |
| POST | `/api/fraud/reviews/:id` | Independent admin `{decision,reason,authorizationPassword}` |

## Financial payloads

Registration additionally requires `business:{legalName,registrationNumber,country:"SG",legalForm,industry,registeredAddress}`. Legal form is `company`, `partnership` or `institution`; personal onboarding is rejected. The business starts pending review regardless of client-supplied status. Approval requires a fresh bank staff password and `verificationConfirmed:true`; review cannot be performed by the business's own primary operator. Version mismatches and already-reviewed applications return409. Approved identity changes require bank assistance.

Account changes, payment source ownership and recipient eligibility enforce an approved business. Missing/pending/rejected source identity returns 403 with `code:"BUSINESS_APPROVAL_REQUIRED"`; a recipient without approval is unavailable for transfer. `customer` is the internal role name for a business operator, not a consumer product.

Transfer: `{fromAccountId,toAccountNumber,amount,description?,requestId,authorizationPassword}`. Bill: `{fromAccountId,billerId,reference,amount,requestId,authorizationPassword}`. `amount` is a decimal string in SGD, `requestId` is a stable unique string generated once for that reviewed instruction. A repeated key with the same canonical payload replays the result; a changed payload returns 409. Persist the same key when retrying a connection failure. A successful HTTP response may contain a `pending_review` or `rejected` transaction: inspect the lifecycle status.

A schedule adds `type` (`transfer` or `bill`), `scheduledAt` (future ISO timestamp) and `frequency` (`once`,`weekly`,`monthly`) to the applicable payment fields. The password is verified but never stored in the instruction. Cancellation requires ownership and session CSRF.

History accepts `q`, `accountId`, `type` (`transfer`,`bill`,`incoming`), `status`, Singapore-calendar `from`/`to`, `page` and `pageSize` (maximum 100). Duplicate/invalid filters are rejected. Statement reconciliation failure returns 409 and must not be presented as an authoritative balance.

Errors return `{error}` with an appropriate HTTP status. MFA login challenges additionally return `code:"MFA_REQUIRED"`/`mfaRequired:true`; send a valid OTP or one recovery code with the password. Bad factor uses `MFA_INVALID`. Authenticated password/OTP failures preserve the session. Rate limits use429. Internal errors omit stack traces and database details.

## Private scoring contract

Python exposes `/internal/health`, `/internal/model` and `POST /internal/assess` on its separate loopback address. Every endpoint requires `Authorization: Bearer <SERVICE_TOKEN>`. Express never serves those private routes publicly. Assessment input binds `transactionId,userId,sourceAccountId,payloadHash,type,amountCents,payee,accountBalanceCents,isInternal,createdAt` and a validated `historySummary`. The scorer returns the same bindings with bounded score, decision, seven features, historical context, reasons and model provenance. It owns no ledger writes or fraud-rule administration.
