# Private banking agents and evidence workflows


Version 2.8.0 adds explicit tool citations, evidence links, qualitative consistency/relevance checks, user-bound draft values and an automated adversarial evaluation suite. See [AI evaluation and reliability](ai-evaluation.md) and run `npm run evaluate:assistant`.

Version 2.7.0 adds five features to the existing DFT banking application. No onboarding agent is included.

| Feature | Access | Where to use it |
| --- | --- | --- |
| Fraud investigation | Bank administrators | Banking insights: select a queued or known outgoing transaction ID |
| Multi-step banking assistant | Business operators; staff enquiries respect the same tool permissions | GLDB Assistant |
| Liquidity planning | Owned business accounts | Banking insights: choose a 1-90 day horizon |
| AI rule impact analysis | Bank administrators | Banking insights: choose a rule, proposed threshold/status/action and lookback |
| Reconciliation investigation | Customers: owned records; administrators: bank operations | Banking insights |

## Provider and startup

Every assistant and insight report requires the configured AI provider. OpenAI is the default; there is no offline report engine, deterministic-only AI simulation or automatic fallback. Verified reads, arithmetic, draft validation and financial controls remain application tools.

Set OPENAI_MODEL and a private OPENAI_API_KEY in .env. Run npm run db:migrate, npm run ai:check to check model access, then npm start. Open http://localhost:3000/assistant or http://localhost:3000/banking-insights. See [OpenAI configuration and privacy](openai.md).

The model chooses approved read/draft tools and gives qualitative interpretations. OpenAI receives chat and permitted tool evidence, but no database connection, session token, password, MFA secret or financial execution tool. FastAPI uses the same configured provider for fraud scoring. Historical AI reports retain their recorded provider and evidence.

## Demonstrate each feature

Use the ten synthetic identities and shared initial password in `data/testing/FEATURE-TESTING.md`.

1. Sign in as `business-tester@greenlink.demo`. Open Banking insights, project 30 days and inspect scheduled occurrences, source-account shortfalls and any suggested funding drafts. An owned transfer credits the destination in the projection and does not count as money leaving the business. No future income is guessed. Held payments are disclosed separately because they are not reserved.
2. In GLDB Assistant, send **Transfer**, then **SGD 25**, then **1088800201**. The assistant asks for missing fields across requests and opens an ordinary transfer form when complete. Send **Schedule transfer SGD 10 to 1088800201 tomorrow weekly** to prepare a schedule draft. Tomorrow defaults to 09:00 Singapore time; an explicit time such as **tomorrow at 15:30** is respected. Inspect the displayed timestamp before authorizing. Raw conversation messages remain in browser memory.
3. Ask the local assistant: **Check my balances and whether I can cover my upcoming scheduled payments.** Inspect the displayed tool activity, verified fact cards and AI interpretation. Exact monetary values and scores come from tool facts; generated numerical claims and unauthorized execution claims are withheld. This guard is a bounded validation rule, not proof that every qualitative model statement is correct.
4. Sign in as `reviewer-tester@greenlink.demo` or `staff-tester@greenlink.demo`. Open Banking insights. Select an outgoing receipt from the fraud queue or use its transaction ID. Investigate it, inspect recorded model/rule reasons, prior completed outgoing history, evidence references and suggested independent checks. The brief does not approve/reject a payment or establish fraud. Use the normal independent review screen for decisions.
5. Preview a high-value threshold change, for example from SGD 10,000 to SGD 9,500. Compare current/proposed allow, review and block counts. Both policies use the same recorded input snapshots and original model scores. Only the latest 1,000 assessments in the chosen window are sampled. Only OpenAI results with valid model provenance and an integer score from 0 to 94 are included. Missing, invalid and retired-provider results are counted and skipped; archived evidence is preserved. No live policy is changed. Without labeled fraud outcomes, the report cannot measure precision, false positives or accuracy.
6. Run reconciliation as a business operator and then as staff. Customer reports include only owned accounts and exceptions. Staff can inspect bank-wide discrepancies, failed/retrying/overdue schedules and stuck notifications. Reports identify exceptions and suggest follow-up; they cannot repair balances or ledger entries.

