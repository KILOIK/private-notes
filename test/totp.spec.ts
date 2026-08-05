import { describe, expect, it } from 'vitest';
import {
	generateRecoveryCodes,
	generateTotpSecret,
	hashRecoveryCode,
	verifyTotpCode,
} from '../src/totp';
import { decryptTotpSecret, encryptTotpSecret } from '../src/totp-secret';

describe('TOTP primitives', () => {
	it('matches the RFC 6238 SHA-1 vectors', async () => {
		const secret = '12345678901234567890';
		await expect(verifyTotpCode(secret, '287082', 59_000, 0)).resolves.toMatchObject({
			valid: true,
			counter: 1,
		});
		await expect(verifyTotpCode(secret, '081804', 1_111_111_109_000, 0)).resolves.toMatchObject({
			valid: true,
		});
		await expect(verifyTotpCode(secret, '050471', 1_111_111_111_000, 0)).resolves.toMatchObject({
			valid: true,
		});
	});

	it('rejects malformed codes and secrets without throwing', async () => {
		await expect(verifyTotpCode('12345678901234567890', '12345', 59_000, 0)).resolves.toEqual({
			valid: false,
			counter: null,
		});
		await expect(verifyTotpCode('12345678901234567890', 'abcdef', 59_000, 0)).resolves.toEqual({
			valid: false,
			counter: null,
		});
		await expect(verifyTotpCode('not a base32 secret!', '123456', 59_000, 0)).resolves.toEqual({
			valid: false,
			counter: null,
		});
	});

	it('accepts only the configured adjacent time-step window', async () => {
		const secret = '12345678901234567890';
		await expect(verifyTotpCode(secret, '287082', 60_000, 0)).resolves.toMatchObject({ valid: false });
		await expect(verifyTotpCode(secret, '287082', 60_000, 1)).resolves.toMatchObject({ valid: true, counter: 1 });
		await expect(verifyTotpCode(secret, '287082', 90_000, 1)).resolves.toMatchObject({ valid: false });
	});

	it('generates unpadded base32 secrets with enough entropy', () => {
		const first = generateTotpSecret();
		const second = generateTotpSecret();
		expect(first).toMatch(/^[A-Z2-7]+$/);
		expect(first).toHaveLength(32);
		expect(second).toMatch(/^[A-Z2-7]+$/);
		expect(second).not.toBe(first);
	});

	it('generates unique printable recovery codes', () => {
		const codes = generateRecoveryCodes(10);
		expect(codes).toHaveLength(10);
		expect(new Set(codes).size).toBe(10);
		for (const code of codes) expect(code).toMatch(/^[A-Z2-9-]+$/);
	});

	it('hashes recovery codes deterministically without embedding plaintext', async () => {
		const code = 'ABCD-EFGH-JKLM';
		const first = await hashRecoveryCode(code);
		const second = await hashRecoveryCode(code);
		expect(first).toBe(second);
		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(first).not.toContain(code);
	});
});

describe('TOTP secret at rest', () => {
	it('round trips encrypted secrets and uses a fresh IV', async () => {
		const secret = generateTotpSecret();
		const signingSecret = 'test-cookie-secret-with-at-least-32-random-characters';
		const first = await encryptTotpSecret(secret, signingSecret);
		const second = await encryptTotpSecret(secret, signingSecret);
		expect(first).not.toBe(second);
		expect(first).not.toContain(secret);
		expect(await decryptTotpSecret(first, signingSecret)).toBe(secret);
		expect(await decryptTotpSecret(second, signingSecret)).toBe(secret);
	});

	it('rejects tampering and the wrong signing secret', async () => {
		const ciphertext = await encryptTotpSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'signing-secret');
		await expect(decryptTotpSecret(ciphertext, 'wrong-signing-secret')).rejects.toThrow();
		const tampered = `${ciphertext.slice(0, -1)}${ciphertext.endsWith('A') ? 'B' : 'A'}`;
		await expect(decryptTotpSecret(tampered, 'signing-secret')).rejects.toThrow();
	});
});
