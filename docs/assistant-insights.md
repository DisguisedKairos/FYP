# Market research and customized dashboards

Open **Ask GLDB** for analysis, or **My dashboard** in the sidebar for saved charts and assistant preferences.

## Questions to try

- "Check the latest available Singapore business and financial market news and give me sourced market insights."
- "Research the public company profile of DBS Group."
- "Analyze my business profile using my registered company details and transaction activity."
- "Show my transaction trends over the past 6 months as a dashboard."
- After opening a chart: 'Add this chart to my customized dashboard and refresh it weekly as "Supplier trends".'

Public research uses the configured OpenAI model with live web search, a check time and clickable citations. Publication can lag events; this is an on-demand check, not streaming news or an executable price feed. Unavailable model/search access or unverified source annotations fails explicitly, without invented or offline substitutes.

Existing dated ScamShield/ECB context remains separate for guarded fraud review. News alone does not establish fraud, change scores, authorize payments or determine creditworthiness.

## Industry news advice and advisory flags

Ask **Show current news for my industry, explain the business implications and advise what concerns to flag**. For a named public company, ask **Research the latest public news about DBS Group and advise what operating risks deserve attention**. For existing suppliers, ask **Scan news for my counterparties and advise what concerns to flag**.

The assistant retrieves relevant public news first, then calls the configured OpenAI model to analyze only those sourced summaries. The industry option maps the signed-in business profile to a fixed generic sector, including energy/utilities; it does not send the submitted industry text, private profile, balances or receipts to search. Searches prioritize recent developments and ask for source/event dates, while clearly distinguishing background and unverified dates. Check time is not publication time or a continuous news feed.

Chat cards show business implications, practical independent checks, clickable source links and one of these advisory labels:

- **Watch this development:** monitor an operating or market development.
- **Consider human review:** independently verify a concern before applying it to the business.
- **Insufficient evidence:** the retrieved news cannot support a conclusion; this is not clearance.

The model can recommend checking source dates, legal identity, official compliance records, beneficiary changes, supplier dependencies, liquidity or cyber safeguards. Its summary context must match the retrieved text; source URLs are inherited from the search results. A quoted context excerpt comes from the retrieved summary, not a separately verified publisher quotation. Unavailable official checks and omitted report parts remain visible. Missing news or failed AI analysis never produces substitute flags.

These are **advisory flags in chat only**. They create no staff review item, payment flag, block, authorization, fraud score or rule change. A news-advice request cannot invoke the payment-review flag tool; a separate supported payment-specific fraud-review request uses the existing controls. Allegations and name matches do not prove fraud or verify a company's legal identity. Raw prompts and hidden model reasoning are not added to the audit log; authorized administrators can inspect the existing `news_advisory_evaluation` metadata for their own runs.

