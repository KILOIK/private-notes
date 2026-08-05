import { describe, expect, it, vi } from 'vitest';
import {
	decryptAttachment,
	encryptAttachment,
	revokeAttachmentUrls,
} from '../public/attachment-crypto.js';

describe('browser attachment crypto', () => {
	it('encrypts the same image with a fresh envelope and round-trips bytes and MIME type', async () => {
		const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
		const source = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
		const first = await encryptAttachment(source, key);
		const second = await encryptAttachment(source, key);
		expect(new Uint8Array(first.ciphertext)).not.toEqual(new Uint8Array(second.ciphertext));
		expect(await decryptAttachment(first.ciphertext, first.mimeType, key)).toEqual(source);
	});

	it('rejects a tampered envelope or wrong key', async () => {
		const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
		const wrongKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
		const encrypted = await encryptAttachment(new Blob([new Uint8Array([7, 8, 9])], { type: 'image/webp' }), key);
		const tampered = new Uint8Array(encrypted.ciphertext);
		tampered[tampered.length - 1] ^= 1;
		await expect(decryptAttachment(tampered.buffer, encrypted.mimeType, key)).rejects.toThrow();
		await expect(decryptAttachment(encrypted.ciphertext, encrypted.mimeType, wrongKey)).rejects.toThrow();
	});

	it('revokes each attachment URL exactly once', () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		const urls = new Set(['blob:a', 'blob:b']);
		revokeAttachmentUrls(urls);
		revokeAttachmentUrls(urls);
		expect(revoke).toHaveBeenCalledTimes(2);
		revoke.mockRestore();
	});
});
