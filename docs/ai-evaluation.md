# AI verification and limits


Production inference uses the configured provider, with OpenAI as the default. Old synthetic model training, threshold experiments, calibration charts, PSI baselines and their CLI demonstrations have been removed. Recorded model activity is operational telemetry, not an accuracy benchmark.

Functional/security tests inject controlled provider transports only inside tests. They cover identity and role checks, account ownership, prompt injection, numeric-claim withholding, evidence citations, draft binding, strict structured fraud output, provider/digest validation, concurrency, unavailable inference and financial rollback. These doubles are not selectable production engines.

Run npm run evaluate:assistant for the adversarial assistant suite. Run npm run demo:agents with the actual configured AI provider and FastAPI gateway to exercise all five analysis features and real payment scoring in a disposable schema. The ordinary process/container checks explicitly verify failed screening when no AI provider is available; they do not silently substitute responses.

AI interpretations can still be wrong. Exact amounts and statuses come from validated tools. Unsafe prose is withheld while verified evidence remains available. High-risk fraud output must identify a supported suspicious pattern. Model outage or malformed output cannot authorize money movement. Independent human review remains necessary for held payments and suspicious-activity cases.

Representative governed outcomes and an independent validation process would be needed to measure real fraud accuracy or calibration. No such performance claim is made by the application.
