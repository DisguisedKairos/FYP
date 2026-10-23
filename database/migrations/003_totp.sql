CREATE TABLE user_mfa (
  user_id BIGINT PRIMARY KEY REFERENCES users(id),
  secret_encrypted TEXT,
  pending_secret_encrypted TEXT,
  pending_expires_at TIMESTAMPTZ,
  enabled_at TIMESTAMPTZ,
  last_counter BIGINT NOT NULL DEFAULT -1,
  CHECK ((enabled_at IS NULL AND secret_encrypted IS NULL) OR (enabled_at IS NOT NULL AND secret_encrypted IS NOT NULL))
);
CREATE TABLE mfa_recovery_codes (
  user_id BIGINT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  PRIMARY KEY(user_id,code_hash)
);
ALTER TABLE sessions ADD COLUMN mfa_verified_at TIMESTAMPTZ;
