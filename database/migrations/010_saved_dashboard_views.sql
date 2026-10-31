-- Private reusable query definitions; financial figures are read live, not copied.
CREATE TABLE saved_dashboard_views (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 80),
  config_json JSONB NOT NULL CHECK(jsonb_typeof(config_json)='object'),
  config_hash TEXT NOT NULL CHECK(config_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id,config_hash)
);
CREATE INDEX saved_dashboard_views_user ON saved_dashboard_views(user_id,created_at DESC,id);
