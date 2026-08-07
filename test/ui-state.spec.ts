import { describe, expect, it } from 'vitest';
import { createLatestOperation } from '../public/latest-operation.js';
import { clearDecryptedFolderState, clearDecryptedNoteState, clearSessionAuthState } from '../public/vault-ui-state.js';

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

	it('removes decrypted folder names and resets folder filters when the vault locks', () => {
		const state = {
			encryptedFolders: [{ id: 'folder-1', name: 'enc:v1:...' }],
			folders: [{ id: 'folder-1', name: '私密工作' }],
			folderMap: new Map([['folder-1', { id: 'folder-1', name: '私密工作' }]]),
			activeCategory: 'password' as const,
			activeFolderId: 'folder-1',
		};

		clearDecryptedFolderState(state);

		expect(state.encryptedFolders).toEqual([]);
		expect(state.folders).toEqual([]);
		expect(state.folderMap.size).toBe(0);
		expect(state.activeCategory).toBe('all');
		expect(state.activeFolderId).toBeUndefined();
	});

	it('replaces decrypted composer folder options with the uncategorized fallback during vault cleanup', () => {
		type TestOption = { tagName: string; value: string; textContent: string };
		const editorFolder = {
			children: [
				{ tagName: 'OPTION', value: 'folder-1', textContent: '私密工作' },
				{ tagName: 'OPTION', value: 'folder-2', textContent: '个人密码' },
			] as TestOption[],
			ownerDocument: {
				createElement(tagName: string): TestOption {
					return { tagName: tagName.toUpperCase(), value: '', textContent: '' };
				},
			},
			replaceChildren(...children: TestOption[]) {
				this.children = children;
			},
		};
		const state = {
			encryptedFolders: [{ id: 'folder-1', name: 'enc:v1:...' }],
			folders: [{ id: 'folder-1', name: '私密工作' }],
			folderMap: new Map([['folder-1', { id: 'folder-1', name: '私密工作' }]]),
			activeCategory: 'all' as const,
			activeFolderId: 'folder-1',
		};
		const clearWithComposer = clearDecryptedFolderState as unknown as (
			folderState: typeof state,
			folderSelect: typeof editorFolder
		) => void;

		clearWithComposer(state, editorFolder);

		expect(editorFolder.children).toEqual([
			{ tagName: 'OPTION', value: '', textContent: '未分类' },
		]);
	});

	it('resets authentication state when logout or a revoked session ends the client session', () => {
		const state = {
			sessionAuthenticated: true,
			vaultUnlocked: true,
			vaultKey: { secret: true },
			cryptoConfig: { version: 1 },
			noteCountMeta: 2,
			reauthRequired: true,
			totpEnabled: true,
			pendingLoginChallenge: 'challenge',
			pendingLoginPassword: 'password',
			unlockError: 'error',
		};

		clearSessionAuthState(state);

		expect(state).toEqual({
			sessionAuthenticated: false,
			vaultUnlocked: false,
			vaultKey: null,
			cryptoConfig: null,
			noteCountMeta: 0,
			reauthRequired: false,
			totpEnabled: false,
			pendingLoginChallenge: null,
			pendingLoginPassword: '',
			unlockError: '',
		});
	});
});
