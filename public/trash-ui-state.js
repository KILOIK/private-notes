export function getTrashReaderActionModel() {
  return Object.freeze({
    copyVisible: false,
    shareVisible: false,
    editVisible: false,
    restoreVisible: true,
    permanentDeleteVisible: true,
  });
}

/** @param {{ deleted_at?: number|null, updated_at?: number }} note */
export function getTrashRowMeta(note) {
  if (!Number.isSafeInteger(note?.deleted_at) || Number(note.deleted_at) < 0) {
    throw new RangeError('trash note requires a deletion timestamp');
  }
  return Object.freeze({
    primaryTime: Number(note.deleted_at),
    secondaryTime: Number(note.updated_at) || 0,
  });
}
