-- Attachment metadata never contains image plaintext. The encrypted object is
-- stored under object_key in the private R2 bucket bound to the Worker.
CREATE TABLE IF NOT EXISTS note_attachments (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending', 'attached', 'detached')),
  created_at INTEGER NOT NULL,
  attached_at INTEGER,
  detached_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_note_attachments_vault_object_key
ON note_attachments(vault_id, object_key);

CREATE INDEX IF NOT EXISTS idx_note_attachments_vault_note_status
ON note_attachments(vault_id, note_id, status);

CREATE INDEX IF NOT EXISTS idx_note_attachments_status_created_at
ON note_attachments(status, created_at);
