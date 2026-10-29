# Test accounts and complete feature walkthrough


For the current Neon-backed app, open the verified demo login table at **`data/testing/neon/README.md`**. Use `npm run test:accounts:neon` to prepare synthetic accounts on a new Neon database, `data/testing/neon/FEATURE-TESTING.md` for the full guide, and `npm run test:accounts:otp:neon` for MFA. These are fresh synthetic Neon identities with their own generated password; original native data is retained separately. The remaining walkthrough applies to both environments. See [Neon setup](neon.md).

## Original native setup

Run `npm run test:accounts` explicitly with the native local PostgreSQL configuration and the Python scorer available (`npm start`). It adds ten dedicated test logins to the native app at `http://localhost:3000`. The Docker app on port 8080 and the isolated fraud demo on port 3001 have their own databases and logins.

The command generates one random initial password, prints it once, and stores it in `data/testing/feature-accounts.json` and `data/testing/FEATURE-TESTING.md`. The demo guide also contains the MFA account's authenticator secret and unused recovery codes. The selected synthetic demo login files are included in Git for project testing. Anyone with repository access can use their passwords and MFA material. Rotate or remove demo accounts before public deployment. Application secrets, PostgreSQL credentials and other runtime data remain excluded from Git; source archives and container images exclude the entire data directory.

| Login email | Actual permission role | Starting use case |
| --- | --- | --- |
| `business-tester@greenlink.demo` | `customer` | Approved, funded business; operating, reserve and closed savings accounts |
| `recipient-tester@greenlink.demo` | `customer` | Approved recipient business, incoming transfers and record isolation |
| `pending-tester@greenlink.demo` | `customer` | Business application awaiting independent approval |
| `rejected-tester@greenlink.demo` | `customer` | Rejected application with explanation; correction and resubmission |
| `profile-tester@greenlink.demo` | `customer` | Existing operator without a business profile; complete its company details |
| `empty-tester@greenlink.demo` | `customer` | Approved business with zero funds; insufficient-funds handling |
| `staff-tester@greenlink.demo` | `admin` | Dedicated bank operations workspace, onboarding and fraud policies |
| `reviewer-tester@greenlink.demo` | `admin` | Separate independent reviewer for held payments |
| `maker-tester@greenlink.demo` | `admin` | Combined business/admin test identity to demonstrate self-approval denial |
| `mfa-tester@greenlink.demo` | `customer` | Approved business with enrolled authenticator and recovery login |

There are **two permission roles**, customer and administrator. Staff, reviewer and maker are separate test identities with the existing administrator permissions; they are not invented extra roles. The maker is an explicit combined-access test case. All customer accounts represent registered businesses or the existing-operator business-onboarding flow.

## Business banking and customer experience

1. Sign in as the business tester. Inspect the company dashboard, operating savings and liquidity reserve. The initial sample funding is SGD 45,000 operating and SGD 5,000 reserve; prepared payments change those balances. Historical sample-funds deposits make statements useful across dates.
2. Open Accounts. Create an empty savings account, rename it and close it. Keep one account open. Closing the funded operating account is refused. A closed fixture account is already visible.
3. Transfer SGD 10 to recipient account **1088800201**. Move SGD 5 to your own reserve **1088800102**. Review the details and authorize with the current test password. Sign in as the recipient in another browser profile to see the matching incoming receipt.
4. Pay a small PUB, SP Services or Singtel bill with a sample reference. Billers simulate settlement; the local payment and notification workflows are implemented.
5. Open Activity and inspect the prepared completed, held and rejected transactions. Search **Feature tour**, filter by status/account/date, export filtered CSV and print/save an account statement as PDF. Statements reconcile opening funds and completed ledger entries; pending/rejected rows never reduce the settled balance.
6. Open Scheduled payments. Examples include active one-time, weekly and monthly instructions, a cancelled instruction, an executed once-only bill and a failed zero-balance bill. Future sample instructions are initially seven or more days away. Create your own instruction a few minutes ahead to watch the normal server worker execute it, or cancel an active sample.
7. Open Notifications. Onboarding, payment, review and schedule examples generate real persisted in-app alerts. Mark one or all read and follow a receipt link.
8. Ask the private assistant for balances, recent transactions, scheduled payments or an explanation of a flagged payment. Request a small transfer/payment draft and finish through the ordinary review form. Chat never executes the financial action. Keep passwords and authenticator codes out of chat.

