-- CAT Mock Generator - Postgres schema (for Supabase deployment).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  social_links  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_links TEXT;

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
  topic         TEXT,
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
ALTER TABLE generated_sets ADD COLUMN IF NOT EXISTS topic TEXT;
CREATE INDEX IF NOT EXISTS idx_sets_section_status ON generated_sets(section, status);
CREATE INDEX IF NOT EXISTS idx_sets_section_quality
  ON generated_sets(section, quality_score DESC, created_at DESC);
-- After the ALTERs above: an index on a missing column throws and aborts the batch.
CREATE INDEX IF NOT EXISTS idx_sets_topic ON generated_sets(section, topic, status);

-- Tracks which user has been served which set (so we never repeat).
CREATE TABLE IF NOT EXISTS user_seen_sets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id  INTEGER NOT NULL REFERENCES generated_sets(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, set_id)
);
CREATE INDEX IF NOT EXISTS idx_user_seen_user ON user_seen_sets(user_id);

CREATE TABLE IF NOT EXISTS mocks (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submitted     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mocks_user ON mocks(user_id);

CREATE TABLE IF NOT EXISTS attempts (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id       INTEGER NOT NULL REFERENCES generated_sets(id) ON DELETE CASCADE,
  section      TEXT NOT NULL,
  answers      JSONB,
  score        REAL,
  total        INTEGER,
  raw_score    REAL,               -- CAT marking: +3/-1/0 (see practice.ts scoreSet)
  mock_id      INTEGER REFERENCES mocks(id) ON DELETE CASCADE,
  phase        TEXT,
  submitted    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, section);
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS raw_score REAL;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS mock_id INTEGER REFERENCES mocks(id) ON DELETE CASCADE;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS phase TEXT;
-- Must come after the ALTERs above - see db-pg.ts for why.
CREATE INDEX IF NOT EXISTS idx_attempts_mock ON attempts(mock_id);
-- Percentile lookups scan submitted attempts by section across ALL users.
CREATE INDEX IF NOT EXISTS idx_attempts_section_submitted ON attempts(section, submitted);

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

-- "Report this question" flags, feeding an admin queue.
CREATE TABLE IF NOT EXISTS question_reports (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_id      INTEGER REFERENCES attempts(id) ON DELETE SET NULL,
  set_id          INTEGER,
  question_id     TEXT NOT NULL,
  section         TEXT NOT NULL,
  prompt_snapshot TEXT,
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_question_reports_status ON question_reports(status, created_at);
