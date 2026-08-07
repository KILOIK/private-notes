import { describe, expect, it, vi } from 'vitest';
import {
	addPendingImage,
	clearAttachmentDraft,
	createAttachmentDraft,
	replacePendingToken,
} from '../public/attachment-draft.js';

describe('attachment draft helpers', () => {
	it('tracks pending image metadata and exposes its local preview URL', () => {
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending-image');
		const draft = createAttachmentDraft();
		const blob = new Blob(['image'], { type: 'image/png' });

		const pending = addPendingImage(draft, blob);

		expect(pending.blob).toBe(blob);
		expect(pending.token).toMatch(/^pending:\/\/[0-9a-f-]{36}$/i);
		expect(pending.url).toBe('blob:pending-image');
		expect(draft.pendingAttachments.get(pending.token)).toBe('blob:pending-image');
		createObjectURL.mockRestore();
	});

	it('replaces only the exact pending token returned by an upload', () => {
		const token = 'pending://11111111-1111-4111-8111-111111111111';
		const attachmentId = '22222222-2222-4222-8222-222222222222';
		const source = `![first](${token}) ${token}-suffix ![second](${token})`;

		expect(replacePendingToken(source, token, attachmentId)).toBe(
			`![first](attachment://${attachmentId}) ${token}-suffix ![second](attachment://${attachmentId})`
		);
	});

	it('revokes every preview URL and resets the draft', () => {
		const createObjectURL = vi.spyOn(URL, 'createObjectURL')
			.mockReturnValueOnce('blob:first')
			.mockReturnValueOnce('blob:second');
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		const draft = createAttachmentDraft();
		draft.noteId = crypto.randomUUID();
		addPendingImage(draft, new Blob(['first'], { type: 'image/png' }));
		addPendingImage(draft, new Blob(['second'], { type: 'image/webp' }));

		clearAttachmentDraft(draft);

		expect(revokeObjectURL.mock.calls).toEqual([['blob:first'], ['blob:second']]);
		expect(draft.noteId).toBeNull();
		expect(draft.images).toHaveLength(0);
		expect(draft.pendingAttachments.size).toBe(0);
		createObjectURL.mockRestore();
		revokeObjectURL.mockRestore();
	});
});
