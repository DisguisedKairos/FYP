# Company dashboards inside GLDB Assistant

Ask GLDB Assistant: "Summarize my transactions with other companies in a dashboard and save it for future use." The reply displays received/paid/net SGD totals, monthly bar graphs, company comparison bars and a transaction-status ring directly in the chat popup.

You can ask about a named company, for example "Show a dashboard with Harbour Supplies for the last 30 days." Ambiguous recorded names produce choices inside the reply. Selecting a company, paging results or refreshing figures keeps the current banking page open. Dashboards are generated only after an assistant request; there is no company dashboard page or sidebar link. The ordinary account overview remains available.

## Saved dashboards

Ask "Save this dashboard" after a company summary, request saving in the original prompt, or use **Save this dashboard** on its chat card. The saved definition stays private in PostgreSQL across sign-ins.

Ask "Show my saved dashboards" to see your saved cards in chat. **Open in chat** retrieves fresh figures without opening a separate page. You can also ask the assistant to reopen a saved dashboard; it lists owned definitions before selecting an exact returned ID. Duplicate names require a choice. Removing a saved view removes its definition and leaves banking transactions unchanged. Each operator can keep up to 20 definitions.

Rolling last-N-days views advance with Singapore's calendar day. Explicit dates and named-month requests retain fixed dates. Existing saved definitions remain compatible. These are live views rather than financial snapshots.

Former /company-activity and /saved-dashboards URLs redirect to the account overview with the assistant open. They do not generate a dashboard automatically.

## Financial and access scope

- All graphs, amounts and counts come from permitted PostgreSQL queries. Model-generated HTML, scripts, SQL and numerical claims are never executed or used as chart values.
- Customers and administrators see only activity on their own accounts. The chart does not expose another company's balances or a bank-wide investigation.
- Company names use recorded counterparty labels with case and whitespace normalization. Labels do not verify legal company identity; distinct historical names remain separate.
- Own-account transfers and opening funding are excluded. Completed transactions alone contribute to monetary totals and monthly bars. Pending and rejected requests contribute to status counts.
- Totals, monthly bars and status counts cover the full matching period. Company comparison bars show the current company page with an explicit range; their scale is shared within that page.
- The default window is 90 inclusive Singapore calendar days, with at most 366 selectable. Ask for last/past N days, this month, last month, or two YYYY-MM-DD dates. Empty periods display an explicit no-activity message.
- Private saved-view writes retain session, CSRF/origin, ownership and current authorization checks. A foreign view ID returns 404 through the API. The model can reopen only an ID retrieved from the owned list in the same run.
- Charts and raw chat messages stay in browser memory and clear on sign-out. Saved definitions, private tool results and AI audit records remain in PostgreSQL. The AI audit interface remains administrator-only; customers see no evidence panel.
- Dashboard operations create no payments, change no balances or risk scores, and make no fraud determination.

## Technical contract and verification

The assistant uses get_company_activity, save_company_dashboard, list_saved_dashboards and open_saved_dashboard. Its validated response carries structured companyDashboard data or savedDashboards definitions for the chat renderer. List/open tools are read-only. Saving requires explicit user intent and uses the server's retrieved definition. After a company selection in chat, a save-this-dashboard follow-up submits the displayed definition; the server validates its shape, dates and ownership against fresh ledger queries before using it as save context. The model never supplies save filters.

The authenticated /api/company-activity and /api/dashboard-views endpoints support chart refreshes, drill-downs, pagination and private saves in chat. They do not provide separate frontend views. Existing installations need migration 010_saved_dashboard_views.sql and its runtime grants; this UI change needs no new migration.

PostgreSQL tests verify ownership, ambiguity, Singapore date boundaries, integer-cent totals, pagination, saved definitions, session revocation and model selection of an owned saved ID. Browser tests cover inline charts on desktop and mobile, unchanged page URLs, saved views across sign-ins, stale responses after logout, empty periods and removal of the former navigation links. Test model doubles are confined to tests; production uses the configured OpenAI model.
