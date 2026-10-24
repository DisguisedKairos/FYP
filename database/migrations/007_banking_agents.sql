-- Agent evidence is separate from the financial ledger. No chat passwords or
-- raw conversation text belong in these records.
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  auth_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('assistant','fraud_investigation','liquidity','rule_simulation','reconciliation')),
  engine TEXT NOT NULL CHECK(engine IN ('workflow','ollama')),
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')),
  report_json JSONB,
  context_json JSONB NOT NULL DEFAULT '{}',
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX agent_runs_user ON agent_runs(user_id,created_at DESC,id);
CREATE TABLE agent_tool_calls (
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  step INTEGER NOT NULL CHECK(step BETWEEN 1 AND 12),
  tool_name TEXT NOT NULL CHECK(tool_name ~ '^[a-z_]{1,50}$'),
  arguments_json JSONB NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,step)
);
