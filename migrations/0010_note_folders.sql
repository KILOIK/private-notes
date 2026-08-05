CREATE TABLE IF NOT EXISTS note_folders (
  id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_note_folders_vault_id
ON note_folders(vault_id, id);

CREATE INDEX IF NOT EXISTS idx_note_folders_vault_updated_id
ON note_folders(vault_id, updated_at DESC, id ASC);
