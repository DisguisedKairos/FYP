# GLDB Assistant

Open **GLDB Assistant** after signing in as an authorized business operator. It reads only that operator's linked business account records and prepares business payment drafts. It supports these examples:

| Message | Result |
| --- | --- |
| What is my balance? | Available balances for your active savings accounts. |
| Show recent transactions | Up to five of your recent records and a link to complete activity. |
| Search transactions for Singtel | Matching activity from your own accounts. |
| Show scheduled payments | Recent instructions and their actual status. |
| Show notifications | Unread count and recent notifications without marking them read. |
| Explain my latest flagged transaction | Recorded score, status and reasons for your latest held/rejected scored payment. |
| Transfer SGD 25 to 1020002001 | A draft opened in the normal transfer form. |
| Transfer SGD 25 from Operating savings to Liquidity reserve | A draft between your business's own accounts. |
| Pay SGD 86.42 to SP Services reference SP-12345 | A bill draft with the supplied reference. |
| Download a statement | Opens activity, where you choose the account and Singapore date range. |

The assistant is a local intent parser, so unsupported wording produces help or a link to a banking screen. It is separate from the trained fraud-scoring model. It does not infer ambiguous payment dates, search a business directory, promise recipient eligibility, or provide general financial advice. The sample Harbour Supplies recipient is available by name only for the seeded demo. All actual payments still require approved source and recipient businesses.

Chat cannot create, authorize, send, approve or cancel payments. A draft must be checked in the normal form and authorized with the current password; risk scoring and financial checks occur when that form is submitted. A later balance or rule change can affect the result.

Conversations live only in browser memory and clear on logout, reload or **Clear conversation**. The endpoint does not store messages or send them to external AI services. Credentials and security-code inputs are conservatively rejected/redacted. Use only the dedicated password field on a banking authorization screen. DIT supplies HTTPS and network configuration when integrating the application into a hosted environment.
