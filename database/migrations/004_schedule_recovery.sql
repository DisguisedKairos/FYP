ALTER TABLE scheduled_payment_runs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0);
ALTER TABLE scheduled_payment_runs ADD COLUMN next_attempt_at TIMESTAMPTZ;
CREATE INDEX scheduled_run_recovery ON scheduled_payment_runs(schedule_id,due_at,next_attempt_at);
