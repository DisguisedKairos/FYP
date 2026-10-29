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
