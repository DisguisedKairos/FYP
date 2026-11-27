# Private banking agents and evidence workflows

Test each assistant capability with the [manual question bank, use cases and expected results](assistant-testing.md).


Version 2.8.0 adds explicit tool citations, evidence links, qualitative consistency/relevance checks, user-bound draft values and an automated adversarial evaluation suite. See [AI evaluation and reliability](ai-evaluation.md) and run `npm run evaluate:assistant`.

Chat replies use a friendly, professional tone with direct answers, natural wording and practical next steps. They use at most two short paragraphs, preferring a single paragraph when sufficient, in both explanation styles. The complete narrative passes safety validation before any extra paragraphs are merged into the second; warnings and qualifications are retained. Banking facts appear with supporting evidence references collapsed by default. Users can open Evidence manually or ask to keep it expanded; an explicit display request applies to later replies in that conversation until changed or cleared. Inline citation markers remain hidden. Detailed saved tool evidence remains available in the administrator-only AI audit log. Model grounding and validation still use the recorded evidence.

The standalone Banking insights workspace has been removed, including its forms, saved-investigation list, queue shortcuts and dedicated API endpoints. Its old URL redirects to Overview. Shared calculations and evidence tools remain available through GLDB Assistant; no onboarding agent is included.

| Feature | Access | Where to use it |
| --- | --- | --- |
| Fraud investigation | Bank administrators | GLDB Assistant: ask about a permitted outgoing transaction ID |
| Multi-step banking assistant | Business operators; staff enquiries respect the same tool permissions | GLDB Assistant |
| Liquidity planning | Owned business accounts | GLDB Assistant: ask for a 1-90 day scheduled-payment projection |
| AI rule impact analysis | Bank administrators | GLDB Assistant: ask for a rule preview with proposed settings and lookback |
| Reconciliation investigation | Customers: owned records; administrators: bank operations | GLDB Assistant |

Administrator investigations show the original payment assessment, latest saved monitoring findings and current human case status separately. A later flag does not rewrite the original decision. Ask “Investigate transaction <actual outgoing receipt ID>, including its latest fraud findings and human review status.” Open cases, assigned reviewers and recorded outcomes come from the case records; this enquiry does not create or close a case.

In Fraud monitoring, the suspicious-activity queue, held-payment reviews and model panels load independently. Batch scans include all recorded outgoing transfers and bills. Scan counts distinguish actual AI reassessments from records requiring manual context review. Missing or damaged original inputs cannot receive an invented score or stop the remainder of the scan. Claim a case before recording an outcome; password confirmation and an independent reviewer remain required. Closing an investigation does not settle or reverse its payment. Rule previews accept natural wording, advertise the supported rule identifiers and exclude malformed or mismatched assessment snapshots without changing live rules.

See [daily market and scam context](market-context.md) for official public feeds and the assistant's guarded human-review requests.

## Chat popup and payment drafts

Select **Ask GLDB** in the lower-right corner after signing in. GLDB Assistant opens as a floating chat popup on every banking screen, with no separate sidebar page. Minimize it with the close button or Escape and reopen it to continue. Unsent text and replies remain in the current session while navigating; replies arriving while minimized show a **New reply** badge. Signing out clears the popup and conversation. Existing `/assistant` links redirect to the dashboard and open the popup.

The assistant reads only the signed-in operator's permitted business records. It can show balances, search transaction history, list scheduled payments and prepare transfer, bill or schedule drafts. Use the [question bank and expected results](assistant-testing.md) for examples and the [three-person testing assignment](assistant-team-testing.md) for tester worksheets.

Draft actions minimize chat and open the ordinary banking forms. Chat cannot create, authorize, send, approve or cancel payments. Review the source, recipient, amount and reference in the form, then authorize with the current password. Current balances, business eligibility and fraud controls are checked at submission.

Raw messages stay in browser memory and clear on reload, logout or Clear conversation. The banking service retains private reports, tool evidence and structured draft context; it does not store raw chat messages. Credentials and security codes belong only in the dedicated banking/security forms.

Completed responses must match the configured OpenAI model and pass completion/tool-shape validation. Incomplete or invalid model responses return an explicit unavailable error. Structured draft continuations expire after fifteen minutes; the UI clears an expired reference so **Try again** starts a fresh request without reusing old draft details. Bill drafts require a reference of 3-64 characters before the payment form is offered.

## Provider and startup

Every assistant enquiry requires the configured AI provider. OpenAI is the default; there is no offline report engine, deterministic-only AI simulation or automatic fallback. Verified reads, arithmetic, draft validation and financial controls remain application tools.

