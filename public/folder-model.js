import { decodeNoteRecord } from './note-records.js';

const UNCATEGORIZED_FOLDER_NAME = '未分类';

/** @typedef {{ id: string, updated_at: number }} SortableFolder */
/** @typedef {{ id?: string, name: string }} DisplayFolder */

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
 * @param {Array<{ id: string, name: string }>} folders
 * @param {string | null} selectedId
 */
export function buildComposerFolderChoices(folders, selectedId) {
  const selected = typeof selectedId === 'string' && folders.some(function (folder) { return folder.id === selectedId; })
    ? selectedId
    : null;
  return {
    selectedId: selected,
    choices: [
      { id: null, name: UNCATEGORIZED_FOLDER_NAME },
      ...folders.map(function (folder) { return { id: folder.id, name: folder.name }; })
    ]
  };
}

/**
 * @param {{ content: string }} note
 * @param {'all' | 'note' | 'password'} category
 * @param {string | null | undefined} folderId
 * @param {Map<string, DisplayFolder>} folderMap
 */
export function matchesNoteFilter(note, category, folderId, folderMap) {
  const record = decodeNoteRecord(note.content);
  if (category !== 'all' && record.type !== category) return false;
  if (folderId === undefined) return true;
  if (folderId === null) return resolveFolderName(folderMap, record.folderId) === UNCATEGORIZED_FOLDER_NAME;
  return record.folderId === folderId && folderMap.has(folderId);
}
