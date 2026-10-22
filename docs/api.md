The local platform serves JSON APIs through the gateway at `http://localhost:3000` by default. Successful responses contain `ok: true`; failures contain `{ "error": "Readable explanation" }`. Registration, account creation and schedule creation return HTTP 201; other successful operations return HTTP 200.

Amounts returned by the API are integer **SGD cents**. Account/user IDs are integers; transaction and schedule IDs are strings. Dates are ISO 8601 timestamps. Send JSON request bodies with `Content-Type: application/json`; the banking request limit is 16 KiB.

Start with a session, then sign in or register:

| Method | Path | Request and result |
| --- | --- | --- |
| GET | `/api/session` | Returns `{ok, user, csrfToken}`; `user` is `null` before sign-in. Creates an anonymous session when needed. |
| POST | `/api/auth/register` | `{name, email, password, confirmPassword?}` → `{ok, user, account, csrfToken}`. Opens one zero-balance savings account. |
| POST | `/api/auth/login` | `{email, password}` → `{ok, user, csrfToken}`. |
| POST | `/api/auth/logout` | `{}` → `{ok, user: null, csrfToken}`. |

`user` contains `{id, name, email, role}`. New registrations have role `customer`. Names contain 2–80 characters; passwords contain 8–128 characters. Email addresses are normalized and unique. Login attempts are rate limited.

Keep the `evergreen_session` cookie and replace the cached CSRF token after login, registration or logout. The cookie is HttpOnly and SameSite=Lax; authenticated sessions expire after 24 hours and anonymous sessions after one hour. Send `X-CSRF-Token` on every write except login and registration. Those two routes still enforce same-origin checks. Cross-site write requests are rejected.

Authenticated customers manage their own accounts and read their dashboard:

| Method | Path | Request and result |
| --- | --- | --- |
| GET | `/api/dashboard` | `{ok, user, accounts, closedAccounts, transactions, billers, summary}`. |
| POST | `/api/accounts` | `{name}` → `{ok, account}`. |
| PATCH | `/api/accounts/:id` | `{name}` → `{ok, account}`. |
| DELETE | `/api/accounts/:id` | Closes an account → `{ok, account}`. Requires a zero balance and another active account. |

Account names contain 2–40 characters. A customer can keep up to eight active accounts. An account contains `{id, name, number, balanceCents, status, createdAt}`; its status is `active` or `closed`.

The dashboard returns the complete transaction collection for the customer's active and closed accounts. Frontend history filters, search, CSV exports and printable statements consume that collection. `summary` contains `{incomeCents, outgoingCents}` for completed external activity during the last 30 days; transfers between the customer's own accounts are excluded. Billers contain `{id, name, category, initials, color}`; supported IDs are `sp-services`, `singtel` and `pub`.

Submit an internal transfer or bill payment with the current login password:

| Method | Path | Body |
| --- | --- | --- |
| POST | `/api/transfers` | `{fromAccountId, toAccountNumber, amount, description?, authorizationPassword, requestId?}` |
| POST | `/api/payments` | `{fromAccountId, billerId, reference, amount, authorizationPassword, requestId?}` |

Both return `{ok, transaction}`. Use a decimal string for `amount`, such as `"123.45"`; numeric inputs are also accepted when they represent valid amounts with at most two decimal places. Amounts must be positive and cannot exceed 9,000,000,000,000 cents. Recipient account numbers contain ten digits; spaces and hyphens are removed. A transfer note can contain up to 100 characters. Bill references contain 3–64 characters.

For example, after signing in and selecting an account from the dashboard, send:

```http
POST /api/payments
Content-Type: application/json
Cookie: evergreen_session=<session-cookie>
X-CSRF-Token: <current-csrf-token>

{
  "fromAccountId": 1,
  "billerId": "sp-services",
  "reference": "SP-123456789",
  "amount": "123.45",
  "authorizationPassword": "Evergreen123!",
  "requestId": "bill-example-001"
}
```

Choose a new `requestId` for each intended payment and reuse it for retries. It accepts 1–100 letters, digits, colons, underscores or hyphens. IDs are scoped to the customer across transfers, bills and schedule creation. Reusing an ID with different effective payment details returns HTTP 409. Omitting it creates a new server-generated ID, so clients should supply one for reliable retries. Passwords are verified again on retries and are never stored with the transaction.

A transaction includes:

| Fields | Meaning |
| --- | --- |
| `id`, `type`, `description`, `counterparty`, `reference` | Receipt identity; type is `transfer`, `bill` or historical `credit`. |
| `accountId`, `accountName`, `accountNumber`, `payee`, `isInternal` | Account identity, recipient and own-account transfer flag. |
| `amountCents`, `status` | Signed amount; outgoing entries are negative. Inspect status even when HTTP succeeds. |
| `createdAt`, `requestedAt`, `completedAt` | Lifecycle timestamps; `completedAt` is null while held or rejected. |
| `authorization`, `review` | Password authorization timestamp/method and independent review details, when applicable. |
| `risk` | Score, decision, reasons, model/rule versions, assessment time and scoring context. |

