# OpenAI configuration

The default AI provider is OpenAI. Express uses the Responses API for the assistant and all banking insights. The private FastAPI gateway uses the same provider/model for structured fraud scoring. There is no alternate provider or simulated inference when OpenAI fails.

## Local setup

Install Node dependencies with npm ci and Python dependencies in .venv using requirements.txt. Run npm run setup to generate missing service/encryption keys, then edit the private .env:

~~~dotenv
OPENAI_API_KEY=your-private-api-key
OPENAI_MODEL=gpt-6-luna
~~~

Keep the existing DATABASE_URL, PUBLIC_ORIGIN, SERVICE_TOKEN and AUTH_ENCRYPTION_KEY. PostgreSQL/Neon setup is unchanged. Do not put the API key in browser code, Git, screenshots or chat. An API key and model access/billing are separate from signing into ChatGPT.

~~~sh
npm run db:migrate
npm run ai:check
npm start
~~~

No Ollama installation, model download, local model endpoint or provider selector is used. Existing migrations and saved audit records retain historical provider names so existing databases remain compatible.

The additive migration permits OpenAI agent runs and preserves existing audit/financial records. ai:check verifies OpenAI model access. npm start still runs Express and the private FastAPI gateway. Open http://localhost:3000. Change OPENAI_MODEL deliberately to a compatible Responses text model supporting function calling and structured output. No model is silently substituted.

## Data and financial safeguards

Chat messages and the tool evidence permitted to the signed-in operator are sent to OpenAI. Evidence can include account names/numbers, balances and transaction descriptions. The assistant refuses obvious security credentials, but operators must not put passwords, OTPs, recovery codes or keys in chat. The UI discloses external inference.

The fraud request sends payment type, amount, available balance, internal-payee status, historical aggregates, Singapore hour and an allowlist of evidence codes. It omits customer/account identifiers, recipient numbers, descriptions, tokens and database credentials. Responses requests use store=false; this disables application-state storage and does not promise zero retention by the API provider.

Tool schemas are strict. Optional tool fields are nullable on the API boundary and validated again by the application. Read tools enforce ownership and bank roles. The model has no payment execution, approval, rule edit or ledger repair tool. Payment drafts remain bound to explicit user details and need ordinary password authorization. Deterministic financial rules, row locks, integer cents, replay protection and independent human review remain active.

Fraud output must be completed JSON with a score from 0 to 94 and supported evidence codes. A score at least 65 must cite a substantial suspicious pattern and requests human review. Refusals, incomplete/malformed output, quota errors and outages fail closed without moving funds or returning an invented score. Scores are qualitative indicators, not validated fraud probabilities.

## Audit and verification

AI audit records identify provider, configured model, returned model, response ID, prompt digest, duration, tools and guardrail outcome when available. Hosted weights cannot be hashed locally: OpenAI records modelIdentitySha256 with identityKind=provider_model_id, never a fabricated modelSha256 weight digest. Historical records retain their original provider and evidence. Current model activity excludes different providers/models/prompts.

~~~sh
npm run build
npm test
npm run test:python
npm run test:browser
npm run test:neon
~~~

Functional/security tests use explicit controlled transports and isolated databases; these are not production fallback modes. test:neon and demo:agents use the real configured API and can incur API usage. They create disposable test schemas rather than modifying customer records. Persistent background fraud monitoring also makes real inference requests for eligible transactions, including newly introduced detector versions.

## Containers and hosting

For Docker, set OPENAI_API_KEY and OPENAI_MODEL privately in .env or the shell, then run npm run devops:setup and npm run devops:up. Compose defaults to OpenAI and provides outbound connectivity to banking/scoring while keeping PostgreSQL and scoring ports private. Do not share docker compose config output because resolved environment variables can contain the key. No model download is required.

For a hosted Node/Python deployment, supply these variables using the hosting service's secret settings. Continue supplying the restricted Neon DATABASE_URL, a stable AUTH_ENCRYPTION_KEY, the same SERVICE_TOKEN to Express/FastAPI, the private FRAUD_SERVICE_URL, and the exact HTTPS PUBLIC_ORIGIN. Hosting and Neon remain separate services.

Official references: [Responses function calling](https://developers.openai.com/api/docs/guides/function-calling), [structured output](https://developers.openai.com/api/docs/guides/structured-outputs), [model catalog](https://developers.openai.com/api/docs/models).
