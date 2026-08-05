import { describe, expect, it } from 'vitest';
import { decryptSharedPayload, encryptSharedPayload } from '../public/share-crypto.js';

function decodeKeyFragment(fragment: string) {
	const encoded = fragment.slice(3);
	const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4);
	return Uint8Array.from(atob(padded), (value) => value.charCodeAt(0));
}

describe('browser share crypto', () => {
	it('round trips Markdown content with encrypted image payloads', async () => {
		const payload = {
			v: 1,
			title: '图片笔记',
			content: '![图片](attachment://11111111-1111-4111-8111-111111111111)',
			createdAt: 1_725_000_000_000,
			sharedAt: 1_725_000_001_000,
			attachments: [{
				id: '11111111-1111-4111-8111-111111111111',
				mimeType: 'image/png',
				ciphertext: 'AQIDBA==',
			}],
		};
		const encrypted = await encryptSharedPayload(payload);
		expect(encrypted.keyFragment).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
		expect(encrypted.proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(await decryptSharedPayload(encrypted.ciphertext, decodeKeyFragment(encrypted.keyFragment))).toMatchObject(payload);
	});

	it('rejects malformed image metadata after decrypting the share envelope', async () => {
		const encrypted = await encryptSharedPayload({
			v: 1,
			title: 'bad',
			content: '',
			createdAt: 1,
			sharedAt: 2,
			attachments: [{ id: 'not-a-uuid', mimeType: 'text/html', ciphertext: 'not-base64' }],
		});
		const keyBytes = decodeKeyFragment(encrypted.keyFragment);
		await expect(decryptSharedPayload(encrypted.ciphertext, keyBytes)).rejects.toThrow('invalid share attachment');
	});
});
