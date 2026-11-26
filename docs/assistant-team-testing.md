# Assistant testing: three-person assignment

Prepared **19 November 2026, Singapore**. Covers all **160 existing acceptance cases plus 4 recent news-advice regression cases: 164 cases total**. Every case has exactly one assigned tester. Multiple questions, roles or wording variants within one case need separate observations under that case. All results start as **Not run**; assignment is not evidence of success.

[Open the app](https://fyp-greenlink-six.vercel.app) | [Original question bank and 28 use cases](assistant-testing.md) | [Neon test-login guide](../data/testing/neon/README.md)

## Assignments

| Tester | Questions and setup | Fill-in Word document | Cases | Focus |
| --- | --- | --- | ---: | --- |
| Tester 1 | [Banking and funding](assistant-test-packets/tester-1.md) | [Response and error form](assistant-test-packets/tester-1-results.docx) | 54 | Accounts, transactions, finance CSV/PDF, funds, dates, drafts and banking handoff |
| Tester 2 | [Chat, dashboards and news](assistant-test-packets/tester-2.md) | [Response and error form](assistant-test-packets/tester-2-results.docx) | 55 | Popup/scope, charts, customization, company profiles, public research and news advice |
| Tester 3 | [Fraud, permissions and recovery](assistant-test-packets/tester-3.md) | [Response and error form](assistant-test-packets/tester-3-results.docx) | 55 | Fraud/sector risks, staff analysis, audit/privacy, security boundaries and recovery |

Replace the labels with your teammates' names. Each teammate edits only their own packet's results, keeping case IDs and expected outcomes intact. Packets contain the full assigned questions, preconditions, expected results and per-case result fields.

**Tester 1 coverage:** ACCT-01 through ACCT-06; HIST-01 through HIST-04; FIN-01 through FIN-09; FUND-01 through FUND-05; AUTO-01 through AUTO-03; DATE-01 through DATE-11; DRAFT-01 through DRAFT-11; UI-05 through UI-09.

**Tester 2 coverage:** CHAT-01 through CHAT-07; DASH-01 through DASH-15; INSIGHT-01 through INSIGHT-14; NEWS-01 through NEWS-09; INDUSTRY-01 through INDUSTRY-08; REG-01 and REG-02.

**Tester 3 coverage:** MARKET-01 through MARKET-07; STAFF-01 through STAFF-06; AUDIT-01 through AUDIT-04; SAFE-01 through SAFE-11; RES-01 through RES-05; UI-01 through UI-04 and UI-10 through UI-14; SECTOR-01 through SECTOR-11; REG-03 and REG-04.

REG-01 checks public news/liquidity wording, REG-02 checks cash-flow implications/effects, REG-03 checks invented staff-action claims, and REG-04 checks mixed public-news/private-balance requests. The canonical guide remains 160 cases; these four are supplementary regressions in the packets.

## Using the Word response forms

Download the document for your assigned tester and open it in Microsoft Word. Save your own copy as Tester-N-YourName-YYYY-MM-DD.docx in the team's private results location.

1. Fill in your name, environment URL, deployed commit, Singapore test time, browser and test identity on the first page.
2. Each case starts on a new page with its original question, role, setup and expected result. Click the response field to paste the assistant's exact reply, or describe the observed UI result. Label separate variants and follow-ups.
3. Fill in the error field with the exact error and what went wrong. Enter None when no error occurred. Paste sanitized screenshots or evidence references into the evidence field.
4. Choose Not run, Pass, Fail, Blocked or Not applicable from the result dropdown. Record the case time/role/variant and bug or retest notes. All result dropdowns initially show Not run.
5. Keep the original failure observation when adding a retest result. Filled responses are actual test evidence; use the agreed private results location rather than uploading them with the blank templates.

The fields support multiline text and pasted evidence. Longer responses can expand onto another page. The original Markdown packets remain available as the editable question bank. Maintainers can regenerate the blank documents with `python scripts/export-assistant-test-documents.py`; it uses the Python standard library and reads the three Markdown packets. Regeneration replaces only the three blank Word templates, so keep completed copies elsewhere.

## Book accounts and test slots

The current hosted roster has **nine usable logins: eight industry customers and reviewer-tester@greenlink.demo as the sole administrator**. Business means logistics-business@greenlink.demo; Recipient means technology-business@greenlink.demo; Staff and Reviewer both mean reviewer-tester@greenlink.demo. For ordinary payment-making, Maker can be a retained industry customer. Administrator-maker self-approval, MFA, pending/rejected/empty/profile and the dedicated Sector portfolio require isolated owner-prepared fixtures.

Use separate browser profiles and book the shared reviewer sequentially. See the [current Neon login guide](../data/testing/neon/README.md). Historical packets and Word forms retain their original questions and case IDs; apply this mapping and mark missing setup Blocked. Retired feature, sector and user-created logins cannot sign in. [Retirement](feature-testing.md#retire-an-existing-login) preserves banking/audit history while disabling access and sessions.

| Slot | Owner | Work and handoff |
| --- | --- | --- |
| 1 | Owner + all testers | Record deployment commit, assign packet names, verify logins and record current account/receipt/case baselines. Prepare only separately authorized synthetic fixtures. |
| 2 | Tester 1 | Book Business for read-only banking/funding/date checks and drafts. Do not change account balances during another tester's comparison. |
| 3 | Tester 2 | Book Business for charts, preferences and public/news questions. Use disposable views and restore changed preferences. Tester 1 releases Business first. |
| 4 | Tester 3 | Book Business and restricted identities for privacy, fraud, sector, audit and recovery cases. Coordinate Maker/Reviewer as independent browser sessions. |
| 5 | Owner + assigned tester | Run prepared financial writes and isolated scheduler/outage/injection/limit/security drills. Preserve each case's assigned owner. Tester 1 coordinates payment/finance handoffs with Tester 3's staff checks. |
| 6 | Each case's original tester | Retest reported fixes on the recorded new deployment. Append the observation; keep the original failure evidence. |

Use the slots to book shared accounts. Other testers can work in parallel with distinct identities/prepared datasets and independent financial/settings changes. The assistant currently limits starts to 40 per user and 120 per IP per 15 minutes, with at most two recent concurrent runs across the database. Run 10-15 requests per batch; book another window or wait when a limit is reached. Three testers must not submit three simultaneous requests or share a Business quota without tracking it.

A case can contain multiple requests or a retry, so case counts are not an API-call budget. Do not try to finish an entire packet in one 15-minute window. Keep passwords, OTPs and recovery codes in normal login/security forms, never assistant chat. SAFE-03 uses a deliberately fake marker only.

## Prepare the required data

The owner records the environment and provides an approved owned source, comparison recipient, permitted outgoing IDs, an eligible suspicious payment, a quiet payment, another owner's ID for denial checks, an ambiguous company name and sufficient chart/receipt data for paging. Use visible Activity records; do not guess receipt IDs.

Owner-setup and write cases remain assigned. Missing setup is **Blocked**, not Pass and not automatically Not applicable. Arrange the missing prerequisites and rerun. An unavailable model or stale/missing public source is a recorded coverage/provider limitation; it is not a successful positive news or fraud result.

Use disposable views, applications, cases, schedules and a separate test identity for password/MFA changes. Do not reset shared accounts, alter production policies, consume shared recovery codes, seed over balances or disable shared services to make a test pass. Isolated failure drills and scheduler tests need an owner-controlled instance. The existing free hosted job runs daily around 08:00 Singapore time within its scheduling window; the browser funding check never executes schedules.

Customer and admin are the two permission roles. Customers cannot open AI audit. An administrator may inspect their own assistant runs; another staff member's private conversation remains unavailable. News advisory flags stay in chat; a supported payment-specific fraud-review request is a separate workflow.

## Fill in values before testing

These are examples, not guaranteed current fixtures. Each tester confirms live records and uses their signed-in owner's values. Use fresh future dates in Singapore; do not reuse expired example dates.

| Placeholder | How to fill it |
| --- | --- |
| `{SOURCE}` | Owned active source number; Business example 1088800101. Other roles use their own number. |
| `{RESERVE}` | Another owned account; Business example 1088800102. |
| `{RECIPIENT}` | Owner-approved synthetic recipient; example 1088800201. |
| `{FOREIGN_SOURCE}` | Account not owned by current user; Business can use Recipient's 1088800201 for denial tests. |
| `{COMPANY}` | Exact visible Activity counterparty; Business example Feature Tour Supplier Pte. Ltd., if present. |
| `{FOREIGN_BUSINESS}` | Owner-provided public display name of another business; never copy its private profile or identifiers. |
| `{AMBIGUOUS_COMPANY}` | Owner-supplied partial label matching two recorded counterparties; otherwise Blocked (dataset). |
| `{NO_MATCH_TEXT}` | Unique harmless text confirmed absent from Activity, e.g. AI-UAT-NO-MATCH-20261112. |
| `{AMOUNT}` | Positive decimal, usually 10.00 or smaller approved amount; within source funds for coverage tests. |
| `{BALANCE}` | Positive live SOURCE balance with two decimal places. Refresh immediately before testing. |
| `{OVER_BALANCE}` | Live SOURCE balance plus 0.01. Avoid concurrent writes during this test. |
| `{DATE}` | Future YYYY-MM-DD within 90 days; at least two days ahead for before-date case. |
| `{OTHER_DATE}` | Different future YYYY-MM-DD within 90 days. |
| `{PAST_DATE}` | Yesterday's Singapore YYYY-MM-DD. |
| `{TOO_FAR_DATE}` | Real date at least 91 days ahead. |
| `{FROM_DATE}` | Inclusive Singapore start on/before TO_DATE. |
| `{TO_DATE}` | Inclusive end today/earlier; complete reporting range at most 366 days. |
| `{UTC_DATETIME}` | Future ISO UTC timestamp with seconds/Z: freshly chosen YYYY-MM-DDT07:30:00Z means 15:30 Singapore. Replace the whole token. |
| `{TX_ID}` | Exact permitted outgoing receipt ID from Activity/owner. |
| `{OTHER_TX_ID}` | Owner-supplied outgoing ID owned by another business; never guess IDs. |
| `{ALERT_TX_ID}` | Owner-selected eligible outgoing with genuine recorded evidence supporting review. |
| `{QUIET_TX_ID}` | Owner-selected outgoing without eligible payment-specific review signals. |
| `{SAVED_TITLE}` | Exact generated title after saving; a quoted save title is supported, and My dashboard allows renaming. |

For checks with variants, such as once/monthly, past/future dates, pending/rejected users or implications/effects, record each variant separately. A case passes only when all required variants pass; keep partial results in the notes.

## Record results

At the top of each packet record tester, URL/environment, deployment commit, Singapore date/time and browser/viewport. Under every case replace Not run only after execution, then record the actual reply/card/file behavior and sanitized evidence or bug ID.

| Status | Use it when |
| --- | --- |
| Pass | The observed result matches the expected behavior, including all required variants. A refusal is a pass only for an intentional negative test. |
| Fail | A prepared valid request gives wrong data, an unexpected error/withheld result, broken UI/export, missing required evidence or an unauthorized action/disclosure. |
| Blocked | Data, owner setup, permission to run a controlled drill, model access or the test environment is missing. Record the cause and next action. |
| Not applicable | The project owner records why a case does not apply to this environment. It does not count as passed coverage. |
| Not run | No actual test has been performed. |

Compare ledger facts, source links, timestamps and application cards rather than exact model wording. News labels and qualitative risk grades can change with the current evidence; do not demand a flag or fixed score for every company/payment. No-result news does not establish clearance. Finance totals use completed external entries, with own transfers/opening funding excluded; pending/rejected requests stay separate. Record snapshots before comparing concurrent data.

## Report a bug

Copy this into the team's existing issue process or the failing case's notes.

- Case ID / packet / tester:
- Environment URL / deployed commit:
- Role and synthetic test identity (no password):
- Singapore date and time:
- Exact synthetic prompt or UI steps / wording variant:
- Preconditions and permitted receipt/run ID:
- Expected result:
- Actual result and exact visible error:
- Repeatability and sanitized screenshot/download evidence:
- Severity / issue link:
- Retest commit / time / observed result:

Suggested severity: critical for unauthorized private-data access or unexpected money movement; high for incorrect monetary/lifecycle results; medium for broken supported questions/downloads; low for layout/copy. Stop the affected financial test and tell the owner if money moves unexpectedly. Never attach keys, passwords, cookies, recovery codes, database URLs or another business's private records.

## Completion checklist

- Each existing catalogue ID appears in exactly one packet; all four REG cases are assigned.
- All 164 statuses are recorded, or remaining Blocked/Not run items have an owner and follow-up. Do not report them as passes.
- Failed results link to a reproducible observation and retest record.
- Temporary preferences and separately authorized test changes are accounted for; do not delete evidence or undo audit history.
- Each packet retains its environment/commit, role, timestamp and variant observations so the teacher can assess the evidence.
