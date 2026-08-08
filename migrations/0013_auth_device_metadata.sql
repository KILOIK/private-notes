ALTER TABLE auth_sessions ADD COLUMN device_label TEXT;
ALTER TABLE auth_sessions ADD COLUMN user_agent TEXT;
ALTER TABLE auth_sessions ADD COLUMN login_ip TEXT;
ALTER TABLE auth_sessions ADD COLUMN login_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_vault_login_at
ON auth_sessions(vault_id, login_at DESC);
