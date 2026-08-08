ALTER TABLE notes ADD COLUMN deleted_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_notes_vault_deleted_updated_id
ON notes(vault_id, deleted_at, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_notes_vault_deleted_at_id
ON notes(vault_id, deleted_at DESC, id DESC);