`risk.decision` is `allow`, `review` or `block`. The resulting transaction status is respectively `completed`, `pending_review` or `rejected`. Only completed transactions debit funds. Held and rejected decisions are successful API results with unchanged balances. Screening failures return HTTP 503 without moving funds. Idempotent retries preserve the recorded risk assessment; an independent review updates the returned lifecycle state. Recipient credit entries receive an associated score and generic screening reason without the payer's features or history. Historical seed entries can have `risk: null`.

Screening receives a bounded sample plus exact SQL aggregates over completed outgoing external transactions: daily outflow for the Singapore calendar day, ten-minute count/amount, historical average/count and known-payee status. The settlement transaction rechecks balances, account state and captured hard daily/velocity controls atomically before debit. A concurrent payment that breaches a hard control is recorded as rejected with a control explanation. Review approval checks current hard rules again. See [financial controls](financial-controls.md).

Schedule future payments using the same payment details:

| Method | Path | Request and result |
| --- | --- | --- |
| GET | `/api/scheduled-payments` | `{ok, schedules}` for the signed-in customer. |
| POST | `/api/scheduled-payments` | Payment fields plus `{type, scheduledAt, frequency}` → `{ok, schedule}`. Requires `authorizationPassword`; supports `requestId`. |
| DELETE | `/api/scheduled-payments/:id` | Cancels future occurrences → `{ok, schedule}`. Repeated cancellation is safe. |

`type` is `transfer` or `bill`; `frequency` is `once`, `weekly` or `monthly`. `scheduledAt` must be a valid future UTC timestamp ending in `Z`, for example `2030-01-31T02:00:00.000Z`. Creation records authorization without reserving funds. Each due occurrence is screened and checked for available funds when executed. Monthly recurrence preserves the original day, using the last day of shorter months; recurring times use UTC.

Each schedule exposes its payment details, `id`, `scheduledAt`, `nextRunAt`, `frequency`, `status`, `createdAt`, `lastRunAt`, `lastStatus`, `lastError` and `runs`. Schedule status is `active`, `completed`, `cancelled` or `failed`. Each run contains `{id, dueAt, status, transactionId, error, createdAt, completedAt}`. Run status reflects processing, completion, review, rejection, failure or cancellation; inspect it separately from schedule completion. Lease claims and deterministic occurrence IDs prevent duplicate settlement after concurrent ticks or restart. Cancellation is rechecked before an in-flight occurrence can debit.

Customers read and acknowledge their notifications:

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/notifications` | `{ok, notifications, unreadCount}`; optional `?unreadOnly=true`. |
| PATCH | `/api/notifications/:id` | `{read: true}` → refreshed notification list/count. |
| PATCH | `/api/notifications/all` | `{read: true}` → marks the customer's notifications read. |

Notifications contain `{id, type, title, message, transactionId, createdAt, isRead, readAt, metadata}`. Networked delivery is asynchronous: the financial transaction commits its event to the outbox and the worker retries delivery. A notification outage does not delay successful financial responses. Consumers deduplicate event IDs. The embedded store also supports immediate delivery.

The following routes require an `admin` role:

| Method | Path | Request and result |
| --- | --- | --- |
| GET | `/api/fraud/rules` | `{ok, rules, version, updatedAt, reviewThreshold, blockThreshold}`. |
| PATCH | `/api/fraud/rules/:id` | `{version, enabled?, threshold?, action?}` → updated rules/version. Actions are `review` or `block`. A stale version returns 409. |
| GET | `/api/fraud/model` | `{ok, model}` with algorithm, features, training/validation metrics, policy and limitations. |
| GET | `/api/fraud/reviews` | `{ok, reviews}` containing pending transactions from other customers, including `maker: {id, name, email}`. |
| POST | `/api/fraud/reviews/:transactionId` | `{decision: "approve" or "reject", reason, authorizationPassword}` → `{ok, transaction}`. |

Review reasons contain 3–500 characters. Administrators cannot review their own transactions. Approval rechecks funds, accounts and current hard financial limits; a failed approval leaves the payment held. Rejection never debits funds. A completed review cannot settle again on retry. Demo administrators are `alex@evergreen.demo` and the independent reviewer `reviewer@evergreen.demo`, both with password `Evergreen123!`.

Common error statuses are 400 for invalid input, 401 for missing/expired login or incorrect login credentials, 403 for CSRF/role/authorization-password failures, 404 for missing or inaccessible resources, 409 for financial/state/idempotency/version conflicts, 413 for excessive payloads, 415 for unsupported content type, 429 for login throttling, and 503 for unavailable screening/services. Unsupported methods return 405 with `Allow`. Responses containing account data use `Cache-Control: no-store`.

Operational endpoints belong to the banking service:

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/health` | `{ok, service: "banking", database: "ready"}` after a database readiness query. |
| POST | `/internal/jobs/tick` | Requires `Authorization: Bearer <SERVICE_TOKEN>` and an empty `{}` body. Returns `{ok, schedulesProcessed, notificationsDelivered, notificationsFailed}`. |

The public gateway hides internal routes. Without a configured service token, the banking job endpoint returns 404. Caller-supplied clock or payment inputs are rejected. The factory's `server.runJobs()` provides the same awaited job execution for tests; its injected clock is configured when creating the application. Delivery attempts are bounded and stop after the first failure, leaving pending events for another tick. See [architecture](architecture.md) for service topology and worker operation.
