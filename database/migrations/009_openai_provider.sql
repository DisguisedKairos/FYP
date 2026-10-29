-- Add OpenAI as an active AI provider without rewriting historical evidence.
ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_engine_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_engine_check CHECK(engine IN ('workflow','ollama','openai'));
