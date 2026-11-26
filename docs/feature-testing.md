# Test accounts and complete feature walkthrough

For copy-and-paste assistant questions, use cases and expected outcomes, see [GLDB Assistant manual acceptance tests](assistant-testing.md).


For the current Neon-backed app, use the [nine-login table](../data/testing/neon/README.md) and [current walkthrough](../data/testing/neon/FEATURE-TESTING.md). The original native fixture remains separate. See [Neon setup](neon.md).

## Current Neon logins

There are **nine usable logins: eight industry customers and one bank administrator**. The industry emails are logistics-business, technology-business, manufacturing-business, wholesale-business, hospitality-business, construction-business, healthcare-business and energy-business, all at `greenlink.demo`. Each owns a separate unverified business and its existing operating/reserve savings accounts.

`reviewer-tester@greenlink.demo` is the only active administrator, for bank operations, independent payment review, fraud rules and AI audit. Use logistics for ordinary banking and technology for recipient/privacy comparisons. Retained credentials are unchanged. The former feature, sector and user-created logins are retired; banking and audit history remain. The owner-approved old monthly PUB test schedule has been cancelled.

Historical workflows below describe the full isolated feature-tour fixture. Pending/rejected, zero-balance, MFA, administrator-maker and sector-portfolio cases need that isolated setup; they are not additional current hosted logins. Do not reseed shared production identities to restore old test accounts.

## Original native setup

Run `npm run test:accounts` explicitly with the native local PostgreSQL configuration and the Python scorer available (`npm start`). It adds ten dedicated test logins to the native app at `http://localhost:3000`. The Docker app on port 8080 and the isolated fraud demo on port 3001 have their own databases and logins.

The command generates one random initial password, prints it once, and stores it in `data/testing/feature-accounts.json` and `data/testing/FEATURE-TESTING.md`. The demo guide also contains the MFA account's authenticator secret and unused recovery codes. The selected synthetic demo login files are included in Git for project testing. Anyone with repository access can use their passwords and MFA material. Rotate or remove demo accounts before public deployment. Application secrets, PostgreSQL credentials and other runtime data remain excluded from Git; source archives and container images exclude the entire data directory.

The native database remains separate from the current Neon roster; retain its original credentials and login inventory. The full ten-feature-login fixture also remains available for fresh or isolated test databases.

## Business banking and customer experience

1. Sign in as the business tester. Inspect the company dashboard, operating savings and liquidity reserve. The initial test funding is SGD 45,000 operating and SGD 5,000 reserve; prepared payments change those balances. Historical test-funds deposits make statements useful across dates.
2. Open Accounts. Create an empty savings account, rename it and close it. Keep one account open. Closing the funded operating account is refused. A closed fixture account is already visible.
3. Transfer SGD 10 to recipient account **1088800201**. Move SGD 5 to your own reserve **1088800102**. Review the details and authorize with the current test password. Sign in as the recipient in another browser profile to see the matching incoming receipt.
4. Pay a small PUB, SP Services or Singtel bill with a test reference. Billers simulate settlement; the local payment and notification workflows are implemented.
5. Open Activity and inspect the prepared completed, held and rejected transactions. Search **Feature tour**, filter by status/account/date, export filtered CSV and print/save an account statement as PDF. Statements reconcile opening funds and completed ledger entries; pending/rejected rows never reduce the settled balance.
6. Open Scheduled payments. Business examples include active one-time, weekly and monthly instructions, a cancelled instruction and an executed once-only bill. Future test instructions are initially seven or more days away. Create your own instruction a few minutes ahead to watch the normal server worker execute it, or cancel an active test instruction. The failed zero-balance fixture belongs to the retired empty tester and is exercised only in isolated tests.
7. Open Notifications. Payment, review and schedule examples generate real persisted in-app alerts. Mark one or all read and follow a receipt link.
8. Ask the private assistant for balances, recent transactions, scheduled payments or an explanation of a flagged payment. Request a small transfer/payment draft and finish through the ordinary review form. Chat never executes the financial action. Keep passwords and authenticator codes out of chat.

## Business profiles and staff workflows

Registration creates an empty active business account without bank onboarding review. Open **Business profile** to inspect the legal account holder and customize industry news. The registered legal identity is read-only; amendments require bank assistance.

The reviewer has no fabricated business or deposit accounts. Its interface opens the bank operations workspace, with Fraud monitoring and Fraud rules. Business onboarding, application submission and approval controls are removed.

Legacy pending/rejected and missing-profile restrictions remain covered in isolated tests. These records cannot bypass ownership or financial eligibility checks, and they are not automatically activated. Historical business decisions and audit records are retained.

