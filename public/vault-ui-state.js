/**
 * @param {{
 *   notes: any[],
 *   allNotes: any[],
 *   expandedIds: Set<string>,
 *   readerNoteId: string | null,
 *   decryptFailedCount: number,
 *   legacyPlaintextCount: number
 * }} state
 */
export function clearDecryptedNoteState(state) {
  state.notes = [];
  state.allNotes = [];
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
 */
export function clearDecryptedFolderState(state) {
  state.encryptedFolders = [];
  state.folders = [];
  state.folderMap = new Map();
  state.activeCategory = 'all';
  state.activeFolderId = undefined;
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
  state.unlockError = '';
}
