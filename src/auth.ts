type AuthEnv = {
	DB: D1Database;
	APP_PASSWORD?: string;
	APP_PASSWORDS?: string;
	COOKIE_SECRET?: string;
};

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_COOKIE_NAME = '__Host-session';
export const MAX_PASSWORD_LENGTH = 1024;
export const DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS = 1800;
export const SESSION_IDLE_TIMEOUT_OPTIONS = [300, 900, 1800, 3600, 14400] as const;
export const MAX_AUTH_DEVICE_RECORDS = 100;
export const AUTH_DEVICE_PAGE_SIZE = 10;

export type LoginBranding = { title: string; description: string };
export type AuthSettings = { login: LoginBranding; idleTimeoutSeconds: number };

const DEFAULT_LOGIN_BRANDING: LoginBranding = {
	title: '正在打开我的笔记',
	description: '输入密码后即可进入应用，并在本地解锁你的加密笔记。',
};

const LOGIN_MAX_FAILED_ATTEMPTS = 5;
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const DEFAULT_VAULT_ID = 'default';
const MAX_SESSION_TOKEN_LENGTH = 4096;
const MIN_COOKIE_SECRET_LENGTH = 32;
const MANAGED_SIGNING_SECRET_META_KEY = 'managed_signing_secret:v1';
const MANAGED_SIGNING_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOTP_ENABLED_META_KEY = 'totp_enabled';
const TOTP_SECRET_META_KEY = 'totp_secret:v1';
const TOTP_PENDING_META_KEY = 'totp_pending:v1';
const LOGIN_BRANDING_META_KEY = 'branding_login:v1';
const SESSION_IDLE_TIMEOUT_META_KEY = 'session_idle_timeout_seconds:v1';
const TOTP_CHALLENGE_PREFIX = 'totp_challenge:v1:';
const TOTP_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const UNSAFE_NEW_APP_PASSWORDS = new Set(['replace-with-a-long-unique-passphrase']);
const UNSAFE_COOKIE_SECRETS = new Set([
	'change-this-to-a-long-random-string',
	'replace-with-at-least-32-random-characters',
]);

type VaultCredential = {
	vaultId: string;
	password: string;
};

export type SessionData = {
	authenticated: boolean;
	vaultId: string;
	reauthRequired: boolean;
	sessionId: string | null;
};

export type SessionDeviceMetadata = {
	deviceLabel: string;
	userAgent: string;
	loginIp: string;
};

export type AuthDeviceCursor = {
	loginAt: number;
	idHash: string;
};

type VerifiedToken = { vaultId: string; sessionId: string | null; legacy: boolean; exp: number };

function getCookie(request: Request, name: string) {
	const cookie = request.headers.get('cookie') || '';
	const prefix = `${name}=`;

	for (const item of cookie.split(';')) {
		const part = item.trim();
		if (!part.startsWith(prefix)) continue;

		try {
			return decodeURIComponent(part.slice(prefix.length));
		} catch {
			return '';
		}
	}

	return '';
}

