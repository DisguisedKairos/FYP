-- Surveillance evidence and human case decisions never mutate the payment ledger.
CREATE TABLE fraud_screenings (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  detector_version TEXT NOT NULL CHECK(length(detector_version) BETWEEN 1 AND 400),
  evidence_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(transaction_id,detector_version)
);
CREATE INDEX fraud_screenings_transaction ON fraud_screenings(transaction_id,created_at DESC);
CREATE TABLE fraud_cases (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  screening_id TEXT NOT NULL REFERENCES fraud_screenings(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','closed')),
  score INTEGER CHECK(score BETWEEN 0 AND 95),
  assigned_to BIGINT REFERENCES users(id),
  outcome TEXT CHECK(outcome IN ('confirmed_fraud','legitimate','inconclusive')),
  review_reason TEXT CHECK(length(review_reason) BETWEEN 10 AND 1000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  CHECK((status='closed' AND outcome IS NOT NULL AND review_reason IS NOT NULL AND assigned_to IS NOT NULL AND resolved_at IS NOT NULL)
     OR (status<>'closed' AND outcome IS NULL AND review_reason IS NULL AND resolved_at IS NULL)),
  CHECK(status<>'in_review' OR assigned_to IS NOT NULL)
);
CREATE INDEX fraud_cases_queue ON fraud_cases(status,updated_at DESC,id);
CREATE TABLE fraud_monitor_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_error TEXT,
  last_summary JSONB NOT NULL DEFAULT '{}'
);
INSERT INTO fraud_monitor_state(id) VALUES(1);
CREATE INDEX transactions_outgoing_monitor ON transactions(insert_seq) WHERE amount_cents<0 AND type IN ('transfer','bill');