No database migration or additional API key is required. Existing OpenAI access must support web search. See [official OpenAI web search and citation requirements](https://developers.openai.com/api/docs/guides/tools-web-search) and [strict function tools](https://developers.openai.com/api/docs/guides/function-calling).

## Private and public company analysis

Private analysis reads only the signed-in operator's submitted business name, industry, country, legal form, application status and owned completed activity. It excludes registered addresses, registration identifiers and other operators' profiles. Submitted details are not independently verified.

Public research requires a company name in the question. Similar names can refer to different companies; public records grant no access to private banking accounts. Web search runs in a separate OpenAI request containing only that validated public name or a fixed market-topic query. Private balances, identifiers, receipts and conversation are not copied into search. Ordinary banking inference still receives permitted private evidence. Public text is untrusted data, rendered as escaped text with validated links.

## Counterparty news, sanctions and compliance sources

Ask "Scan news for companies this account deals with, including sanctions and compliance issues" or name an exact recorded company: "Check sanctions and recent news for PUB" if PUB appears in your own recent external receipts.

The scan selects at most five safe counterparty labels from the signed-in operator's completed external receipts in the last 90 days, most recent first. Own transfers, opening balances and old/unsettled receipts are excluded. Coverage shows selected/omitted counts, including names not searched. An exact company argument must be in the question and match an owned receipt; public data never grants another operator's banking access.

Two separate live OpenAI searches use only those names and a server-mapped generic industry category. One restricts search and citations to official UN, Singapore MAS and US OFAC domains for sanctions listings and regulator enforcement notices. The other checks company and relevant industry news. Balances, account numbers, transaction amounts/descriptions, addresses, raw industry text and raw chat are not sent to these searches. Other companies mentioned in industry news are public examples, not inferred counterparties.

Each report includes check time and cited public sources, with source dates and identity gaps when available. An inaccessible search remains unavailable; partial results stay labelled. Missing results, general source landing pages, name similarity and headlines do not establish legal-entity identity, sanctions clearance, complete list coverage or compliance. A human must check entity identifiers, dated official records and applicable jurisdictions. The tool never blocks/approves payments, changes scores or creates fraud cases. Request metadata uses the existing admin-only AI audit.

Official entry points: [UN consolidated list](https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list), [MAS designated persons/entities](https://www.mas.gov.sg/regulation/anti-money-laundering/targeted-financial-sanctions/lists-of-designated-individuals-and-entities), [OFAC Sanctions List Service](https://ofac.treasury.gov/sanctions-list-service). These links are always available for manual checks; their presence alone does not mean a lookup succeeded.

## Granular transaction trends

Use past/last 1-12 calendar months, including the current partial month. Explicit dates and rolling-day filters remain available. Monthly facts include received/paid/net, completed and directional counts, average outgoing payment rounded to cents, and change from the preceding displayed month. Percentage change is unavailable without a prior nonzero baseline. Zero-activity months remain visible; partial months are labelled without extrapolating forecasts.

Only completed external receipts affect amounts. Own transfers/opening funding are excluded; pending/rejected counts stay separate.

## Save and customize

Ask to save/add/pin the displayed chart, or select **Save to My dashboard**. It stays available in chat and on **My dashboard** across sign-ins. Saving needs explicit intent and an unambiguous owned definition.

The dedicated page supports chart titles, bar/line/table style, comparison/status visibility, manual/weekly refresh, Refresh now and removal. Current versions protect concurrent edits. Saved filters remain immutable; create another chart for a different company/period. Limit: 20 definitions per operator.

Private assistant preferences control concise/detailed explanation, default 1-12-month trend period, new-chart style and market topic. They affect future requests, preserving banking permissions, authorization, numerical checks and Singapore dates.

## Weekly refresh

A new saved chart has an initial bounded snapshot. Weekly mode becomes due seven days after its last successful saved refresh. The existing worker leases due charts, re-queries only the owner's ledger, stores a snapshot and schedules the next week. It performs no AI inference or financial action.

Vercel Hobby's existing daily job processes due charts on its next run around 08:00 Singapore time within its scheduling window. This does not promise an exact minute. Work is bounded to ten charts per job; additional due charts wait for another invocation.

Opening a chart queries live records. The page distinguishes live query time from last saved refresh and next due time. Failed scheduled refresh retains the old snapshot, records an error and retries the next day. Manual refresh updates saved refresh metadata too.

## Setup and verification

Apply migration 011 and runtime grants before deployment:

    npm run db:migrate
    npm run build

Use the existing private runtime/migration configuration. Do not reseed. Migration 011 adds assistant_preferences and saved-chart settings/snapshots, preserving financial records and existing definitions.

Tests: tests/dft-counterparty-news.test.js, tests/dft-assistant-insights.test.js and tests/dft-assistant-insights-browser.js, alongside existing company, saved-view, OpenAI and SQL permission suites. Controlled providers are test doubles; real verification uses the configured provider in a disposable schema.

References: [official OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search) and [function calling](https://developers.openai.com/api/docs/guides/function-calling).

For private reputation and financial interaction assessments, use the [sector portfolio and company-risk workflow](counterparty-risk.md). Fictional GLDB Demo names are excluded from public news research.