function base64UrlEncode(input: string | Uint8Array) {
	const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string) {
	if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new Error('invalid base64url');
	const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

async function hmacSha256Base64Url(secret: string, data: string) {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
	return base64UrlEncode(new Uint8Array(signature));
}

function safeEqual(a: string, b: string) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

function normalizeVaultId(value: string) {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
	return normalized.replace(/^-|-$/g, '') || DEFAULT_VAULT_ID;
}

function isUsableCookieSecret(value: unknown) {
	return (
		typeof value === 'string' &&
		value.length >= MIN_COOKIE_SECRET_LENGTH &&
		!UNSAFE_COOKIE_SECRETS.has(value)
	);
}

function isManagedSigningSecret(value: unknown) {
	return typeof value === 'string' && MANAGED_SIGNING_SECRET_PATTERN.test(value);
}

/**
 * Legacy Deploy to Cloudflare installs could ask users for Worker secrets, but
 * could not generate a unique random value for each deployment. Keep an
 * explicit COOKIE_SECRET as the preferred override; otherwise atomically
 * initialize one per D1 database.
 */
export async function resolveCookieSecret(env: AuthEnv) {
	const configuredSecret = env.COOKIE_SECRET;
	if (typeof configuredSecret === 'string' && isUsableCookieSecret(configuredSecret)) return configuredSecret;
	const useManagedSecret =
		typeof configuredSecret !== 'string' ||
		configuredSecret.length === 0 ||
		UNSAFE_COOKIE_SECRETS.has(configuredSecret);
	if (!useManagedSecret) {
		throw new Error('COOKIE_SECRET override is shorter than 32 characters');
	}

	const existing = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ? LIMIT 1')
		.bind(MANAGED_SIGNING_SECRET_META_KEY)
		.first<{ value: string }>();
	if (existing) {
		if (!isManagedSigningSecret(existing.value)) {
			throw new Error('managed signing secret is invalid');
		}
		return existing.value;
	}

	const candidate = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
	const created = await env.DB.prepare(
		`INSERT INTO app_meta (key, value)
		 VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = app_meta.value
		 RETURNING value`
	)
		.bind(MANAGED_SIGNING_SECRET_META_KEY, candidate)
		.first<{ value: string }>();
	if (!created || !isManagedSigningSecret(created.value)) {
		throw new Error('failed to initialize managed signing secret');
	}
	return created.value;
}

function getVaultCredentials(env: AuthEnv) {
	const credentials: VaultCredential[] = [];
	if (typeof env.APP_PASSWORD === 'string' && env.APP_PASSWORD.length > 0) {
		credentials.push({ vaultId: DEFAULT_VAULT_ID, password: env.APP_PASSWORD });
	}

	for (const item of (env.APP_PASSWORDS || '').split(',')) {
		const trimmed = item.trim();
		if (!trimmed) continue;

		const separatorIndex = trimmed.indexOf('=');
		if (separatorIndex <= 0) continue;

		const vaultId = normalizeVaultId(trimmed.slice(0, separatorIndex));
		const password = trimmed.slice(separatorIndex + 1).trim();
		if (!password) continue;
		credentials.push({ vaultId, password });
	}

	return credentials;
}

/** Returns a safe diagnostic for the Worker entry point; null means authentication is usable. */
export function getAuthConfigurationError(env: AuthEnv) {
	if (typeof env.COOKIE_SECRET !== 'string' || env.COOKIE_SECRET.length < MIN_COOKIE_SECRET_LENGTH) {
		return 'COOKIE_SECRET is missing or shorter than 32 characters';
	}
	if (UNSAFE_COOKIE_SECRETS.has(env.COOKIE_SECRET)) return 'COOKIE_SECRET still uses an example value';

	const credentials = getVaultCredentials(env);
	if (credentials.length === 0) {
		return 'APP_PASSWORD or APP_PASSWORDS is missing';
	}

	const vaultIds = new Set<string>();
	const passwords = new Set<string>();
	for (const credential of credentials) {
		if (UNSAFE_NEW_APP_PASSWORDS.has(credential.password)) return 'APP_PASSWORD still uses an example value';
		if (credential.password.length > MAX_PASSWORD_LENGTH) return 'vault password exceeds the supported length';
		if (vaultIds.has(credential.vaultId)) return `duplicate vault id: ${credential.vaultId}`;
		if (passwords.has(credential.password)) return 'duplicate vault password';
		vaultIds.add(credential.vaultId);
		passwords.add(credential.password);
	}

	return null;
}

export function getConfiguredVaultCount(env: AuthEnv) {
	return getVaultCredentials(env).length;
}

async function getCredentialFingerprint(env: AuthEnv, credential: VaultCredential) {
	if (!env.COOKIE_SECRET) return '';
	return hmacSha256Base64Url(
		env.COOKIE_SECRET,
		`session-credential\u0000${credential.vaultId}\u0000${credential.password}`
	);
}

export async function getCredentialFingerprintForVault(env: AuthEnv, vaultId: string) {
	const normalizedVaultId = normalizeVaultId(vaultId);
	const credential = getVaultCredentials(env).find((item) => item.vaultId === normalizedVaultId);
	return credential ? getCredentialFingerprint(env, credential) : '';
}

async function hashOpaque(value: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`private-notes-auth:v1\u0000${value}`));
	return base64UrlEncode(new Uint8Array(digest));
}

function normalizeSettingText(value: unknown, maxLength: number) {
	if (typeof value !== 'string' || /[<>]/.test(value)) return null;
	const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
	if (!normalized) return null;
	return Array.from(normalized).slice(0, maxLength).join('');
}

