ALTER TABLE tool_calls ADD COLUMN agent_role TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN artifacts_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_messages_text ON messages(text);

CREATE TABLE IF NOT EXISTS trace_blobs (
  blob_hash TEXT PRIMARY KEY,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trace_nodes (
  seq_hash TEXT PRIMARY KEY,
  prev_hash TEXT,
  blob_hash TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL
);
