/**
 * @typedef {{ noteId: string, revision: number, attachmentIds: Set<string> }} ComposerSaveRecovery
 */

/**
 * @param {{ noteId: string, revision: number, attachmentIds: Iterable<string> }} input
 * @returns {ComposerSaveRecovery}
 */
export function createComposerSaveRecovery(input) {
  return {
    noteId: String(input.noteId),
    revision: Number(input.revision),
    attachmentIds: new Set(input.attachmentIds),
  };
}

/**
 * @param {ComposerSaveRecovery} recovery
 * @param {{ id: string, revision: number }} note
 * @param {Iterable<string>} attachmentIds
 * @returns {ComposerSaveRecovery}
 */
export function updateComposerSaveRecovery(recovery, note, attachmentIds) {
  return createComposerSaveRecovery({
    noteId: note.id || recovery.noteId,
    revision: note.revision,
    attachmentIds,
  });
}

/**
 * @param {string | null} editingId
 * @param {Array<{ id: string, revision: number }>} notes
 * @param {ComposerSaveRecovery | null} recovery
 * @returns {{ id: string, revision: number } | null}
 */
export function getComposerRetryNote(editingId, notes, recovery) {
  if (!editingId) return null;
  return notes.find(function (note) { return note.id === editingId; })
    || (recovery && recovery.noteId === editingId ? { id: recovery.noteId, revision: recovery.revision } : null);
}

/**
 * @param {Array<{ attachmentId?: string | null }>} images
 * @param {ComposerSaveRecovery | null} recovery
 * @returns {string[]}
 */
export function getUncommittedAttachmentIds(images, recovery) {
  const committed = recovery ? recovery.attachmentIds : new Set();
  return images.reduce(function (ids, image) {
    const id = image.attachmentId;
    if (typeof id === 'string' && !committed.has(id)) ids.push(id);
    return ids;
  }, /** @type {string[]} */ ([]));
}
