import { describe, expect, it } from 'vitest';
import {
	createComposerSaveRecovery,
	getComposerRetryNote,
	getUncommittedAttachmentIds,
	markComposerSaveCommitted,
	updateComposerSaveRecovery,
} from '../public/composer-recovery.js';

describe('composer post-save recovery', () => {
	it('does not delete attachments already committed by the save', () => {
		const recovery = createComposerSaveRecovery({
			noteId: 'note-1',
			revision: 3,
			attachmentIds: ['attachment-1'],
		});
		const images = [
			{ attachmentId: 'attachment-1' },
			{ attachmentId: 'attachment-2' },
			{ attachmentId: null },
		];

		expect(getUncommittedAttachmentIds(images, recovery)).toEqual(['attachment-2']);
	});

	it('uses the committed note revision when the refreshed list is stale', () => {
		const recovery = createComposerSaveRecovery({ noteId: 'note-1', revision: 4, attachmentIds: [] });

		expect(getComposerRetryNote('note-1', [], recovery)).toEqual({ id: 'note-1', revision: 4 });
	});

	it('updates the recovery lease after a retry save', () => {
		const recovery = createComposerSaveRecovery({ noteId: 'note-1', revision: 4, attachmentIds: ['old'] });
		const updated = updateComposerSaveRecovery(recovery, { id: 'note-1', revision: 5 }, ['new']);

		expect(updated).toEqual({
			noteId: 'note-1',
			revision: 5,
			attachmentIds: new Set(['new']),
		});
	});

	it('updates the discard baseline once the API save has committed', () => {
		const state = { composerInitialSnapshot: 'before-save' };

		markComposerSaveCommitted(state, 'after-save');
		expect(state.composerInitialSnapshot).toBe('after-save');
	});
});
