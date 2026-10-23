CREATE TABLE legacy_imports (
  fingerprint TEXT PRIMARY KEY CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  source_name TEXT NOT NULL,counts JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE legacy_service_records (
  source TEXT NOT NULL,table_name TEXT NOT NULL,record_key TEXT NOT NULL,record_json JSONB NOT NULL,
  import_fingerprint TEXT NOT NULL REFERENCES legacy_imports(fingerprint),
  PRIMARY KEY(source,table_name,record_key)
);
