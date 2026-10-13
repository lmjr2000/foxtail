-- Foxtail initial schema.
-- Ids are random text (never sequential) so a store id says nothing about how many stores exist.

CREATE TABLE franchisees (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  contact_name  TEXT,
  contact_email TEXT,
  phone         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL,
  name                  TEXT NOT NULL DEFAULT '',
  role                  TEXT NOT NULL CHECK (role IN ('corporate_admin', 'corporate_viewer', 'franchise_owner')),
  -- franchise owners see exactly the stores of this franchisee; corporate roles leave it NULL
  franchisee_id         TEXT REFERENCES franchisees(id) ON DELETE RESTRICT,
  password_hash         TEXT,
  must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
  google_sub            TEXT,
  disabled_at           TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  -- bumped on password change / disable so older sessions stop working
  token_version         INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT franchise_owner_has_franchisee CHECK ((role = 'franchise_owner') = (franchisee_id IS NOT NULL))
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE stores (
  id             TEXT PRIMARY KEY,
  store_number   TEXT,
  name           TEXT NOT NULL,
  address        TEXT,
  city           TEXT,
  state          TEXT,
  postal_code    TEXT,
  timezone       TEXT NOT NULL DEFAULT 'America/New_York',
  -- {"sun": {"open":"06:00","close":"20:00"} | null, ...}
  opening_hours  JSONB NOT NULL,
  franchisee_id  TEXT REFERENCES franchisees(id) ON DELETE RESTRICT,
  archived_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX stores_franchisee_idx ON stores (franchisee_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX stores_number_key ON stores (store_number) WHERE store_number IS NOT NULL AND archived_at IS NULL;

CREATE TABLE recorders (
  store_id         TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  vendor           TEXT NOT NULL CHECK (vendor IN ('uniview', 'hikvision', 'dahua', 'generic', 'custom')),
  connection       TEXT NOT NULL CHECK (connection IN ('direct', 'edge')),
  host             TEXT,
  rtsp_port        INTEGER,
  username         TEXT,
  -- AES-256-GCM sealed (services/secret-box.ts); never returned by the API
  password_sealed  TEXT,
  path_template    TEXT,
  stream_profile   TEXT NOT NULL DEFAULT 'sub' CHECK (stream_profile IN ('sub', 'main')),
  -- sha256 of the edge agent token (the token itself is shown once)
  edge_token_hash  TEXT,
  edge_last_seen_at TIMESTAMPTZ,
  edge_version     TEXT,
  last_test_at     TIMESTAMPTZ,
  last_test_ok     BOOLEAN,
  last_test_error  TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX recorders_edge_token_key ON recorders (edge_token_hash) WHERE edge_token_hash IS NOT NULL;

CREATE TABLE cameras (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  channel    INTEGER NOT NULL CHECK (channel BETWEEN 1 AND 256),
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, channel)
);

-- Overrides over the coffee-shop defaults (packages/shared/src/counting.ts). Hours/timezone live on stores.
CREATE TABLE counting_profiles (
  store_id                 TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  enabled_modules          JSONB,
  kpi_metrics              JSONB,
  enabled_rules            JSONB,
  thresholds               JSONB,
  sampling_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  sample_interval_seconds  INTEGER NOT NULL DEFAULT 30,
  updated_by               TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE zones (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  zone_type         TEXT NOT NULL,
  label             TEXT NOT NULL,
  audience          TEXT NOT NULL CHECK (audience IN ('customer', 'staff')),
  camera_id         TEXT REFERENCES cameras(id) ON DELETE SET NULL,
  polygon           JSONB,
  capacity          INTEGER,
  staff_target_min  INTEGER,
  staff_target_max  INTEGER,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX zones_store_idx ON zones (store_id);

-- One row per area per sampling round. Counts and anonymous foot points only, never images.
CREATE TABLE samples (
  store_id      TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  round_at      TIMESTAMPTZ NOT NULL,
  zone_id       TEXT NOT NULL,
  camera_id     TEXT,
  person_count  INTEGER NOT NULL,
  points        JSONB
);
CREATE INDEX samples_store_time_idx ON samples (store_id, round_at);

CREATE TABLE pos_hourly (
  store_id      TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  hour_at       TIMESTAMPTZ NOT NULL,
  sales         NUMERIC(12, 2),
  transactions  INTEGER,
  source        TEXT NOT NULL,
  uploaded_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, hour_at)
);

-- Manual spot checks (someone counted at the store) vs what the system measured.
CREATE TABLE accuracy_checks (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('count', 'wait')),
  start_at      TIMESTAMPTZ NOT NULL,
  minutes       INTEGER NOT NULL,
  manual_value  NUMERIC NOT NULL,
  manual_n      INTEGER,
  system_value  NUMERIC,
  system_n      INTEGER,
  coverage_pct  INTEGER,
  notes         TEXT NOT NULL DEFAULT '',
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX accuracy_checks_store_idx ON accuracy_checks (store_id, start_at);

-- Who changed what (settings, stores, logins). Read by corporate admins.
CREATE TABLE audit_log (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id   TEXT,
  action    TEXT NOT NULL,
  store_id  TEXT,
  detail    JSONB
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
