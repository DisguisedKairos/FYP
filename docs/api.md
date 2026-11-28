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
| GET | `/api/funding-check` | Read-only, current 30-day active-schedule coverage for the signed-in owner; no AI request |
| POST | `/api/accounts` | `{name}`; zero-balance savings account |
| PATCH/DELETE | `/api/accounts/:id` | Rename `{name}` / safe zero-balance closure |
| POST | `/api/transfers` | Authorized transfer |
| POST | `/api/payments` | Authorized bill |
| GET | `/api/transactions` | Owned filtered/paginated history; `q`, `accountId`, `type` (`transfer`, `bill`, `incoming`, `outgoing`), `status` (`completed`, `pending_review`, `rejected`), `from`, `to`, `page`, `pageSize` |
| GET | `/api/transactions/:id` | Owned transaction receipt |
| GET | `/api/transactions/export` | Filtered CSV |
| GET | `/api/statements` | Reconciled statement; required `accountId`, optional `from`,`to` |
| GET/POST | `/api/scheduled-payments` | Own instructions / create authorized instruction |
| DELETE | `/api/scheduled-payments/:id` | Cancel owned active schedule |
| GET | `/api/notifications` | Owned notifications and unread count |
| PATCH | `/api/notifications/:id` | Mark owned item or `all` read with `{read:true}` |
| POST | `/api/assistant/messages` | `{message}`; private read/draft response |
| GET | `/api/business` | Signed-in operator's business profile |
| GET | `/api/fraud/rules` | Admin rules and version |
| PATCH | `/api/fraud/rules/:id` | Admin `{enabled?,threshold?,action?,version,authorizationPassword}` |
| GET | `/api/fraud/rules/audit` | Admin paginated policy history |
| GET | `/api/fraud/model` | Admin model provenance and evaluation |
| GET | `/api/fraud/model-activity` | Staff-only recorded current OpenAI activity, with no synthetic metrics; optional `days=1..90` |
| POST | `/api/fraud/scan` | Staff-only bounded monitoring scan; `{limit?:1..25,transactionId?}` |
| GET | `/api/fraud/analysis/:id` | Staff-only saved monitoring analysis for an outgoing transaction |
| GET | `/api/fraud/cases` | Staff-only suspicious cases, counts and scan status; `status`, `page` |
| GET | `/api/fraud/cases/:id` | Case evidence and human-review audit history |
| POST | `/api/fraud/cases/:id/review` | Claim `{action:"claim",version}` or resolve `{action:"close",version,outcome,reason,authorizationPassword}` |
| GET | `/api/fraud/reviews` | Admin review queue |
| POST | `/api/fraud/reviews/:id` | Independent admin `{decision,reason,authorizationPassword}` |

## Private banking agents (2.7.0)

All routes require the existing session. POST routes additionally require CSRF and the same-origin guard. Run records are private to their initiating user. All generation requests require OpenAI. The optional `engine` field accepts only `openai`; `workflow` and other providers are rejected with 400. OpenAI unavailability returns 503 with no alternate response engine. `/api/assistant/messages` is a compatibility URL for this same model-backed assistant.

| Method | Path | Payload/result |
| --- | --- | --- |
| POST | `/api/agents/assistant` | `{message,previousRunId?,engine?}`; response has reply, authoritative fact cards, form-draft actions, run ID and tool names |

The assistant returns its reply, permitted banking facts, run ID and tool names. The former Banking insights task, status and run-list/detail endpoints have been removed; they return 404. Historical evidence remains available through the administrator-only AI audit API. Unsupported fields/tools fail closed. Raw messages are not stored; reports, tool evidence and structured draft context are retained in PostgreSQL. Follow [agent privacy, limits and walkthrough](banking-agents.md).

## AI audit log (2.11.0)

