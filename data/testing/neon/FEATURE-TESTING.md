# Greenlink demo feature-testing logins

Open http://localhost:3000. These are dedicated synthetic test identities. Original users, passwords, accounts and fraud settings are preserved.

Initial password for all ten new users: **GLTest-ljDD9JhfDfmi!a1**

Changed passwords, approvals, review decisions and balances are retained when setup is repeated.

| Login email | Actual permission role | Business state | Operating account | Test purpose |
| --- | --- | --- | --- | --- |
| business-tester@greenlink.demo | customer | approved | 1088800101 | Everyday business banking, payments, schedules, statements and assistant |
| recipient-tester@greenlink.demo | customer | approved | 1088800201 | Receive transfers and verify business/account isolation |
| pending-tester@greenlink.demo | customer | pending_review | 1088800301 | Pending onboarding and blocked financial actions |
| rejected-tester@greenlink.demo | customer | rejected | 1088800401 | Rejected application, review explanation and resubmission |
| profile-tester@greenlink.demo | customer | Missing profile | 1088800501 | Existing operator completing a missing registered-business profile |
| empty-tester@greenlink.demo | customer | approved | 1088800601 | Zero balance, insufficient funds and failed scheduled instruction |
| staff-tester@greenlink.demo | admin | Staff workspace | No deposit account | Bank operations, business approvals, fraud rules and monitoring |
| reviewer-tester@greenlink.demo | admin | Staff workspace | No deposit account | Independent approve/reject decisions and fraud-rule audit |
| maker-tester@greenlink.demo | admin | approved | 1088800901 | Administrator payment maker; own held payment cannot be self-approved |
| mfa-tester@greenlink.demo | customer | approved | 1088801001 | Authenticator login, recovery codes and profile security |

## Feature walkthrough

Follow docs/feature-testing.md for every screen and workflow. Use different browser profiles/private windows for maker and reviewer. Business operating account: 1088800101; reserve: 1088800102; recipient: 1088800201.

Prepared payment outcomes:

- supplier-payment: completed, AI score 20, combined score 20; receipt 3b60a73b-582a-5c41-a736-0fd5cddda9b5
- utility-bill: completed, AI score 25, combined score 25; receipt d49279e6-8fa8-5501-ae28-7e2fcf27a9bb
- liquidity-transfer: completed, AI score 42, combined score 42; receipt dd44d918-9e86-5942-a01c-a77a372a1073
- independently-approved: completed, AI score 68, combined score 70; receipt 348bd2a1-a245-5bad-ae65-2f6467da8259
- independently-rejected: rejected, AI score 42, combined score 70; receipt 2c4ac2ce-f020-58b2-a3f9-14036f34b3e9
- high-value-awaiting-review: pending_review, AI score 68, combined score 70; receipt 537bd25e-6713-5c3b-a0b1-ba6b5e48213e
- daily-limit-blocked: rejected, AI score 68, combined score 95; receipt 69e8c950-b18e-5900-a3fb-87d3a06cc596
- maker-awaiting-independent-review: pending_review, AI score 25, combined score 70; receipt fd4d227a-ff23-5276-a877-6ac74373a675

Prepared schedules:

- once: active; instruction be90a96a-e204-4d54-b7ea-a9667f0b122d
- weekly: active; instruction 576d5100-674f-40b7-a6ec-4dce48ef8082
- monthly: active; instruction dbcabfa1-dce5-4558-8035-d33e6ecf5eb9
- cancelled: cancelled; instruction f3bbd0f0-94db-47f4-bb3e-21357e63e1c3
- execute: completed; instruction d8aac958-6b2f-4ede-af9e-b3c8de0e27ab
- insufficient: failed; instruction 43e6bf79-505c-4e14-a9c8-c2c882534e9f (Insufficient funds in the selected account.)

## Authenticator account

Only mfa-tester@greenlink.demo requires a second factor initially. Add this account to your authenticator using the private secret **3BVVK2W27HJFUVTQ7DCUP4464S6NLPQQ**.

Authenticator URI: otpauth://totp/Green%20Link%20Digital%20Bank%3Amfa-tester%40greenlink.demo?secret=3BVVK2W27HJFUVTQ7DCUP4464S6NLPQQ&issuer=Green+Link+Digital+Bank&algorithm=SHA1&digits=6&period=30

Or run npm run test:accounts:otp:neon to obtain the current local test code. Codes cannot be reused; wait for the next 30-second slot after a successful code login.

Unused initial recovery codes (one use each):

- F9DD-864F-576C-7489-5707
- 183D-E3F8-CB1E-F895-2F4C
- 246D-A5F4-9E6A-4E35-2E6D
- 3E84-6103-548E-75FF-DC16
- 1926-0640-6E7B-8835-5681
- F7C8-A2FE-C2BA-1CEB-869B
- AFC5-AB85-2401-BC72-DE34
- 704F-0AC1-49AC-B3D6-A248
- 8092-ACDA-C592-C7B9-F582

## Verification

10 sign-ins verified through real Express/PostgreSQL. MFA password-only sign-in was refused, recovery sign-in succeeded, customer administrator access and cross-business reads were refused, and assistant balance enquiry succeeded. The original-record fingerprint check passed. Sample financial writes were scored by the configured private Python service; original policy values were retained.

This file and feature-accounts.json contain shared synthetic demo credentials. Rotate or remove demo accounts before public deployment.