Set OPENAI_MODEL and a private OPENAI_API_KEY in .env. Run npm run db:migrate, npm run ai:check to check model access, then npm start. Open http://localhost:3000/dashboard and select Ask GLDB. See [OpenAI configuration and privacy](openai.md).

The model chooses approved read/draft tools and gives qualitative interpretations. OpenAI receives chat and permitted tool evidence, but no database connection, session token, password, MFA secret or financial execution tool. FastAPI uses the same configured provider for fraud scoring. Historical AI reports retain their recorded provider and evidence.

## Presentation questions

These questions illustrate the features; they are not commands to memorize. Ask in your own words, use ordinary follow-ups, and include the financial details needed for the task. The model interprets the request and selects a permitted tool. For example, asking for money movements as columns selects a bar chart, keeping a displayed chart can use an informal request, and asking for a review form does not require the word "draft". Genuine missing or ambiguous details need clarification.

Updated 27 November 2026. Use the [current nine-login Neon guide](../data/testing/neon/README.md). Sign in as `logistics-business@greenlink.demo` for the customer questions; use `reviewer-tester@greenlink.demo` only for administrator tasks. The administrator does not own the customer's deposits or private charts.

A read-only check of the current database confirmed logistics operating account **1099100101**, logistics reserve **1099100102**, and technology recipient **1099100201**. Confirm these in Business accounts before presenting. The former `108880...` feature-tour accounts are not the current presentation setup. Other industry logins must use their own accounts and recorded companies.

Copy only the question into Ask GLDB. Use a fresh conversation for unrelated questions; keep the save-chart follow-up in the same conversation as the chart. Current hosted customer records contain unverified company labels, so they cannot establish real-world company reputation or sanctions status. Public-company research below is a separate lookup, not a claim that the customer has paid that company.

Natural alternatives are supported: “Generate a finance report from 1 to 25 November 2026”, “Show my opening and closing balances from November 1 to 25, 2026”, “Make me a bar graph of my money going in and out over the last six months”, and “Can you help me send SGD 10.00 from 1099100101 to 1099100201? Prepare the form for me to review.” The shared parser preserves shorthand date endpoints and written duration counts. A saved chart keeps its rolling calendar-month or week window when refreshed; an explicit date range remains fixed. These are alternative phrasings, not required commands.

| Feature | Customer question | What to show |
| --- | --- | --- |
| Current balances | Show my savings accounts and their current balances. | Owned account facts; compare with Business accounts. |
| Recent activity | Show my recent transactions. | Owned receipts and recorded statuses. |
| Company search | Find my transactions containing "GLDB Demo Straits Carrier Pte. Ltd.". | Existing logistics counterparty receipts. |
| Historical balances | Show my opening and closing account balances from 2026-11-01 to 2026-11-25. | Historical balances for that Singapore date range, not today's balance. |
| Scheduled instructions | List my scheduled payments. | Current instructions, or an honest empty list. |
| Upcoming obligations | Can I cover my scheduled payments over the next 7 days? | Displayed seven-day period, included schedule occurrences and any source-account shortfall; no guessed future income. |
| Finance downloads | Generate a downloadable finance report from 2026-11-01 to 2026-11-25. | Check the displayed period; download CSV and PDF. |
| Cash flow | Summarize my inflow and outflow this month. | Completed external flows, distinct from current balances. |
| Proposed company payment | Can I pay SGD 10.00 from 1099100101 to GLDB Demo Straits Carrier Pte. Ltd. by tomorrow? | Read-only funding check; no transfer is created. |
| Company dashboard | Show a dashboard of my transactions with GLDB Demo Straits Carrier Pte. Ltd. for the last 90 days. | Inline ledger-derived charts for the recorded company. |
| Monthly trends | Show my transaction trends over the past 6 months as a dashboard. | Monthly charts, including empty and partial months. |
| Save displayed chart | Save this chart as "Presentation trends" and refresh it weekly. | Ask immediately after the trends chart; inspect My dashboard. Refresh is scheduled, not continuous. |
| Saved charts | Show my saved dashboards. | Owned saved definitions and Open in chat controls. |
| Own business profile | Analyze my business profile using my registered company details and transaction activity. | The signed-in business's submitted details and owned activity. |
| Public company profile | Research the public company profile of DBS Group. | Sourced public information and identity limitations; no private DBS records. |
| Industry news advice | Show current news for my industry and explain what our company should do next based on our business activities and priorities. | Relevant dated sources, company context and chat-only advisory concerns. |
| Official market/scam context | Show the latest available FX reference changes and official scam alerts. | Publication dates and explicit stale/unavailable notices where needed. |
| Market-assisted fraud review | Check my transactions for fraud using daily market trends. | Up to five eligible outgoing records, supported concerns and existing human-review status. A new flag is not guaranteed. |
| Counterparty interaction risk | Evaluate reputation and financial risk of interacting with companies recorded in my transactions. | Owned cash-flow exposure, supported reasons and unknowns. Missing reputation evidence is not clearance or a tool failure. |
| Reconciliation | Check my accounts for reconciliation exceptions. | Owned discrepancies or an explicit no-exception result; no balance repair. |

