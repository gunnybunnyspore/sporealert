CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE habitat_type AS ENUM ('park', 'nature_reserve', 'pond', 'riverbank');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hotspots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  type habitat_type NOT NULL,
  moisture_score NUMERIC(5, 2) NOT NULL DEFAULT 50 CHECK (moisture_score BETWEEN 0 AND 100),
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS predictions (
  id BIGSERIAL PRIMARY KEY,
  hotspot_id UUID NOT NULL REFERENCES hotspots(id) ON DELETE CASCADE,
  predicted_for TIMESTAMPTZ NOT NULL,
  score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  event_model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  radius_km NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (radius_km > 0 AND radius_km <= 50),
  threshold SMALLINT NOT NULL DEFAULT 80 CHECK (threshold BETWEEN 0 AND 100),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weather_observations (
  id BIGSERIAL PRIMARY KEY,
  grid_key TEXT NOT NULL,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  air_temperature_c NUMERIC(6, 2) NOT NULL,
  soil_temperature_c NUMERIC(6, 2) NOT NULL,
  humidity_pct NUMERIC(5, 2) NOT NULL CHECK (humidity_pct BETWEEN 0 AND 100),
  precipitation_mm NUMERIC(8, 3) NOT NULL DEFAULT 0 CHECK (precipitation_mm >= 0),
  UNIQUE (grid_key, observed_at)
);

CREATE TABLE IF NOT EXISTS weather_cache (
  cache_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_location_gix ON users USING GIST (location);
CREATE INDEX IF NOT EXISTS hotspots_location_gix ON hotspots USING GIST (location);
CREATE INDEX IF NOT EXISTS hotspots_type_idx ON hotspots (type);
CREATE INDEX IF NOT EXISTS hotspots_tags_gin ON hotspots USING GIN (tags);
CREATE INDEX IF NOT EXISTS predictions_hotspot_time_idx ON predictions (hotspot_id, predicted_for DESC);
CREATE INDEX IF NOT EXISTS weather_observations_location_gix ON weather_observations USING GIST (location);
CREATE INDEX IF NOT EXISTS weather_observations_time_idx ON weather_observations (observed_at DESC);

-- Example habitat seed. Replace with an OSM-derived import in production.
-- INSERT INTO hotspots (name, location, type, moisture_score, tags)
-- VALUES ('Example Nature Reserve', ST_SetSRID(ST_MakePoint(-73.98, 40.75), 4326)::geography,
--         'nature_reserve', 85, '{"natural":"wood"}'::jsonb);
