CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  email TEXT NOT NULL CHECK (length(email) <= 254), password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  auth_version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 40), number TEXT NOT NULL UNIQUE CHECK (number ~ '^[0-9]{10}$'),
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents BETWEEN 0 AND 9000000000000),
  opening_balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (opening_balance_cents BETWEEN 0 AND 9000000000000),
  opening_provenance TEXT NOT NULL DEFAULT 'new' CHECK (opening_provenance IN ('new','seed','legacy_verified')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX accounts_user ON accounts(user_id);
CREATE SEQUENCE settlement_sequence;
CREATE TABLE billers (id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,initials TEXT NOT NULL,color TEXT NOT NULL);
INSERT INTO billers VALUES ('sp-services','SP Services','Utilities','SP','#dceae3'),('singtel','Singtel','Telecommunications','S','#f6e2e2'),('pub','PUB','Water','P','#dfeaf6');
CREATE TABLE transactions (
  id TEXT PRIMARY KEY, insert_seq BIGSERIAL UNIQUE NOT NULL, settlement_seq BIGINT UNIQUE,
  account_id BIGINT NOT NULL REFERENCES accounts(id), type TEXT NOT NULL CHECK (type IN ('transfer','bill','credit')),
  description TEXT NOT NULL, amount_cents BIGINT NOT NULL CHECK (amount_cents <> 0 AND amount_cents BETWEEN -9000000000000 AND 9000000000000),
  counterparty TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('completed','pending_review','rejected')),
  reference TEXT NOT NULL DEFAULT '', internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL, requested_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ,
  risk_json JSONB, authorization_json JSONB, review_json JSONB,
  to_account_id BIGINT REFERENCES accounts(id), biller_id TEXT REFERENCES billers(id), payee TEXT,
  CHECK ((status = 'completed' AND completed_at IS NOT NULL AND settlement_seq IS NOT NULL) OR (status <> 'completed' AND completed_at IS NULL AND settlement_seq IS NULL))
);
CREATE INDEX transactions_account_date ON transactions(account_id,created_at DESC,insert_seq DESC);
CREATE INDEX transactions_settled ON transactions(account_id,completed_at,settlement_seq) WHERE status='completed';
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id BIGINT REFERENCES users(id), csrf_token TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE auth_attempts (
  bucket_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, locked_until TIMESTAMPTZ
);
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY, actor_id BIGINT REFERENCES users(id), target_user_id BIGINT REFERENCES users(id),
  event_type TEXT NOT NULL, ip_address TEXT, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE payment_bindings (
  user_id BIGINT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL, canonical_json JSONB NOT NULL, assessment_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id,request_id)
);
CREATE TABLE requests (
  user_id BIGINT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL, result_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_id)
);
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered')),
  attempts INTEGER NOT NULL DEFAULT 0,available_at TIMESTAMPTZ NOT NULL DEFAULT now(),locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),delivered_at TIMESTAMPTZ,last_error TEXT
);
CREATE INDEX outbox_delivery ON notification_outbox(status,available_at,locked_until);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),type TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,
  transaction_id TEXT REFERENCES transactions(id),metadata JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL,read_at TIMESTAMPTZ
);
CREATE INDEX notifications_user ON notifications(user_id,created_at DESC);
CREATE TABLE scheduled_payments (
  id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),type TEXT NOT NULL CHECK(type IN ('transfer','bill')),
  payload_json JSONB NOT NULL,amount_cents BIGINT NOT NULL CHECK(amount_cents BETWEEN 1 AND 9000000000000),
  frequency TEXT NOT NULL CHECK(frequency IN ('once','weekly','monthly')),scheduled_at TIMESTAMPTZ NOT NULL,next_run_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','failed','cancelled')),
  authorization_json JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),last_run_at TIMESTAMPTZ,
  last_status TEXT,last_error TEXT,lease_owner TEXT,lease_until TIMESTAMPTZ
);
CREATE INDEX scheduled_due ON scheduled_payments(status,next_run_at,lease_until);
CREATE TABLE scheduled_payment_runs (
  id TEXT PRIMARY KEY,schedule_id TEXT NOT NULL REFERENCES scheduled_payments(id),due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',transaction_id TEXT REFERENCES transactions(id),error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),completed_at TIMESTAMPTZ,UNIQUE(schedule_id,due_at)
);
CREATE TABLE fraud_settings (id INTEGER PRIMARY KEY CHECK(id=1),version BIGINT NOT NULL DEFAULT 1,review_threshold INTEGER NOT NULL DEFAULT 65 CHECK(review_threshold BETWEEN 0 AND 94));
INSERT INTO fraud_settings(id) VALUES(1);
CREATE TABLE fraud_rules (
  id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT true,
  threshold NUMERIC(18,2) NOT NULL CHECK(threshold > 0),unit TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN ('review','block'))
);
INSERT INTO fraud_rules VALUES
 ('high_value','High-value payment','Review a payment at or above this amount.',true,10000,'SGD','review'),
 ('new_payee','New recipient','Review a large payment to a recipient without completed outgoing history.',true,1500,'SGD','review'),
 ('velocity','Rapid transactions','Check outgoing payments in ten minutes.',true,5,'transactions / 10 minutes','review'),
 ('balance_utilization','Balance depletion','Check the percentage of available balance used.',true,90,'%','review'),
 ('daily_limit','Daily outgoing limit','Check the outgoing total for the Singapore calendar day.',true,25000,'SGD / day','block');
CREATE TABLE fraud_rule_audit (
  id BIGSERIAL PRIMARY KEY,rule_id TEXT NOT NULL REFERENCES fraud_rules(id),version BIGINT NOT NULL,
  actor_id BIGINT REFERENCES users(id),actor_name TEXT NOT NULL,before_json JSONB NOT NULL,after_json JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE fraud_assessments (
  id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),source_account_id BIGINT NOT NULL REFERENCES accounts(id),
  payload_hash TEXT NOT NULL,policy_version BIGINT NOT NULL,policy_json JSONB NOT NULL,
  input_json JSONB NOT NULL,result_json JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
