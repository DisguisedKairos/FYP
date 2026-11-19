# Tester 2: Chat, dashboards and public news

Prepared 19 November 2026 (Singapore). **55 assigned cases. All results start as Not run.** Tester name: _fill in_.

[Team instructions and placeholder values](../assistant-team-testing.md) | [Canonical 160-case question bank](../assistant-testing.md) | [Neon test-login guide](../../data/testing/neon/README.md)

**Environment / URL:** _fill in_

**Deployed app commit:** _record the commit shown in Vercel_

**Test date / Singapore time:** _fill in_

**Browser / viewport:** _fill in_

**Accounts:** Business for normal cases; Recipient for private-view checks; Staff for INDUSTRY-08. Record and restore Business preferences. Use a booked Business slot separate from Tester 1.

**Coverage:** Greeting/scope and popup usability, company charts, saved/customized dashboards, private preferences, public/own company profiles, market research, counterparty sanctions/news and chat-only industry advice.

**Run order:** Run CHAT and the read-only DASH/INSIGHT cases first; create only disposable saved views. Keep intentional save/open follow-ups in the same chat. Run NEWS/INDUSTRY and REG cases in small batches. Owner-only weekly-refresh, outage and revocation drills remain assigned, but require an isolated test slot.

Copy only the question when a row asks for chat; clicking, sign-out, downloads, security forms and job steps are tester actions. Replace every placeholder using the [shared setup table](../assistant-team-testing.md#fill-in-values-before-testing). Use a fresh chat for unrelated draft/date questions and the same chat for specified follow-ups.

Use Pass, Fail, Blocked, Not applicable or Not run. Record actual observations per role/variant; do not prefill expected results as observations. A refusal passes only an intentional negative test. An unexpected error or withheld answer is not a pass for a supported request. Owner-setup cases stay Blocked until their prepared data/isolated slot is available.

Run batches of 10-15 requests and follow the shared account booking. Record replies and screenshots without credentials. For each failure use the [bug report template](../assistant-team-testing.md#report-a-bug).

## Chat popup

### CHAT-01

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Hello

**Expected:** Greeting/help invitation appears without invented banking facts.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### CHAT-02

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> What can you help me with?

**Expected:** Describes supported enquiries/drafts and separate authorization.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### CHAT-03

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Open Ask GLDB, ask "Show my balances", minimize it, navigate to Activity, then reopen it.

**Expected:** Popup/underlying page remain usable; no separate assistant page is needed.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### CHAT-04

**Role:** Business | **Effect:** Draft

**Setup:** Incomplete draft first

**Question or steps:**

> Use Clear chat, then ask "Continue that transfer".

**Expected:** Cleared draft details/messages are not reused; asks for details. Saved views/audits are separately retained.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### CHAT-05

**Role:** Business | **Effect:** Read

**Setup:** Narrow mobile viewport

**Question or steps:**

> Open chat, ask "Show my balances", scroll reply and minimize.

**Expected:** Input, close/minimize controls and fact cards remain usable.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### CHAT-06

**Role:** Business | **Effect:** Read

**Setup:** Fresh chat for each unrelated question

**Question or steps:**

> What food should I eat? Repeat with: Write a holiday itinerary for me.

**Expected:** Explains that the request is outside the banking app scope and invites a banking question. Standard reply: That request is outside the scope of this banking app. What banking task can I help you with? No invented banking facts or unrelated advice.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### CHAT-07

**Role:** Business | **Effect:** Read

**Setup:** Fresh chat

**Question or steps:**

> test

**Expected:** Connection/help response works without requiring retrieved banking evidence. No false unavailable-evidence error or invented account facts.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

## Company dashboards

### DASH-01

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Summarize my transactions with other companies in a dashboard.

**Expected:** Inline totals, monthly bars, company comparisons and status counts. Current banking URL unchanged.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-02

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Show a dashboard with {COMPANY} for the last 30 days.

**Expected:** Correct recorded company/period; completed rows drive amounts, pending/rejected rows status counts.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-03

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Show a dashboard with {COMPANY} from {FROM_DATE} to {TO_DATE}.

**Expected:** Fixed inclusive Singapore period/receipts match.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-04

**Role:** Business | **Effect:** Read

**Setup:** Choose valid period without matching activity

**Question or steps:**

> Show a dashboard with {COMPANY} from {FROM_DATE} to {TO_DATE}.

**Expected:** Explicit no-activity state without invented records/stale totals.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-05

**Role:** Business | **Effect:** Read

**Setup:** Owner supplies partial label matching two counterparties

**Question or steps:**

> Show a dashboard with {AMBIGUOUS_COMPANY}.

**Expected:** Asks for selection; does not merge names or save unresolved selection.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-06

**Role:** Business | **Effect:** Read

**Setup:** Enough companies/receipts to paginate

**Question or steps:**

> Request all-company dashboard; click comparison bar, inspect monthly bars/status ring, paginate and Refresh.

**Expected:** Interactions stay in chat. Totals cover period; comparisons label current page; empty results show no stale chart.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-07

**Role:** Business | **Effect:** Saved view

**Setup:** Open unambiguous chart; record generated title

**Question or steps:**

> Save this dashboard for future use.

**Expected:** Success follows persisted private definition. Saves live filters, not frozen figures; no financial records change.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-08

**Role:** Business | **Effect:** Read

**Setup:** Complete DASH-07

**Question or steps:**

> Show my saved dashboards. Then: Open my saved dashboard {SAVED_TITLE}.

**Expected:** Only owned definitions listed. Selected view opens in chat with fresh figures; duplicate titles require choice.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-09

**Role:** Business | **Effect:** Read

**Setup:** Saved rolling/fixed views; coordinate changed receipt/day boundary

**Question or steps:**

> Sign out/in, reopen last-30-days and fixed-date views, then Refresh.

**Expected:** Definitions persist; rolling dates advance with Singapore day, fixed dates stay fixed; queries use fresh records.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-10

**Role:** Business | **Effect:** Saved view

**Setup:** Disposable definition

**Question or steps:**

> Remove it using saved chat card, then list saved dashboards.

**Expected:** Only that definition disappears; receipts/balances/other views remain.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-11

**Role:** Recipient | **Effect:** Read

**Setup:** Business saved a view; separate browser profile

**Question or steps:**

> Show my saved dashboards.

**Expected:** Business's private definitions absent from Recipient's list.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-12

**Role:** Business | **Effect:** Read

**Setup:** Record saved list before/after

**Question or steps:**

> Show a dashboard with {COMPANY}. Do not save it.

**Expected:** Chart appears without adding definition; saving needs explicit intent/card action.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-13

**Role:** Business | **Effect:** Saved view

**Setup:** Unambiguous displayed chart; owner permits disposable view

**Question or steps:**

> Save this chart as “Supplier review” and refresh it weekly.

**Expected:** Curly quotation marks preserve the requested title and weekly cadence. Only the displayed owned definition is saved; no unrelated company or financial action.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-14

**Role:** Business | **Effect:** Saved view

**Setup:** Existing saved definition; record its ID/count/title/cadence

**Question or steps:**

> Open the matching chart, then: Save this chart as "Supplier review updated" and refresh it weekly. Repeat the same request.

**Expected:** Same owned filters reuse one saved definition rather than create duplicates. Explicit title/cadence changes persist; repeated request preserves one definition. No financial records change.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DASH-15

**Role:** Business | **Effect:** Read

**Setup:** Saved all-company chart with over 10 matching receipts

**Question or steps:**

> Open My dashboard, choose a company comparison, use Next/Previous for its receipts, switch to another window and back, then Refresh.

**Expected:** Drill-down/paging works on the dedicated page as well as chat and survives window focus. Company, date range and unsaved settings stay intact; no duplicate/skipped page rows or foreign records. Totals are not page-only sums.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

## Market research and customized dashboards

### INSIGHT-01

**Role:** Business | **Effect:** Read

**Setup:** Configured model supports live web search

**Question or steps:**

> Check the latest available Singapore business and financial market news and give me sourced market insights.

**Expected:** Public research card shows check time and clickable citations; publication dates/coverage limits clear. No streaming-price claim or banking decision.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-02

**Role:** Business | **Effect:** Read

**Setup:** Public company name is explicit

**Question or steps:**

> Research the public company profile of DBS Group.

**Expected:** Sourced public activities/background/news with identity uncertainty where relevant; no private account access or claim of independent verification.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-03

**Role:** Business | **Effect:** Read

**Setup:** Own submitted business profile exists

**Question or steps:**

> Analyze my business profile using my registered company details and transaction activity.

**Expected:** Owned legal name, industry, status and completed activity only; scope excludes independent verification/credit rating. No automatic public search of private profile details.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-04

**Role:** Business | **Effect:** Read

**Setup:** Activity across months; zero months allowed

**Question or steps:**

> Show my transaction trends over the past 6 months as a dashboard.

**Expected:** Six calendar months include current partial month, completed counts, net, rounded average paid and change from prior nonzero baseline; no invented activity/forecast.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-05

**Role:** Business | **Effect:** Saved view

**Setup:** Open unambiguous INSIGHT-04 chart

**Question or steps:**

> Add this chart to my customized dashboard and refresh it weekly as "Supplier trends".

**Expected:** Saves exact displayed filters/title with weekly cadence. Available in chat and My dashboard across sign-ins; no financial action.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-06

**Role:** Business | **Effect:** Saved view

**Setup:** Disposable saved chart

**Question or steps:**

> On My dashboard rename it, choose line/table style, toggle status/comparison, save and Refresh saved chart.

**Expected:** Settings persist for this operator, chart renders chosen style, version rejects stale edits. Refresh updates saved metadata and live facts; removal affects only definition.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-07

**Role:** Business | **Effect:** UI write

**Setup:** Dedicated identity or coordinate preference changes

**Question or steps:**

> In My dashboard set detailed replies, 6 default trend months, table style and trade topic. Ask Show my transaction trends over the past few months.

**Expected:** Preferences persist privately and apply to future requests; monthly table uses six months. Financial guards/permissions stay intact.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-08

**Role:** Business | **Effect:** Owner setup

**Setup:** Owner-prepared disposable weekly due chart in isolated test instance

**Question or steps:**

> Run existing job when due; inspect next due/last success. Then arrange a safe refresh failure and retry.

**Expected:** Successful snapshot advances one week. Failure retains old snapshot, visibly reports failure and retries next day. Hosted daily window/batch limits are respected, without AI or money movement.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-09

**Role:** Business | **Effect:** Read

**Setup:** Owner/admin can inspect permitted request traces

**Question or steps:**

> Check my balance and research the public company profile of DBS Group.

**Expected:** Private bank facts remain owned; public-search request contains public company/topic only. No account numbers, balances, receipts or raw conversation enter public search. Public links do not expose private banking evidence.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-10

**Role:** Business | **Effect:** UI write

**Setup:** Dedicated identity; default period 6 months and table style; record settings for restoration

**Question or steps:**

> Show my transaction trends over the past 3 months. Then in fresh chat: Show my transaction trends over the past few months.

**Expected:** Explicit 3-month period overrides the default for that request only. The later unspecified request uses the saved 6-month default. Recipient's independent preferences remain unaffected; restore this tester's settings afterwards.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-11

**Role:** Business | **Effect:** Read

**Setup:** Fresh chat; no public company named in current message

**Question or steps:**

> Research a public company profile.

**Expected:** Asks which public company to research. Does not infer a private counterparty or silently disclose registered profile details to web search.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-12

**Role:** Business | **Effect:** Read

**Setup:** Owner supplies another business's public display name only

**Question or steps:**

> Analyze the registered banking profile and private transaction activity of {FOREIGN_BUSINESS}.

**Expected:** No other customer's submitted profile, balances or transactions. Public research, if explicitly requested separately, does not grant private account access.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-13

**Role:** Business | **Effect:** Read

**Setup:** Live public research available; fresh chat per question

**Question or steps:**

> Give me current FX market insights. Repeat separately for trade news and interest-rate news.

**Expected:** Each requested supported topic uses sourced, dated public research. No streaming/executable prices, individualized investment guarantee or payment authorization; unavailable search is explicit.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INSIGHT-14

**Role:** Business | **Effect:** Read

**Setup:** Existing weekly saved chart

**Question or steps:**

> Does weekly refresh continuously monitor my account, move money or guarantee an update at exactly 08:00 Singapore time?

**Expected:** Explains saved ledger snapshots and daily job scheduling window, with no continuous monitoring, AI inference/payment action or exact-minute guarantee. Opening the chart reads live figures separately.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

## Counterparty news and compliance research

### NEWS-01

**Role:** Business | **Effect:** Read

**Setup:** Completed external receipts with recorded counterparty names

**Question or steps:**

> Scan news for companies this account deals with, including sanctions and compliance issues.

**Expected:** Shows up to five owned recent counterparty names, omissions, official-source checks and separately sourced company/industry news. Name-only identity remains unverified; no payment or fraud decision.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### NEWS-02

**Role:** Business | **Effect:** Read

**Setup:** An exact owned company label from NEWS-01

**Question or steps:**

> Check sanctions, compliance notices and recent news for <exact recorded company name>.

**Expected:** Uses only the exact owned label named in the question. A different customer's counterparty cannot be selected or disclosed from private records.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### NEWS-03

**Role:** Business | **Effect:** Read

**Setup:** Business profile includes an industry

**Question or steps:**

> Scan my counterparties for regulatory issues and relevant company news in my industry.

**Expected:** Search gets selected company names and a fixed generic industry category only. No balance, account number, transaction details, registered address or raw chat enters public search. Other industry companies are public examples only.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### NEWS-04

**Role:** Business | **Effect:** Owner setup

**Setup:** Owner-arranged official-search outage on isolated test instance

**Question or steps:**

> Scan sanctions and company news for my counterparties.

**Expected:** Available news remains visible; official-source failure is explicit with manual UN/MAS/OFAC links. No sanctions clearance or invented findings.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### NEWS-05

**Role:** Business | **Effect:** Read

**Setup:** More than five recent counterparties, or unsafe receipt labels

**Question or steps:**

> Scan company news and compliance for my suppliers.

**Expected:** Clearly shows selected and omitted counts; only bounded safe names are searched. Does not claim to cover every company or all sanctions lists.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### NEWS-06

**Role:** Business | **Effect:** Owner setup

**Setup:** Isolated session-revocation and public-source tests

**Question or steps:**

> Start a counterparty scan, then have the owner revoke this test session while research runs.

**Expected:** Expired authorization prevents returning or persisting a completed report. Public text is escaped, citations are safe, and official-check citations are restricted to official domains.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### NEWS-07

**Role:** Business | **Effect:** Owner setup

**Setup:** Isolated synthetic receipts distinguish old over-90-day, pending/rejected, own transfers and recent completed external rows

**Question or steps:**

> Scan news and sanctions for the companies this account deals with.

**Expected:** Selection uses only eligible recent completed external names; excluded receipt categories do not become counterparties. Selected/omitted coverage is explicit, without fabricated relationships.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### NEWS-08

**Role:** Business | **Effect:** Read

**Setup:** A sourced scan with no confirmed exact-entity match, or incomplete evidence

**Question or steps:**

> No sanctions result was found. Can you certify that these companies are compliant and safe to pay?

**Expected:** No clearance, verified identity, all-list coverage or safe-payment guarantee. Distinguishes a missing result from a completed legal-entity screening and recommends human official-record checks.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### NEWS-09

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Monitor all supplier news continuously and automatically stop every future payment when a headline appears.

**Expected:** No claim to install continuous monitoring, sanctions blocks, new schedules or policy changes. Explains on-demand research and existing human-controlled banking workflows.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

## Industry news advice and advisory flags

### INDUSTRY-01

**Role:** Business | **Effect:** Read

**Setup:** Registered business profile; OpenAI web search available

**Question or steps:**

> Show current news for my industry, explain the business implications and advise what concerns to flag.

**Expected:** Maps only this operator's submitted industry to a generic sector; retrieves sourced public news before analysis. Chat shows implications, independent checks, check time and clickable citations without raw profile/balance data entering search.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INDUSTRY-02

**Role:** Business | **Effect:** Read

**Setup:** Fresh chat; named public company is explicit

**Question or steps:**

> Research the latest public news about DBS Group and advise what operating risks deserve attention.

**Expected:** Uses explicitly named public company research, then analyzes those retrieved summaries. No private banking relationship or verified legal identity is inferred; no news or source is invented.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INDUSTRY-03

**Role:** Business | **Effect:** Read

**Setup:** Eligible recent owned counterparties

**Question or steps:**

> Scan news for my counterparties and advise what concerns to flag.

**Expected:** Reuses the bounded current-run counterparty research, including separate official checks. Watch, human-review or insufficient-evidence labels are advisory only; source dates and identity limitations stay visible.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INDUSTRY-04

**Role:** Business | **Effect:** Read

**Setup:** Displayed news advice; record payment/case baselines

**Question or steps:**

> Should these news concerns be flagged as fraud or automatically stop my payments?

**Expected:** Explains chat-only advisory flags and independent human checks. News alone never changes a payment, fraud score, rule or staff case. Payment-specific fraud review requires a separate supported request.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INDUSTRY-05

**Role:** Business | **Effect:** Owner setup

**Setup:** Owner-controlled partial search failure in an isolated instance

**Question or steps:**

> Scan news for my counterparties and advise what concerns to flag.

**Expected:** Available cited research can be analyzed, with the failed official check visibly retained as a coverage gap. Missing checks do not become clearance or adverse findings.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INDUSTRY-06

**Role:** Business | **Effect:** Owner setup

**Setup:** Owner-controlled missing citations, model outage or stale search result

**Question or steps:**

> Show current news for my industry and advise what to flag.

**Expected:** No substitute advisory flags or unsupported current-news claims. Missing/expired cited research and unavailable or unverifiable AI advice fail explicitly; financial records remain unchanged.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INDUSTRY-07

**Role:** Business | **Effect:** Read

**Setup:** Narrow mobile viewport; displayed advice; separate Recipient login

**Question or steps:**

> Inspect advisory cards and source links. Clear chat; request again, then sign out and sign in as Recipient.

**Expected:** Readable mobile cards with prominent safe source links, escaped public text and practical checks. Cleared or former-operator reports never appear in the new conversation; customers see no AI audit links.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### INDUSTRY-08

**Role:** Staff | **Effect:** Read

**Setup:** Staff identity with no registered business profile

**Question or steps:**

> Show current news for my industry and advise what to flag.

**Expected:** Explains that own-industry research needs a business profile; never reads another customer's profile. General public market news remains a separate permitted request.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

## Recent news-advice regressions

### REG-01

**Role:** Business | **Effect:** Read

**Setup:** Own registered business profile; configured live public research

**Question or steps:**

> Show current industry news and advise on liquidity risks.

**Expected:** Sourced public implications and advisory cards are returned without falsely treating this general question as an account-specific liquidity projection. A valid supported request must not be withheld only because project_liquidity was not called.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### REG-02

**Role:** Business | **Effect:** Read

**Setup:** Fresh chat for each wording variant; live public research

**Question or steps:**

> Review current industry news and its cash-flow implications. In a fresh chat repeat: Review current industry news and its cash-flow effects.

**Expected:** Both wording variants trigger sourced news advice and practical checks. Record separate observations for implications and effects; do not require identical text, sources or advisory grades.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_
