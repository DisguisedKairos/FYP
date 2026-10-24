# DFT verification record - 2.10.0

Verified locally on 25 October 2026 (Asia/Singapore): 165 Node functional/security tests, 21 Python contract/delivery tests and nine browser workflows passed. Syntax checks covered 82 JavaScript files. The suite uses controlled adapters only inside tests; production cannot select them.

Real local qwen3.5:4b fraud inference returned 5 for a routine sample and 68 for a contrasting amount/velocity/balance-use sample. These are observed model outputs, not preset demonstration scores or validated fraud-performance metrics.

The real Express/PostgreSQL/FastAPI process check passed with installed Ollama. It exercised actual fraud scoring, assistant balance and draft tools, authorized transfers/bills, independent review, schedules, notifications, statements and rule audit. A held instruction is settled only through a separately authorized reviewer in that disposable fixture. When no model is installed, process/container checks instead verify explicit unavailability and unchanged balances.

The original native database retains 13 accounts and 28 ledger rows. Before the new runtime started, no standing schedules were due, and the account/transaction financial fingerprint remained c652e4b50bfa55035f5ae3cb3a6d6a65ab818b5120f73817e89f2405d1f8dac0. A verified private PostgreSQL backup was saved as data/backups/greenlink-before-ollama-20261025.dump. No account credentials, balances, old assessments or review decisions were reset.

Ollama is now the only inference provider. The previous baseline model, dataset, training/evaluation code, synthetic metrics UI and older demonstrations were removed. Historical records remain audit evidence and are excluded from current-model activity counts and new rule-impact samples. Model provenance, canonical payload binding, grounded high-risk reasons, strict output validation, bounded concurrency, stale authorization, privacy and financial rollback remain covered.

AI interpretations can still fail validation and are withheld when unsafe. Qualitative LLM risk scores are not calibrated fraud probabilities. No real-world accuracy or fraud-detection effectiveness is claimed. Use npm run demo:agents for an actual local-model demonstration and the commands in the root README to reproduce the other checks.
