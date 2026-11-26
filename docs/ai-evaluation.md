# AI verification and limits


Production inference uses the configured OpenAI model. Old synthetic model training, threshold experiments, calibration charts, PSI baselines and their CLI demonstrations have been removed. Recorded model activity is operational telemetry, not an accuracy benchmark.

Functional/security tests inject controlled provider transports only inside tests. They cover identity and role checks, account ownership, prompt injection, numeric-claim withholding, evidence citations, draft binding, strict structured fraud output, provider/digest validation, concurrency, unavailable inference and financial rollback. These doubles are not selectable production engines.

Run npm run evaluate:assistant for the adversarial assistant suite. Run npm run demo:agents with the actual configured AI provider and FastAPI gateway to exercise all five analysis features and real payment scoring in a disposable schema. The ordinary process/container checks explicitly verify failed screening when no AI provider is available; they do not silently substitute responses.

AI interpretations can still be wrong. Exact amounts and statuses come from validated tools. Unsafe prose is withheld while verified evidence remains available. High-risk fraud output must identify a supported suspicious pattern. Model outage or malformed output cannot authorize money movement. Independent human review remains necessary for held payments and suspicious-activity cases.

Representative governed outcomes and an independent validation process would be needed to measure real fraud accuracy or calibration. No such performance claim is made by the application.

The 26 November 2026 sweep checked all 164 cases in the three assistant test packets: 125 chat cases across 155 live variants using the configured OpenAI model, plus 39 cases covered by controlled functional/security or browser regressions. The live checks included all eight industry profiles and verified that advice used the signed-in business's company and industry. All latest variants passed; earlier connection failures and functional failures remain in private test records alongside successful retests. These checks used disposable local PostgreSQL schemas and did not change production banking records.

The sweep fixed three defects: the model could replace a requested projection period with a shorter period; a customer claiming administrator authority could receive an unrelated tool error; and valid explanations refusing to invent fraud probabilities or guaranteed losses could be withheld. Regression tests now cover these cases, including positive certainty claims that must remain blocked. The final application suite passed 399 tests, and the browser suite passed 70 checks with no skips. `npm run build` passed syntax checks for all 156 JavaScript source files. Blank tester worksheets remain blank; automated checks do not represent human tester observations.

The results cover the documented questions and tested variants, not every future model response or external-provider outage. Missing payment details, inaccessible records, unsupported periods and insufficient public evidence must still produce clarification or an appropriate limitation rather than invented banking facts.
