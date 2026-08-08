const MOBILE_MAX = 767;
const COMPACT_MAX = 1179;

/** @param {number} width @returns {'wide' | 'compact' | 'mobile'} */
export function getWorkspaceMode(width) {
  if (!Number.isFinite(width) || width < 0) throw new RangeError('width must be non-negative');
  return width <= MOBILE_MAX ? 'mobile' : width <= COMPACT_MAX ? 'compact' : 'wide';
}

/** @param {number} width @param {string|null} readerNoteId @param {boolean} navigationOpen */
export function getWorkspacePresentation(width, readerNoteId, navigationOpen) {
  const mode = getWorkspaceMode(width);
  const hasReader = Boolean(readerNoteId);
  const drawerOpen = mode !== 'wide' && navigationOpen;
  return Object.freeze({
    mode,
    activeView: mode === 'mobile' && hasReader ? 'reader' : 'list',
    navigationOpen: drawerOpen,
    navigationModal: drawerOpen,
    showNavigation: mode === 'wide' || drawerOpen,
    showList: mode !== 'mobile' || !hasReader,
    showReader: mode !== 'mobile' || hasReader,
    showReaderBack: mode === 'mobile' && hasReader,
  });
}

/** @param {'wide'|'compact'|'mobile'} mode @param {string|null} readerNoteId */
export function getWorkspaceScrollTarget(mode, readerNoteId) {
  return mode === 'mobile' ? (readerNoteId ? 'reader' : 'list') : readerNoteId ? 'reader' : 'list';
}

/** @param {{type?: string}|null|undefined} record */
export function getReaderActionModel(record) {
  const password = record?.type === 'password';
  return Object.freeze({ copyVisible: !password, shareVisible: !password, editVisible: true, restoreVisible: false, permanentDeleteVisible: false });
}