export function normalizeLoginBranding(value: unknown): LoginBranding | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as { title?: unknown; description?: unknown };
	const title = normalizeSettingText(candidate.title, 64);
	const description = normalizeSettingText(candidate.description, 160);
	return title && description ? { title, description } : null;
}

export function normalizeIdleTimeoutSeconds(value: unknown) {
	return typeof value === 'number' && SESSION_IDLE_TIMEOUT_OPTIONS.includes(value as (typeof SESSION_IDLE_TIMEOUT_OPTIONS)[number])
		? value
		: null;
}

export async function getAuthSettings(env: AuthEnv): Promise<AuthSettings> {
	const rows = await env.DB.prepare('SELECT key, value FROM app_meta WHERE key IN (?, ?)')
		.bind(LOGIN_BRANDING_META_KEY, SESSION_IDLE_TIMEOUT_META_KEY)
		.all<{ key: string; value: string }>();
	const values = new Map((rows.results ?? []).map((row) => [row.key, row.value]));
	let login = DEFAULT_LOGIN_BRANDING;
	try {
		const parsed = JSON.parse(values.get(LOGIN_BRANDING_META_KEY) || '') as unknown;
		login = normalizeLoginBranding(parsed) || DEFAULT_LOGIN_BRANDING;
	} catch {
		// Fall back to safe defaults when an older or malformed value is present.
	}
	const parsedTimeout = Number(values.get(SESSION_IDLE_TIMEOUT_META_KEY));
	const idleTimeoutSeconds = normalizeIdleTimeoutSeconds(parsedTimeout) ?? DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS;
	return { login, idleTimeoutSeconds };
}

export async function isTotpEnabled(env: AuthEnv) {
	const row = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ? LIMIT 1')
		.bind(TOTP_ENABLED_META_KEY).first<{ value: string }>();
	return row?.value === '1';
}

async function getTotpSecretCiphertext(env: AuthEnv) {
	const row = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ? LIMIT 1')
		.bind(TOTP_SECRET_META_KEY).first<{ value: string }>();
	return row?.value ?? null;
}

export async function getVaultIdForPassword(env: AuthEnv, password: string) {
	if (getAuthConfigurationError(env)) return null;

	const suppliedFingerprint = await hmacSha256Base64Url(env.COOKIE_SECRET!, `login-password\u0000${password}`);
	for (const credential of getVaultCredentials(env)) {
		const configuredFingerprint = await hmacSha256Base64Url(
			env.COOKIE_SECRET!,
			`login-password\u0000${credential.password}`
		);
		if (safeEqual(suppliedFingerprint, configuredFingerprint)) return credential.vaultId;
	}
	return null;
}

export async function createSessionToken(
	env: AuthEnv,
	vaultId = DEFAULT_VAULT_ID,
	existingSessionId?: string,
	metadata?: SessionDeviceMetadata
) {
	if (getAuthConfigurationError(env)) return '';
	const normalizedVaultId = normalizeVaultId(vaultId);
	const credential = getVaultCredentials(env).find((item) => item.vaultId === normalizedVaultId);
	if (!credential) return '';

	const nowMs = Date.now();
	const now = Math.floor(nowMs / 1000);
	const sessionId = existingSessionId || base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
	const idHash = await hashOpaque(sessionId);
	await env.DB.prepare(
		`INSERT INTO auth_sessions (id_hash, vault_id, created_at, last_activity_at, last_reauth_at, expires_at, revoked_at, device_label, user_agent, login_ip, login_at)
		 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
		 ON CONFLICT(id_hash) DO UPDATE SET
			vault_id = excluded.vault_id,
			expires_at = excluded.expires_at,
			device_label = COALESCE(auth_sessions.device_label, excluded.device_label),
			user_agent = COALESCE(auth_sessions.user_agent, excluded.user_agent),
			login_ip = COALESCE(auth_sessions.login_ip, excluded.login_ip),
			login_at = COALESCE(auth_sessions.login_at, excluded.login_at)`
	)
		.bind(
			idHash,
			normalizedVaultId,
			nowMs,
			nowMs,
			nowMs,
			nowMs + SESSION_MAX_AGE_SECONDS * 1000,
			metadata?.deviceLabel ?? null,
			metadata?.userAgent ?? null,
			metadata?.loginIp ?? null,
			metadata ? nowMs : null
		)
		.run();
	await trimAuthSessions(env, normalizedVaultId);
	const payload = base64UrlEncode(
		JSON.stringify({
			v: 3,
			vaultId: normalizedVaultId,
			credential: await getCredentialFingerprint(env, credential),
			sessionId,
			iat: now,
			exp: now + SESSION_MAX_AGE_SECONDS,
		})
	);
	const signature = await hmacSha256Base64Url(env.COOKIE_SECRET!, payload);
	return `${payload}.${signature}`;
}

