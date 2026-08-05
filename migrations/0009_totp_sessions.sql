-- TOTP metadata is deployment-wide and lives in app_meta. These tables hold
-- only hashed recovery codes and opaque, hashed server-side session IDs.
CREATE TABLE IF NOT EXISTS auth_recovery_codes (
  code_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id_hash TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  last_reauth_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_vault_activity
ON auth_sessions(vault_id, last_activity_at);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
ON auth_sessions(expires_at);
