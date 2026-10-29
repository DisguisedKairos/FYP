# Greenlink demo feature-testing logins

Open http://localhost:3000. These are dedicated synthetic test identities. Original users, passwords, accounts and fraud settings are preserved.

Initial password for all ten new users: **GLTest-GfBawLc_7sK-!a1**

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

- supplier-payment: completed, AI score 14, combined score 14; receipt fc7c3e5d-265f-56d4-ac83-badfd0ad2e49
- utility-bill: completed, AI score 19, combined score 19; receipt f2bc7d98-3b94-5fc1-ac00-9650875ec294
- liquidity-transfer: completed, AI score 12, combined score 12; receipt 5ca98db2-f4b2-5764-a331-94d7d057e9bb
- independently-approved: completed, AI score 74, combined score 74; receipt 24ff2773-1805-5f06-a134-ac9de1c4c3e9
- independently-rejected: rejected, AI score 53, combined score 70; receipt 95181fa0-1ab6-5dc8-a769-548c9df6c537
- high-value-awaiting-review: pending_review, AI score 45, combined score 70; receipt d3ffec8f-a1bd-5768-a20f-f4756508ca9f
- daily-limit-blocked: rejected, AI score 66, combined score 95; receipt 487a2a3c-fd3f-5f77-a8e7-b8d840018d95
- maker-awaiting-independent-review: pending_review, AI score 36, combined score 70; receipt 1ee9557f-8fc5-5bf7-aa34-765ffa32d307

Prepared schedules:

- once: active; instruction 040d2ec6-86d6-4c7c-9210-81143f9a1eee
- weekly: active; instruction b97af466-4952-4d5b-9c21-8128f1184294
- monthly: active; instruction f5dd343f-7b79-4999-b5ab-cbd9126ada5e
- cancelled: cancelled; instruction 8434029a-5ef6-423d-a0d2-366252756d04
- execute: completed; instruction ead6c696-112c-4104-a4b6-b7c6776a0d5d
- insufficient: failed; instruction 0e6407d8-53a4-4fdc-b9f1-d1193ed4e118 (Insufficient funds in the selected account.)

## Authenticator account

Only mfa-tester@greenlink.demo requires a second factor initially. Add this account to your authenticator using the private secret **4J3RUE3PLZHGMM2B35LW3L3DTR2NAEHH**.

Authenticator URI: otpauth://totp/Green%20Link%20Digital%20Bank%3Amfa-tester%40greenlink.demo?secret=4J3RUE3PLZHGMM2B35LW3L3DTR2NAEHH&issuer=Green+Link+Digital+Bank&algorithm=SHA1&digits=6&period=30

Or run npm run test:accounts:otp to obtain the current local test code. Codes cannot be reused; wait for the next 30-second slot after a successful code login.

Unused initial recovery codes (one use each):

- 18A8-8321-5261-A0A7-8858
- C46D-974B-5375-CEE1-BD77
- 6283-61ED-7434-6059-2F2D
- FD13-118A-8E82-AB34-D5FC
- 58D8-2F16-2E10-029A-6DD5
- F653-DCB8-6540-C2AC-B906
- CF3C-5E15-C092-95EB-F981
- 3A69-9A79-D39A-A0DB-C2E9
- 33E9-6620-301C-035E-CFC6

## Verification

10 sign-ins verified through real Express/PostgreSQL. MFA password-only sign-in was refused, recovery sign-in succeeded, customer administrator access and cross-business reads were refused, and assistant balance enquiry succeeded. The original-record fingerprint check passed. Sample financial writes were scored by the configured private Python service; original policy values were retained.

This file and feature-accounts.json contain shared synthetic demo credentials. Rotate or remove demo accounts before public deployment.
