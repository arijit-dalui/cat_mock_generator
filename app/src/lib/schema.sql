-- CAT Mock Generator - SQLite schema. All statements are idempotent.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',          -- 'user' | 'admin'
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Generic event log: powers admin analytics (DAU, generations, solves).
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,        -- register|login|generate|solve|tab_open
  section    TEXT,                 -- VA|RC|DI|LR|QA when relevant
  meta       TEXT,                 -- JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

-- Knowledge base: exemplar items distilled from the mock papers.
CREATE TABLE IF NOT EXISTS kb_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  section     TEXT NOT NULL,       -- VA|RC|DI|LR|QA
  subtype     TEXT,                -- para_jumble|rc|geometry|algebra|...
  source_file TEXT,
  stem        TEXT,                -- question / passage / set body
  options     TEXT,                -- JSON array of option strings
  answer      TEXT,
  solution    TEXT,
  difficulty  TEXT,
  word_count  INTEGER,
  embedding   TEXT,                -- JSON array of floats (nullable)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_section ON kb_items(section, subtype);

-- Generated sets: the pool plus any served sets.
CREATE TABLE IF NOT EXISTS generated_sets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  section       TEXT NOT NULL,
  payload       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pooled',
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  quality_score INTEGER,
  judge_notes   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sets_section_status ON generated_sets(section, status);
CREATE INDEX IF NOT EXISTS idx_sets_section_quality
  ON generated_sets(section, quality_score DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS user_seen_sets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id  INTEGER NOT NULL REFERENCES generated_sets(id) ON DELETE CASCADE,
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, set_id)
);
CREATE INDEX IF NOT EXISTS idx_user_seen_user ON user_seen_sets(user_id);

-- User attempts at a generated set.
CREATE TABLE IF NOT EXISTS attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id       INTEGER NOT NULL REFERENCES generated_sets(id) ON DELETE CASCADE,
  section      TEXT NOT NULL,
  answers      TEXT,               -- JSON map of questionId -> chosen option
  score        REAL,
  total        INTEGER,
  submitted    INTEGER NOT NULL DEFAULT 0,  -- 0 | 1
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, section);
