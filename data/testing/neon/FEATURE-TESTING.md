# Current Neon feature walkthrough

The hosted roster contains **eight industry customers and one administrator**. Use the [nine-login table](README.md); the earlier feature-tour and sector logins are retired. Their financial and audit records remain available as history, and the approved old monthly PUB test schedule has been cancelled.

## Customer banking

Use `logistics-business@greenlink.demo` for ordinary banking and `technology-business@greenlink.demo` as the separate recipient/privacy identity. Any of the eight industry customers can test their own balances, accounts, transaction history/search, statements, finance CSV/PDF downloads, schedules, notifications, charts, saved dashboards, company profiles and industry-news advice. Use actual current account numbers, receipt IDs, dates and balances from that identity's screens.

Open Ask GLDB for read-only enquiries and drafts. Chat does not execute payments or approve held transactions. Authorize financial instructions only in the banking forms. For cross-business checks, use separate browser profiles and confirm that one customer cannot read another customer's records or saved preferences.

Each industry customer retains its operating savings and reserve. New customer savings accounts start empty. Do not alter shared balances or schedules merely to restore a test baseline.

## Bank administrator

`reviewer-tester@greenlink.demo` is the only retained administrator. It handles fraud monitoring, independent payment reviews, rule management and AI audit. A customer can create a permitted held payment for independent review; the reviewer must use the normal authorization workflow. The administrator role does not grant ownership of customer deposits or their private assistant conversations.

## Cases requiring isolated setup

Restricted legacy businesses, missing business profiles, zero-balance fixtures, the former MFA tester, administrator-maker self-approval and the dedicated multi-sector scenario portfolio are no longer shared hosted logins. Prepare these in an owner-controlled isolated database when testing those cases. Current industry data is not a substitute for the old sector-scenario portfolio. Do not create replacement shared production logins to satisfy a historical test packet.

MFA and password/session-revocation controls remain implemented. Test changes using an authorized disposable local identity or a separately agreed retained account; do not consume shared historical recovery material. The legacy feature-accounts.json records the original feature-tour setup and is retained for isolated tooling, not current login instructions.

## Verification

The cleanup preserves all retained credentials, businesses, balances, receipts and existing audit records. Retirement disables access and revokes sessions rather than deleting ledger history. For assistant questions, follow the [current identity mapping](../../../docs/assistant-testing.md#logins-and-roles) and [three-person test assignment](../../../docs/assistant-team-testing.md). Mark cases with missing setup Blocked and retain the original failure observation when recording a retest.
