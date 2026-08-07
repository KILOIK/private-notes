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
