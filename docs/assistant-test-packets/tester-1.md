# Tester 1: Banking, funding and finance reports

Prepared 19 November 2026 (Singapore). **54 assigned cases. All results start as Not run.** Tester name: _fill in_.

[Team instructions and placeholder values](../assistant-team-testing.md) | [Canonical 160-case question bank](../assistant-testing.md) | [Neon test-login guide](../../data/testing/neon/README.md)

**Environment / URL:** _fill in_

**Deployed app commit:** _record the commit shown in Vercel_

**Test date / Singapore time:** _fill in_

**Browser / viewport:** _fill in_

**Accounts:** Business and Recipient; Empty for low-funds reads; Staff with no accounts for ACCT-05. Use separate browser profiles for sender/recipient.

**Coverage:** Accounts, history/search, finance CSV/PDF, affordability, automatic warnings, dated company-payment checks, payment drafts, normal payment/schedule handoffs and statements.

**Run order:** Run ACCT/HIST/FIN/FUND/DATE reads first. Complete DRAFT cases without authorizing. Then coordinate the owner-prepared AUTO/FIN/UI cases. Recheck baseline figures after each deliberate banking write.

Copy only the question when a row asks for chat; clicking, sign-out, downloads, security forms and job steps are tester actions. Replace every placeholder using the [shared setup table](../assistant-team-testing.md#fill-in-values-before-testing). Use a fresh chat for unrelated draft/date questions and the same chat for specified follow-ups.

Use Pass, Fail, Blocked, Not applicable or Not run. Record actual observations per role/variant; do not prefill expected results as observations. A refusal passes only an intentional negative test. An unexpected error or withheld answer is not a pass for a supported request. Owner-setup cases stay Blocked until their prepared data/isolated slot is available.

Run batches of 10-15 requests and follow the shared account booking. Record replies and screenshots without credentials. For each failure use the [bug report template](../assistant-team-testing.md#report-a-bug).

## Accounts and history

### ACCT-01

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Show my savings accounts and their current balances.

**Expected:** Owned active facts match Accounts/Dashboard at check time; foreign balances stay private.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### ACCT-02

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> List my scheduled payments.

**Expected:** Permitted owned timing, frequency and status appear; no instruction is changed.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### ACCT-03

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Can I cover my scheduled payments over the next 7 days?

**Expected:** Seven-day scenario shows source shortfalls/assumptions without invented income or payment guarantees.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### ACCT-04

**Role:** Empty | **Effect:** Read

**Setup:** Owner confirms no active obligations

**Question or steps:**

> Show my balance and whether I have enough for upcoming scheduled payments.

**Expected:** Zero balance with no fabricated obligation or arbitrary minimum-balance warning.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### ACCT-05

**Role:** Staff | **Effect:** Read

**Setup:** Staff has no deposit account

**Question or steps:**

> Show my savings balances.

**Expected:** No owned deposit accounts; admin status does not expose every customer balance through this tool.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### HIST-01

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Show my recent transactions.

**Expected:** Owned Activity records/statuses match; held/rejected requests are not described as settled.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### HIST-02

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Find my transactions containing "{COMPANY}".

**Expected:** Search matches permitted receipts; counterparty label grants no access to the other company's accounts.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### HIST-03

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Find my transactions containing "{NO_MATCH_TEXT}".

**Expected:** Honest empty result without invented matches.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### ACCT-06

**Role:** Business | **Effect:** Read

**Setup:** Fresh chat for each horizon

**Question or steps:**

> Can I cover my scheduled payments over the next 91 days? Repeat with an explicitly zero-day projection.

**Expected:** Unsupported projection horizon is refused or clarified; no silently substituted complete 91-day/zero-day result or coverage guarantee.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### HIST-04

**Role:** Business | **Effect:** Read

**Setup:** More than 20 owned receipts; note latest Activity ordering

**Question or steps:**

> Show my recent transactions.

**Expected:** Returned list is bounded to 20 owned receipts. Does not claim that a bounded recent list is the complete account history; Activity remains available for full filtering.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

## Finance reports

### FIN-01

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Summarize my inflow and outflow this month.

**Expected:** Finance card shows month-to-date completed external received/paid/net, current balances and CSV/PDF controls. No payment is inferred.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FIN-02

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Summarize my inflow and outflow last month.

**Expected:** Activity covers previous complete Singapore month; balances remain current, not historical month-end balances.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FIN-03

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Generate a downloadable finance report for the last 30 days. Download CSV and PDF.

**Expected:** Both files open with correct period, generation time, owned rows and totals. No invented links.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FIN-04

**Role:** Business | **Effect:** Read

**Setup:** Boundary receipts if available

**Question or steps:**

> Generate a finance report from {FROM_DATE} to {TO_DATE}.

**Expected:** Inclusive Singapore dates respected; boundary receipts fall on correct days.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FIN-05

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Generate a downloadable finance report for yesterday.

**Expected:** Yesterday in Singapore, not rolling 24 hours; empty period labelled honestly.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FIN-06

**Role:** Business | **Effect:** Owner setup

**Setup:** Owner coordinates separately authorized synthetic transaction

**Question or steps:**

> Generate a finance report for today. After the coordinated transaction settles, download again.

**Expected:** Every download is a fresh snapshot and includes the new receipt even if earlier preview is older.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FIN-07

**Role:** Business | **Effect:** Read

**Setup:** Period contains completed external, own-transfer, opening and pending/rejected examples

**Question or steps:**

> Generate a finance report this month and compare with Activity.

**Expected:** Only completed external rows affect flow totals; own transfers/opening funds excluded. Pending/rejected counts separate; no settled balance deduction.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FIN-08

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Generate a finance report for the last 500 days.

**Expected:** Unsupported range refused/clarified, never claimed as complete 500-day export.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FIN-09

**Role:** Business | **Effect:** Read

**Setup:** Open report; separate Recipient login available

**Question or steps:**

> Generate a finance report for this month. Sign out before clicking an old CSV/PDF control, then sign in as Recipient.

**Expected:** Old controls cannot download the former business's report under the new session. An authorization error or current-owner-only result never exposes former-owner financial rows.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

## Current payment funding

### FUND-01

**Role:** Business | **Effect:** Read

**Setup:** AMOUNT within live source balance

**Question or steps:**

> Can I afford SGD {AMOUNT} from {SOURCE}?

**Expected:** Uses settled source balance; coverage creates no draft, reservation, schedule or payment.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FUND-02

**Role:** Business | **Effect:** Read

**Setup:** OVER_BALANCE = live balance + 0.01; no concurrent writes

**Question or steps:**

> Can I afford SGD {OVER_BALANCE} from {SOURCE}?

**Expected:** Exact SGD 0.01 shortage; no silent combination with other accounts.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FUND-03

**Role:** Business | **Effect:** Read

**Setup:** Positive live balance; no concurrent writes

**Question or steps:**

> Can I afford SGD {BALANCE} from {SOURCE}?

**Expected:** Exact coverage without rounding error/invented minimum buffer; no funds move.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FUND-04

**Role:** Business | **Effect:** Read

**Setup:** At least two active owned accounts

**Question or steps:**

> Can I afford a payment from {SOURCE}? In fresh chat: Can I afford SGD 10?

**Expected:** First asks for amount; second asks for source rather than assuming coverage.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### FUND-05

**Role:** Business | **Effect:** Read

**Setup:** RESERVE covers SOURCE's small gap

**Question or steps:**

> Can I afford SGD {OVER_BALANCE} from {SOURCE}?

**Expected:** SOURCE remains short; any suggested funding transfer is not treated as executed.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

## Automatic funding warnings

### AUTO-01

**Role:** Business | **Effect:** Owner setup

**Setup:** Isolated approved operator, disposable shortfall schedule due within 30 days

**Question or steps:**

> Sign in and send no chat prompt. Open funding notice beside Ask GLDB.

**Expected:** Notice appears without forced popup/focus; details show source, largest gap, first shortage and checked time.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### AUTO-02

**Role:** Business | **Effect:** Owner setup

**Setup:** Warning visible; disposable obligation

**Question or steps:**

> Type an unsent message; resolve obligation through authorized funding/cancellation; refresh/wait for successful check.

**Expected:** Warning updates/clears without losing text or stealing focus. Check itself moves/reserves no money.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### AUTO-03

**Role:** Business | **Effect:** Owner setup

**Setup:** Owner-controlled test request failure

**Question or steps:**

> Load warning; fail next funding check, restore and retry.

**Expected:** Prior warning visibly stale/unavailable; failure never implies coverage. Successful retry recovers.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

## Dated company payment planning

### DATE-01

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Summarize inflow and outflow this month. Can I pay SGD {AMOUNT} to {COMPANY} from {SOURCE} by this month?

**Expected:** Card separates historical business/source flow from current funds, schedules to month-end, additional payment and gap. No draft/payment created.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DATE-02

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Can I pay SGD {AMOUNT} to {COMPANY} from {SOURCE} by {DATE}?

**Expected:** End of selected Singapore day is cutoff; only obligations through cutoff count. Covered is a conservative scenario, not authorization.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DATE-03

**Role:** Business | **Effect:** Read

**Setup:** DATE at least two days ahead; prepare boundary obligation if checking inclusion

**Question or steps:**

> Can I pay SGD {AMOUNT} to {COMPANY} from {SOURCE} before {DATE}?

**Expected:** Cutoff excludes DATE and ends previous Singapore day. Schedule on DATE is excluded.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DATE-04

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Summarize inflow and outflow last month. Can I pay SGD {AMOUNT} to {COMPANY} from {SOURCE} by next month?

**Expected:** Historical period is last month; deadline next month-end. Past inflow is not added to balance again.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DATE-05

**Role:** Business | **Effect:** Read

**Setup:** Outgoing obligations plus unsettled incoming schedule

**Question or steps:**

> Can I pay SGD {AMOUNT} to {COMPANY} from {SOURCE} by {DATE}?

**Expected:** Future credits shown separately/excluded until settled; cannot erase current gap.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DATE-06

**Role:** Business | **Effect:** Read

**Setup:** Existing same-amount/recipient schedule within deadline

**Question or steps:**

> Can I pay SGD {AMOUNT} to {COMPANY} from {SOURCE} by {DATE}?

**Expected:** Existing schedule counts separately; proposed payment is additional, not an edit.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DATE-07

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Do I have enough funds to pay {COMPANY} by {DATE}?

**Expected:** Requests missing amount/source; historical totals alone do not imply coverage.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DATE-08

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Can I pay SGD {AMOUNT} to {COMPANY} from {SOURCE} by 2099-02-30?

**Expected:** Invalid/out-of-horizon date refused/clarified without substitution or positive claim.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DATE-09

**Role:** Business | **Effect:** Read

**Setup:** Two different future deadlines within 90 days

**Question or steps:**

> Can I pay SGD {AMOUNT} to {COMPANY} from {SOURCE} by {DATE} or {OTHER_DATE}? Repeat with: Can I pay SGD {AMOUNT} to {COMPANY} from {SOURCE} by tomorrow or next month?

**Expected:** Asks for one deadline for explicit, relative or mixed alternatives; does not silently select a date or the more affordable result.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DATE-10

**Role:** Business | **Effect:** Read

**Setup:** Standard

**Question or steps:**

> Can I pay USD 100 to {COMPANY} from {SOURCE} by {DATE}?

**Expected:** Unsupported currency clarified/refused; not read as SGD or converted with reference FX.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DATE-11

**Role:** Business | **Effect:** Read

**Setup:** Use fresh chat for second query

**Question or steps:**

> Can I pay SGD {AMOUNT} to {COMPANY} from {SOURCE} by {PAST_DATE}? Repeat with {TOO_FAR_DATE}.

**Expected:** Both past/over-90-day deadlines refused/clarified; no substituted default or positive coverage.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

## Payment drafts

### DRAFT-01

**Role:** Business | **Effect:** Draft

**Setup:** Do not authorize

**Question or steps:**

> Transfer SGD 10 from {SOURCE} to {RECIPIENT}

**Expected:** Review retains exact source/recipient/amount. Opening fills normal form; separate authorization still required.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DRAFT-02

**Role:** Business | **Effect:** Draft

**Setup:** PUB supported; do not authorize

**Question or steps:**

> Pay SGD 10 from {SOURCE} to PUB reference AIUAT-001

**Expected:** Exact biller/source/amount/reference retained; no settled claim or financial action.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DRAFT-03

**Role:** Business | **Effect:** Draft

**Setup:** Do not authorize

**Question or steps:**

> Schedule transfer SGD 10 from {SOURCE} to {RECIPIENT} tomorrow at 15:30 weekly

**Expected:** Weekly draft is tomorrow 15:30 Singapore; check local/UTC display. No instruction until authorization.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DRAFT-04

**Role:** Business | **Effect:** Draft

**Setup:** Fresh chat per recurrence

**Question or steps:**

> Schedule transfer SGD 10 from {SOURCE} to {RECIPIENT} on {UTC_DATETIME} once. Repeat using monthly.

**Expected:** Exact future instant/recurrence retained; separate instructions not merged.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DRAFT-05

**Role:** Business | **Effect:** Draft

**Setup:** Fresh chat

**Question or steps:**

> Send Transfer, then SGD 25, then {RECIPIENT}.

**Expected:** Missing fields requested; amount/recipient retained in active continuation. Inspect selected owned source. No password in chat.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DRAFT-06

**Role:** Business | **Effect:** Draft

**Setup:** Fresh chat per invalid input

**Question or steps:**

> Transfer SGD 1.234 from {SOURCE} to {RECIPIENT}. Then: Pay SGD 10 from {SOURCE} to PUB reference AB

**Expected:** Excess decimals/two-character reference refused/clarified; no truncated amount/ready invalid bill.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DRAFT-07

**Role:** Business | **Effect:** Draft

**Setup:** Standard

**Question or steps:**

> Prepare valid transfer, open review and cancel; compare Activity/balances.

**Expected:** No posted payment, hold, schedule or balance change from preparation/cancellation alone.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DRAFT-08

**Role:** Business | **Effect:** Draft

**Setup:** Do not authorize

**Question or steps:**

> Transfer SGD {OVER_BALANCE} from {SOURCE} to {RECIPIENT}

**Expected:** Selected source shortfall visible; chat cannot execute; form still checks live funds.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DRAFT-09

**Role:** Business | **Effect:** Draft

**Setup:** PUB supported; future UTC instant

**Question or steps:**

> Schedule bill SGD 10 from {SOURCE} to PUB reference AIUAT-002 on {UTC_DATETIME} once

**Expected:** Exact bill schedule fields retained; opening form creates no authorized instruction.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DRAFT-10

**Role:** Business | **Effect:** Draft

**Setup:** Fresh chat per value

**Question or steps:**

> Transfer SGD 0 from {SOURCE} to {RECIPIENT}. Repeat with SGD -1 and SGD 1e3.

**Expected:** Zero, negative and scientific notation refused/clarified without conversion to ready positive payment.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### DRAFT-11

**Role:** Business | **Effect:** Draft

**Setup:** Disposable incomplete draft; wait over 15 minutes without continuing it

**Question or steps:**

> Transfer SGD 10. After continuation expires: Use {SOURCE} and send it to {RECIPIENT}.

**Expected:** Expired draft cannot silently supply its old amount or other missing fields. A clear expired-context response or fresh clarification requires restating details; no payment is executed.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

## Banking screens beyond chat

### UI-05

**Role:** Business | **Effect:** UI write

**Setup:** Owner-approved SGD 1-10, sufficient funds/real model; record baselines/ID

**Question or steps:**

> Authorize one transfer normally; compare sender/recipient in separate profiles. Retry only same submitted request if offered.

**Expected:** One accepted request key yields one debit/credit. Completed entries conserve value; held/rejected/failed screening does not settle. Risk/reasons/status recorded.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### UI-06

**Role:** Business | **Effect:** UI write

**Setup:** Owner-approved small sample bill, real scoring

**Question or steps:**

> Pay PUB with valid reference using normal password-authorized form.

**Expected:** Validation/lifecycle/notification agree. External utility settlement is simulated by this prototype.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### UI-07

**Role:** Business | **Effect:** UI write

**Setup:** Owned disposable future instruction

**Question or steps:**

> Create schedule, check recurrence/time, then cancel in Scheduled payments.

**Expected:** Authorized creation/cancellation works; creation moves/reserves no money; unrelated instructions remain.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### UI-08

**Role:** Business | **Effect:** Owner setup

**Setup:** Isolated due/insufficient cases; agree actual scheduler window

**Question or steps:**

> Let disposable instruction become due; inspect occurrence, receipt and failure/retry if any.

**Expected:** Live funds/rules/AI/idempotency apply. Failed funds/screening causes no debit; recurrence follows lifecycle. Hosted free-plan job is daily.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_

### UI-09

**Role:** Business | **Effect:** Read

**Setup:** Known activity period

**Question or steps:**

> Filter/search Activity by account/status/date; export CSV and account statement.

**Expected:** Export matches permitted records. Statement reconciles opening/completed closing balance; held/rejected requests do not reduce settled balance. Distinct from assistant finance report.

**Status:** Not run

**Actual reply / observation:** _record after running_

**Evidence / bug ID / Singapore time:** _fill in; omit secrets_
