# Current demo logins - Neon

Updated **26 November 2026**. There are **nine usable logins: one customer for each of eight industries, plus one bank administrator**. The local app at http://localhost:3000 and [the hosted app](https://fyp-greenlink-six.vercel.app) use this Neon database when configured with the current connection settings.

Use the full email as the username. Retained passwords were preserved; this cleanup did not reset passwords or MFA. The values below are the shared synthetic demo credentials; a later password change takes precedence.

## Industry business demo accounts

| Login email | Demo password | Permission role | Industry |
| --- | --- | --- | --- |
| `logistics-business@greenlink.demo` | `IndustryDemo123!` | `customer` | Logistics and freight transport |
| `technology-business@greenlink.demo` | `IndustryDemo123!` | `customer` | Technology and software services |
| `manufacturing-business@greenlink.demo` | `IndustryDemo123!` | `customer` | Manufacturing and electronics |
| `wholesale-business@greenlink.demo` | `IndustryDemo123!` | `customer` | Wholesale import and export |
| `hospitality-business@greenlink.demo` | `IndustryDemo123!` | `customer` | Food and hospitality |
| `construction-business@greenlink.demo` | `IndustryDemo123!` | `customer` | Construction and property services |
| `healthcare-business@greenlink.demo` | `IndustryDemo123!` | `customer` | Healthcare and medical supplies |
| `energy-business@greenlink.demo` | `IndustryDemo123!` | `customer` | Renewable energy services |
| `reviewer-tester@greenlink.demo` | `GLTest-ljDD9JhfDfmi!a1` | `admin` | Bank operations and independent review |

Each industry login owns one fictional business, with its existing operating savings account, liquidity reserve and historical receipts. The administrator handles fraud reviews, fraud rules and the AI audit log. Customer logins cannot open administrator controls or another company's private records.

The other feature-testing, sector-portfolio and user-created logins are retired. Their sign-in access and sessions are disabled; financial records, balances and audit history remain. The owner-approved monthly PUB test schedule for SGD 12.50 on the retired business tester was cancelled, including future occurrences. No funds were moved during cleanup.

## Try the retained accounts

1. Sign in as an industry customer and inspect Overview, Accounts and Activity.
2. Open **Business profile > Customize industry news**, choose operating markets, activities and priorities, then save.
3. Ask **Show current news for my industry and explain what our company should do next.** Verify the business label and dated sources.
4. Test balances, finance downloads, funding checks, charts and payment drafts using this customer's own records.
5. Compare logistics and technology in separate browser profiles for isolation and different industry advice. Use the normal banking forms for authorized synthetic transfers between retained businesses.
6. Use the reviewer login separately for bank operations. Never put passwords, authenticator codes or recovery codes in assistant chat.

See the [current walkthrough](FEATURE-TESTING.md) and [assistant question bank](../../../docs/assistant-testing.md). Historical tester packets keep their original case IDs; use the current identity mapping and mark missing isolated fixtures Blocked.

## Setup and retained history

`npm run demo:industries` prepares the eight industry fixtures on an appropriately configured development database and preserves changed credentials and existing records. The full feature-tour and sector-portfolio seeders are for fresh or isolated fixtures; their historical credential JSON is not the current hosted roster. Do not rerun those seeders to restore retired shared logins.

The original native PostgreSQL fixtures have separate credentials and do not describe this Neon roster. [Account-retirement instructions](../../../docs/feature-testing.md#retire-an-existing-login) explain the operator preview/apply process. These synthetic demo credentials remain excluded from release packages; database connections and application/API secrets must stay private.
