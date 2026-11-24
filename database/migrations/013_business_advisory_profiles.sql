-- Optional planning preferences; legal identity and banking permissions are unchanged.
CREATE TABLE business_advisory_profiles (
  business_id BIGINT PRIMARY KEY REFERENCES businesses(id),
  profile_key TEXT NOT NULL CHECK(profile_key ~ '^[a-z_]{2,40}$'),
  settings_json JSONB NOT NULL CHECK(jsonb_typeof(settings_json)='object' AND pg_column_size(settings_json)<=4096),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
