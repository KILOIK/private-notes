/**
 * @typedef {{ id: string, title?: string, created_at: number, updated_at: number, record?: any, folderName?: string }} WorkspaceNote
 * @typedef {{ id: string, name: string }} WorkspaceFolder
 * @typedef {'updated' | 'created' | 'title'} NoteSortKey
 */

/** @returns {Array<{ key: NoteSortKey, label: string }>} */
export function getSortOptions() {
  return [
    { key: 'updated', label: '最近更新' },
    { key: 'created', label: '最近创建' },
    { key: 'title', label: '标题' },
  ];
}

/**
 * @param {WorkspaceNote[]} notes
 * @param {WorkspaceFolder[]} folders
 * @param {'all' | 'note' | 'password'} activeCategory
 * @param {string | null | undefined} activeFolderId
 * @param {number} trashCount
 */
export function buildNavigationModel(notes, folders, activeCategory, activeFolderId, trashCount) {
  const categoryCounts = { all: notes.length, note: 0, password: 0 };
  const folderCounts = Object.fromEntries(folders.map(function (folder) { return [folder.id, 0]; }));
  let uncategorizedCount = 0;

  notes.forEach(function (note) {
    const type = note.record?.type === 'password' ? 'password' : 'note';
    categoryCounts[type] += 1;
    const folderId = typeof note.record?.folderId === 'string' ? note.record.folderId : null;
    if (folderId && Object.prototype.hasOwnProperty.call(folderCounts, folderId)) folderCounts[folderId] += 1;
    else uncategorizedCount += 1;
  });

  const activeKey = activeFolderId === undefined
    ? 'all'
    : activeFolderId === null
      ? 'uncategorized'
      : `folder:${activeFolderId}`;

  return Object.freeze({
    totalCount: notes.length,
    uncategorizedCount,
    categoryCounts: Object.freeze(categoryCounts),
    folderCounts: Object.freeze(folderCounts),
    trashCount: Math.max(0, Number.isFinite(trashCount) ? Math.floor(trashCount) : 0),
    activeKey: activeCategory === 'all' ? activeKey : `category:${activeCategory}:${activeKey}`,
  });
}

/** @template {WorkspaceNote} T @param {T[]} notes @param {NoteSortKey} sortKey @returns {T[]} */
export function sortVisibleNotes(notes, sortKey) {
  return notes.slice().sort(function (a, b) {
    if (sortKey === 'title') {
      return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN') || a.id.localeCompare(b.id);
    }
    const field = sortKey === 'created' ? 'created_at' : 'updated_at';
    return (Number(b[field]) || 0) - (Number(a[field]) || 0) || a.id.localeCompare(b.id);
  });
}

/** @param {Array<{ id: string, type: string, label: string, value: string }>} fields */
export function buildPasswordDisplayModel(fields) {
  return fields.map(function (field) {
    return Object.freeze({
      id: field.id,
      label: field.label || '字段',
      value: field.value,
      hidden: field.type === 'secret',
      multiline: field.type === 'multiline',
      copyVisible: true,
    });
  });
}
