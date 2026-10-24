# Private banking agents and evidence workflows

Version 2.7.0 adds five features to the existing DFT banking application. No onboarding agent is included.

| Feature | Access | Where to use it |
| --- | --- | --- |
| Fraud investigation | Bank administrators | Banking insights: select a queued or known outgoing transaction ID |
| Multi-step banking assistant | Business operators; staff enquiries respect the same tool permissions | GLDB Assistant |
| Liquidity planning | Owned business accounts | Banking insights: choose a 1-90 day horizon |
| Historical fraud-rule simulation | Bank administrators | Banking insights: choose a rule, proposed threshold/status/action and lookback |
| Reconciliation investigation | Customers: owned records; administrators: bank operations | Banking insights |

## Modes and local startup

**Offline evidence workflow** is the default for report forms. It uses bounded application code and authoritative PostgreSQL records; it is not described as LLM inference. Every feature has an offline workflow.

**Local Ollama agent** uses a language model to choose approved tools, inspect their results and produce a qualitative interpretation. The model never receives a database connection, session token, password, MFA secret or a financial write tool. The private FastAPI fraud model is a separate service and remains responsible for risk scores.

The existing development computer has Ollama and local `qwen3.5:4b` installed. Its ignored `.env` is configured with:

```dotenv
AGENT_MODE=ollama
AGENT_MODEL=qwen3.5:4b
AGENT_OLLAMA_URL=http://127.0.0.1:11434
```

Start `npm run agent:start` in a separate terminal if Ollama is not running. The helper starts the installed executable with cloud access disabled and a loopback listener. It strips banking/operator credentials and does not download models. Normal `npm start` launches Express/FastAPI; it does not install or manage Ollama. Open http://localhost:3000/banking-insights or http://localhost:3000/assistant.

For another checkout, install Ollama and a local model supporting tools, set the three values above in ignored `.env`, then restart the banking application. The URL must be a plain HTTP loopback origin; remote endpoints, redirects, cloud model names and remotely backed models are refused. The helper needs `ollama` on PATH. Reference: [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling).

The UI reports whether the configured model is available. Choose offline workflow explicitly when it is unavailable. An Ollama request never silently changes to a deterministic response. Docker delivery uses offline mode by default; connecting an additional model service is a separate delivery configuration.

## Demonstrate each feature

Use the ten identities and private initial password in `data/testing/FEATURE-TESTING.md`.

1. Sign in as `business-tester@greenlink.demo`. Open Banking insights, project 30 days and inspect scheduled occurrences, source-account shortfalls and any suggested funding drafts. An owned transfer credits the destination in the projection and does not count as money leaving the business. No future income is guessed. Held payments are disclosed separately because they are not reserved.
2. In GLDB Assistant, choose offline workflow and send **Transfer**, then **SGD 25**, then **1088800201**. The assistant asks for missing fields across requests and opens an ordinary transfer form when complete. Send **Schedule transfer SGD 10 to 1088800201 tomorrow weekly** to prepare a schedule draft. Tomorrow defaults to 09:00 Singapore time; an explicit time such as **tomorrow at 15:30** is respected. Inspect the displayed timestamp before authorizing. Raw conversation messages remain in browser memory.
3. Select Local Ollama in the assistant and ask: **Check my balances and whether I can cover my upcoming scheduled payments.** Inspect the displayed tool activity, verified fact cards and local-model interpretation. Exact monetary values and scores come from tool facts; generated numerical claims and unauthorized execution claims are withheld. This guard is a bounded validation rule, not proof that every qualitative model statement is correct.
4. Sign in as `reviewer-tester@greenlink.demo` or `staff-tester@greenlink.demo`. Open Banking insights. Select an outgoing receipt from the fraud queue or use its transaction ID. Investigate it, inspect recorded model/rule reasons, prior completed outgoing history, evidence references and suggested independent checks. The brief does not approve/reject a payment or establish fraud. Use the normal independent review screen for decisions.
5. Preview a high-value threshold change, for example from SGD 10,000 to SGD 9,500. Compare current/proposed allow, review and block counts. Both policies use the same recorded input snapshots and original model scores. Only the latest 1,000 assessments in the chosen window are sampled. Missing model results are counted and skipped. No live policy is changed. Without labeled fraud outcomes, the report cannot measure precision, false positives or accuracy.
6. Run reconciliation as a business operator and then as staff. Customer reports include only owned accounts and exceptions. Staff can inspect bank-wide discrepancies, failed/retrying/overdue schedules and stuck notifications. Reports identify exceptions and suggest follow-up; they cannot repair balances or ledger entries.

## Evidence, privacy and boundaries

Migration `007_banking_agents.sql` adds `agent_runs` and append-only `agent_tool_calls`. The schema now has **25 tables and seven migrations**. Existing identity, balance and transaction records are preserved.

Reports, permitted tool arguments/results and structured draft context are saved privately in PostgreSQL. Raw user messages, model prompts and hidden reasoning are not stored by the banking service. A report may contain a generated paraphrase. Clearing a conversation clears browser messages; it does not remove evidence records. Report lists/detail endpoints are restricted to the initiating user, including for staff. Sensitive input is refused before creating a run.

The runtime role cannot rewrite/delete tool evidence, delete runs or change a run's owner. Role and ownership checks are repeated inside tools. HTTP execution rechecks the session between tool calls and before completion. Changed security versions invalidate draft continuations/results; a continuation expires after fifteen minutes. Tools accept strict argument allowlists. There is no arbitrary SQL, shell, URL fetching or payment execution tool.

Limits: forty starts per user and 120 per IP per fifteen minutes, two concurrent recent runs across the database, eight tool calls, four model rounds and a sixty-second model deadline. Each model request has a bounded timeout/response size. Unknown tools, unsupported arguments, missing evidence, unavailable inference and stale authorization produce explicit failures. A failed run records only a bounded error code.

Financial calculations, scores and lifecycle statuses are application facts. Model prose is interpretation. Local trials exposed numerical mistakes; validation now withholds numerical narrative claims and invalid score scales while retaining tool evidence. Human review and the existing independent approval/password controls remain necessary. These controls are consistent with [OWASP excessive-agency guidance](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

## Verification

```sh
npm test
npm run test:browser
npm run demo:agents
```

The explicit agent demonstration creates a disposable PostgreSQL schema using `TEST_DATABASE_URL`, seeds synthetic businesses, scores a sample payment through real private FastAPI, and exercises all five features with real local Ollama. It verifies investigations do not change financial balances, then removes the schema. Native data is never seeded by this command. Local Ollama is required for this optional demonstration; CI exercises the model adapter and tool boundary with controlled responses.

`tests/dft-agents.test.js` covers ownership, CSRF, staff restrictions, multi-turn drafts, schedules, recurrence, value conservation, historical simulations, reconciliation isolation, hostile tool calls, bounded loops, stale authorization and model-origin/narrative checks. `tests/dft-agents-browser.js` covers mobile business workflows and staff investigation/simulation with saved evidence.
