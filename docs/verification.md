# Verification and data preservation

Run npm run build, npm test, npm run test:python and npm run test:browser. Tests use controlled OpenAI transports and isolated PostgreSQL schemas; they are not production inference substitutes.

Run npm run test:neon to verify actual Express, FastAPI, OpenAI and Neon integration in a disposable schema. It checks assistant tool evidence, payment binding, transfers/bills, independent review, schedules, notifications, statements, rules and AI audit. Run npm run demo:agents to exercise all five insight workflows with real OpenAI inference. These commands use API credits and preserve existing banking records.

The original native database and private PostgreSQL backups are retained. Account credentials, balances, historical assessments and review decisions are not reset by provider cleanup. Applied SQL migrations are immutable. Historical provider names/digests remain audit evidence rather than active model options.

New assessments accept OpenAI provenance only. The model has no financial execution tool. Invalid or unavailable inference fails closed, and unsafe generated prose is withheld while verified evidence remains visible. Scores are qualitative indicators, not calibrated probabilities or a claim of real-world fraud detection accuracy.
