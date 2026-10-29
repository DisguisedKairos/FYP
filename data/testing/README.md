> **The current localhost app uses Neon.** For its verified email/password table, open [neon/README.md](neon/README.md). This document contains the original native PostgreSQL passwords, which do not work on Neon.

# Local test account logins

Open http://localhost:3000/login. Use the full email address as the username.

These passwords were checked against the current local PostgreSQL password hashes on 29 October 2026. No passwords, roles, MFA settings or banking records were changed. This README contains local credentials and is excluded from Git and release packages.

| Login email | Password | Permission role | Second factor | Test purpose |
| --- | --- | --- | --- | --- |
| business-tester@greenlink.demo | GLTest-GfBawLc_7sK-!a1 | customer | None | Everyday business banking, payments, schedules, statements and assistant |
| recipient-tester@greenlink.demo | GLTest-GfBawLc_7sK-!a1 | customer | None | Receive transfers and verify business/account isolation |
| pending-tester@greenlink.demo | GLTest-GfBawLc_7sK-!a1 | customer | None | Pending onboarding and blocked financial actions |
| rejected-tester@greenlink.demo | GLTest-GfBawLc_7sK-!a1 | customer | None | Rejected application, review explanation and resubmission |
| profile-tester@greenlink.demo | GLTest-GfBawLc_7sK-!a1 | customer | None | Existing operator completing a missing registered-business profile |
| empty-tester@greenlink.demo | GLTest-GfBawLc_7sK-!a1 | customer | None | Zero balance, insufficient funds and failed scheduled instruction |
| staff-tester@greenlink.demo | GLTest-GfBawLc_7sK-!a1 | admin | None | Bank operations, business approvals, fraud rules and monitoring |
| reviewer-tester@greenlink.demo | GLTest-GfBawLc_7sK-!a1 | admin | None | Independent approve/reject decisions and fraud-rule audit |
| maker-tester@greenlink.demo | GLTest-GfBawLc_7sK-!a1 | admin | None | Administrator payment maker; own held payment cannot be self-approved |
| mfa-tester@greenlink.demo | GLTest-GfBawLc_7sK-!a1 | customer | Authenticator or unused recovery code | Authenticator login, recovery codes and profile security |
| bankops@greenlink.demo | Staff-kySB6ypsHRI8O0tWJm__66iG1aA! | admin | None | Existing bank operations administrator |

The MFA tester also requires an authenticator code. Run `npm run test:accounts:otp` locally for a current code, or use the authenticator/recovery details in [FEATURE-TESTING.md](FEATURE-TESTING.md). Codes cannot be reused.

Use separate browser profiles for the maker and independent reviewer. Payment authorization uses the same current password as login. Full workflows: [feature-testing guide](../../docs/feature-testing.md).

The existing alex@greenlink.demo and jamie@greenlink.demo passwords have been changed from the seed defaults and are not available in the saved test credentials. They have not been reset. Use the verified feature-testing identities above.

If you change a password, update this local README yourself; it is a verified snapshot rather than a password reset tool. Never upload this file or the private MFA guide to GitHub.