async function verifySessionToken(env: AuthEnv, token: string): Promise<VerifiedToken | null> {
	if (getAuthConfigurationError(env) || token.length > MAX_SESSION_TOKEN_LENGTH) return null;
	const parts = token.split('.');
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
	const [payload, signature] = parts;
	const expectedSignature = await hmacSha256Base64Url(env.COOKIE_SECRET!, payload);
	if (!safeEqual(signature, expectedSignature)) return null;

	try {
		const data = JSON.parse(base64UrlDecode(payload)) as {
			credential?: unknown;
			exp?: unknown;
			v?: unknown;
			vaultId?: unknown;
			sessionId?: unknown;
		};
		const now = Math.floor(Date.now() / 1000);
		if (
			(data.v !== 2 && data.v !== 3) ||
			typeof data.exp !== 'number' ||
			!Number.isSafeInteger(data.exp) ||
			data.exp <= now ||
			typeof data.vaultId !== 'string' ||
			normalizeVaultId(data.vaultId) !== data.vaultId ||
			typeof data.credential !== 'string'
		) {
			return null;
		}

		const credential = getVaultCredentials(env).find((item) => item.vaultId === data.vaultId);
		if (!credential) return null;
		const currentFingerprint = await getCredentialFingerprint(env, credential);
		if (!safeEqual(data.credential, currentFingerprint)) return null;
		if (data.v === 2) return { vaultId: credential.vaultId, sessionId: null, legacy: true, exp: data.exp as number };
		if (typeof data.sessionId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.sessionId)) return null;
		return { vaultId: credential.vaultId, sessionId: data.sessionId, legacy: false, exp: data.exp as number };
	} catch {
		return null;
	}
}

export async function getSession(request: Request, env: AuthEnv): Promise<SessionData> {
	if (getAuthConfigurationError(env)) {
		return { authenticated: false, vaultId: DEFAULT_VAULT_ID, reauthRequired: false, sessionId: null };
	}

	const session = getCookie(request, SESSION_COOKIE_NAME);
	if (!session) return { authenticated: false, vaultId: DEFAULT_VAULT_ID, reauthRequired: false, sessionId: null };
	const verified = await verifySessionToken(env, session);
	if (!verified) return { authenticated: false, vaultId: DEFAULT_VAULT_ID, reauthRequired: false, sessionId: null };
	const authSettings = await getAuthSettings(env);
	const sessionId = verified.sessionId || await hashOpaque(session);
	const idHash = await hashOpaque(sessionId);
	if (verified.legacy) {
		const now = Date.now();
		await env.DB.prepare(
			`INSERT INTO auth_sessions (id_hash, vault_id, created_at, last_activity_at, last_reauth_at, expires_at, revoked_at)
			 VALUES (?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(id_hash) DO NOTHING`
		).bind(idHash, verified.vaultId, now, now, now, verified.exp * 1000).run();
	}
	const row = await env.DB.prepare(
		`SELECT last_activity_at, last_reauth_at, expires_at, revoked_at FROM auth_sessions WHERE id_hash = ? LIMIT 1`
	).bind(idHash).first<{ last_activity_at: number; last_reauth_at: number; expires_at: number; revoked_at: number | null }>();
	if (!row || row.revoked_at || row.expires_at <= Date.now()) {
		return { authenticated: false, vaultId: DEFAULT_VAULT_ID, reauthRequired: false, sessionId: null };
	}
	const reauthRequired = Date.now() - row.last_activity_at > authSettings.idleTimeoutSeconds * 1000;
	return { authenticated: true, vaultId: verified.vaultId, reauthRequired, sessionId };
}