## Evidence, privacy and boundaries

Migration `007_banking_agents.sql` adds `agent_runs` and append-only `agent_tool_calls`. Version 2.9.0 also adds three [transaction-monitoring and human-review tables](fraud-monitoring.md), bringing the schema to **28 tables**. Migration `009_openai_provider.sql` preserves historical evidence while permitting OpenAI agent runs, bringing the total to **nine migrations**. Existing identity, balance and transaction records are preserved.

Reports, permitted tool arguments/results and structured draft context are saved privately in PostgreSQL. Raw user messages, model prompts and hidden reasoning are not stored by the banking service. A report may contain a generated paraphrase. Clearing a conversation clears browser messages; it does not remove evidence records. Report lists/detail endpoints are restricted to the initiating user, including for staff. Sensitive input is refused before creating a run.

The runtime role cannot rewrite/delete tool evidence, delete runs or change a run's owner. Role and ownership checks are repeated inside tools. HTTP execution rechecks the session between tool calls and before completion. Changed security versions invalidate draft continuations/results; a continuation expires after fifteen minutes. Tools accept strict argument allowlists. There is no arbitrary SQL, shell, URL fetching or payment execution tool.

Limits: forty starts per user and 120 per IP per fifteen minutes, two concurrent recent runs across the database, eight tool calls, four model rounds and a sixty-second model deadline. Each model request has a bounded timeout/response size. Unknown tools, unsupported arguments, unavailable inference and stale authorization produce explicit failures. Banking interpretations require retrieved evidence; trusted help/clarification contains no banking facts and has no evidence links. A failed run records only a bounded error code.

Financial calculations, scores and lifecycle statuses are application facts. Model prose is interpretation. Local trials exposed numerical mistakes; validation now withholds numerical narrative claims and invalid score scales while retaining tool evidence. Human review and the existing independent approval/password controls remain necessary. These controls are consistent with [OWASP excessive-agency guidance](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

## Verification

```sh
npm test
npm run test:browser
npm run demo:agents
```

The explicit agent demonstration creates a disposable PostgreSQL schema using `TEST_DATABASE_URL`, seeds synthetic businesses, scores a sample payment through the real private FastAPI/OpenAI gateway, and exercises all five features with real OpenAI. It verifies investigations do not change financial balances, then removes the schema. Native data is never seeded by this command. OpenAI credentials are required for this optional demonstration; CI exercises the model adapter and tool boundary with controlled responses.

`tests/dft-agents.test.js` covers ownership, CSRF, staff restrictions, multi-turn drafts, schedules, recurrence, value conservation, historical simulations, reconciliation isolation, hostile tool calls, bounded loops, stale authorization and model-origin/narrative checks. `tests/dft-agents-browser.js` covers mobile business workflows and staff investigation/rule analysis with saved evidence.

## AI evaluation audit

Administrators can open **AI audit log** or **View AI audit** on their responses/reports to inspect model call attempts and saved tool evidence. Customer navigation, assistant responses and insight reports do not show audit links. A customer opening `/ai-audit` returns to the dashboard, and direct audit API requests receive 403. New runs include a prompt-template digest, request count and final narrative safety outcome (validated evidence, help without banking claims, or withheld interpretation). Optional narrative repair is identified separately in the request timeline. Raw rejected prose and hidden thoughts are never copied into the new log. A model request can complete while its suggested tool or narrative is refused by the application. Failed attempts and unavailable-model checks are visible without pretending analysis succeeded.

The audit reuses agent_runs, agent_tool_calls, fraud_assessments, fraud_screenings and append-only audit_log. No new database migration or duplicate evidence table is needed. Staff payment/monitoring access does not grant access to another user's assistant records. Read-only evidence endpoints remain available when OpenAI is unavailable. See [API filters and permissions](api.md#ai-audit-log-2110).
