# Explainable fraud engine

## Training and inference

`datasets/fraud-history.csv` contains 1,400 synthetic, labelled transaction observations. `scripts/train-fraud.js` trains regularized logistic regression using a deterministic 80/20 split and writes `services/fraud/model.json` plus the approved checksum in `fraud_service/model.sha256`. The Python FastAPI service performs inference without an external AI API or machine-learning library. A missing, invalid or changed unapproved artifact fails startup.

Run `npm run train:fraud` to reproduce the checked-in model. To train from another governed dataset, pass its CSV path: `node scripts/train-fraud.js path/to/history.csv`. Use `--generate-demo` only to regenerate the synthetic baseline dataset. No customer records are uploaded.

Required CSV fields:

| Field | Meaning |
| --- | --- |
| `amountCents` | Current payment amount. |
| `averageOutgoingCents` | Average completed historical outgoing amount. |
| `outgoingCount10m` | Completed outgoing payments in the preceding ten minutes. |
| `outgoingAmount10m` | Total of those payments. |
| `knownPayee` | 1 if the recipient appears in completed outgoing history; otherwise 0. |
| `balanceCents` | Available source balance. |
| `hour` | Singapore local hour, 0–23. |
| `label` | Historical fraud label: 0 or 1. |

Inference recomputes these features from the authoritative ledger history supplied by the banking service. Future records, rejected payments and transfers between a customer's own accounts do not inflate recent external payment counts. Features include logarithmic amount, amount deviation, velocity, recipient familiarity, balance utilisation, unusual hour and recent outgoing value.

## Decisions and explanations

Python emits an integer model score from 0 to 94 using `min(94, round(sigmoid(logit) * 100))`, with JavaScript-compatible rounding. A score of 65 or above requests review; the model cannot independently block. The Node banking service adds approved deterministic policy rules. A matched blocking rule raises the combined score to 95 and rejects the instruction; a matched review rule raises it to at least 70. Administrator rule changes require fresh password authorization, the current policy version and an audit record.

Each assessment stores its model version, rule version, feature values, history summary, matched rules and plain-language reasons. Repeating the same transaction identifier returns the original assessment even if rules or balances have since changed. Reusing an identifier for different immutable payment details is rejected.

## Evaluation and limits

The artifact's primary metrics use the published rounded weights and actual runtime review threshold 65 on 280 held-out synthetic observations: TP 61, FP 2, TN 194, FN 23; precision 96.83%, recall 72.62%, accuracy 91.07%. The prior probability-threshold 0.5 experiment is labelled separately under `diagnostics`, not presented as deployed-policy performance. Configurable banking rules are outside these model-only metrics.

The shuffled 80/20 synthetic split is not time-separated or customer-separated production validation. These results establish reproducibility only. Real banking use needs representative labels, leakage checks, calibration, fairness evaluation, drift monitoring, investigator feedback and independently approved thresholds. Python tests independently recompute the held-out confusion matrix and compare 63 boundary/feature vectors against the JavaScript reference. They also test authentication, immutable source/payload binding, schema rejection and model-artifact tampering.
