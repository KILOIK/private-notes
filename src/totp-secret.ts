const TOTP_CIPHERTEXT_PREFIX = 'totp:v1:';
const TOTP_ENVELOPE_PATTERN = /^totp:v1:([A-Za-z0-9_-]+)$/;
const TOTP_SALT = new TextEncoder().encode('private-notes:totp-secret:v1:salt');
const TOTP_INFO = new TextEncoder().encode('private-notes:totp-secret:v1');

function bytesToBase64Url(bytes: Uint8Array) {
	let binary = '';
	for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
	const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

async function deriveWrappingKey(signingSecret: string) {
	if (typeof signingSecret !== 'string' || signingSecret.length === 0) throw new TypeError('signing secret required');
	const baseKey = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(signingSecret),
		'HKDF',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt: TOTP_SALT, info: TOTP_INFO },
		baseKey,
		256
	);
	return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptTotpSecret(secret: string, signingSecret: string) {
	if (typeof secret !== 'string' || secret.length === 0 || secret.length > 256) {
		throw new TypeError('invalid TOTP secret');
	}
	const key = await deriveWrappingKey(signingSecret);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: TOTP_INFO },
		key,
		new TextEncoder().encode(secret)
	);
	const envelope = JSON.stringify({ v: 1, iv: bytesToBase64Url(iv), data: bytesToBase64Url(new Uint8Array(data)) });
	return `${TOTP_CIPHERTEXT_PREFIX}${bytesToBase64Url(new TextEncoder().encode(envelope))}`;
}

export async function decryptTotpSecret(ciphertext: string, signingSecret: string) {
	if (typeof ciphertext !== 'string' || ciphertext.length > 16_384) throw new Error('invalid TOTP ciphertext');
	const match = TOTP_ENVELOPE_PATTERN.exec(ciphertext);
	if (!match) throw new Error('invalid TOTP ciphertext');
	let envelope: { v?: unknown; iv?: unknown; data?: unknown };
	try {
		envelope = JSON.parse(new TextDecoder().decode(base64UrlToBytes(match[1]))) as typeof envelope;
	} catch {
		throw new Error('invalid TOTP ciphertext');
	}
	if (
		envelope.v !== 1 ||
		typeof envelope.iv !== 'string' ||
		typeof envelope.data !== 'string'
	) {
		throw new Error('invalid TOTP ciphertext');
	}
	const iv = base64UrlToBytes(envelope.iv);
	const data = base64UrlToBytes(envelope.data);
	if (iv.length !== 12 || data.length < 16) throw new Error('invalid TOTP ciphertext');
	const key = await deriveWrappingKey(signingSecret);
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv, additionalData: TOTP_INFO },
		key,
		data
	);
	return new TextDecoder().decode(plaintext);
}