## Onboarding and staff workflows

1. The pending tester can view its pending application but cannot move funds or change savings accounts. Use a different browser profile to sign in as the staff tester. Open business applications, inspect the sample company, confirm sample verification and approve with a reason and current password. Refresh the pending user's application to see approval.
2. The rejected tester sees the saved rejection reason. Correct its details and resubmit. It returns to pending review and requires another independent staff decision.
3. The profile tester starts without company details. Submit a registered-business profile, then approve it independently. It starts with zero sample funds.
4. The empty tester can see its approved business and zero balance. A payment above its available funds is refused; the prepared failed schedule records the insufficient-funds reason.
5. Dedicated staff/reviewer users have no fabricated businesses or deposit accounts. Their interface opens the bank operations workspace.

## Fraud rules, AI scores and independent authorization

The feature setup uses the real configured Python scorer and the existing rule policy. It creates a SGD 10,000 held high-value payment, a held maker payment to a new recipient, a SGD 30,000 policy-blocked payment, and independently approved/rejected examples. The existing rule values and policy version are preserved.

1. Sign in as the reviewer tester. In Fraud monitoring, open **high-value-awaiting-review** or **maker-awaiting-independent-review**. Inspect AI score, combined score, model explanation, matched controls and recorded authorization. Approve one with a verified sample reason; reject another. Refresh the business sender to see the final receipt and balance.
2. The maker tester can see its held payment in Activity. Its own transaction is excluded from its review queue, and a direct self-approval request returns 403. The fixture has verified this guard. A different administrator can review it.
3. As staff/reviewer, open Fraud rules. For a small rule-management demonstration, record the initial threshold, change the high-value threshold from SGD 10,000 to SGD 9,500, authorize and inspect the audit entry. Restore the original threshold afterward and inspect the second audit event. Rule edits affect the shared local policy; the fixture itself does not edit it. Ordinary customer accounts cannot use these administrator APIs.
4. Use npm run demo:agents for actual configured AI scoring and all five analysis features in a disposable schema. Old preset fraud simulations have been removed.

## Login security, MFA and sessions

1. All new identities use the generated initial password in the private guide. Only the MFA tester initially requires a second factor. Wrong credentials are refused and durable throttles remain enabled.
2. For the MFA tester, add the private guide's secret/URI to an authenticator, or run **`npm run test:accounts:otp:neon`** for the current Neon app, or **`npm run test:accounts:otp`** for the original native database. Each accepted code can be used once; wait for the next 30-second slot after using it.
3. Use an unused recovery code from the private guide to test recovery login. It becomes invalid after use. One initial code was consumed by the setup's successful recovery-login check; nine remain initially.
4. On an ordinary customer account, open Profile & security and enroll/confirm your own authenticator, inspect the ten one-use recovery codes, then test code login and disabling MFA with the current password and a fresh code.
5. Sign into the same test identity in two browser profiles. Change its password in one; the old password and other session stop working. Test Revoke all sessions and confirm both sessions are signed out. Setup reruns preserve these changes and never reset passwords or MFA.
6. To verify ownership/RBAC, compare the recipient's dashboard/history with the business tester. Customer requests for another business account return 404; administrator-only rules return 403. An administrator cannot bypass source-account ownership for ordinary banking transfers.

## Repeatability and evidence

Run `npm run test:accounts` again to locate the private guide. It recognizes its own audited fixture, checks identity ownership and leaves modified passwords, balances, approvals, reviews and MFA settings intact. It refuses a reserved email, registration or account-number collision instead of adopting an existing customer. A failed partial run can resume the idempotent examples. Financial writes retain fixed request IDs and actual password authorization.

Initial deposits are explicitly labelled synthetic fixture credits. New payment examples pass through current financial rules and real configured scoring; MFA is enrolled through Express, with encrypted secrets and hashed recovery codes in PostgreSQL. The script verifies original users, passwords, roles, MFA records, accounts, transactions, businesses and fraud settings match their pre-run snapshot, and checks that every account balance reconciles. Existing sessions are allowed to refresh normally.

The command is explicit local-development tooling, never called by `npm start`, database migrations, normal seeding, or CI/container startup. `tests/dft-feature-accounts.test.js` checks collision refusal, preservation, replay, onboarding, schedules, maker/checker controls, MFA and ownership against isolated PostgreSQL fixtures; those unit/integration fixtures use a controlled model, while the live setup uses the configured Python service.