export async function touchSessionActivity(env: AuthEnv, sessionId: string, nowMs = Date.now()) {
	const idHash = await hashOpaque(sessionId);
	await env.DB.prepare(
		'UPDATE auth_sessions SET last_activity_at = ? WHERE id_hash = ? AND revoked_at IS NULL AND expires_at > ?'
	).bind(nowMs, idHash, nowMs).run();
}

export async function requireActiveSession(
	request: Request,
	env: AuthEnv,
	options: { touch?: boolean } = {}
): Promise<SessionData> {
	const session = await getSession(request, env);
	if (!session.authenticated) throw new Error('unauthorized');
	if (session.reauthRequired) throw new Error('reauth_required');
	if (options.touch && session.sessionId) await touchSessionActivity(env, session.sessionId);
	return session;
}

function getClientIp(request: Request) {
	return (request.headers.get('cf-connecting-ip') || 'unknown').slice(0, 128);
}

export function getSessionDeviceMetadata(request: Request): SessionDeviceMetadata {
	const userAgent = (request.headers.get('user-agent') || '未知客户端').slice(0, 512);
	const deviceLabel = (/iPhone|iPad|Android|Macintosh|Windows|Linux/i.exec(userAgent)?.[0] || '未知设备').slice(0, 80);
	return { deviceLabel, userAgent, loginIp: getClientIp(request) };
}

async function trimAuthSessions(env: AuthEnv, vaultId: string) {
	const normalizedVaultId = normalizeVaultId(vaultId);
	await env.DB.prepare(
		`DELETE FROM auth_sessions
		 WHERE vault_id = ?
		   AND id_hash NOT IN (
			 SELECT id_hash FROM auth_sessions
			 WHERE vault_id = ?
			 ORDER BY COALESCE(login_at, created_at) DESC, id_hash DESC
			 LIMIT ?
		   )`
	)
		.bind(normalizedVaultId, normalizedVaultId, MAX_AUTH_DEVICE_RECORDS)
		.run();
}

export async function listAuthDevices(
	env: AuthEnv,
	vaultId: string,
	currentSessionId: string | null,
	cursor: AuthDeviceCursor | null,
	limit: number
) {
	const currentHash = currentSessionId ? await hashOpaque(currentSessionId) : null;
	const normalizedVaultId = normalizeVaultId(vaultId);
	const normalizedLimit = Math.max(1, Math.min(AUTH_DEVICE_PAGE_SIZE, limit));
	const query = cursor
		? env.DB.prepare(
			`WITH recent_sessions AS (
				SELECT id_hash, device_label, user_agent, login_ip,
					COALESCE(login_at, created_at) AS login_at, last_activity_at
				FROM auth_sessions
				WHERE vault_id = ?
				ORDER BY COALESCE(login_at, created_at) DESC, id_hash DESC
				LIMIT ?
			)
			SELECT id_hash, device_label, user_agent, login_ip, login_at, last_activity_at
			FROM recent_sessions
			WHERE login_at < ? OR (login_at = ? AND id_hash < ?)
			ORDER BY login_at DESC, id_hash DESC
			LIMIT ?`
		).bind(normalizedVaultId, MAX_AUTH_DEVICE_RECORDS, cursor.loginAt, cursor.loginAt, cursor.idHash, normalizedLimit + 1)
		: env.DB.prepare(
			`WITH recent_sessions AS (
				SELECT id_hash, device_label, user_agent, login_ip,
					COALESCE(login_at, created_at) AS login_at, last_activity_at
				FROM auth_sessions
				WHERE vault_id = ?
				ORDER BY COALESCE(login_at, created_at) DESC, id_hash DESC
				LIMIT ?
			)
			SELECT id_hash, device_label, user_agent, login_ip, login_at, last_activity_at
			FROM recent_sessions
			ORDER BY login_at DESC, id_hash DESC
			LIMIT ?`
		).bind(normalizedVaultId, MAX_AUTH_DEVICE_RECORDS, normalizedLimit + 1);
	const result = await query.all<{
		id_hash: string;
		device_label: string | null;
		user_agent: string | null;
		login_ip: string | null;
		login_at: number;
		last_activity_at: number;
	}>();
	const rows = result.results ?? [];
	const hasMore = rows.length > normalizedLimit;
	const devices = (hasMore ? rows.slice(0, normalizedLimit) : rows).map((row) => ({
		deviceLabel: row.device_label || '未知设备',
		userAgent: row.user_agent || '未知客户端',
		loginIp: row.login_ip || 'unknown',
		loginAt: row.login_at,
		lastActivityAt: row.last_activity_at,
		current: currentHash === row.id_hash,
	}));
	const last = hasMore ? rows[normalizedLimit - 1] : null;
	return {
		devices,
		nextCursor: last ? { loginAt: last.login_at, idHash: last.id_hash } : null,
	};
}

