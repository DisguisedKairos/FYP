# Financial control requirements

## Money and transaction lifecycle

The legal customer is a registered business, linked to its accounts through `business_id`. The primary contact's user ID is an authorization boundary, not the legal account-holder name. New businesses require bank onboarding approval before account changes, sending or receiving money. Independent review, fresh authorization, optimistic versions and a verification confirmation protect onboarding decisions. Pending legacy business profiles also pause standing payment occurrences until approval, without consuming screening retries or advancing the occurrence. Company-level multi-signatory mandates are outside this iteration.

Supported amounts are positive decimal strings with at most two places, converted exactly to integer cents. Scientific notation, floating-point overflow, zero and negative instructions are rejected. PostgreSQL constraints bound balances and ledger entries. Transfers debit the owned active source and credit a distinct active registered destination atomically. Bills debit the source and retain a supported biller and billing reference; live settlement rails are outside this demonstration.

Each financial submission requires a customer-scoped `requestId` and the current password. The key is permanently bound to canonical operation type, source account and payload before screening. Retrying an identical request returns its receipt; changing the payload under the same key returns 409. Account locks prevent parallel overspending. A database failure rolls back balances, both transfer entries, the receipt and outbox together.

The lifecycle is `requested → screened → completed | pending_review | rejected`. Pending/rejected requests never debit or reserve funds. Completed entries have a settlement sequence and completion time. Review keeps request and decision evidence. An administrator cannot approve their own request. Approval requires fresh authorization, current funds, active accounts and the current blocking policies; concurrent review attempts settle once.

## Fraud guardrails

Python scores every new transfer/bill, including a schedule occurrence, from explicit prior outgoing aggregates. The application persists the bound assessment and policy before calling the scorer. It validates identifiers, source, payload hash, score/decision, finite bounded features, historical context, model provenance and assessment timestamp. Unauthorized, unavailable, malformed or mismatched responses fail closed without settlement.

Approved deterministic rules apply independently of the model. Controls include high value, daily outgoing total, recent velocity, new payee and balance utilization. Rule changes require an administrator's current password, matching policy version and an exact audit record. Settlement rechecks current blocking rules under the sender lock, so a concurrent payment or policy change cannot rely solely on stale screening. Model explanations support a review and do not prove fraud.

## Schedules, notifications and statements

Workers lease each due instruction immediately before screening rather than reserving a waiting batch. A tick starts at most 20 distinct instructions and stops starting more after 50 seconds; an in-flight bounded assessment may finish afterward. Remaining instructions wait without consuming attempts. Existing occurrence keys, retries, independent payment review and lease takeover/cancellation protections still apply.

The separate [suspicious-activity monitor](fraud-monitoring.md) can flag recorded payments, including completed ones, using the original AI input, current rules and historical patterns. Its findings are append-only; cases require an independent human reviewer, a current version and fresh password authorization for resolution. Cases never approve, reverse or change a payment. Missing historical context is labelled for manual review; scoring outages leave records unchecked for retry. Original transaction assessments remain unchanged.

A schedule stores the authorized canonical instruction and next occurrence. Every occurrence has a stable key, processing lease, attempt count and terminal result. A transient dependency outage retries the same occurrence with bounded delay; a committed result is recovered after interruption without a second debit. Cancellation respects an occurrence that already committed. Past occurrences remain visible.

Financial operations emit outbox events in their transaction. Delivery and notification insertion are atomic and deduplicated. Notification lists/acknowledgements are scoped to their owner. Notifications are in-app only.

Statements use a consistent database snapshot and Singapore date boundaries. Their opening balance derives from stored creation/import provenance and completed entries before the period. Every row's running balance must stay nonnegative and reconcile with the closing/current balance. Positive or negative unexplained drift is an error. Explicit verified legacy opening balances are distinguishable from transaction activity. Pending/rejected rows do not affect money totals. CSV protects textual cells against formula execution.

## Customer and security requirements

Customers can access only their own accounts, history, receipts, schedules, statements and notifications. The assistant follows the same ownership boundary, returns drafts requiring the ordinary review/password flow, and cannot authorize writes. Registration cannot assign privileges. Password changes and session revocation invalidate stale authorizations; optional authenticator login prevents code/recovery replay. Audit records contain decisions and actor context without passwords, raw cookies, OTPs or recovery secrets.

The functional/security suites test concurrency, rollback, idempotency, independent review, hostile inputs, data isolation, service failure, recovery and reconciliation. Their evidence applies to this project implementation with synthetic data, not a live bank certification.

## Agent boundaries

The 2.7.0 agent layer has read/report and form-draft tools only. Tools repeat role/ownership checks; HTTP tasks recheck their session and all tasks recheck the security version before returning results. The assistant and private FastAPI fraud-scoring gateway require the configured OpenAI model for inference. Banking reads remain available without it. There is no agent tool for SQL, shell access, settlement, transaction decisions, rule changes or repairing balances.

Numerical facts are rendered from authoritative tool results. Generated numerical claims and unauthorized execution claims are withheld. Qualitative interpretations remain subject to reviewer verification. Historical rule simulations never alter policies, and liquidity projections include assumptions rather than guaranteed funds. Existing password authorization, independent review, binding keys and settlement guardrails apply to every draft completed through banking forms. See [agent controls and evidence](banking-agents.md).

## Recorded decisions and subsequent rule changes

The original fraud assessment and policy snapshot remain evidence of pre-payment screening. Settlement may apply stricter current controls and record a different risk decision, score and rule version on the payment. AI audit, fraud investigation and monitoring use that recorded payment decision while retaining the initial assessment separately. Later policy changes cannot erase a recorded review/block signal. A human approval changes the payment lifecycle status and adds independent review evidence; it does not rewrite the original risk decision.
