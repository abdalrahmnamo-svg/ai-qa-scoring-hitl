CREATE TABLE IF NOT EXISTS conversations (
  conversation_id       TEXT PRIMARY KEY,
  agent                 TEXT NOT NULL,
  contact               TEXT NOT NULL,
  date                  TEXT NOT NULL,            -- YYYY-MM-DD
  topic                 TEXT,
  raw_response_sec      INTEGER,
  adjusted_response_sec INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conversations_date_agent ON conversations(date, agent);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
  seq             INTEGER NOT NULL,
  sender          TEXT NOT NULL CHECK (sender IN ('customer','agent')),
  is_bot          INTEGER NOT NULL DEFAULT 0,
  text            TEXT NOT NULL,
  ts              TEXT NOT NULL                   -- ISO timestamp
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, seq);

-- AI drafts. Never counted anywhere until a human approves one.
CREATE TABLE IF NOT EXISTS draft_scores (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
  draft_scores    TEXT NOT NULL,                  -- JSON { criterionId: { points, evidence, computed? } }
  total_score     INTEGER NOT NULL,
  passed          INTEGER NOT NULL,
  reasoning       TEXT NOT NULL,
  confidence      REAL,
  model           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending_human_review'
                  CHECK (status IN ('pending_human_review','approved','rejected','superseded')),
  final_scores    TEXT,                           -- JSON { criterionId: int } set on approve
  review_note     TEXT,
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON draft_scores(status);
CREATE INDEX IF NOT EXISTS idx_drafts_conv ON draft_scores(conversation_id);

-- Official scores. Rows appear only through human approval, or as human/golden seed data.
CREATE TABLE IF NOT EXISTS scores (
  conversation_id   TEXT PRIMARY KEY REFERENCES conversations(conversation_id),
  scores            TEXT NOT NULL,                -- JSON { criterionId: int }
  total_score       INTEGER NOT NULL,
  passed            INTEGER NOT NULL,
  score_origin      TEXT NOT NULL CHECK (score_origin IN ('human','golden','agent_approved')),
  comments          TEXT,
  scored_by         TEXT,
  scored_date       TEXT NOT NULL,
  approved_draft_id INTEGER REFERENCES draft_scores(id)
);

CREATE TABLE IF NOT EXISTS scorecard_config (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  structure        TEXT NOT NULL,                 -- JSON scorecard structure
  guidelines       TEXT NOT NULL,                 -- JSON guideline list
  operating_hours  TEXT NOT NULL                  -- JSON { targetFrtMinutes }
);
