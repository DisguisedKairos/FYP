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

## Private and public company analysis

Private analysis reads only the signed-in operator's submitted business name, industry, country, legal form, application status and owned completed activity. It excludes registered addresses, registration identifiers and other operators' profiles. Submitted details are not independently verified.

Public research requires a company name in the question. Similar names can refer to different companies; public records grant no access to private banking accounts. Web search runs in a separate OpenAI request containing only that validated public name or a fixed market-topic query. Private balances, identifiers, receipts and conversation are not copied into search. Ordinary banking inference still receives permitted private evidence. Public text is untrusted data, rendered as escaped text with validated links.

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

Tests: tests/dft-assistant-insights.test.js and tests/dft-assistant-insights-browser.js, alongside existing company, saved-view, OpenAI and SQL permission suites. Controlled providers are test doubles; real verification uses the configured provider in a disposable schema.

References: [official OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search) and [function calling](https://developers.openai.com/api/docs/guides/function-calling).
