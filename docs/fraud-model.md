# Local Ollama fraud scoring

Ollama is the only AI inference engine. The configured model is shared with the banking assistant through AGENT_MODEL and AGENT_OLLAMA_URL. FastAPI is an authenticated validation gateway, not a separate trained fraud predictor. No baseline artifact, synthetic dataset, logistic weights or formula score remains.

Express supplies a bound transaction with authoritative pre-payment aggregates from PostgreSQL. The local model receives the amount, balance, transaction type, internal-transfer flag, Singapore hour and historical aggregates. Customer IDs, account numbers, payee identifiers, credentials, descriptions and raw transaction histories are omitted from the fraud prompt.

The gateway requests [structured Ollama output](https://docs.ollama.com/capabilities/structured-outputs): an integer modelScore from zero through 94 and reason codes from the evidence actually supported by the request. No free-form model explanation is published as a banking fact. The model selects factual explanation codes; the gateway renders their verified descriptions. High-risk scores require a supported suspicious pattern. Unknown codes, duplicate/extra fields, nonfinite or out-of-range scores, unfinished output and unsupported models are rejected.

Scores at or above 65 request human review. They are uncalibrated qualitative LLM indicators, not probabilities of proven fraud. No accuracy, precision, recall, calibration or production effectiveness is claimed. Financial rules remain separate and can hold/block even when the model score is low. Rule matches can produce a combined priority score; that value is labelled separately from the AI score.

Both gateways reject cloud model names, remotely backed models and external inference origins. Native access uses loopback; Compose permits only its private Ollama service name. The installed weights digest and prompt revision are recorded with each new assessment. A weights change during inference is refused. Model inference has a bounded timeout and concurrency limit. Invalid, busy or unavailable inference produces an explicit error with no financial movement and no alternative model.

Existing historical assessments are retained as immutable evidence. They are not re-labelled as Ollama outputs. The staff activity panel counts only matching current Ollama provenance and excludes legacy/changed-model records. Background monitoring writes new evidence instead of overwriting original payment assessments.

The private endpoints are GET /internal/health, GET /internal/model and POST /internal/assess. Every endpoint requires the service token. Health reports the validation gateway; model metadata additionally checks the installed local model. The scorer has no database credentials or financial write endpoint.

See [banking controls](financial-controls.md), [human fraud monitoring](fraud-monitoring.md), [AI verification](ai-evaluation.md) and [banking agents](banking-agents.md).
