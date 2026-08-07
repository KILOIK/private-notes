import { describe, expect, it } from 'vitest';
import { createLatestOperation } from '../public/latest-operation.js';
import { clearDecryptedNoteState } from '../public/vault-ui-state.js';

describe('sensitive UI state', () => {
	it('invalidates an older reader operation when a newer one starts or the reader closes', () => {
		const operations = createLatestOperation();
		const first = operations.begin();
		expect(operations.isCurrent(first)).toBe(true);

		const second = operations.begin();
		expect(operations.isCurrent(first)).toBe(false);
		expect(operations.isCurrent(second)).toBe(true);

		operations.cancel();
		expect(operations.isCurrent(second)).toBe(false);
	});

	it('removes decrypted note and reader state when the vault locks', () => {
		const state = {
			notes: [{ id: 'note-1', folderName: '私密文件夹' }],
			allNotes: [{ id: 'note-1', content: '明文', folderName: '私密文件夹' }],
			expandedIds: new Set(['note-1']),
			readerNoteId: 'note-1',
			decryptFailedCount: 2,
			legacyPlaintextCount: 1,
		};

		clearDecryptedNoteState(state);

		expect(state.notes).toEqual([]);
		expect(state.allNotes).toEqual([]);
		expect(state.expandedIds.size).toBe(0);
		expect(state.readerNoteId).toBeNull();
		expect(state.decryptFailedCount).toBe(0);
		expect(state.legacyPlaintextCount).toBe(0);
	});
});
