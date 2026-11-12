# Sector companies and counterparty risk

One business login owns eight fictional counterparty profiles and historical receipts:

| Field | Value |
| --- | --- |
| Email | sector-tester@greenlink.demo |
| Initial demo password | Greenlink123! |
| Role | Business operator (customer) |
| Business | GLDB Demo Sector Portfolio Pte. Ltd. |
| Savings account | Sector demonstration savings |

These are intentionally public demonstration credentials. Use this identity for the fictional portfolio only. Rerunning setup preserves a changed password, MFA settings and existing records.

## Companies and case inputs

| Fictional company | Sector | Scenario to evaluate |
| --- | --- | --- |
| GLDB Demo Harbor Freight Pte. Ltd. | Logistics | Incomplete ownership documents |
| GLDB Demo Circuit Cloud Pte. Ltd. | Technology | Unresolved cyber incident and delivery disruption |
| GLDB Demo Quartz Trading Pte. Ltd. | Wholesale trade | Hypothetical sanctions-name similarity; legal identity unresolved |
| GLDB Demo Keystone Build Pte. Ltd. | Construction | Financial distress indicators and disputed delivery |
| GLDB Demo Clearwell Health Pte. Ltd. | Healthcare | Licensing-document discrepancy and delivery dependency |
| GLDB Demo Aurora Energy Pte. Ltd. | Energy | Opaque ownership and an unverified beneficiary change |
| GLDB Demo Lantern Hospitality Pte. Ltd. | Hospitality | Unverified adverse-media allegation and seasonal liquidity pressure |
| GLDB Demo Cedar Advisory Pte. Ltd. | Professional services | Baseline case with no supplied adverse flag; safety remains unestablished |

Every case input is fictional. No company in this table is claimed to appear in real news or on an actual sanctions list. Scenario flags are stored inputs, not stored AI scores or verdicts.

## Ask the assistant

- "Evaluate reputation and money risk of interacting with my demo companies across sectors."
- "Compare reputation and financial risk for my flagged companies."
- "Evaluate reputation and financial risk for GLDB Demo Aurora Energy Pte. Ltd."
- "How much have I paid and received when interacting with the flagged companies?"

The assistant retrieves up to eight owned counterparties, then calls the configured OpenAI model through a separate private, strict assessment schema. It generates reputation and financial interaction grades separately, explains the cited case inputs, and recommends independent checks. Without a working configured model or a valid response, it does not substitute fixed grades.

Grades are **Elevated review concern**, **Review recommended**, or **Insufficient evidence**. They are qualitative review aids, not calibrated fraud probabilities, credit ratings, sanctions clearance or payment authorization. The baseline case must not be labelled safe merely because adverse evidence is absent.

Cards show exact completed paid/received/net cash flow, pending outgoing requests, and completed paid amounts associated with open payment reviews. Amounts come from the owned database snapshot over the last 90 days. Historical payments are not losses or predicted losses. Pending value is not reserved or booked as a loss. The report creates no payment, case, rule or balance change.

Fictional names are excluded from live public-company news/sanctions research. For genuine public companies, use the existing sourced news workflow; legal-entity matching and applicable-jurisdiction checks still require a human reviewer. A recorded payment review concerns that payment and does not establish misconduct by the named company.

## Operator setup

Apply the additive schema migration and existing runtime grants, then seed the dedicated account:

    npm run db:migrate
    npm run demo:companies

Use the project's ignored private runtime/migration configuration. Migration 012 adds the operator-maintained demo_counterparties table. The runtime role can read it; it cannot create or alter scenario flags or the registered historical-receipt IDs. Automatic fraud monitoring excludes only those operator-registered historical fixture IDs. New payments remain eligible even if their reference resembles a demo reference, and staff can explicitly inspect a historical fixture payment.

Setup inserts deterministic, fictional historical receipts and adjusts only the dedicated account by newly inserted amounts. It verifies fixture provenance, refuses unrelated identities/account numbers and leaves existing customer balances and credentials intact. Reruns insert no duplicate receipts and do not top up spent funds.

## Verification

tests/dft-counterparty-risk.test.js covers seeding, exact monetary totals, ownership, CSRF, provider schemas, unsafe/invented assessments, model outages, current-session checks and escaped report rendering. The PostgreSQL permission suite denies runtime writes to the scenario table. Controlled adapters are tests only; live evaluation uses the configured OpenAI model. Manual cases SECTOR-01 through SECTOR-11 are in the [assistant checklist](assistant-testing.md).

Assessment request metadata uses the existing admin-only AI audit with phase counterparty_risk_evaluation. Raw model reasoning is not stored.
