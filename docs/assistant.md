# GLDB Assistant

Open **GLDB Assistant** after signing in as an authorized business operator. It reads only that operator's linked business account records and prepares business payment drafts. It supports these examples:

| Message | Result |
| --- | --- |
| test / Hello | Local-model connection acknowledgement and suggested tasks, without retrieving banking records. |
| What is my balance? | Available balances for your active savings accounts. |
| Show recent transactions | Up to twenty owned transaction receipts, depending on the selected tool. |
| Search transactions for Singtel | Matching activity from your own accounts. |
| Show scheduled payments | Recent instructions and their actual status. |
| Investigate a transaction ID | Staff-only recorded risk evidence; use Banking insights to select the outgoing receipt. |
| Transfer SGD 25 to 1020002001 | A draft opened in the normal transfer form. |
| Transfer SGD 25 from Operating savings to Liquidity reserve | A draft between your business's own accounts. |
| Pay SGD 86.42 to SP Services reference SP-12345 | A bill draft with the supplied reference. |


The assistant requires the local Ollama agent; see [tools and safeguards](banking-agents.md). The parser-only assistant and offline report choices have been removed. The model uses permitted tools for banking evidence, while greetings and requests without evidence receive trusted help/clarification after a model response. Banking facts require evidence even after a corrective tool attempt. Fraud scoring also uses the same local Ollama model through the private FastAPI validation gateway. The assistant does not search a business directory, promise recipient eligibility or provide general financial advice. All actual payments still require approved source and recipient businesses.

Chat cannot create, authorize, send, approve or cancel payments. A draft must be checked in the normal form and authorized with the current password; risk scoring and financial checks occur when that form is submitted. A later balance or rule change can affect the result.

Raw conversations live in browser memory and clear on logout, reload or **Clear conversation**. The banking service saves reports, tool evidence and structured draft context privately in PostgreSQL, but does not save raw messages. The assistant sends prompts and permitted tool results to the configured loopback model service. Help/clarification runs save only the trusted response and no banking tool results. Credentials and security-code inputs are conservatively rejected/redacted. Use only the dedicated password field on a banking authorization screen. DIT supplies HTTPS and network configuration when integrating the application into a hosted environment.
