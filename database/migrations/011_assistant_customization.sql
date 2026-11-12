-- Additive private assistant preferences and saved-chart refresh metadata.
CREATE TABLE assistant_preferences (
  user_id BIGINT PRIMARY KEY REFERENCES users(id),
  response_style TEXT NOT NULL DEFAULT 'concise' CHECK(response_style IN ('concise','detailed')),
  trend_months SMALLINT NOT NULL DEFAULT 3 CHECK(trend_months BETWEEN 1 AND 12),
  chart_type TEXT NOT NULL DEFAULT 'bar' CHECK(chart_type IN ('bar','line','table')),
  market_topic TEXT NOT NULL DEFAULT 'general' CHECK(market_topic IN ('general','singapore','fx','trade','interest_rates')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE saved_dashboard_views
  ADD COLUMN presentation_json JSONB NOT NULL DEFAULT '{"chartType":"bar","showStatus":true,"showCompanies":true}' CHECK(jsonb_typeof(presentation_json)='object'),
  ADD COLUMN refresh_cadence TEXT NOT NULL DEFAULT 'manual' CHECK(refresh_cadence IN ('manual','weekly')),
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  ADD COLUMN refreshed_at TIMESTAMPTZ,
  ADD COLUMN next_refresh_at TIMESTAMPTZ,
  ADD COLUMN refresh_error TEXT,
  ADD COLUMN snapshot_json JSONB CHECK(snapshot_json IS NULL OR jsonb_typeof(snapshot_json)='object');
CREATE INDEX saved_dashboard_views_due ON saved_dashboard_views(next_refresh_at,id) WHERE refresh_cadence='weekly';
