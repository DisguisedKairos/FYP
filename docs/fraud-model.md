# Explainable fraud engine

## Training and inference

`datasets/fraud-history.csv` contains 1,400 synthetic, labelled transaction observations. `scripts/train-fraud.js` trains regularized logistic regression using a deterministic 80/20 split and writes `services/fraud/model.json`. Runtime inference needs no external API or machine-learning package.

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

The model emits a 0–100 risk indicator. A model score at or above 65 sends the payment for review; model-only scores are capped at 94 so model output alone does not automatically block a customer. Enabled blocking rules, such as a daily outgoing limit, raise the decision to block and score to at least 95. Admin rule changes are versioned and audited.

Each assessment stores its model version, rule version, feature values, history summary, matched rules and plain-language reasons. Repeating the same transaction identifier returns the original assessment even if rules or balances have since changed. Reusing an identifier for different immutable payment details is rejected.

## Evaluation and limits

The model artifact reports dataset hash, row counts, seed, epochs, confusion matrix, accuracy, precision and recall on its held-out synthetic set. These are reproducibility evidence. They are not evidence of performance on real banking data. Real deployment requires representative labels, leakage checks, calibration, fairness evaluation, drift monitoring, investigator feedback and independently approved operating thresholds. Cloud deployment is currently deferred.