async function getLoginRateLimitKey(request: Request, env: AuthEnv) {
	return hmacSha256Base64Url(env.COOKIE_SECRET!, `login-ip\u0000${getClientIp(request)}`);
}

export async function getLoginRateLimit(request: Request, env: AuthEnv) {
	const key = await getLoginRateLimitKey(request, env);
	const now = Date.now();
	const row = await env.DB.prepare(
		`SELECT locked_until
		 FROM auth_rate_limits
		 WHERE key = ?
		 LIMIT 1`
	)
		.bind(key)
		.first<{ locked_until: number }>();

	if (row?.locked_until && row.locked_until > now) {
		return {
			key,
			limited: true,
			retryAfterSeconds: Math.ceil((row.locked_until - now) / 1000),
		};
	}

	return { key, limited: false, retryAfterSeconds: 0 };
}

export async function recordFailedLogin(env: AuthEnv, key: string) {
	const now = Date.now();
	const row = await env.DB.prepare(
		`INSERT INTO auth_rate_limits (key, attempts, first_attempt_at, locked_until, updated_at)
		 VALUES (?, 1, ?, 0, ?)
		 ON CONFLICT(key) DO UPDATE SET
			attempts = CASE
				WHEN excluded.updated_at - auth_rate_limits.first_attempt_at > ? THEN 1
				ELSE auth_rate_limits.attempts + 1
			END,
			first_attempt_at = CASE
				WHEN excluded.updated_at - auth_rate_limits.first_attempt_at > ? THEN excluded.updated_at
				ELSE auth_rate_limits.first_attempt_at
			END,
			locked_until = CASE
				WHEN excluded.updated_at - auth_rate_limits.first_attempt_at > ? THEN 0
				WHEN auth_rate_limits.attempts + 1 >= ? THEN excluded.updated_at + ?
				ELSE auth_rate_limits.locked_until
			END,
			updated_at = excluded.updated_at
		 RETURNING attempts, locked_until`
	)
		.bind(
			key,
			now,
			now,
			LOGIN_RATE_LIMIT_WINDOW_MS,
			LOGIN_RATE_LIMIT_WINDOW_MS,
			LOGIN_RATE_LIMIT_WINDOW_MS,
			LOGIN_MAX_FAILED_ATTEMPTS,
			LOGIN_LOCKOUT_MS
		)
		.first<{ attempts: number; locked_until: number }>();

	if (!row) throw new Error('failed to update login rate limit');
	return {
		attempts: row.attempts,
		locked: row.locked_until > now,
		retryAfterSeconds: row.locked_until > now ? Math.ceil((row.locked_until - now) / 1000) : 0,
	};
}

export async function clearFailedLogins(env: AuthEnv, key: string) {
	await env.DB.prepare('DELETE FROM auth_rate_limits WHERE key = ?').bind(key).run();
}

export async function cleanupOldLoginRateLimits(env: AuthEnv) {
	const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
	await env.DB.prepare('DELETE FROM auth_rate_limits WHERE updated_at < ?').bind(cutoff).run();
}

export function tooManyLoginAttempts(retryAfterSeconds: number) {
	const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
	const minutes = Math.max(1, Math.ceil(seconds / 60));
	return new Response(
		JSON.stringify({
			ok: false,
			error: `登录失败次数过多，请 ${minutes} 分钟后再试`,
			retryAfterSeconds: seconds,
		}),
		{
			status: 429,
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'no-store',
				'retry-after': String(seconds),
				'x-content-type-options': 'nosniff',
			},
		}
	);
}

async function challengeKey(challengeId: string) {
	return `${TOTP_CHALLENGE_PREFIX}${await hashOpaque(challengeId)}`;
}

