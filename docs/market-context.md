# Daily market and scam context

Ask GLDB Assistant **Check my transactions for fraud using daily market trends**. It can read the latest five permitted outgoing payments, compare recorded pre-payment patterns with recent official scam topics, and request an independent human investigation for supported concerns. A specific outgoing transaction ID can also be supplied. Customers can inspect only their own payments; bank administrators retain their existing bank-wide access.

The configured OpenAI model chooses the permitted tools and whether to request review. Fixed checks constrain which payment-specific signals qualify; they are eligibility controls, not a simulated AI risk model. The existing Python/OpenAI numeric screening engine and financial rules remain authoritative for payment scoring and authorization.

## Official public sources

- [ScamShield alerts](https://www.scamshield.gov.sg/resources/scam-alert/): published alert titles, dates and topic labels. Only alerts published in the preceding 45 calendar days qualify; absence of recent alerts is reported as unavailable.
- [ECB reference exchange rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html): the last-90-days XML feed supplies the latest two published fixings. The service derives USD/SGD, EUR/SGD and GBP/SGD crosses and their percentage change. These are reference data, not live stock/crypto prices, trading quotes or conversion rates for executing transactions. The latest fixing must be at most seven calendar days old to accommodate weekends and holidays.
- [ECB financial news](https://www.ecb.europa.eu/rss/press.html): up to five dated releases from the preceding fourteen calendar days. This is ECB financial and policy coverage, not a complete global news feed.

Sources are fetched on demand through fixed HTTPS URLs with redirects refused, an eight-second timeout per source and a one-megabyte response limit. A warm application caches successful context for at most one hour, or partial/unavailable results for five minutes; the Singapore calendar-day change expires the cache. A cold Vercel function may fetch again. This does not require a new scheduled task, database migration or API key. A daily check does not imply that publishers issue a new alert or fixing every day. The assistant shows publication dates and explicit missing-source notices rather than inventing current values.

## Review guardrails

Only an explicit request to check banking transactions, payments or account activity for fraud, scams, suspicious behavior or risk permits a flag. Reading fraud news alone does not authorize an investigation case. The model must first analyze the exact permitted payment in the same run and then select an eligible signal code. Eligibility requires recorded substantial screening concern, unusual pre-payment amount/velocity, or a substantial unfamiliar-recipient payment whose description overlaps a recent official scam topic. A topic overlap is a reason to verify the business purpose; it does not prove a scam. Historical aggregates must match the original bound payment snapshot.

Market movement or news alone cannot qualify a flag. No model-supplied explanation, source URL, score, balance or payment decision is accepted by the flag tool. Source pages are untrusted data, not instructions. Role, ownership, session, freshness and eligibility checks run again before evidence is saved.

Flags reuse the existing fraud investigation queue, screening evidence and durable staff notifications. They assign no new numeric score, move no money and do not approve, reject, refund or freeze a payment. Duplicate signals do not create duplicate cases or notifications. The assistant cannot reopen a case already closed by a human; the existing independent monitoring workflow retains its own material-change rules. The human reviewer must still claim the case and authorize the final review outcome, and cannot adjudicate their own payment.

Chat replies omit evidence dropdowns and citation markers. Dated public facts remain visible in the answer. Tool snapshots and the model-request trace remain in private investigation records and the administrator-only AI audit log; staff can inspect the saved daily context on the fraud case. No banking data is sent to the public feeds. Permitted banking evidence and public context are sent to the configured OpenAI model under the existing disclosure.

Run npm test for parsing, stale/malformed feeds, ownership, revocation, false-flag prevention, duplicate delivery and closed-case protections. Run npm run test:browser for the customer-popup-to-independent-staff workflow. Production uses real official feeds and the configured OpenAI model; synthetic feeds and tool-selection doubles exist only in the test suite.
