import { decodeNoteRecord } from './note-records.js';

const UNCATEGORIZED_FOLDER_NAME = '未分类';

/** @typedef {{ id: string, updated_at: number }} SortableFolder */
/** @typedef {{ name: string }} DisplayFolder */

/** @template {SortableFolder} T @param {T[]} folders @returns {T[]} */
export function sortFolders(folders) {
  return folders.slice().sort(function (a, b) {
    return b.updated_at - a.updated_at || a.id.localeCompare(b.id);
  });
}

/** @param {Map<string, DisplayFolder>} folderMap @param {string | null} folderId */
export function resolveFolderName(folderMap, folderId) {
  if (!folderId) return UNCATEGORIZED_FOLDER_NAME;
  const folder = folderMap.get(folderId);
  return folder ? folder.name : UNCATEGORIZED_FOLDER_NAME;
}

/**
 * @param {{ content: string }} note
 * @param {'all' | 'note' | 'password'} category
 * @param {string | null} folderId
 * @param {Map<string, DisplayFolder>} folderMap
 */
export function matchesNoteFilter(note, category, folderId, folderMap) {
  const record = decodeNoteRecord(note.content);
  if (category !== 'all' && record.type !== category) return false;
  if (folderId === null) return resolveFolderName(folderMap, record.folderId) === UNCATEGORIZED_FOLDER_NAME;
  return record.folderId === folderId && folderMap.has(folderId);
}
