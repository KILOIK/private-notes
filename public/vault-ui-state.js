/**
 * @param {{
 *   notes: any[],
 *   allNotes: any[],
 *   trashNotes?: any[],
 *   trashCount?: number,
 *   trashMode?: boolean,
 *   expandedIds: Set<string>,
 *   readerNoteId: string | null,
 *   decryptFailedCount: number,
 *   legacyPlaintextCount: number
 * }} state
 */
export function clearDecryptedNoteState(state) {
  state.notes = [];
  state.allNotes = [];
  if ('trashNotes' in state) state.trashNotes = [];
  if ('trashCount' in state) state.trashCount = 0;
  if ('trashMode' in state) state.trashMode = false;
  state.expandedIds.clear();
  state.readerNoteId = null;
  state.decryptFailedCount = 0;
  state.legacyPlaintextCount = 0;
}

/**
 * @param {{
 *   encryptedFolders: any[],
 *   folders: any[],
 *   folderMap: Map<string, any>,
 *   activeCategory: 'all' | 'note' | 'password',
 *   activeFolderId: string | null | undefined
 * }} state
 * @param {{
 *   ownerDocument: { createElement(tagName: string): HTMLOptionElement },
 *   replaceChildren(...nodes: HTMLOptionElement[]): void
 * }} [editorFolder]
 */
export function clearDecryptedFolderState(state, editorFolder) {
  state.encryptedFolders = [];
  state.folders = [];
  state.folderMap = new Map();
  state.activeCategory = 'all';
  state.activeFolderId = null;
  if (editorFolder) {
    const fallback = editorFolder.ownerDocument.createElement('option');
    fallback.value = '';
    fallback.textContent = '未分类';
    editorFolder.replaceChildren(fallback);
  }
}

/**
 * @param {{
 *   sessionAuthenticated: boolean,
 *   vaultUnlocked: boolean,
 *   vaultKey: any,
 *   cryptoConfig: any,
 *   noteCountMeta: number,
 *   reauthRequired: boolean,
 *   totpEnabled: boolean,
 *   pendingLoginChallenge: string | null,
 *   pendingLoginPassword: string,
 *   pendingAuthMode: 'login' | 'reauth' | null,
 *   unlockError: string
 * }} state
 */
export function clearSessionAuthState(state) {
  state.sessionAuthenticated = false;
  state.vaultUnlocked = false;
  state.vaultKey = null;
  state.cryptoConfig = null;
  state.noteCountMeta = 0;
  state.reauthRequired = false;
  state.totpEnabled = false;
  state.pendingLoginChallenge = null;
  state.pendingLoginPassword = '';
  state.pendingAuthMode = null;
  state.unlockError = '';
}
