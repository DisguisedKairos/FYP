# GLDB Assistant

Select **Ask GLDB** in the lower-right corner after signing in. GLDB Assistant opens as a floating chat popup on every banking screen, with no separate sidebar page. Minimize it with the close button or Escape and reopen it to continue. Unsent text and replies remain in the current session while navigating; replies arriving while minimized show a **New reply** badge. Signing out clears the popup and conversation. Existing `/assistant` links redirect to the dashboard and open the popup.

The assistant reads only the signed-in operator's linked business account records and prepares business payment drafts. Draft actions minimize chat and open the ordinary banking forms for review and password authorization. It supports these examples:

| Message | Result |
| --- | --- |
| test / Hello | OpenAI connection acknowledgement and suggested tasks, without retrieving banking records. |
| What is my balance? | Available balances for your active savings accounts. |
| Show recent transactions | Up to twenty owned transaction receipts, depending on the selected tool. |
| Search transactions for Singtel | Matching activity from your own accounts. |
| Show scheduled payments | Recent instructions and their actual status. |
| Investigate a transaction ID | Staff-only recorded risk evidence; use Banking insights to select the outgoing receipt. |
| Transfer SGD 25 to 1020002001 | A draft opened in the normal transfer form. |
| Transfer SGD 25 from Operating savings to Liquidity reserve | A draft between your business's own accounts. |
| Pay SGD 86.42 to SP Services reference SP-12345 | A bill draft with the supplied reference. |


The assistant requires OpenAI; see [tools and safeguards](banking-agents.md). The parser-only assistant and offline report choices have been removed. The model uses permitted tools for banking evidence, while greetings and requests without evidence receive trusted help/clarification after a model response. Banking facts require evidence even after a corrective tool attempt. Fraud scoring also uses the same configured OpenAI model through the private FastAPI validation gateway. The assistant does not search a business directory, promise recipient eligibility or provide general financial advice. All actual payments still require approved source and recipient businesses.

Chat cannot create, authorize, send, approve or cancel payments. A draft must be checked in the normal form and authorized with the current password; risk scoring and financial checks occur when that form is submitted. A later balance or rule change can affect the result.

Raw conversations live in browser memory and clear on logout, reload or **Clear conversation**. The banking service saves reports, tool evidence and structured draft context privately in PostgreSQL, but does not save raw messages. The assistant sends prompts and permitted tool results to the OpenAI API. Help/clarification runs save only the trusted response and no banking tool results. Credentials and security-code inputs are conservatively rejected/redacted. Use only the dedicated password field on a banking authorization screen. DIT supplies HTTPS and network configuration when integrating the application into a hosted environment.

Completed responses must match the configured OpenAI model and pass completion/tool-shape validation. Incomplete or invalid model responses return an explicit unavailable error. Structured draft continuations expire after fifteen minutes; the UI clears an expired reference so **Try again** starts a fresh request without reusing old draft details. Bill drafts require a reference of 3-64 characters before the payment form is offered.