Related read-only follow-ups can keep the company and search filters: after a company chart, ask **Show the same company for October 2026 instead.** After a filtered transaction search, ask **What about October 2026 for the same company?** Keep these in the same conversation. The assistant retrieves fresh owned records; it does not reuse old balances or carry payment instructions into a new request. An explicit bar or line chart request overrides the display preference for that chart, and saving the displayed chart retains its style. **Compare our inflow and outflow in September and October 2026 as a chart** covers both months; **Show a dashboard of my transaction trends this quarter** uses the Singapore calendar quarter through today.

For questions that need background as well as banking records, use these prompts:

- **Explain liquidity and cash flow in wholesale digital banking.** General concepts can be explained without reading an account.
- **Explain that more simply.** Ask immediately after a general explanation in the same chat.
- **What are current Singapore payment authorization requirements? Explain using public sources.** Current information is researched with dated primary-source links.
- **Show my current balances and explain the general liquidity context.** Account facts and public background remain separate.

The assistant can use general banking knowledge and sourced public context. It still retrieves private balances, transactions, funding calculations and company assessments from permitted banking tools. Public context does not fill missing account values or verify a company identity. Clarifications apply to supported banking and business tasks; unrelated personal requests receive the scope reply even when their details are incomplete. Mixed questions retain the supported banking task and decline the unrelated part.

For the sanctions/news scan, ask **Scan news for companies this account deals with, including sanctions and compliance issues.** The assistant selects up to five safe recorded company names from recent owned external receipts, including the current logistics counterparties. Names are searched as recorded; a receipt or similarly named search result does not verify legal identity. Missing public coverage remains explicit and does not clear a company. Industry news and named public-company profiles remain available separately.

For payment-form demonstrations, the current logistics login can ask these complete drafts. Inspect the form, then cancel unless you intend to authorize an actual instruction:

- **Prepare a transfer of SGD 10.00 from 1099100101 to 1099100201.**
- **Prepare a PUB bill payment of SGD 5.00 from 1099100101 with reference "RP-C300".**
- **Prepare a weekly transfer of SGD 10.00 from 1099100101 to 1099100201 starting tomorrow at 09:00.**

Chat prepares forms; it never submits, approves or settles them. Opening/closing accounts, notifications, password/MFA changes, live rule edits and payment decisions are demonstrations in their ordinary screens, not commands that chat executes.

For administrator demonstrations, sign out of the customer account and sign in as `reviewer-tester@greenlink.demo`:

1. Copy an existing outgoing transaction ID from Fraud monitoring, then ask **Investigate transaction {TRANSACTION_ID} and explain its recorded risk reasons.** Replace `{TRANSACTION_ID}` before sending; a copied placeholder requests clarification. The fact cards show the receipt, recorded scores or an explicit missing assessment, earlier-payment counts and reasons. An incoming or inaccessible ID is not a valid positive demonstration.
2. Ask **Preview the high_value fraud rule with a proposed threshold of SGD 9,500 over the last 30 days without changing the live rule.** Inspect its period, proposed threshold, eligible/skipped assessments and before/after decision counts. No eligible snapshots means insufficient coverage; it does not establish that a proposed threshold is safe or measure fraud accuracy.
3. Ask **Check bank-wide reconciliation exceptions.** Customer questions remain limited to their owned accounts.
4. Open **AI audit** using the administrator navigation. It shows permitted structured model/tool activity, not hidden model reasoning or other users' private conversations.

## Guidance and missing details

Common screen instructions, literal test placeholders and incomplete public-company requests return application guidance or a specific clarification without inventing account facts. Value-free security how-to questions point to Profile & security; appended credentials remain blocked before inference. These help replies still require the configured OpenAI service and a current authorized session.

When the model skips tools for a supported banking enquiry, its recovery request requires a permitted tool call. A request that still retrieves no evidence is described as an incomplete banking lookup, rather than incorrectly being called outside scope. Actual balances, reports, payments, research and risk analysis continue to use their evidence tools and existing limits. Refusals for unauthorized records or actions remain expected negative-test outcomes.

