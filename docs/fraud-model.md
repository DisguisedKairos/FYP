# Fraud scoring and provider contracts

OpenAI is the default provider, configured with OPENAI_API_KEY and OPENAI_MODEL. FastAPI is an authenticated validation gateway, not a separately trained fraud model. See [OpenAI setup, privacy and verification](openai.md).

Express supplies a bound transaction with authoritative pre-payment PostgreSQL aggregates. The model receives payment type, amount, available balance, internal-transfer flag, Singapore hour and historical aggregates. Customer/account IDs, recipient numbers, credentials, descriptions and raw transaction histories are omitted.

The Responses API requests strict structured output: an integer modelScore from zero through 94 and allowlisted evidence codes. The gateway independently checks completed output, provider model identity, duplicate JSON fields, score bounds and supported reasons. Scores at least 65 must identify a substantial suspicious pattern and request human review. The application renders verified reason descriptions; free-form model prose never becomes an authoritative financial fact.

The indicator is qualitative and not a calibrated probability. No model accuracy, training or calibration claim is made. Deterministic policy can hold or block a request independently of a low AI score. Held payments need an independent human reviewer; no funds move on failed scoring, malformed/refused output or provider outage. There is no formula score or simulated fallback.

OpenAI requests use the fixed official HTTPS endpoint and server-only credentials. Audit evidence records configured/returned model, API response ID, provider-model identity hash and prompt revision. Hosted model weights cannot be hashed locally. Existing historical records retain their original provenance.

The private endpoints are GET /internal/health, GET /internal/model and POST /internal/assess. All require SERVICE_TOKEN. Health reports the validation gateway; model metadata additionally checks provider availability. The scorer receives no database or MFA encryption credentials and exposes no financial write endpoint.

See [financial controls](financial-controls.md), [human monitoring](fraud-monitoring.md), [AI verification](ai-evaluation.md) and [banking agents](banking-agents.md).
