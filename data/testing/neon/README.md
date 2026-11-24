# Current localhost login details - Neon

Open **http://localhost:3000**. The running application uses Neon PostgreSQL (`neondb`). Use the full email as your username and copy the matching password below without Markdown backticks or extra spaces.

Verified on 29 October 2026: every password matched the current Neon database and all ten accounts signed in successfully through the running login API, including the MFA account with an authenticator code.

| Login email | Password | Permission role | What to test |
| --- | --- | --- | --- |
| `business-tester@greenlink.demo` | `GLTest-ljDD9JhfDfmi!a1` | `customer` | Everyday business banking, payments, schedules, statements and assistant |
| `recipient-tester@greenlink.demo` | `GLTest-ljDD9JhfDfmi!a1` | `customer` | Receive transfers and verify business/account isolation |
| `pending-tester@greenlink.demo` | `GLTest-ljDD9JhfDfmi!a1` | `customer` | Pending onboarding and blocked financial actions |
| `rejected-tester@greenlink.demo` | `GLTest-ljDD9JhfDfmi!a1` | `customer` | Rejected application, review explanation and resubmission |
| `profile-tester@greenlink.demo` | `GLTest-ljDD9JhfDfmi!a1` | `customer` | Existing operator completing a missing registered-business profile |
| `empty-tester@greenlink.demo` | `GLTest-ljDD9JhfDfmi!a1` | `customer` | Zero balance, insufficient funds and failed scheduled instruction |
| `staff-tester@greenlink.demo` | `GLTest-ljDD9JhfDfmi!a1` | `admin` | Bank operations, business approvals, fraud rules and monitoring |
| `reviewer-tester@greenlink.demo` | `GLTest-ljDD9JhfDfmi!a1` | `admin` | Independent approve/reject decisions and fraud-rule audit |
| `maker-tester@greenlink.demo` | `GLTest-ljDD9JhfDfmi!a1` | `admin` | Administrator payment maker; own held payment cannot be self-approved |
| `mfa-tester@greenlink.demo` | `GLTest-ljDD9JhfDfmi!a1` | `customer` | Authenticator login, recovery codes and profile security |

Only `mfa-tester@greenlink.demo` also requires an authenticator code. Run `npm run test:accounts:otp:neon` for a current code. A successful code cannot be reused; wait for the next 30-second code. Private authenticator setup and recovery details are in [FEATURE-TESTING.md](FEATURE-TESTING.md).

The original native database has different passwords. Its `alex@greenlink.demo`, `jamie@greenlink.demo` and `bankops@greenlink.demo` accounts are not in this Neon database. Use the business tester for customer banking or the staff/reviewer tester for bank operations.

If your browser fills an older saved password, replace it with the password above. Changed passwords remain changed: this guide records the verified credentials at the time above and does not reset accounts. Repeated failed logins are limited for up to 15 minutes.

This file contains shared synthetic demo credentials for project testing. Rotate or remove demo accounts before public deployment. It remains excluded from source packages.


## Industry business demo accounts

These eight additional **customer** identities represent fictional Singapore businesses in real industries. They use real public industry research through the configured OpenAI provider; their names, banking activity and funds are educational fixtures. They are separate from the ten original feature-testing identities above.

Verified on **24 November 2026** through the Express login/profile/dashboard APIs using the restricted Neon runtime connection. All eight sign-ins succeeded, and each business has two owned savings accounts.

**Initial password for these eight accounts only:** `IndustryDemo123!`. Changed passwords remain changed; rerunning setup does not reset them. Each business has an operating savings account, a liquidity reserve, several months of fictional completed receipts and its own saved news-planning preferences.

| Login email | Fictional business | Industry focus |
| --- | --- | --- |
| `logistics-business@greenlink.demo` | GLDB Demo Meridian Logistics Pte. Ltd. | Freight routes, customs and carrier dependencies |
| `technology-business@greenlink.demo` | GLDB Demo Nimbus Cloud Pte. Ltd. | Cloud continuity, vendor security and software services |
| `manufacturing-business@greenlink.demo` | GLDB Demo Precision Electronics Pte. Ltd. | Components, production dependencies and lead times |
| `wholesale-business@greenlink.demo` | GLDB Demo Straits Wholesale Pte. Ltd. | Imports/exports, trade documents and supplier terms |
| `hospitality-business@greenlink.demo` | GLDB Demo Orchard Hospitality Pte. Ltd. | Food supply, hospitality demand and operating costs |
| `construction-business@greenlink.demo` | GLDB Demo Keystone Projects Pte. Ltd. | Project milestones, subcontractors and building materials |
| `healthcare-business@greenlink.demo` | GLDB Demo Clearwell Medical Pte. Ltd. | Medical product notices, licensing checks and supply continuity |
| `energy-business@greenlink.demo` | GLDB Demo Aurora Renewables Pte. Ltd. | Energy contracts, equipment dependencies and project delivery |

### Try a company-specific briefing

1. Sign in with one of the eight emails and its current password.
2. Open **Business profile > Customize industry news**. Confirm or change operating markets, activities and priorities, then save.
3. Click **Ask for an industry briefing**, or ask **Show current news for my industry and explain what our company should do next.**
4. Check the company label, selected activities/markets, dated source links, conditional business implications and practical next checks.
5. Sign in as a different industry business and ask the same question. Confirm the company context and industry-specific next steps differ. One company must never receive another company's saved settings or private banking records.
6. Reopen the preferences after signing in again to confirm persistence. Save an outdated version in a separate tab to verify a reload is required.

Setup: `npm run db:migrate`, then `npm run demo:industries`. This creates only the dedicated demo businesses and records audited sample funding. Existing identities, passwords, receipts, approvals and account balances are preserved. No live news or AI assessment is fabricated by setup. All these companies are fictional; company-name searches must not present them as real firms.