The model interprets the requested draft type, chart style and explicitly requested bookmark settings. Direct draft, bookmark and payment-review requests can cite a matching clause from the user's message; command keywords are not mandatory. The quote is validated against the current message and discarded before tool-call storage. The server derives amounts, owned sources, recipients and schedule times from the operator's wording or current draft context, preserving Singapore time conversion and the ordinary authorization workflow. Current payment-source reads stay separate from historical balance periods. Review flags still require an eligible payment-specific signal, and public news advice remains advisory in chat. Narrative checks distinguish explicit statements such as "no payment was sent" and "not authorization or a guarantee" from claims of execution or guaranteed funding; mixed statements that still claim an unauthorized action remain blocked. Wording corrections return bounded alternative paragraphs from the same model, retain the original enquiry's evidence requirements and select a paragraph only after it passes the same financial checks. If every alternative fails, the unsafe narrative remains withheld. This tool interface follows the [official OpenAI function-calling guidance](https://developers.openai.com/api/docs/guides/function-calling).

## Evidence, privacy and boundaries

Missing payment details must produce a targeted question, rather than interpreting general account balances as payment coverage. An explicit statement that funding cannot yet be determined is permitted; positive coverage claims remain blocked when a check is incomplete or short. If clarification metadata incorrectly lists tools for a future request, the invalid response is rejected and the same provider may correct it once within the original task deadline. Uncorrectable metadata still fails; the correction cannot grant permissions or execute an action.

A failed wording correction can use the remaining attempt within the existing two-attempt limit and task deadline. Every corrected paragraph still passes financial validation; repeated failures withhold unsafe prose while retaining the authoritative banking cards.

News advice selects unchanged source excerpts from the current retrieved summaries. The function schema constrains the choices, and the application still verifies their source-part pairing. Freshness limits, the bounded correction attempt and the prohibition on invented replacement evidence remain enforced.

Migration `007_banking_agents.sql` adds `agent_runs` and append-only `agent_tool_calls`. Version 2.9.0 also adds three [transaction-monitoring and human-review tables](fraud-monitoring.md), bringing the schema to 28 tables at that release. Migration `009_openai_provider.sql` preserves historical evidence while permitting OpenAI agent runs. Migration `010_saved_dashboard_views.sql` adds private reusable company dashboards, bringing that release to **29 tables and ten migrations**. Migration 011_assistant_customization.sql adds private preferences and chart refresh metadata; that release has **30 tables and eleven migrations**. Existing identity, balance and transaction records are preserved.

Reports, permitted tool arguments/results and structured draft context are saved privately in PostgreSQL. Raw user messages, model prompts and hidden reasoning are not stored by the banking service. A report may contain a generated paraphrase. Clearing a conversation clears browser messages; it does not remove evidence records. Assistant continuations are restricted to the initiating user. The administrator-only AI audit API retains role and ownership restrictions for historical evidence. Sensitive input is refused before creating a run.

The runtime role cannot rewrite/delete tool evidence, delete runs or change a run's owner. Role and ownership checks are repeated inside tools. HTTP execution rechecks the session between tool calls and before completion. Changed security versions invalidate draft continuations/results; a continuation expires after fifteen minutes. Tools accept strict argument allowlists. There is no arbitrary SQL, shell, URL fetching or payment execution tool.

Limits: forty starts per user and 120 per IP per fifteen minutes, two concurrent recent runs across the database, eight tool calls, four tool-planning rounds and a sixty-second model deadline. If required evidence arrives on the last planning round, a bounded final answer without tools can follow within that same deadline. It cannot retrieve more records or execute a tool; missing required evidence still fails. Each model request has a bounded timeout/response size. Unknown tools, unsupported arguments, unavailable inference and stale authorization produce explicit failures. Banking interpretations require retrieved evidence; trusted help/clarification contains no banking facts and has no evidence links. A failed run records only a bounded error code.

