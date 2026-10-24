# Fraud evaluation and assistant reliability

Version 2.8.0 adds reproducible model evaluation, staff monitoring and assistant evidence checks. These features do not change the approved fraud weights, live review threshold, payment rules, database schema or financial balances.

## Fraud evaluation

Sign in as bank staff and open **Fraud monitoring**. Below the queue, **Model evaluation and monitoring** shows:

- The approved model's original synthetic holdout, with TP/FP/TN/FN, precision, recall, false positive rate and review workload at several thresholds. These test-set comparisons are diagnostics, not a basis for selecting a production threshold.
- A separate, deterministic synthetic chronological experiment: earliest 60% for fitting, next 20% for threshold selection, last 20% for final testing. Equal timestamps stay in the same partition. The threshold maximises validation F1 among 35, 50, 65, 80 and 90; ties select the lower value. Final test labels never influence fitting or selection. This candidate is never deployed.
- Raw sigmoid calibration bins and Brier score. These describe the raw output, not the capped 0–94 risk indicator, and do not recalibrate inference.
- Recent transaction feature distributions compared with the approved synthetic training partition. Population stability index (PSI) uses five fixed bins per feature and additive smoothing. A demonstration threshold of 0.2 produces an investigation prompt only after 100 matching-model assessments. Neither value is a validated banking policy.

The temporal demonstration generates simulated observations and illustrative timestamps in memory, including a later behavioural shift. It is not a reconstruction of historical customer transactions. The original checked-in dataset has no timestamps; it is not relabelled as temporal validation. Customer-separated testing, representative verified labels and checks for future information in upstream aggregates remain necessary.

The staff-only `GET /api/fraud/evaluation?days=30` accepts 1–90 days. It reads the latest 1,000 assessment attempts, excludes future attempts and assessments without the matching model version/checksum, reports missing results, and never returns raw customer records. It verifies the approved artifact/dataset hashes and requires the running scorer version/hash to match. Restart after an explicitly approved artifact replacement to refresh the process cache.

Recorded review/block decisions are not confirmed fraud labels or settlement outcomes. No live accuracy, precision or recall is claimed. Distribution alerts do not establish fraud, and an absence of alerts does not establish safety.

Run the reproducible report without changing the model:

```sh
npm run evaluate:fraud
```

Evaluate an operator-supplied labelled temporal CSV locally:

```sh
npm run evaluate:fraud -- --temporal-csv path/to/private-history.csv
```

Use the eight numeric fields documented in [the fraud model guide](fraud-model.md), plus `occurredAt` as an ISO UTC timestamp, such as `2026-01-01T00:00:00.000Z`. `hour` must match Singapore local time at that instant. The restricted CSV format uses unquoted numeric values/timestamps, requires whole nonnegative values, both labels, at least 100 observations, and at least 20 observations with both labels in each time partition. Limit: 8 MiB/50,000 rows. Verify feature provenance and obtain labels independently; the application cannot validate their truth. No upload or automatic model promotion occurs.

## Assistant reliability

Local Ollama receives references such as `[E1]` beside tool results. The server constructs the reference-to-run/step mapping; the model cannot invent a valid reference to another run. The assistant and saved report show these references, and **View saved evidence** opens the originating user's private report. Exact balances, payment values and dates come from tool fact cards rather than generated prose.

Model narratives must cite a retrieved reference. Unknown/missing references, numerical claims (digits and common English number words), external links, credential requests, execution claims, categorical certainty and selected contradictions are withheld. Reconciliation cannot establish an absence of fraud, and scheduled-payment scenarios cannot establish funding for any potential obligation. Checks compare prose with recorded allow/review/block decisions, projected shortfalls, reconciliation exceptions and missing draft fields. Recognised balance, history, scheduled-payment and liquidity questions require corresponding tools. One bounded wording repair is allowed; failure preserves the authoritative evidence while withholding the interpretation.

Model-created draft values must agree with details extracted from the user's explicit request or unexpired draft context. A model cannot supply a missing recipient or silently change the amount. Ambiguous requests require clarification or the normal banking form. Existing ownership, session, tool allowlist, deadline and authorization controls remain in force.

These are bounded deterministic checks, not a proof that every natural-language statement is correct. A valid citation proves a tool was retrieved, not that every claim follows from it. Review the facts and use the ordinary authorized banking forms for financial actions.

Actual local trials exposed invented counts expressed as words, fraud conclusions inferred from reconciliation and an invented approval reason based on missing history; these now have regression cases. Cold model loading under competing workloads can exceed the request deadline and returns an explicit unavailable result. Use the offline workflow explicitly if needed; a model request does not silently switch modes.

```sh
npm run evaluate:assistant
npm run test:browser
npm run demo:agents
```

The assistant evaluation suite runs controlled model outputs against real disposable PostgreSQL schemas: valid/forged citations, contradictory claims, irrelevant tools, incomplete and altered drafts, direct/record-based prompt injections, and cross-company probes. It asserts unchanged balances. These are repeatable application guardrail evaluations, not statistical quality scores for an LLM. `demo:agents` additionally exercises the installed local Ollama model and actual Python scoring; it reports withheld interpretations separately. Native banking records are never seeded by either command.

Methodology references: [time-aware model evaluation](https://scikit-learn.org/stable/modules/cross_validation.html#time-series-split), [calibration diagnostics](https://scikit-learn.org/stable/modules/calibration.html), and [OWASP agent permissions and human authorization](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).