## Fraud rules, AI scores and independent authorization

The feature setup uses the real configured Python scorer and the existing rule policy. It creates a SGD 10,000 held high-value payment, a held maker payment to a new recipient, a SGD 30,000 policy-blocked payment, and independently approved/rejected examples. The existing rule values and policy version are preserved.

1. Sign in as the reviewer tester. In Fraud monitoring, open **high-value-awaiting-review** or **maker-awaiting-independent-review**. Inspect AI score, combined score, model explanation, matched controls and recorded authorization. Approve one with a verified test reason; reject another. Refresh the business sender to see the final receipt and balance.
2. The maker tester can see its held payment in Activity. Its own transaction is excluded from its review queue, and a direct self-approval request returns 403. The fixture has verified this guard. A different administrator can review it.
3. As the reviewer, open Fraud rules. For a small rule-management demonstration, record the initial threshold, change the high-value threshold from SGD 10,000 to SGD 9,500, authorize and inspect the audit entry. Restore the original threshold afterward and inspect the second audit event. Rule edits affect the shared local policy; the fixture itself does not edit it. Ordinary customer accounts cannot use these administrator APIs.
4. Use npm run demo:agents for actual configured AI scoring and all five analysis features in a disposable schema. Old preset fraud simulations have been removed.

## Login security, MFA and sessions

1. All new identities use the generated initial password in the private guide. Only the MFA tester initially requires a second factor. Wrong credentials are refused and durable throttles remain enabled.
2. For the MFA tester, add the private guide's secret/URI to an authenticator, or run **`npm run test:accounts:otp:neon`** for the current Neon app, or **`npm run test:accounts:otp`** for the original native database. Each accepted code can be used once; wait for the next 30-second slot after using it.
3. Use an unused recovery code from the private guide to test recovery login. It becomes invalid after use. One initial code was consumed by the setup's successful recovery-login check; nine remain initially.
4. On an ordinary customer account, open Profile & security and enroll/confirm your own authenticator, inspect the ten one-use recovery codes, then test code login and disabling MFA with the current password and a fresh code.
5. Sign into the same test identity in two browser profiles. Change its password in one; the old password and other session stop working. Test Revoke all sessions and confirm both sessions are signed out. Setup reruns preserve these changes and never reset passwords or MFA.
6. To verify ownership/RBAC, compare the recipient's dashboard/history with the business tester. Customer requests for another business account return 404; administrator-only rules return 403. An administrator cannot bypass source-account ownership for ordinary banking transfers.

## Repeatability and evidence

Use the current Neon guide for the hosted roster. Run `npm run test:accounts` only with the original native configuration, or `npm run test:accounts:neon` for a fresh or isolated Neon fixture. The full verification still expects all ten feature logins and is not a check of the retired hosted roster. It recognizes its own audited fixture, checks identity ownership and leaves modified passwords, balances, approvals, reviews and MFA settings intact. It refuses a reserved email, registration or account-number collision instead of adopting an existing customer. A failed partial run can resume the idempotent examples. Financial writes retain fixed request IDs and actual password authorization.

Initial deposits are explicitly labelled synthetic fixture credits. New payment examples pass through current financial rules and real configured scoring; MFA is enrolled through Express, with encrypted secrets and hashed recovery codes in PostgreSQL. The script verifies original users, passwords, roles, MFA records, accounts, transactions, businesses and fraud settings match their pre-run snapshot, and checks that every account balance reconciles. Existing sessions are allowed to refresh normally.

The command is explicit local-development tooling, never called by `npm start`, database migrations, normal seeding, or CI/container startup. `tests/dft-feature-accounts.test.js` checks collision refusal, preservation, replay, business access restrictions, schedules, maker/checker controls, MFA and ownership against isolated PostgreSQL fixtures; those unit/integration fixtures use a controlled model, while the live setup uses the configured Python service.

## Retire an existing login

Run the operator command against the intended database with explicit user IDs. Without `--apply`, it previews the selected identities and changes no records:

```sh
npm run accounts:retire -- --ids <explicit IDs>
```

After reviewing that preview, append `--apply` to disable those logins:

```sh
npm run accounts:retire -- --ids <explicit IDs> --apply
```

Retirement prefixes the stored password hash with `!retired!`, which the existing password verifier rejects, increments the authentication version and revokes existing sessions in one operator transaction. It preserves businesses, accounts, balances, transactions and audit history. It requires no schema, authentication-code or HTTP changes. Existing fixture markers prevent setup reruns from recreating identities or resetting retired credentials; full edge-case coverage remains in isolated test fixtures.