Financial calculations, scores and lifecycle statuses are application facts. Model prose is interpretation. Local trials exposed numerical mistakes; validation now withholds numerical narrative claims and invalid score scales while retaining tool evidence. Human review and the existing independent approval/password controls remain necessary. These controls are consistent with [OWASP excessive-agency guidance](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

## Verification

```sh
npm test
npm run test:browser
npm run demo:agents
```

The explicit agent demonstration creates a disposable PostgreSQL schema using `TEST_DATABASE_URL`, seeds synthetic businesses, scores a test payment through the real private FastAPI/OpenAI gateway, and exercises five assistant enquiries with real OpenAI. It verifies investigations do not change financial balances, then removes the schema. Native data is never seeded by this command. OpenAI credentials are required for this optional demonstration; CI exercises the model adapter and tool boundary with controlled responses.

`tests/dft-agents.test.js` covers ownership, CSRF, staff restrictions, multi-turn drafts, schedules, recurrence, value conservation, historical simulations, reconciliation isolation, hostile tool calls, bounded loops, stale authorization and model-origin/narrative checks. `tests/dft-agents-browser.js` covers mobile assistant workflows, removal of the retired workspace, and administrator-only audit access.

## AI evaluation audit

Administrators can open **AI audit log** or **View AI audit** on their responses/reports to inspect model call attempts and saved tool evidence. Customer navigation, assistant responses and insight reports do not show audit links. A customer opening `/ai-audit` returns to the dashboard, and direct audit API requests receive 403. New runs include a prompt-template digest, request count and final narrative safety outcome (validated evidence, help without banking claims, or withheld interpretation). Optional narrative repair is identified separately in the request timeline. Raw rejected prose and hidden thoughts are never copied into the new log. A model request can complete while its suggested tool or narrative is refused by the application. Failed attempts and unavailable-model checks are visible without pretending analysis succeeded.

The audit reuses agent_runs, agent_tool_calls, fraud_assessments, fraud_screenings and append-only audit_log. No new database migration or duplicate evidence table is needed. Staff payment/monitoring access does not grant access to another user's assistant records. Read-only evidence endpoints remain available when OpenAI is unavailable. See [API filters and permissions](api.md#ai-audit-log-2110).

## Company activity dashboards

Presentation questions are examples rather than required commands. You can reword them naturally, for example “How much have I got available right now?” or “Put that in everyday words for me.” The model selects the appropriate evidence tools by meaning. Include real company names and valid dates when needed; the assistant asks for genuinely missing details rather than requiring a particular phrase.

The assistant can generate an owned transaction dashboard for a named company or biller using get_company_activity. Ask "Generate a dashboard for transaction activity with Harbour Supplies for the last 30 days" to display the charts directly in chat. Ambiguous names return choices inside the reply. The dashboard shows completed incoming/outgoing/net amounts, payment statuses, monthly activity and paginated receipts. Request another period in chat to change its Singapore date range. See [Company activity](company-activity.md) for matching and access limits.

## Company payment readiness in chat

The read-only `check_payment_funds` tool also supports dated company-payment questions and combined cash-flow summaries. It takes no model-provided arguments: the server reads the requested amount, owned source, recipient label and deadline from the message. The response includes `paymentReadiness`, with settled business/source cash flow, an explicit SGT deadline, current source funds, scheduled outgoing obligations, the additional proposed payment and a funding gap. Recipient labels are not verified identities. The default historical summary is month-to-date; explicitly asking for last month changes only the historical summary. Future credits are excluded until settled, past income is not counted twice, and no funds are combined across accounts. Planning dates are limited to 90 days. Missing details or bounded-calculation limits never produce a positive coverage result. General scheduled-payment projections remain available separately.

## Market research and customization

The new get_business_profile tool analyzes owned submitted details and activity; get_market_insights and research_public_company retrieve sourced public information in a separate request without private banking facts. Charts remain in chat and can be kept on the dedicated My dashboard page with private preferences and weekly refresh. See [workflow and boundaries](assistant-insights.md).

The scan_counterparty_news tool selects up to five owned recent external counterparty labels, then runs separate official UN/MAS/OFAC sanctions/compliance-source research and company/industry news research. Coverage, identity uncertainty and unavailable checks remain visible. Only names and a generic industry category enter the public searches; the tool cannot clear or change payments or open cases. See [details and prompts](assistant-insights.md#counterparty-news-sanctions-and-compliance-sources).

For current news in the operator's industry, get_market_insights accepts the industry topic and uses only a mapped generic sector from the owned profile. The analyze_news_insights tool analyzes the sourced public summaries retrieved in the same run, returning business implications, independent checks and chat-only advisory flags. It cannot create payment flags or staff cases. See [news advice, source limits and example questions](assistant-insights.md#industry-news-advice-and-advisory-flags).

Migration 012 brings the schema to **31 tables and twelve migrations**, adding unverified scenario inputs. The assess_counterparty_risk tool generates separate reputation/financial interaction grades with the configured OpenAI model and owned receipt totals. It cannot clear companies or execute payments. See [sector cases, demo login and prompts](counterparty-risk.md).