- GET `/api/ai-audit`: searchable saved evidence summaries. Filters: type=all|agent|payment|monitoring|failure, q (maximum 150 characters; literal matching), days=1..90 (default 30), page=1..10000, pageSize=1..100 (default 20). Duplicate/unknown filters return 400. Response: entries, pagination, filters, scope and explanation.
- GET `/api/ai-audit/:kind/:id`: returns {record:{kind,id,createdAt,evidence,modelCalls,modelCallsTruncated,interpretation,provenanceNote}}. Payment detail distinguishes AI-selected reasons from financial rule matches and retains canonical input/policy binding. assessment and policySnapshot preserve the initial screening; paymentRisk contains the recorded payment controls, and decisionSummary prefers those controls when present. guardrails records both decisions and any currentRuleVersion. List decisions use the same recorded payment controls. Human review remains separate from the risk decision. Monitoring includes its saved assessment and current human case outcome. Agent detail includes permitted tool arguments/results, displayed report and narrative safety outcome. No context_json or raw chat is returned.

Both require an authenticated administrator and are read-only PostgreSQL operations. Customers receive 403 for all audit list and detail requests, including their own records. The data layer rechecks the current database role and rejects forged or demoted administrator identities. Administrators see global payment/monitoring evidence but only their own assistant runs and assistant failures. Cross-owner private administrator detail returns 404. Historical records do not require a running model to read. A maximum of 100 request metadata entries is returned per record. There are no audit mutation endpoints.

New inference calls append ai.model_call metadata to the protected audit_log. Metadata is allowlisted: provider/model, subject, phase, attempt, timestamps, duration, available digests, proposed tool names, status and bounded error code. Availability failures have executed=false. executed=true identifies an attempt through the OpenAI adapter/gateway; it does not prove that OpenAI completed inference. Request completion does not establish guardrail acceptance or financial settlement. Detailed timing is not retroactively synthesized. Browser JSON export uses this same authorized detail response.

## Financial payloads

Registration additionally requires `business:{legalName,registrationNumber,country:"SG",legalForm,industry,registeredAddress}`. Legal form is `company`, `partnership` or `institution`; personal profiles are rejected. Registration creates an empty active business account; the retained database status `approved` means project banking access, not an independent KYB decision. Client-supplied role, owner and status do not grant privileges. Business onboarding, profile-submission and application-review endpoints have been removed and return 404. Existing restricted/missing profiles are not automatically activated. Legal identity amendments require bank assistance; news preferences remain editable through the advisory-profile endpoint.

Account changes, payment source ownership and recipient eligibility enforce an approved business. Missing/pending/rejected source identity returns 403 with `code:"BUSINESS_APPROVAL_REQUIRED"`; a recipient without approval is unavailable for transfer. `customer` is the internal role name for a business operator, not a consumer product.

Transfer: `{fromAccountId,toAccountNumber,amount,description?,requestId,authorizationPassword}`. Bill: `{fromAccountId,billerId,reference,amount,requestId,authorizationPassword}`. `amount` is a decimal string in SGD, `requestId` is a stable unique string generated once for that reviewed instruction. A repeated key with the same canonical payload replays the result; a changed payload returns 409. Persist the same key when retrying a connection failure. A successful HTTP response may contain a `pending_review` or `rejected` transaction: inspect the lifecycle status.

A schedule adds `type` (`transfer` or `bill`), `scheduledAt` (future ISO timestamp) and `frequency` (`once`,`weekly`,`monthly`) to the applicable payment fields. The password is verified but never stored in the instruction. Cancellation requires ownership and session CSRF.

History accepts `q`, `accountId`, `type` (`transfer`,`bill`,`incoming`), `status`, Singapore-calendar `from`/`to`, `page` and `pageSize` (maximum 100). Duplicate/invalid filters are rejected. Statement reconciliation failure returns 409 and must not be presented as an authoritative balance.

Errors return `{error}` with an appropriate HTTP status. MFA login challenges additionally return `code:"MFA_REQUIRED"`/`mfaRequired:true`; send a valid OTP or one recovery code with the password. Bad factor uses `MFA_INVALID`. Authenticated password/OTP failures preserve the session. Rate limits use429. Internal errors omit stack traces and database details.

