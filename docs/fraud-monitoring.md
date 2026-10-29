# AI transaction monitoring and human review

Version 2.9.0 adds a suspicious-activity queue alongside pre-payment fraud authorization. Sign in as bank staff and open **Fraud monitoring** at `/fraud-monitoring`.

## What is analysed

Every new transfer or bill already receives OpenAI scoring before settlement. Monitoring also examines recorded outgoing transfers and bills, including completed, pending-review and rejected instructions. Incoming mirror credits are represented by their source payment rather than counted twice. Deposits without an outgoing instruction are not scored as outgoing payments.

The running application checks up to 25 unchecked payments every thirty seconds. A PostgreSQL lease prevents simultaneous workers from processing the same batch; expired leases recover after restart. **Run AI scan** starts a batch immediately. Enter an outgoing transaction ID to analyse a particular payment and inspect its saved result, including a result that has no suspicious-activity flag. Leave the field blank to process the next batch. Large backlogs require additional batches; the screen reports remaining work.

AI reassessment uses the original bound pre-payment input, history snapshot and account balance, not today's balance or future activity. Results include the model version/checksum, feature values, model explanations, original screening decision and the policy version used for the scan. Reassessment never overwrites the original payment assessment. Unchanged model/policy/detector versions reuse existing results.

An immutable monitoring record is saved for each analysed instruction. Missing or mismatched historical input is routed for manual review with an explicit coverage-gap reason; an AI score is not invented. A scorer outage leaves the payment unchecked, records a monitoring failure and retries later. Existing cases and notification delivery remain available.

## Why a case is flagged

- The AI risk indicator reaches the existing review threshold of 65 out of 100.
- The original instruction required review or blocking.
- Current financial rules match the original input snapshot. This is a retrospective comparison, not a new settlement decision.
- At least three individually smaller outgoing payments to the same payee within ten minutes together reach the configured high-value threshold. Previous payments must be completed, external, earlier than the current instruction and individually below that threshold.
- With at least five earlier completed external payments, the amount is at least four times the earlier average and at least SGD 1,500.
- The original bound context is missing or cannot be verified, requiring manual investigation.

The priority score combines model/rule/pattern signals. It is shown separately from the model score. Coverage gaps can have no score. The split-payment and amount-jump detectors are illustrative guardrails, not validated fraud classifiers. The OpenAI risk indicator is not validated as a real-world fraud classifier. A flag is not proof of fraud; an unflagged instruction is not proven legitimate. Equal-time completed entries are excluded from historical pattern comparisons to avoid relying on uncertain ordering.

## Human review

1. Inspect the case's business, payment status, AI score, reasons and saved evidence.
2. **Claim investigation** to assign the case to yourself. Another bank reviewer must handle your own outgoing payments.
3. Verify the business purpose, supporting records and recipient independently. Review the archived policy and limits of the evidence.
4. Record **Confirmed fraud**, **Legitimate activity** or **Inconclusive**, with a 10–1,000 character reason and your current password.

Cases move from `open` to `in_review` to `closed`. Claims and decisions use optimistic versions and row locks; only the assigned reviewer can close a case. Role, session/security-version, ownership and fresh authorization checks protect decisions. Findings are append-only for the runtime role; reviewer actions and notes enter the protected audit log.

Independent bank staff receive a durable in-app alert when a case is created or reopened. Repeated scans do not duplicate cases or notifications. Unchanged findings do not reopen a resolved case. A new signal or higher priority can reopen it while preserving the prior decision in the audit trail.

Case review never settles, rejects, reverses or refunds a payment. A pending payment still needs its separate independent payment authorization. Confirmed outcomes are retained for investigation; they do not automatically retrain or certify the model. Assignment release/reassignment and external investigator integrations are not implemented in this iteration.

## API and database

All endpoints require a bank administrator session. Writes require the existing CSRF/same-origin checks.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/fraud/scan` | `{limit?:1..25,transactionId?}`; analyse the next batch or a selected outgoing instruction |
| GET | `/api/fraud/analysis/:transactionId` | Latest saved monitoring evidence, including unflagged results |
| GET | `/api/fraud/cases` | Queue, counts and monitor status; `status=active/open/in_review/closed/all`, `page` |
| GET | `/api/fraud/cases/:id` | Evidence, reviewer, outcome and audit history |
| POST | `/api/fraud/cases/:id/review` | `{action:"claim",version}` or `{action:"close",version,outcome,reason,authorizationPassword}` |

Migration `008_fraud_monitoring.sql` adds `fraud_screenings`, `fraud_cases` and `fraud_monitor_state` (28 tables, eight migrations). Run `npm run db:migrate` with operator credentials before starting this release against an existing installation. It preserves customer and financial records and refreshes the restricted runtime grants.

```sh
npm run demo:agents
```

The demonstration uses actual OpenAI fraud inference through FastAPI and runs all five banking analysis tasks in a disposable PostgreSQL schema. Scores and tool selections come from the configured API model; no suspicious outcome or explanation is preset. Unsafe model prose is withheld while recorded tool evidence remains visible. It verifies unchanged balances after analysis and removes its isolated schema. Start the normal platform with its OpenAI API key configured. Native customer data is never seeded by this command. Split-payment cases and independent human outcomes are covered by the functional and browser tests below.

`tests/dft-fraud-cases.test.js` covers permissions, CSRF, recorded/completed-payment analysis, split patterns, missing history, idempotency, notifications, human review, concurrent claims, outages, lease takeover, revoked authorization and reopening. The mobile browser test covers the complete staff workflow. Runtime PostgreSQL tests prohibit rewriting/deleting evidence or changing the payment linked to a case.