export async function createPendingTwoFactorChallenge(
	env: AuthEnv,
	vaultId: string,
	passwordFingerprint: string
) {
	const challengeId = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
	const now = Date.now();
	const key = await challengeKey(challengeId);
	await env.DB.prepare(
		`INSERT INTO app_meta (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
	).bind(key, JSON.stringify({ vaultId: normalizeVaultId(vaultId), passwordFingerprint, expiresAt: now + TOTP_CHALLENGE_TTL_MS })).run();
	return challengeId;
}

async function consumeRecoveryCode(env: AuthEnv, code: string) {
	let hash: string;
	try {
		const module = await import('./totp');
		hash = await module.hashRecoveryCode(code);
	} catch {
		return false;
	}
	const row = await env.DB.prepare(
		'UPDATE auth_recovery_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL RETURNING code_hash'
	).bind(Date.now(), hash).first<{ code_hash: string }>();
	return Boolean(row);
}

export async function verifyTwoFactorChallenge(
	env: AuthEnv,
	challengeId: string,
	codeOrRecoveryCode: string
): Promise<SessionData | null> {
	if (typeof challengeId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challengeId)) return null;
	const key = await challengeKey(challengeId);
	const row = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ? LIMIT 1').bind(key).first<{ value: string }>();
	if (!row) return null;
	let challenge: { vaultId?: string; passwordFingerprint?: string; expiresAt?: number };
	try { challenge = JSON.parse(row.value) as typeof challenge; } catch { return null; }
	if (!challenge.vaultId || !challenge.passwordFingerprint || !challenge.expiresAt || challenge.expiresAt <= Date.now()) {
		await env.DB.prepare('DELETE FROM app_meta WHERE key = ?').bind(key).run();
		return null;
	}
	const currentFingerprint = await getCredentialFingerprintForVault(env, challenge.vaultId);
	if (!currentFingerprint || !safeEqual(currentFingerprint, challenge.passwordFingerprint)) return null;
	const secretCiphertext = await getTotpSecretCiphertext(env);
	const enabled = await isTotpEnabled(env);
	let valid = false;
	if (enabled && secretCiphertext) {
		try {
			const { decryptTotpSecret } = await import('./totp-secret');
			const secret = await decryptTotpSecret(secretCiphertext, env.COOKIE_SECRET!);
			const { verifyTotpCode } = await import('./totp');
			valid = (await verifyTotpCode(secret, codeOrRecoveryCode, Date.now(), 1)).valid;
		} catch { valid = false; }
	}
	if (!valid) valid = await consumeRecoveryCode(env, codeOrRecoveryCode);
	if (!valid) return null;
	const consumed = await env.DB.prepare(
		'UPDATE app_meta SET value = ? WHERE key = ? AND value = ? RETURNING key'
	).bind('consumed', key, row.value).first<{ key: string }>();
	if (!consumed) return null;
	await env.DB.prepare('DELETE FROM app_meta WHERE key = ? AND value = ?').bind(key, 'consumed').run();
	const sessionId = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
	const now = Date.now();
	await env.DB.prepare(
		`INSERT INTO auth_sessions (id_hash, vault_id, created_at, last_activity_at, last_reauth_at, expires_at, revoked_at)
		 VALUES (?, ?, ?, ?, ?, ?, NULL)`
	).bind(await hashOpaque(sessionId), challenge.vaultId, now, now, now, now + SESSION_MAX_AGE_SECONDS * 1000).run();
	return { authenticated: true, vaultId: challenge.vaultId, reauthRequired: false, sessionId };
}

export async function verifyTotpOrRecoveryCode(env: AuthEnv, code: string) {
	const ciphertext = await getTotpSecretCiphertext(env);
	if (ciphertext && await isTotpEnabled(env)) {
		try {
			const { decryptTotpSecret } = await import('./totp-secret');
			const { verifyTotpCode } = await import('./totp');
			const secret = await decryptTotpSecret(ciphertext, env.COOKIE_SECRET!);
			if ((await verifyTotpCode(secret, code, Date.now(), 1)).valid) return true;
		} catch { /* generic unauthorized */ }
	}
	return consumeRecoveryCode(env, code);
}

export async function getTotpEnrollment(env: AuthEnv) {
	const row = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ? LIMIT 1').bind(TOTP_PENDING_META_KEY).first<{ value: string }>();
	return row?.value ?? null;
}

export { TOTP_ENABLED_META_KEY, TOTP_SECRET_META_KEY, TOTP_PENDING_META_KEY };
