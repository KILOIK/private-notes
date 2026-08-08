import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

const REQUIRED_MIGRATIONS = [
	'0001_init.sql',
	'0002_notes_fts.sql',
	'0003_app_meta.sql',
	'0004_auth_rate_limits.sql',
	'0005_note_vaults.sql',
	'0006_hardening.sql',
	'0007_one_time_shares.sql',
	'0008_attachments.sql',
	'0009_totp_sessions.sql',
	'0010_note_folders.sql',
	'0011_note_trash.sql',
] as const;

const migrationNames = new Set(env.TEST_MIGRATIONS.map((migration) => migration.name));
if (!REQUIRED_MIGRATIONS.every((name) => migrationNames.has(name))) {
	throw new Error('test migration list is missing the current private-notes schema migrations');
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
