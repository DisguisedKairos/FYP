# Banking workflows and financial controls

## Immediate payments

1. The signed-in customer selects an owned, active savings account and a registered recipient or supported biller.
2. The browser validates the fields and displays the exact payee, amount and reference for review.
3. The server verifies the customer's current password. No review-screen state can substitute for server authorization.
4. The fraud service evaluates historical amount patterns, recipient familiarity, recent activity, time and balance usage; enabled rules are evaluated against the same context.
5. The ledger records the assessment and either completes the payment, holds it for independent review, or rejects it under a blocking rule.
6. A committed event is delivered to the customer's notification inbox. The receipt and transaction history show the actual result.

## Financial invariants

| Requirement | Control |
| --- | --- |
| No overdraft | Integer-cent arithmetic, positive amount validation and a balance recheck inside the ledger transaction. |
| No double spending on retries | Per-user idempotency keys and atomic source/recipient ledger changes. |
| Account ownership | Every account mutation and source payment resolves the account against the authenticated customer. |
| Authorization | Current-password verification on payments, scheduled instruction creation and review decisions. |
| Separation of duties | An administrator cannot approve or reject their own held payment. A second administrator is required. |
| Held funds | A payment under review has no ledger debit. Approval uses the then-current available balance. |
| Configuration accountability | Admin-only fraud configuration, optimistic version checks and before/after change audit. |
| Confidentiality | Hashed passwords, server sessions, HttpOnly cookies, CSRF and same-origin validation, private service tokens. |
| Durable notifications | Transactional outbox, retry leases and consumer deduplication. |
| Scheduled consent | The authorized source, recipient, amount, frequency and date are immutable; cancellation stops future occurrences. |
| Statements | Filters and exports use real stored records and identify status. Pending/rejected records do not imply money moved. |
| Statement reconciliation | Completed entries preserve settlement order for tied timestamps, including approved holds. Impossible legacy chronology, negative running balances or a closing mismatch stop statement issuance. |
| Private assistant | Owned read queries and payment drafts only; chat cannot bypass password authorization, screening or independent review. |

## Fraud monitoring

Customers see the assessment explanation on transaction details. Administrators have a review queue, model information and rule controls. A decision records who reviewed it, when, and why. The demo has two admin identities so the maker-checker restriction can be exercised.

Historical seed transactions predate the scoring feature; new payment attempts receive an assessment. The provided model is a reproducible logistic-regression baseline trained on synthetic labelled observations, with held-out metrics and a dataset hash. Those metrics describe the included test dataset, not a validated real-world fraud detector. See [fraud model](fraud-model.md).
