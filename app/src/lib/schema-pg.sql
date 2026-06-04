-- CAT Mock Generator - Postgres schema (for Supabase deployment).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS events (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  section    TEXT,
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

CREATE TABLE IF NOT EXISTS kb_items (
  id          SERIAL PRIMARY KEY,
  section     TEXT NOT NULL,
  subtype     TEXT,
  source_file TEXT,
  stem        TEXT,
  options     JSONB,
  answer      TEXT,
  solution    TEXT,
  difficulty  TEXT,
  word_count  INTEGER,
  embedding   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kb_section ON kb_items(section, subtype);

CREATE TABLE IF NOT EXISTS generated_sets (
  id            SERIAL PRIMARY KEY,
  section       TEXT NOT NULL,
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pooled',
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  quality_score INTEGER,
  judge_notes   TEXT
);
-- Migrations for previously-deployed databases (idempotent).
ALTER TABLE generated_sets ADD COLUMN IF NOT EXISTS quality_score INTEGER;
ALTER TABLE generated_sets ADD COLUMN IF NOT EXISTS judge_notes TEXT;
CREATE INDEX IF NOT EXISTS idx_sets_section_status ON generated_sets(section, status);
CREATE INDEX IF NOT EXISTS idx_sets_section_quality
  ON generated_sets(section, quality_score DESC, created_at DESC);

-- Tracks which user has been served which set (so we never repeat).
CREATE TABLE IF NOT EXISTS user_seen_sets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id  INTEGER NOT NULL REFERENCES generated_sets(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, set_id)
);
CREATE INDEX IF NOT EXISTS idx_user_seen_user ON user_seen_sets(user_id);

CREATE TABLE IF NOT EXISTS attempts (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id       INTEGER NOT NULL REFERENCES generated_sets(id) ON DELETE CASCADE,
  section      TEXT NOT NULL,
  answers      JSONB,
  score        REAL,
  total        INTEGER,
  submitted    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, section);

-- Self-reported practice from sources outside this app (books, other mocks).
-- One row per (user, section); upserted from the profile page.
CREATE TABLE IF NOT EXISTS user_external_stats (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section    TEXT NOT NULL,
  solved     INTEGER NOT NULL DEFAULT 0,
  accuracy   REAL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, section)
);
