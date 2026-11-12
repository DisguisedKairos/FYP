-- Fictional counterparty case inputs are maintained only by the operator role.
-- These rows never represent public sanctions records or AI verdicts.
CREATE TABLE demo_counterparties (
 id TEXT PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id),
 company TEXT NOT NULL CHECK(company LIKE 'GLDB Demo %' AND length(company)<=120),
 company_key TEXT NOT NULL CHECK(company_key=lower(btrim(regexp_replace(company,'[[:space:]]+',' ','g')))),
 sector TEXT NOT NULL CHECK(length(sector) BETWEEN 2 AND 100),
 flags_json JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(flags_json)='array' AND jsonb_array_length(flags_json)<=8),
 receipt_ids_json JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(receipt_ids_json)='array' AND jsonb_array_length(receipt_ids_json)<=4),
 fixture_key TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id,company_key)
);
CREATE INDEX demo_counterparties_owner ON demo_counterparties(user_id);