## Private scoring contract

The local Python model exposes `/internal/health`, `/internal/model` and `POST /internal/assess` on its separate loopback address. Every endpoint requires `Authorization: Bearer <SERVICE_TOKEN>`. Express never serves those private routes publicly. Assessment input binds `transactionId,userId,sourceAccountId,payloadHash,type,amountCents,payee,accountBalanceCents,isInternal,createdAt` and a validated `historySummary`. The scorer returns the same bindings with bounded score, decision, seven features, historical context, reasons and model provenance. It owns no ledger writes or fraud-rule administration.

Assistant continuation expiry returns HTTP 409 with `code: ASSISTANT_CONTEXT_EXPIRED`. Clients must discard the expired reference and allow an explicit fresh request; they must not reuse the previous draft context.

After an owned-counterparty scan establishes a public-evidence gap, the assistant can complete with `newsInsights.status: "unavailable"` and an empty `insights` array. The response explains the coverage gap; no news assessment or advisory flags were generated. Skipped evidence retrieval, stale or invalid source records and invalid model output remain subject to validation. Missing coverage never establishes sanctions clearance or company safety.

## Assistant customization and saved-chart refresh

Endpoints require the signed-in operator and existing origin/CSRF checks for writes. No user ID override is accepted.

| Method / path | Contract |
| --- | --- |
| GET /api/assistant-preferences | Own responseStyle, trendMonths, chartType and marketTopic, with defaults |
| PATCH /api/assistant-preferences | Strict partial settings: concise/detailed; integer 1-12 months; bar/line/table; general/singapore/fx/trade/interest_rates |
| PATCH /api/dashboard-views/:id | Own title/presentation/refreshCadence and current version; stale version 409, foreign ID 404 |
| POST /api/dashboard-views/:id/refresh | Empty object; fresh owned snapshot and refreshedAt/nextRefreshAt; no financial action |

Creation also accepts presentation/refreshCadence. Definitions support period kind months with integer months (1-12), alongside rolling/fixed. The existing job refreshes due weekly charts. Public research uses bounded assistant tools and is not an arbitrary URL proxy. See [workflow and boundaries](assistant-insights.md).

The assistant also accepts ordinary counterparty-news/sanctions questions through POST /api/agents/assistant. scan_counterparty_news has only an optional exact company label from the message; the server validates it against owned recent completed receipts and otherwise selects at most five names. Its report returns counterpartyScan coverage/limits/status and publicResearch source cards. It is on-demand research, not a sanctions clearance or financial action. No new endpoint, migration or credential is required.

For reputation/financial interaction risk, POST /api/agents/assistant may use assess_counterparty_risk with an optional exact owned company name from the question. counterpartyRisk contains current source scope, omitted-company count, separate qualitative model grades, supported explanations/checks and authoritative cash-flow exposure. Operator-entered case inputs retain their provenance, runtime cannot edit them, and no financial action is available. See [sector risk workflow](counterparty-risk.md).


## Company industry news preferences

- `GET /api/business/advisory-profile` returns the signed-in business name, registered industry, mapped planning profile, curated options, selected settings and version. A business without saved preferences receives labelled industry defaults; a staff login without a business receives `available: false`.
- `POST /api/business/advisory-profile` accepts exactly `{profileKey, version, settings}`. Settings contain nonempty arrays `markets`, `operations` and `priorities` selected from the GET options. Session authentication and CSRF are required. The server derives business ownership; foreign IDs and arbitrary search text are rejected. A stale version or changed industry returns 409. Saving affects planning context, not legal identity, account balances or banking permissions.

Industry research uses only curated topic labels, selected operating markets and activities. `analyze_news_insights` separately retrieves the current operator's company context, limits action codes to that industry's permitted checks, and returns the context with cited advisory cards. Private company names, account numbers, balances, identifiers and raw user instructions are excluded from the industry web-search query. News flags remain advisory in chat.
