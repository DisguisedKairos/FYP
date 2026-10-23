# Fraud rule management and AI scoring demonstration

Run a complete C300 demonstration against the actual Python model, Express APIs and restricted PostgreSQL login:

```sh
npm run demo:fraud
```

For an interactive copy after the examples finish:

```sh
npm run demo:fraud:serve
```

The interactive banking app defaults to **http://127.0.0.1:3001**, separately from the normal application on port 3000. `DEMO_PORT` can select another loopback port. The demo prints its actual address when ready.

## Prerequisites and isolation

Use the working application's ignored `.env` and a separate local `TEST_DATABASE_URL` in `.env.test`. The test operator needs permission to create/drop disposable databases and roles, as for the PostgreSQL provisioning tests. The launcher uses the installed virtual-environment Python interpreter, or `PYTHON` if configured.

Each run creates a randomly named `greenlink_fraud_...` database with separate restricted runtime and migration logins. It seeds synthetic business accounts and a dedicated fraud operations reviewer. Only that new database is modified. The existing application's accounts, ledger and policy are fingerprinted before/after; the run fails if those financial records differ. Use this command against a quiet local application so genuine concurrent banking activity does not invalidate the comparison.

The demo starts its own private Python process on an unused loopback port, with a new service token. The outage example stops this demonstration process only, verifies failure without financial writes, then restarts it. The normal app and its scorer remain available.

Default mode closes its processes and drops only its generated database/roles after saving reports. Interactive mode retains them until Ctrl+C, then performs the same cleanup. An interrupted run also attempts cleanup; local files under `test-results/fraud-demo/<run-id>/` remain as evidence. Abrupt operating-system termination can prevent cleanup, so stop the demo normally.

## Examples executed

| Example | Expected behaviour |
| --- | --- |
| Historical-pattern comparison | Three model-only SGD 5,000 probes compare typical history, a much smaller historical average, and combined unfamiliar-recipient/rapid/unusual-hour signals. Actual Python inference explains each score. |
| Normal supplier payment | SGD 100 to a known business completes with a low model score and exactly one debit. |
| New recipient | SGD 2,000 to an unfamiliar business matches `new_payee`; no debit while held. An independent reviewer later rejects the sample instruction. |
| Review threshold | An authorized administrator changes `high_value` to review from SGD 50; a SGD 75 payment is held even though its AI score is low. |
| Blocking action | The same rule changes to `block`; a new SGD 75 instruction is rejected with combined score 95 and no debit. |
| AI-only anomaly | Temporarily disable `high_value` and `new_payee`, submit SGD 20,000 to an unfamiliar business, and verify the real model alone requests review with no matched deterministic rule. Other controls remain active. |
| Independent review | The maker's self-approval is refused. A separate reviewer approves the SGD 75 held instruction, causing a single debit on approval. |
| Versioned rule management | A stale update is refused, all seven successful rule changes have before/after audit records, and the five original rule settings are restored. |
| Rapid transfers | Five SGD 1.25 transfers complete; the sixth is held by `velocity`, without a sixth debit. These inputs come from the completed ledger, not hand-written history summaries. |
| Scorer outage | A real request while the demo Python process is stopped returns 503. No financial transaction or balance change is committed. The private scorer then restarts. |
| Authorization and replay | A customer rule edit is refused; resending the original completed request returns the same receipt without another debit. |
| Reconciliation | Every demo account reconciles and runtime SQL permissions remain restricted. In-app notifications are delivered. |

The model-only probes are clearly separated in the report from actual payment submissions. Payment-history aggregates are always calculated by the banking service from PostgreSQL. Every model call uses the real pinned Python artifact; no model stub is used.

## Interactive login and presentation steps

These accounts exist **only in the disposable demo**, with password `Greenlink123!`:

| Email | Purpose |
| --- | --- |
| `fraud-reviewer@greenlink.demo` | Dedicated independent reviewer, bank operations workspace; recommended for viewing rules, audit and pending reviews |
| `alex@greenlink.demo` | Meridian Logistics sender; retains the seed's broad demo admin role so the self-approval guard can be demonstrated |
| `jamie@greenlink.demo` | Harbour Supplies recipient and business operator; generates the rapid-payment sequence |
| `reviewer@greenlink.demo` | Sam Rivera, seeded policy administrator; performs the scripted rule changes |

The existing application's logins on port 3000 are unaffected. The demonstration's authentication quotas remain enabled; the reviewer account has capacity for further interactive review and rule changes after the scripted steps.

1. Sign in as `fraud-reviewer@greenlink.demo` at the printed demo URL.
2. Open **Fraud monitoring**. The AI-only SGD 20,000 payment and sixth rapid payment remain pending. Open their reasons, model scores and matched controls.
3. Inspect **Fraud rules** and its change history. The thresholds/actions are restored, with policy version advanced from 1 to 8.
4. Sign in as Alex to see completed, held and rejected requests in **Activity**, or as Jamie to inspect the rapid-payment history and notifications.
5. Approve or reject the remaining sample requests if useful for your presentation. These additional manual actions occur after the saved report snapshot.

## Evidence and interpretation

The command writes `report.html`, `report.json` and a private-service diagnostic `python.log` under its unique ignored output directory. The HTML report is self-contained, works offline, and can be printed/saved as PDF. It shows AI versus combined scores, explanations, debit timing, policy audit, security responses, reconciliation and the original-data comparison. JSON contains detailed synthetic input/output evidence and all executed assertions, without passwords, service tokens or connection URLs.

One verified run on 24 October 2026 produced 42 passing assertions:

| Scenario | AI score | Combined score | Outcome |
| --- | --- | --- | --- |
| SGD 100 normal payment | 4 | 4 | Completed |
| SGD 2,000 new recipient | 59 | 70 | Held, then independently rejected |
| SGD 75 with review rule | 6 | 70 | Held, then independently approved |
| SGD 75 with block rule | 6 | 95 | Rejected |
| SGD 20,000 AI-only anomaly | 88 | 88 | Held; no deterministic rule matched |
| Sixth SGD 1.25 rapid payment | 10 | 70 | Held by velocity rule |

Model scores can vary with the Singapore time of day; the run asserts the expected decisions and financial effects rather than hard-coding those illustrative numeric values. Python emits 0–94 and requests review at 65+. A review rule raises the combined score to at least 70; a blocking rule sets 95. A lower model score may still produce a rule hold or rejection.

The model is a synthetic-data logistic-regression baseline, not validated production fraud detection. A high score or policy match is a review signal, not a finding that a business committed fraud. See [model documentation](fraud-model.md) and [financial controls](financial-controls.md).
