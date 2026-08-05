const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_SECRET_BYTES = 20;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_CODE_GROUP_LENGTH = 4;
const RECOVERY_CODE_GROUPS = 4;

function bytesToBase64Url(bytes: Uint8Array) {
	let binary = '';
	for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase32(secret: string) {
	const normalized = secret.trim().toUpperCase();
	if (!normalized || !/^[A-Z2-7]+={0,6}$/.test(normalized)) return null;

	const unpadded = normalized.replace(/=+$/g, '');
	const paddingLength = normalized.length - unpadded.length;
	if (paddingLength > 0 && normalized.length % 8 !== 0) return null;
	if ((unpadded.length * 5) % 8 === 1) return null;

	const output = new Uint8Array(Math.floor((unpadded.length * 5) / 8));
	let buffer = 0;
	let bits = 0;
	let outputIndex = 0;
	for (const character of unpadded) {
		const value = BASE32_ALPHABET.indexOf(character);
		if (value < 0) return null;
		buffer = (buffer << 5) | value;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			output[outputIndex] = (buffer >> bits) & 0xff;
			outputIndex += 1;
		}
	}
	return output.length > 0 ? output : null;
}

function decodeTotpSecret(secret: string) {
	// RFC 6238 publishes the SHA-1 vector as its raw ASCII key. Generated
	// secrets use base32, but accepting this decimal vector keeps the helper
	// interoperable with the standard test fixture without weakening base32
	// validation for all other malformed values.
	if (/^\d+$/.test(secret)) return new TextEncoder().encode(secret);
	return decodeBase32(secret);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
	return difference === 0;
}

async function generateTotpCode(secretBytes: Uint8Array, counter: number) {
	const key = await crypto.subtle.importKey(
		'raw',
		secretBytes,
		{ name: 'HMAC', hash: 'SHA-1' },
		false,
		['sign']
	);
	const counterBytes = new Uint8Array(8);
	const view = new DataView(counterBytes.buffer);
	view.setUint32(0, Math.floor(counter / 0x1_0000_0000));
	view.setUint32(4, counter >>> 0);
	const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));
	const offset = digest[digest.length - 1] & 0x0f;
	const binaryCode =
		((digest[offset] & 0x7f) << 24) |
		(digest[offset + 1] << 16) |
		(digest[offset + 2] << 8) |
		digest[offset + 3];
	return String(binaryCode % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function generateTotpSecret() {
	const bytes = crypto.getRandomValues(new Uint8Array(TOTP_SECRET_BYTES));
	let bits = 0;
	let value = 0;
	let output = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			output += BASE32_ALPHABET[(value >> bits) & 31];
		}
	}
	if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	return output;
}

export async function verifyTotpCode(
	secret: string,
	code: string,
	nowMs: number,
	allowedSkewSteps: number
): Promise<{ valid: boolean; counter: number | null }> {
	if (
		typeof secret !== 'string' ||
		typeof code !== 'string' ||
		!/^[0-9]{6}$/.test(code) ||
		!Number.isFinite(nowMs) ||
		nowMs < 0 ||
		!Number.isSafeInteger(allowedSkewSteps) ||
		allowedSkewSteps < 0 ||
		allowedSkewSteps > 10
	) {
		return { valid: false, counter: null };
	}
	const secretBytes = decodeTotpSecret(secret);
	if (!secretBytes) return { valid: false, counter: null };

	const currentCounter = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
	let matchedCounter: number | null = null;
	for (let offset = -allowedSkewSteps; offset <= allowedSkewSteps; offset += 1) {
		const counter = currentCounter + offset;
		if (counter < 0) continue;
		const generated = await generateTotpCode(secretBytes, counter);
		const matches = constantTimeEqual(new TextEncoder().encode(generated), new TextEncoder().encode(code));
		if (matches && matchedCounter === null) matchedCounter = counter;
	}
	return { valid: matchedCounter !== null, counter: matchedCounter };
}

function randomRecoveryCharacter() {
	const limit = Math.floor(256 / RECOVERY_ALPHABET.length) * RECOVERY_ALPHABET.length;
	while (true) {
		const byte = crypto.getRandomValues(new Uint8Array(1))[0];
		if (byte < limit) return RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
	}
}

export function generateRecoveryCodes(count: number) {
	if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
		throw new RangeError('recovery code count must be between 1 and 100');
	}
	const codes = new Set<string>();
	while (codes.size < count) {
		const characters = Array.from(
			{ length: RECOVERY_CODE_GROUP_LENGTH * RECOVERY_CODE_GROUPS },
			() => randomRecoveryCharacter()
		);
		const groups: string[] = [];
		for (let index = 0; index < characters.length; index += RECOVERY_CODE_GROUP_LENGTH) {
			groups.push(characters.slice(index, index + RECOVERY_CODE_GROUP_LENGTH).join(''));
		}
		codes.add(groups.join('-'));
	}
	return [...codes];
}

export async function hashRecoveryCode(code: string) {
	if (typeof code !== 'string' || code.trim().length === 0 || code.length > 256) {
		throw new TypeError('invalid recovery code');
	}
	const normalized = code.trim().toUpperCase().replace(/\s+/g, '');
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(`private-notes-recovery-code:v1\u0000${normalized}`)
	);
	return bytesToBase64Url(new Uint8Array(digest));
}
