import { encryptSharedPayload } from './share-crypto.js';
import { buildHighlightedTextSegments, buildNoteCardViewModel, buildReaderRenderPlan, extractAttachmentIds, renderMarkdown } from './markdown.js';
import { loadEditorMarkdown, runEditorCommand, serializeEditorMarkdown } from './document-editor.js';
import { decryptAttachment, encryptAttachment, extractDroppedImage, extractPastedImages, revokeAttachmentUrls } from './attachment-crypto.js';
import { addPendingImage, clearAttachmentDraft, createAttachmentDraft, replacePendingToken } from './attachment-draft.js';
import { buildComposerFolderChoices, matchesNoteFilter, resolveFolderName, sortFolders } from './folder-model.js';
import { buildNoteSaveContent, decodeNoteRecord, getSafeRecordText } from './note-records.js';
import { createDefaultPasswordFields } from './password-fields.js';
import { buildPasswordSavePayload, focusComposerPrimaryField, renderPasswordEditor, renderPasswordReader } from './password-ui.js';
import { createLatestOperation } from './latest-operation.js';
import { clearDecryptedFolderState, clearDecryptedNoteState, clearSessionAuthState } from './vault-ui-state.js';
import { beginComposerSaving } from './composer-saving.js';
import { createComposerDraftSnapshot } from './composer-draft.js';
import { completeComposerSave } from './composer-post-save.js';
import { createComposerSaveRecovery, getComposerRetryNote, getUncommittedAttachmentIds, markComposerSaveCommitted, updateComposerSaveRecovery } from './composer-recovery.js';
import { getReaderActionModel, getWorkspaceMode, getWorkspacePresentation, getWorkspaceScrollTarget } from './workspace-view.js';
import { buildNavigationModel, sortVisibleNotes } from './workspace-model.js';
import { getTrashReaderActionModel, getTrashRowMeta } from './trash-ui-state.js';
import { getSettingsSurfaceState } from './settings-ui-state.js';
import { getCompleteTotpCode, moveTotpFocus, normalizeTotpInput } from './totp-input.js';

/**
 * @typedef {{ id: string, title: string, content: string, created_at: number, updated_at: number, revision: number, deleted_at?: number|null }} RawNote
 * @typedef {RawNote & { encrypted: boolean, decryptFailed: boolean, record?: any, folderName?: string, attachmentIds?: string[] }} Note
 * @typedef {{ vaultSalt: string, cipher: 'aes-gcm-256', kdf: 'pbkdf2-sha256', iterations: number, version: 1, keyCheck: string | null }} CryptoConfig
 */

const KEY_CHECK_MARKER = 'private-notes-key-check:v1';

/** @type {{
 * notes: Note[],
 * allNotes: Note[],
 * trashNotes: Note[],
 * trashCount: number,
 * trashMode: boolean,
 * editingId: string | null,
 * sharingNoteId: string | null,
 * shareOperationId: number,
 * shareCreating: boolean,
 * shareReturnFocus: HTMLElement | null,
 * expandedIds: Set<string>,
 * statusTimer: number | null,
 * sessionAuthenticated: boolean,
 * authMode: 'checking' | 'login' | 'unlock' | 'totp',
 * vaultUnlocked: boolean,
 * vaultKey: CryptoKey | null,
 * cryptoConfig: CryptoConfig | null,
 * noteCountMeta: number,
 * decryptFailedCount: number,
 * legacyPlaintextCount: number,
 * unlockError: string,
 * appShortName: string,
 * loginTitle: string,
 * loginDescription: string,
 * idleTimeoutSeconds: number,
 * readerNoteId: string | null,
 * readerOperation: ReturnType<typeof createLatestOperation>,
 * editorMode: 'source' | 'preview',
 * attachmentUrls: Set<string>,
 * pendingAttachmentIds: string[],
 * attachmentDraft: ReturnType<typeof createAttachmentDraft>,
 * pendingLoginChallenge: string | null,
 * pendingLoginPassword: string,
 * totpVerifying: boolean,
 * reauthRequired: boolean,
 * totpEnabled: boolean,
 * idleTimer: number | null,
 * encryptedFolders: Array<{ id: string, name: string, created_at: number, updated_at: number }>,
 * folders: Array<{ id: string, name: string, created_at: number, updated_at: number }>,
 * folderMap: Map<string, { id: string, name: string, created_at: number, updated_at: number }>,
 * activeCategory: 'all' | 'note' | 'password',
 * activeFolderId: string | null | undefined
 * sortKey: 'updated' | 'created' | 'title'
 * editorRecordType: 'note' | 'password'
 * editorPasswordFields: Array<{ id: string, type: 'text' | 'secret' | 'multiline', label: string, value: string }>
 * editorFolderId: string | null
 * editorSourceMarkdown: string
 * editorSourceDirty: boolean
 * composerSaving: boolean
 * composerInitialSnapshot: string | null
 * composerPostSaveRecovery: { noteId: string, revision: number, attachmentIds: Set<string> } | null
 * editingInline: boolean
 * workspaceMode: 'wide' | 'compact' | 'mobile'
 * navigationOpen: boolean
 * navigationReturnFocus: HTMLElement | null
 * listScrollTop: number
 * hasListScrollSnapshot: boolean
 * settingsReturnFocus: HTMLElement | null
 * authDevicesCurrentCursor: string | null
 * authDevicesPreviousCursors: Array<string | null>
 * authDevicesNextCursor: string | null
 * authDevicesLoading: boolean
 * folderReturnFocus: HTMLElement | null
 * editingFolderId: string | null
 * }} */
const state = {
  notes: [],
  allNotes: [],
  trashNotes: [],
  trashCount: 0,
  trashMode: false,
  editingId: null,
  sharingNoteId: null,
  shareOperationId: 0,
  shareCreating: false,
  shareReturnFocus: null,
  expandedIds: new Set(),
  statusTimer: null,
  sessionAuthenticated: false,
  authMode: 'checking',
  vaultUnlocked: false,
  vaultKey: null,
  cryptoConfig: null,
  noteCountMeta: 0,
  decryptFailedCount: 0,
  legacyPlaintextCount: 0,
  unlockError: '',
  appShortName: document.documentElement.dataset.appShortName || '我的笔记',
  loginTitle: '正在打开我的笔记',
  loginDescription: '输入密码后即可进入应用，并在本地解锁你的加密笔记。',
  idleTimeoutSeconds: 1800,
  readerNoteId: null,
  readerOperation: createLatestOperation(),
  editorMode: 'source',
  attachmentUrls: new Set(),
  pendingAttachmentIds: [],
  attachmentDraft: createAttachmentDraft(),
  pendingLoginChallenge: null,
  pendingLoginPassword: '',
  totpVerifying: false,
  reauthRequired: false,
  totpEnabled: false,
  idleTimer: null,
  encryptedFolders: [],
  folders: [],
  folderMap: new Map(),
  activeCategory: 'all',
  activeFolderId: null,
  sortKey: 'updated',
  editorRecordType: 'note',
  editorPasswordFields: [],
  editorFolderId: null,
  editorSourceMarkdown: '',
  editorSourceDirty: false,
  composerSaving: false,
  composerInitialSnapshot: null,
  composerPostSaveRecovery: null,
  editingInline: false,
  workspaceMode: getWorkspaceMode(window.innerWidth),
  navigationOpen: false,
  navigationReturnFocus: null,
  listScrollTop: 0,
  hasListScrollSnapshot: false,
  settingsReturnFocus: null,
  authDevicesCurrentCursor: null,
  authDevicesPreviousCursors: [],
  authDevicesNextCursor: null,
  authDevicesLoading: false,
  folderReturnFocus: null,
  editingFolderId: null
};
/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function getElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error('页面缺少必要元素：' + id);
  return element;
}

/** @param {string} id @returns {HTMLInputElement} */
function getInput(id) {
  const element = getElement(id);
  if (!(element instanceof HTMLInputElement)) throw new Error('页面元素类型错误：' + id);
  return element;
}

/** @param {string} id @returns {HTMLTextAreaElement} */
function getTextArea(id) {
  const element = getElement(id);
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('页面元素类型错误：' + id);
  return element;
}

/** @param {string} id @returns {HTMLSelectElement} */
function getSelect(id) {
  const element = getElement(id);
  if (!(element instanceof HTMLSelectElement)) throw new Error('页面元素类型错误：' + id);
  return element;
}

/** @param {string} id @returns {HTMLButtonElement} */
function getButton(id) {
  const element = getElement(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error('页面元素类型错误：' + id);
  return element;
}

const els = {
  loginView: getElement('loginView'),
  totpView: getElement('totpView'),
  appView: getElement('appView'),
  unlockBadge: getElement('unlockBadge'),
  loginTitle: getElement('loginTitle'),
  loginDesc: getElement('loginDesc'),
  passwordInput: getInput('passwordInput'),
  passwordHelp: getElement('passwordHelp'),
  loginBtn: getButton('loginBtn'),
  loginLogoutBtn: getButton('loginLogoutBtn'),
  loginStatus: getElement('loginStatus'),
  totpInputs: getElement('totpInputs'),
  totpBackBtn: getButton('totpBackBtn'),
  totpRecoveryToggleBtn: getButton('totpRecoveryToggleBtn'),
  totpRecoveryPanel: getElement('totpRecoveryPanel'),
  totpRecoveryInput: getInput('totpRecoveryInput'),
  totpStatus: getElement('totpStatus'),
  totpVerifyBtn: getButton('totpVerifyBtn'),
  loginTitleInput: getInput('loginTitleInput'),
  loginDescriptionInput: getTextArea('loginDescriptionInput'),
  idleTimeoutSelect: getSelect('idleTimeoutSelect'),
  authSettingsPassword: getInput('authSettingsPassword'),
  saveAuthSettingsBtn: getButton('saveAuthSettingsBtn'),
  authSettingsStatus: getElement('authSettingsStatus'),
  authDevicesList: getElement('authDevicesList'),
  authDevicesPagination: getElement('authDevicesPagination'),
  authDevicesPreviousBtn: getButton('authDevicesPreviousBtn'),
  authDevicesPageLabel: getElement('authDevicesPageLabel'),
  authDevicesNextBtn: getButton('authDevicesNextBtn'),
  topbar: getElement('topbar'),
  searchInput: getInput('searchInput'),
  clearSearchBtn: getButton('clearSearchBtn'),
  newBtn: getButton('newBtn'),
  fabNewBtn: getButton('fabNewBtn'),
  fabTopBtn: getButton('fabTopBtn'),
  settingsBtn: getButton('settingsBtn'),
  closeSettingsBtn: getButton('closeSettingsBtn'),
  settingsPanel: getElement('settingsPanel'),
  settingsBackdrop: getButton('settingsBackdrop'),
  settingsLogoutBtn: getButton('settingsLogoutBtn'),
  statusLine: getElement('statusLine'),
  vaultPanel: getElement('vaultPanel'),
  workspaceLayout: getElement('workspaceLayout'),
  workspaceNavigation: getElement('workspaceNavigation'),
  navigationBtn: getButton('navigationBtn'),
  closeNavigationBtn: getButton('closeNavigationBtn'),
  navigationBackdrop: getButton('navigationBackdrop'),
  feedView: getElement('feedView'),
  noteListScroll: getElement('noteListScroll'),
  vaultPanelDesc: getElement('vaultPanelDesc'),
  vaultUnlockInput: getInput('vaultUnlockInput'),
  unlockBtn: getButton('unlockBtn'),
  securityPanel: getElement('securityPanel'),
  securityPanelStatus: getElement('securityPanelStatus'),
  enrollTotpBtn: getButton('enrollTotpBtn'),
  disableTotpBtn: getButton('disableTotpBtn'),
  totpEnrollmentPanel: getElement('totpEnrollmentPanel'),
  totpSecretLabel: getElement('totpSecretLabel'),
  totpRecoveryCodes: getTextArea('totpRecoveryCodes'),
  confirmTotpBtn: getButton('confirmTotpBtn'),
  noteCount: getElement('noteCount'),
  listTitle: getElement('listTitle'),
  noteList: getElement('noteList'),
  sortBtn: getButton('sortBtn'),
  sortMenu: getElement('sortMenu'),
  feedNewBtn: getButton('feedNewBtn'),
  readerView: getElement('readerView'),
  readerEmptyState: getElement('readerEmptyState'),
  readerDetail: getElement('readerDetail'),
  readerBackBtn: getButton('readerBackBtn'),
  readerPath: getElement('readerPath'),
  readerMeta: getElement('readerMeta'),
  readerCopyBtn: getButton('readerCopyBtn'),
  readerShareBtn: getButton('readerShareBtn'),
  readerEditBtn: getButton('readerEditBtn'),
  readerMoreBtn: getButton('readerMoreBtn'),
  readerStandardActions: getElement('readerStandardActions'),
  readerTrashActions: getElement('readerTrashActions'),
  readerRestoreBtn: getButton('readerRestoreBtn'),
  readerPermanentDeleteBtn: getButton('readerPermanentDeleteBtn'),
  readerTitle: getElement('readerTitle'),
  readerContent: getElement('readerContent'),
  readerDocument: getElement('readerDocument'),
  readerEditor: getElement('readerEditor'),
  passwordFields: getElement('passwordFields'),
  readerMoreMenu: getElement('readerMoreMenu'),
  readerDeleteBtn: getButton('readerDeleteBtn'),
  editorModal: getElement('editorModal'),
  editorCard: getElement('editorCard'),
  modalTitle: getElement('modalTitle'),
  editorTitle: getInput('editorTitle'),
  editorFolder: getSelect('editorFolder'),
  passwordEditorFields: getElement('passwordEditorFields'),
  editorContent: getTextArea('editorContent'),
  documentEditor: getElement('documentEditor'),
  editorToolbar: getElement('editorToolbar'),
  insertLinkBtn: getButton('insertLinkBtn'),
  insertImageBtn: getButton('insertImageBtn'),
  attachmentStatus: getElement('attachmentStatus'),
  mobilePasteStatus: getElement('mobilePasteStatus'),
  editorPreview: getElement('editorPreview'),
  composerSaveStatus: getElement('composerSaveStatus'),
  cancelBtn: getButton('cancelBtn'),
  saveBtn: getButton('saveBtn'),
  shareModal: getElement('shareModal'),
  shareNoteLabel: getElement('shareNoteLabel'),
  shareExpiry: getSelect('shareExpiry'),
  shareSetup: getElement('shareSetup'),
  shareResult: getElement('shareResult'),
  shareLinkInput: getInput('shareLinkInput'),
  shareExpiryLabel: getElement('shareExpiryLabel'),
  closeShareModalBtn: getButton('closeShareModalBtn'),
  cancelShareBtn: getButton('cancelShareBtn'),
  createShareBtn: getButton('createShareBtn'),
  copyShareLinkBtn: getButton('copyShareLinkBtn'),
  folderNav: getElement('folderNav'),
  trashNav: getButton('trashNav'),
  trashNavCount: getElement('trashNavCount'),
  newFolderBtn: getButton('newFolderBtn'),
  folderDialog: getElement('folderDialog'),
  folderList: getElement('folderList'),
  folderDialogMode: getElement('folderDialogMode'),
  manageFoldersBtn: getButton('manageFoldersBtn'),
  closeFolderDialogBtn: getButton('closeFolderDialogBtn'),
  cancelFolderBtn: getButton('cancelFolderBtn'),
  folderNameInput: getInput('folderNameInput'),
  saveFolderBtn: getButton('saveFolderBtn')
};

function getTotpDigits() {
  return /** @type {HTMLInputElement[]} */ (Array.from(els.totpInputs.querySelectorAll('[data-totp-index]')));
}

/** @param {boolean} pending */
function setTotpVerificationPending(pending) {
  els.totpVerifyBtn.disabled = pending;
  els.totpBackBtn.disabled = pending;
  els.totpRecoveryToggleBtn.disabled = pending;
  els.totpRecoveryInput.disabled = pending;
  getTotpDigits().forEach(function (input) { input.disabled = pending; });
}

/** @param {string} text */
function setStatus(text) {
  if (state.statusTimer !== null) window.clearTimeout(state.statusTimer);
  if (!text) {
    els.statusLine.textContent = '';
    els.statusLine.classList.remove('show');
    return;
  }
  els.statusLine.textContent = text;
  els.statusLine.classList.add('show');
  state.statusTimer = window.setTimeout(function () {
    els.statusLine.classList.remove('show');
  }, 1800);
}

function updateSearchUi() {
  const hasText = Boolean(els.searchInput.value.trim());
  els.clearSearchBtn.classList.toggle('show', hasText);
}

function getActiveScrollElement() {
  return getWorkspaceScrollTarget(state.workspaceMode, state.readerNoteId) === 'reader'
    ? els.readerView
    : els.noteListScroll;
}

function updateScrollUi() {
  const shouldShow = getActiveScrollElement().scrollTop > 320;
  els.fabTopBtn.classList.toggle('show', shouldShow);
}

function updateModalUi() {
  const open = (!state.editingInline && !els.editorModal.classList.contains('hidden')) || !els.shareModal.classList.contains('hidden') || !els.folderDialog.classList.contains('hidden');
  [els.topbar, els.fabNewBtn, els.fabTopBtn].forEach(function (element) {
    element.classList.toggle('modal-obscured', open);
  });
  [els.loginView, els.appView, els.fabNewBtn, els.fabTopBtn].forEach(function (element) {
    element.inert = open;
  });
}

function syncWorkspacePresentation() {
  const view = getWorkspacePresentation(window.innerWidth, state.readerNoteId, state.navigationOpen);
  state.workspaceMode = view.mode;
  state.navigationOpen = view.navigationOpen;
  els.workspaceLayout.dataset.mode = view.mode;
  els.workspaceLayout.dataset.activeView = view.activeView;
  els.workspaceNavigation.classList.toggle('is-open', view.showNavigation);
  els.workspaceNavigation.setAttribute('aria-hidden', String(!view.showNavigation));
  els.workspaceNavigation.inert = !view.showNavigation;
  els.navigationBtn.setAttribute('aria-expanded', String(view.navigationOpen));
  els.navigationBackdrop.classList.toggle('hidden', !view.navigationModal);
  els.feedView.classList.toggle('is-hidden', !view.showList);
  els.readerView.classList.toggle('is-hidden', !view.showReader);
  els.readerBackBtn.classList.toggle('hidden', !view.showReaderBack);
}

function openNavigation() {
  if (state.workspaceMode === 'wide') return;
  state.navigationReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  state.navigationOpen = true;
  syncWorkspacePresentation();
  setNavigationBackgroundInert(getWorkspacePresentation(window.innerWidth, state.readerNoteId, state.navigationOpen).navigationModal);
  els.workspaceNavigation.focus();
}

/** @param {boolean} [restoreFocus] */
function closeNavigation(restoreFocus = true) {
  state.navigationOpen = false;
  syncWorkspacePresentation();
  setNavigationBackgroundInert(false);
  const returnFocus = state.navigationReturnFocus;
  state.navigationReturnFocus = null;
  if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
}

let resizeFrame = 0;
function handleWorkspaceResize() {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(function () {
    if (getWorkspaceMode(window.innerWidth) === 'wide') {
      state.navigationOpen = false;
      setNavigationBackgroundInert(false);
    }
    syncWorkspacePresentation();
  });
}

/** @param {HTMLElement} container */
function getFocusableElements(container) {
  return /** @type {HTMLElement[]} */ (Array.from(container.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )).filter(function (element) {
    return element instanceof HTMLElement && element.getClientRects().length > 0;
  }));
}

/** @param {KeyboardEvent} event @param {HTMLElement} container */
function trapFocus(event, container) {
  const focusable = getFocusableElements(container);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (!first || !last) {
    event.preventDefault();
    container.focus();
  } else if (!(active instanceof HTMLElement) || !container.contains(active) || !focusable.includes(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey ? active === first : active === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/** @param {boolean} inert */
function setSettingsBackgroundInert(inert) {
  [els.topbar, els.statusLine, els.vaultPanel, els.workspaceLayout, els.fabNewBtn, els.fabTopBtn].forEach(function (element) {
    element.inert = inert;
  });
}

/** @param {boolean} locked */
function setSettingsScrollLock(locked) {
  document.documentElement.classList.toggle('settings-open', locked);
  document.body.classList.toggle('settings-open', locked);
}

/** @param {boolean} open */
function setSettingsSurfaceOpen(open) {
  const surface = getSettingsSurfaceState(open);
  els.settingsPanel.classList.toggle('hidden', !open);
  els.settingsPanel.setAttribute('aria-hidden', String(surface.ariaHidden));
  els.settingsBackdrop.classList.toggle('hidden', !open);
  els.settingsBackdrop.setAttribute('aria-hidden', String(surface.ariaHidden));
  els.settingsBtn.setAttribute('aria-expanded', String(surface.open));
  setSettingsScrollLock(surface.scrollLocked);
}

/** @param {boolean} inert */
function setNavigationBackgroundInert(inert) {
  [els.topbar, els.feedView, els.readerView, els.fabNewBtn, els.fabTopBtn].forEach(function (element) {
    element.inert = inert;
  });
}

function openSettings() {
  state.settingsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  setSettingsSurfaceOpen(true);
  setSettingsBackgroundInert(true);
  els.settingsPanel.focus();
  loadAuthSettings().catch(function (error) {
    els.authSettingsStatus.textContent = error instanceof Error ? error.message : '读取登录设置失败';
  });
  loadAuthDevices(null, true).catch(function (error) {
    setStatus(error instanceof Error ? error.message : '读取登录记录失败');
  });
}

function closeSettings() {
  setSettingsSurfaceOpen(false);
  setSettingsBackgroundInert(false);
  const returnFocus = state.settingsReturnFocus;
  state.settingsReturnFocus = null;
  if (returnFocus && returnFocus.isConnected) returnFocus.focus();
}

function openFolderDialog() {
  state.folderReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  state.editingFolderId = null;
  els.folderDialogMode.textContent = '新建文件夹';
  els.saveFolderBtn.textContent = '保存文件夹';
  renderFolderManager();
  els.folderDialog.classList.remove('hidden');
  els.folderDialog.setAttribute('aria-hidden', 'false');
  updateModalUi();
  els.folderNameInput.focus();
}

function closeFolderDialog() {
  els.folderDialog.classList.add('hidden');
  els.folderDialog.setAttribute('aria-hidden', 'true');
  els.folderNameInput.value = '';
  state.editingFolderId = null;
  els.folderDialogMode.textContent = '新建文件夹';
  els.saveFolderBtn.textContent = '保存文件夹';
  updateModalUi();
  const returnFocus = state.folderReturnFocus;
  state.folderReturnFocus = null;
  if (returnFocus && returnFocus.isConnected) returnFocus.focus();
}

function renderFilterNav() {
  els.folderNav.querySelectorAll('[data-folder-id][data-folder-category]').forEach(function (element) {
    const button = /** @type {HTMLButtonElement} */ (element);
    const folderId = button.dataset.folderId === '__uncategorized__' ? null : button.dataset.folderId;
    const active = folderId === state.activeFolderId && button.dataset.folderCategory === state.activeCategory;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  els.folderNav.querySelectorAll('.folder-subfilters').forEach(function (element) {
    const children = /** @type {HTMLElement} */ (element);
    children.hidden = children.dataset.folderId !== (state.activeFolderId === null ? '__uncategorized__' : state.activeFolderId);
  });
  els.trashNav.classList.toggle('is-active', state.trashMode);
  if (state.trashMode) els.trashNav.setAttribute('aria-current', 'page');
  else els.trashNav.removeAttribute('aria-current');
}

/** @param {HTMLElement} container @param {string | null} folderId @param {{ total: number, note: number, password: number }} counts */
function appendFolderFilters(container, folderId, counts) {
  const children = document.createElement('div');
  children.className = 'folder-subfilters';
  children.dataset.folderId = folderId === null ? '__uncategorized__' : folderId;
  children.hidden = state.activeFolderId !== folderId;
  ['note', 'password'].forEach(function (category) {
    const child = document.createElement('button');
    child.type = 'button';
    child.className = 'folder-subfilter';
    child.dataset.folderId = folderId === null ? '__uncategorized__' : folderId;
    child.dataset.folderCategory = category;
    child.textContent = `${category === 'note' ? '笔记' : '密码'} ${category === 'note' ? counts.note : counts.password}`;
    children.append(child);
  });
  container.append(children);
}

/** @param {string | null} folderId @param {string} name @param {{ total: number, note: number, password: number }} counts */
function appendFolderFilter(folderId, name, counts) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'folder-chip';
  button.dataset.folderId = folderId === null ? '__uncategorized__' : folderId;
  button.dataset.folderCategory = 'all';
  const icon = document.createElement('span');
  icon.className = 'nav-item-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = folderId === null ? '?' : '▰';
  const label = document.createElement('span');
  label.className = 'nav-item-label';
  label.textContent = name;
  const count = document.createElement('span');
  count.className = 'nav-item-count';
  count.textContent = String(counts.total);
  button.append(icon, label, count);
  els.folderNav.append(button);
  appendFolderFilters(els.folderNav, folderId, counts);
}

/** @param {ReturnType<typeof buildNavigationModel>} [model] */
function renderFolders(model = buildNavigationModel(state.allNotes, state.folders, state.activeCategory, state.activeFolderId, state.trashCount)) {
  els.folderNav.replaceChildren();
  appendFolderFilter(null, '未分类', model.uncategorizedCounts);
  state.folders.forEach(function (folder) {
    appendFolderFilter(folder.id, folder.name, model.folderCounts[folder.id]);
  });
  renderFilterNav();
}

function renderNavigationSummary() {
  const model = buildNavigationModel(state.allNotes, state.folders, state.activeCategory, state.activeFolderId, state.trashCount);
  els.trashNavCount.textContent = String(model.trashCount);
  renderFolders(model);
}

function renderFolderManager() {
  els.folderList.replaceChildren();
  if (!state.folders.length) {
    const empty = document.createElement('div');
    empty.className = 'folder-manager-empty';
    empty.textContent = '还没有文件夹';
    els.folderList.appendChild(empty);
    return;
  }
  state.folders.forEach(function (folder) {
    const row = document.createElement('div');
    row.className = 'folder-manager-row';
    const name = document.createElement('span');
    name.className = 'folder-manager-name';
    name.textContent = folder.name;
    const actions = document.createElement('div');
    actions.className = 'folder-manager-actions';
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'btn secondary';
    rename.textContent = '重命名';
    rename.onclick = function () {
      state.editingFolderId = folder.id;
      els.folderDialogMode.textContent = '重命名文件夹';
      els.saveFolderBtn.textContent = '保存修改';
      els.folderNameInput.value = folder.name;
      els.folderNameInput.focus();
      els.folderNameInput.select();
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn danger';
    remove.textContent = '删除';
    remove.onclick = function () {
      deleteFolder(folder).catch(function (error) {
        setStatus(error instanceof Error ? error.message : '删除文件夹失败');
      });
    };
    actions.append(rename, remove);
    row.append(name, actions);
    els.folderList.appendChild(row);
  });
}

async function saveFolder() {
  const name = els.folderNameInput.value.trim();
  if (!name) {
    setStatus('请输入文件夹名称');
    els.folderNameInput.focus();
    return;
  }
  const encryptedName = await encryptValue(name);
  if (state.editingFolderId) {
    const folder = state.folderMap.get(state.editingFolderId);
    if (!folder) throw new Error('文件夹已不存在');
    await api('/api/folders/' + encodeURIComponent(folder.id), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: encryptedName, revision: folder.updated_at })
    });
  } else {
    await api('/api/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: crypto.randomUUID(), name: encryptedName })
    });
  }
  state.editingFolderId = null;
  els.folderNameInput.value = '';
  els.folderDialogMode.textContent = '新建文件夹';
  els.saveFolderBtn.textContent = '保存文件夹';
  await refreshFolders();
  renderFolderManager();
  setStatus('文件夹已保存');
}

/** @param {{ id: string, name: string }} folder */
async function deleteFolder(folder) {
  if (!window.confirm(`删除文件夹“${folder.name}”？其中笔记会归入未分类。`)) return;
  await api('/api/folders/' + encodeURIComponent(folder.id), { method: 'DELETE' });
  if (state.activeFolderId === folder.id) state.activeFolderId = null;
  if (state.editingFolderId === folder.id) {
    state.editingFolderId = null;
    els.folderNameInput.value = '';
    els.folderDialogMode.textContent = '新建文件夹';
    els.saveFolderBtn.textContent = '保存文件夹';
  }
  await refreshFolders();
  renderFolderManager();
  setStatus('文件夹已删除，原笔记已归入未分类');
}

function updateLoginMode() {
  const checking = state.authMode === 'checking';
  const unlockOnly = state.authMode === 'unlock' || (state.sessionAuthenticated && !state.vaultUnlocked);
  els.unlockBadge.classList.toggle('hidden', !unlockOnly);
  els.loginLogoutBtn.classList.toggle('hidden', !unlockOnly);
  els.passwordInput.disabled = checking;
  els.loginBtn.disabled = checking;
  if (checking) {
    els.loginTitle.textContent = state.loginTitle;
    els.loginDesc.textContent = '正在检查当前设备的访问状态，页面会保持在原位。';
    els.passwordInput.placeholder = '请稍候…';
    els.passwordHelp.textContent = '刷新时不再切换页面，只会显示这层锁屏。';
    els.loginBtn.textContent = '请稍候…';
    return;
  }
  els.loginTitle.textContent = unlockOnly ? '解锁' + state.appShortName : state.loginTitle;
  els.loginDesc.textContent = unlockOnly
    ? '你已经通过访问验证。现在输入密码解锁本地加密内容；刷新后不会再出现页面跳转。'
    : state.loginDescription;
  els.passwordInput.placeholder = unlockOnly ? '输入解锁密码' : '输入访问密码';
  els.passwordHelp.textContent = unlockOnly
    ? '密码只在本次页面会话中用于派生解密密钥，不再明文保存到 localStorage。'
    : '同一个密码同时用于访问站点和本地解密。';
  els.loginBtn.textContent = unlockOnly ? '解锁' + state.appShortName : '进入笔记';
}

function showTotpView() {
  state.authMode = 'totp';
  state.totpVerifying = false;
  setTotpVerificationPending(false);
  els.loginView.classList.add('hidden');
  els.totpView.classList.remove('hidden');
  els.appView.classList.add('app-dimmed');
  els.totpStatus.textContent = '';
  els.totpRecoveryPanel.classList.add('hidden');
  els.totpRecoveryInput.value = '';
  getTotpDigits().forEach(function (input) { input.value = ''; });
  const first = getTotpDigits()[0];
  if (first) first.focus();
}

function updateVaultUi() {
  els.vaultPanel.classList.add('hidden');
  els.searchInput.disabled = !state.vaultUnlocked;
  els.clearSearchBtn.disabled = !state.vaultUnlocked;
  els.newBtn.disabled = !state.vaultUnlocked;
  els.feedNewBtn.disabled = !state.vaultUnlocked;
  els.fabNewBtn.disabled = !state.vaultUnlocked;
  els.vaultPanelDesc.textContent = state.unlockError
    ? state.unlockError + '。如果你已经忘记密码，旧密文无法在页面内恢复。'
    : state.noteCountMeta > 0
      ? '你当前有 ' + state.noteCountMeta + ' 条已加密笔记。请输入密码查看内容；忘记密码将无法在页面内恢复旧密文。'
      : '当前还没有可显示的解密内容。输入密码后可正常使用。';
}

/** @param {Uint8Array} bytes */
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/** @param {string} base64 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function clearSensitiveInputs() {
  els.passwordInput.value = '';
  els.vaultUnlockInput.value = '';
  getTotpDigits().forEach(function (input) { input.value = ''; });
  els.totpRecoveryInput.value = '';
}

function clearAttachmentUrls() {
  revokeAttachmentUrls(state.attachmentUrls);
}

/** @param {string} text */
function setAttachmentStatus(text) {
  els.attachmentStatus.textContent = text;
  els.mobilePasteStatus.textContent = text;
}

async function discardAttachmentDraft() {
  const images = [...state.attachmentDraft.images];
  const deletableAttachmentIds = getUncommittedAttachmentIds(images, state.composerPostSaveRecovery);
  clearAttachmentDraft(state.attachmentDraft);
  state.pendingAttachmentIds = [];
  await Promise.allSettled(images.map(function (image) {
    return image.uploadPromise || Promise.resolve();
  }));
  await Promise.allSettled(deletableAttachmentIds.map(function (id) {
    return fetch('/api/attachments/' + encodeURIComponent(id), {
      method: 'DELETE',
      credentials: 'same-origin'
    });
  }));
}

function clearFolderState() {
  clearDecryptedFolderState(state, els.editorFolder);
  renderFolders();
}

/** @param {boolean} [discardDraft] */
function purgeVaultUi(discardDraft = true) {
  if (state.idleTimer !== null) window.clearTimeout(state.idleTimer);
  state.idleTimer = null;
  clearFolderState();
  state.vaultUnlocked = false;
  state.vaultKey = null;
  state.cryptoConfig = null;
  clearDecryptedNoteState(state);
  closeReader();
  closeComposer(discardDraft);
  closeSettings();
  closeFolderDialog();
  closeShareDialog(true);
  clearSensitiveInputs();
  renderList();
}

function endSession() {
  purgeVaultUi(false);
  clearSessionAuthState(state);
  els.loginStatus.textContent = '';
  showLogin();
  renderList();
  setStatus('');
}

/** @param {'idle' | 'logout' | 'reauth_required'} reason */
function lockVault(reason) {
  purgeVaultUi(true);
  if (reason === 'logout') clearSessionAuthState(state);
  if (reason === 'reauth_required' || reason === 'idle') {
    state.sessionAuthenticated = true;
    state.reauthRequired = true;
    state.authMode = 'unlock';
  }
  showLogin();
  setStatus(reason === 'idle' ? `已锁定：超过 ${Math.round(state.idleTimeoutSeconds / 60)} 分钟无操作，请重新验证` : '需要重新验证');
}

function scheduleIdleLock() {
  if (state.idleTimer !== null) window.clearTimeout(state.idleTimer);
  if (!state.sessionAuthenticated || !state.vaultUnlocked) return;
  state.idleTimer = window.setTimeout(function () {
    lockVault('idle');
  }, state.idleTimeoutSeconds * 1000);
}

function recordUserActivity() {
  if (state.vaultUnlocked) scheduleIdleLock();
}

/**
 * Fetches and validates the server-owned encryption parameters. Unsupported
 * versions fail visibly instead of silently writing incompatible ciphertext.
 * @returns {Promise<CryptoConfig>}
 */
async function getCryptoConfig() {
  const data = await api('/api/crypto-config');
  const config = {
    vaultSalt: String(data.vaultSalt || ''),
    cipher: String(data.cipher || ''),
    kdf: String(data.kdf || ''),
    iterations: Number(data.iterations),
    version: Number(data.version),
    keyCheck: typeof data.keyCheck === 'string' && data.keyCheck ? data.keyCheck : null
  };

  if (!config.vaultSalt) {
    throw new Error('服务器未返回加密盐值');
  }
  if (config.cipher !== 'aes-gcm-256') {
    throw new Error('暂不支持服务器指定的加密算法：' + config.cipher);
  }
  if (config.kdf !== 'pbkdf2-sha256') {
    throw new Error('暂不支持服务器指定的密钥派生算法：' + config.kdf);
  }
  if (!Number.isSafeInteger(config.iterations) || config.iterations < 100000 || config.iterations > 10000000) {
    throw new Error('服务器返回的密钥派生迭代次数无效');
  }
  if (config.version !== 1) {
    throw new Error('暂不支持加密协议版本：' + config.version);
  }

  state.cryptoConfig = /** @type {CryptoConfig} */ (config);
  return state.cryptoConfig;
}

async function refreshMeta() {
  const data = await api('/api/health');
  state.noteCountMeta = data.noteCount || 0;
  state.totpEnabled = Boolean(data.totpEnabled);
  updateTotpUi();
  updateVaultUi();
}

async function loadPublicConfig() {
  const data = await api('/api/public-config', undefined, { recordActivity: false });
  if (data.login && typeof data.login.title === 'string' && typeof data.login.description === 'string') {
    state.loginTitle = data.login.title;
    state.loginDescription = data.login.description;
  }
  if (Number.isSafeInteger(data.idleTimeoutSeconds)) state.idleTimeoutSeconds = data.idleTimeoutSeconds;
}

/** @param {{ login: { title: string, description: string }, idleTimeoutSeconds: number }} settings */
function applyAuthSettingsToForm(settings) {
  state.loginTitle = settings.login.title;
  state.loginDescription = settings.login.description;
  state.idleTimeoutSeconds = settings.idleTimeoutSeconds;
  els.loginTitleInput.value = settings.login.title;
  els.loginDescriptionInput.value = settings.login.description;
  els.idleTimeoutSelect.value = String(settings.idleTimeoutSeconds);
}

async function loadAuthSettings() {
  const data = await api('/api/auth/settings');
  applyAuthSettingsToForm(data);
}

async function saveAuthSettings() {
  const password = els.authSettingsPassword.value;
  const title = els.loginTitleInput.value;
  const description = els.loginDescriptionInput.value;
  const idleTimeoutSeconds = Number(els.idleTimeoutSelect.value);
  if (!password) throw new Error('请输入当前密码');
  const data = await api('/api/auth/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, login: { title, description }, idleTimeoutSeconds }),
  });
  applyAuthSettingsToForm(data);
  els.authSettingsPassword.value = '';
  els.authSettingsStatus.textContent = '登录设置已保存';
  if (state.vaultUnlocked) scheduleIdleLock();
}

/** @param {Array<{ deviceLabel?: string, current?: boolean, loginIp?: string, loginAt?: number|null, lastActivityAt?: number|null }>} devices */
function renderAuthDevices(devices) {
  els.authDevicesList.replaceChildren();
  if (!Array.isArray(devices) || devices.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'field-help';
    empty.textContent = '暂无登录记录';
    els.authDevicesList.appendChild(empty);
    return;
  }
  devices.forEach(function (device) {
    const row = document.createElement('div');
    row.className = 'auth-device-row';
    const title = document.createElement('strong');
    title.textContent = String(device.deviceLabel || '未知设备') + (device.current ? ' · 当前设备' : '');
    const detail = document.createElement('div');
    detail.className = 'field-help';
    detail.textContent = `${device.loginIp || 'unknown'} · 登录 ${formatDate(device.loginAt || 0)} · 最近活动 ${formatDate(device.lastActivityAt || 0)}`;
    row.append(title, detail);
    els.authDevicesList.appendChild(row);
  });
}

function updateAuthDevicesPagination() {
  const visible = state.authDevicesPreviousCursors.length > 0 || Boolean(state.authDevicesNextCursor);
  els.authDevicesPagination.classList.toggle('hidden', !visible);
  els.authDevicesPageLabel.textContent = '第 ' + (state.authDevicesPreviousCursors.length + 1) + ' 页';
  els.authDevicesPreviousBtn.disabled = state.authDevicesLoading || state.authDevicesPreviousCursors.length === 0;
  els.authDevicesNextBtn.disabled = state.authDevicesLoading || !state.authDevicesNextCursor;
}

/** @param {string | null} cursor @param {boolean} [reset] */
async function loadAuthDevices(cursor, reset) {
  if (state.authDevicesLoading) return;
  if (reset) {
    state.authDevicesCurrentCursor = null;
    state.authDevicesPreviousCursors = [];
    state.authDevicesNextCursor = null;
  }
  state.authDevicesLoading = true;
  els.authDevicesList.setAttribute('aria-busy', 'true');
  updateAuthDevicesPagination();
  try {
    const data = await api('/api/auth/devices' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
    if (!Array.isArray(data.devices)) throw new Error('服务器返回的登录记录格式无效');
    state.authDevicesCurrentCursor = cursor;
    state.authDevicesNextCursor = typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null;
    renderAuthDevices(data.devices);
  } finally {
    state.authDevicesLoading = false;
    els.authDevicesList.removeAttribute('aria-busy');
    updateAuthDevicesPagination();
  }
}

async function loadNextAuthDevices() {
  if (!state.authDevicesNextCursor || state.authDevicesLoading) return;
  const cursor = state.authDevicesNextCursor;
  state.authDevicesPreviousCursors.push(state.authDevicesCurrentCursor);
  try {
    await loadAuthDevices(cursor);
  } catch (error) {
    state.authDevicesPreviousCursors.pop();
    updateAuthDevicesPagination();
    throw error;
  }
}

async function loadPreviousAuthDevices() {
  if (state.authDevicesPreviousCursors.length === 0 || state.authDevicesLoading) return;
  const cursor = state.authDevicesPreviousCursors.pop();
  if (cursor === undefined) return;
  try {
    await loadAuthDevices(cursor);
  } catch (error) {
    state.authDevicesPreviousCursors.push(cursor);
    updateAuthDevicesPagination();
    throw error;
  }
}

els.authDevicesNextBtn.onclick = function () {
  loadNextAuthDevices().catch(function (error) {
    setStatus(error instanceof Error ? error.message : '读取下一页登录记录失败');
  });
};
els.authDevicesPreviousBtn.onclick = function () {
  loadPreviousAuthDevices().catch(function (error) {
    setStatus(error instanceof Error ? error.message : '读取上一页登录记录失败');
  });
};

/**
 * @param {string} passphrase
 * @param {CryptoConfig} config
 */
async function deriveVaultKey(passphrase, config) {
  const salt = base64ToBytes(config.vaultSalt);
  const kdfName = config.kdf === 'pbkdf2-sha256' ? 'PBKDF2' : config.kdf;
  const kdfHash = config.kdf === 'pbkdf2-sha256' ? 'SHA-256' : config.kdf;
  const cipherName = config.cipher === 'aes-gcm-256' ? 'AES-GCM' : config.cipher;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    kdfName,
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: kdfName,
      salt: salt,
      iterations: config.iterations,
      hash: kdfHash
    },
    keyMaterial,
    { name: cipherName, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * @param {unknown} value
 */
function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}

/**
 * @param {string} value
 */
async function encryptValue(value) {
  if (!state.cryptoConfig || !state.vaultKey) {
    throw new Error('加密配置尚未就绪');
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherName = state.cryptoConfig.cipher === 'aes-gcm-256'
    ? 'AES-GCM'
    : state.cryptoConfig.cipher;
  const cipher = await crypto.subtle.encrypt(
    { name: cipherName, iv: iv },
    state.vaultKey,
    new TextEncoder().encode(value || '')
  );

  return 'enc:v' + state.cryptoConfig.version + ':' + btoa(JSON.stringify({
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher))
  }));
}

/**
 * Encrypts a decrypted note with a fresh random key that is never sent to the
 * server. The proof lets the share endpoint authorize consumption without
 * learning that key.
 * @param {Note} note
 */
async function encryptShare(note) {
  const content = getSafeRecordText(note.record, note.content);
  if (content === null) throw new Error('密码记录不能分享');
  const attachments = await collectShareAttachments(note);
  return encryptSharedPayload({
    v: 1,
    title: note.title || '无标题',
    content: content,
    createdAt: note.created_at,
    sharedAt: Date.now(),
    ...(attachments.length ? { attachments: attachments } : {})
  });
}

/** @param {Note} note */
async function collectShareAttachments(note) {
  const ids = buildReaderRenderPlan(note.record || decodeNoteRecord(note.content)).attachmentIds;
  if (!ids.length) return [];
  if (!state.vaultKey) throw new Error('请先解锁内容');
  const listed = await api('/api/attachments?noteId=' + encodeURIComponent(note.id));
  const metadata = new Map((/** @type {Array<{ id: string, mime_type: string }>} */ (listed.attachments || [])).map(function (item) { return [item.id, item]; }));
  const entries = [];
  for (const id of ids) {
    const item = metadata.get(id);
    if (!item) throw new Error('分享图片缺少附件元数据');
    const response = await fetch('/api/attachments/' + encodeURIComponent(id), { credentials: 'same-origin' });
    if (!response.ok) throw new Error('分享图片读取失败');
    const plain = await decryptAttachment(await response.arrayBuffer(), item.mime_type, state.vaultKey);
    const bytes = new Uint8Array(await plain.arrayBuffer());
    entries.push({ id: id, mimeType: plain.type, ciphertext: bytesToBase64(bytes) });
    bytes.fill(0);
  }
  return entries;
}

/**
 * Keeps existing enc:v1 payloads readable while rejecting unknown versions.
 * @param {string} value
 */
async function decryptValue(value) {
  if (!isEncryptedValue(value)) return value || '';
  if (!state.cryptoConfig || !state.vaultKey) {
    throw new Error('解密配置尚未就绪');
  }

  const prefix = value.match(/^enc:v(\d+):/);
  const payloadVersion = Number(prefix && prefix[1]);
  if (!prefix || payloadVersion !== 1) {
    throw new Error('不支持的密文版本');
  }

  const payload = JSON.parse(atob(value.slice(prefix[0].length)));
  const cipherName = state.cryptoConfig.cipher === 'aes-gcm-256'
    ? 'AES-GCM'
    : state.cryptoConfig.cipher;
  const plain = await crypto.subtle.decrypt(
    { name: cipherName, iv: base64ToBytes(payload.iv) },
    state.vaultKey,
    base64ToBytes(payload.data)
  );

  return new TextDecoder().decode(plain);
}

/**
 * @param {RawNote[]} rawNotes
 * @param {boolean} [updateCounters]
 * @returns {Promise<Note[]>}
 */
async function decryptNotes(rawNotes, updateCounters = true) {
  /** @type {Note[]} */
  const decrypted = [];
  let failedCount = 0;
  let legacyPlaintextCount = 0;

  for (const note of rawNotes) {
    try {
      const encrypted = isEncryptedValue(note.title) && isEncryptedValue(note.content);
      if (!encrypted) legacyPlaintextCount += 1;
      const content = await decryptValue(note.content);
      const record = decodeNoteRecord(content);
      decrypted.push({
        id: note.id,
        title: await decryptValue(note.title),
        content: content,
        created_at: note.created_at,
        updated_at: note.updated_at,
        revision: note.revision,
        deleted_at: typeof note.deleted_at === 'number' ? note.deleted_at : null,
        encrypted: encrypted,
        decryptFailed: false,
        record: record,
        folderName: resolveFolderName(state.folderMap, record.folderId)
      });
    } catch (error) {
      failedCount += 1;
      decrypted.push({
        id: note.id,
        title: '⚠ 无法解密此笔记',
        content: '这条笔记无法使用当前密钥解密。服务器中的原始密文仍然保留；为避免覆盖，编辑、复制和删除已禁用。',
        created_at: note.created_at,
        updated_at: note.updated_at,
        revision: note.revision,
        deleted_at: typeof note.deleted_at === 'number' ? note.deleted_at : null,
        encrypted: true,
        decryptFailed: true
      });
    }
  }

  if (updateCounters) {
    state.decryptFailedCount = failedCount;
    state.legacyPlaintextCount = legacyPlaintextCount;
  }
  if (rawNotes.length > 0 && failedCount === rawNotes.length) {
    throw new Error('本地解锁密钥不正确');
  }
  return decrypted;
}

async function refreshFolders() {
  if (!state.vaultUnlocked) {
    clearFolderState();
    return;
  }

  const data = await api('/api/folders');
  if (!Array.isArray(data.folders)) {
    throw new Error('服务器返回的文件夹列表格式无效');
  }

  /** @type {Array<{ id: string, name: string, created_at: number, updated_at: number }>} */
  const encryptedFolders = data.folders.map(function (/** @type {any} */ folder) {
    if (!folder || typeof folder !== 'object' || typeof folder.id !== 'string' || typeof folder.name !== 'string' ||
      !Number.isSafeInteger(folder.created_at) || !Number.isSafeInteger(folder.updated_at)) {
      throw new Error('服务器返回的文件夹格式无效');
    }
    return {
      id: folder.id,
      name: folder.name,
      created_at: folder.created_at,
      updated_at: folder.updated_at
    };
  });
  const folders = await Promise.all(encryptedFolders.map(async function (folder) {
    return { ...folder, name: await decryptValue(folder.name) };
  }));

  state.encryptedFolders = sortFolders(encryptedFolders);
  state.folders = sortFolders(folders);
  state.folderMap = new Map(state.folders.map(function (folder) { return [folder.id, folder]; }));
  state.allNotes.forEach(function (note) {
    if (note.record) note.folderName = resolveFolderName(state.folderMap, note.record.folderId);
  });
  state.trashNotes.forEach(function (note) {
    if (note.record) note.folderName = resolveFolderName(state.folderMap, note.record.folderId);
  });
  if (typeof state.activeFolderId === 'string' && !state.folderMap.has(state.activeFolderId)) state.activeFolderId = null;
  renderFolders();
  if (!els.folderDialog.classList.contains('hidden')) renderFolderManager();
  if (!els.editorModal.classList.contains('hidden')) renderComposerFolderSelect();
  applySearch();
}

/**
 * Search is memory-only: keystrokes never trigger API requests or repeat
 * decryption work.
 * @param {Note[]} notes
 * @param {string} query
 */
function filterNotes(notes, query) {
  const q = (query || '').trim().toLocaleLowerCase('zh-CN');
  if (!q) return notes;
  return notes.filter(function (note) {
    if (note.decryptFailed) return true;
    return (note.title || '').toLocaleLowerCase('zh-CN').includes(q)
      || (note.content || '').toLocaleLowerCase('zh-CN').includes(q);
  });
}

function applySearch() {
  const source = state.trashMode ? state.trashNotes : state.allNotes;
  state.notes = filterNotes(source, els.searchInput.value).filter(function (note) {
    return state.trashMode
      ? matchesNoteFilter(note, state.activeCategory, undefined, state.folderMap)
      : matchesNoteFilter(note, state.activeCategory, state.activeFolderId, state.folderMap);
  });
  state.expandedIds.forEach(function (id) {
    if (!state.notes.find(function (note) { return note.id === id; })) {
      state.expandedIds.delete(id);
    }
  });
  renderList();
  renderFilterNav();
  renderNavigationSummary();
}

function showLogin() {
  state.authMode = state.sessionAuthenticated ? 'unlock' : 'login';
  state.totpVerifying = false;
  setTotpVerificationPending(false);
  els.loginView.classList.remove('hidden');
  els.totpView.classList.add('hidden');
  els.appView.classList.add('app-dimmed');
  updateLoginMode();
}

function showChecking() {
  state.authMode = 'checking';
  els.loginStatus.textContent = '';
  els.loginView.classList.remove('hidden');
  els.totpView.classList.add('hidden');
  els.appView.classList.add('app-dimmed');
  updateLoginMode();
}

function showApp() {
  if (state.sessionAuthenticated && state.vaultUnlocked) {
    els.loginView.classList.add('hidden');
    els.totpView.classList.add('hidden');
    els.appView.classList.remove('app-dimmed');
    els.securityPanel.classList.remove('hidden');
    scheduleIdleLock();
  } else {
    showLogin();
    els.securityPanel.classList.add('hidden');
  }
  updateVaultUi();
}

els.settingsBtn.onclick = openSettings;
els.closeSettingsBtn.onclick = closeSettings;
els.settingsBackdrop.onclick = closeSettings;
els.saveAuthSettingsBtn.onclick = function () {
  els.authSettingsStatus.textContent = '保存中…';
  saveAuthSettings().catch(function (error) {
    els.authSettingsStatus.textContent = error instanceof Error ? error.message : '保存登录设置失败';
  });
};
els.settingsLogoutBtn.onclick = function () {
  logout().catch(function (error) {
    setStatus(error instanceof Error ? error.message : '退出失败');
  });
};

els.folderNav.addEventListener('click', function (event) {
  const target = event.target instanceof HTMLElement ? event.target.closest('[data-folder-id][data-folder-category]') : null;
  if (!(target instanceof HTMLButtonElement)) return;
  const folderId = target.dataset.folderId;
  const category = target.dataset.folderCategory;
  if (!folderId || (category !== 'all' && category !== 'note' && category !== 'password')) return;
  state.trashMode = false;
  state.activeFolderId = folderId === '__uncategorized__' ? null : folderId;
  state.activeCategory = category;
  applySearch();
  if (state.workspaceMode !== 'wide') {
    closeNavigation(false);
    els.navigationBtn.focus();
  }
  els.noteListScroll.scrollTop = 0;
});
els.newFolderBtn.onclick = openFolderDialog;
els.trashNav.onclick = function () {
  if (state.editingInline) {
    setStatus('请先保存或取消当前编辑');
    return;
  }
  state.trashMode = true;
  state.activeCategory = 'all';
  state.activeFolderId = undefined;
  closeReader();
  refreshTrash().catch(function (error) {
    setStatus(error instanceof Error ? error.message : '读取最近删除失败');
  });
};
els.manageFoldersBtn.onclick = openFolderDialog;
els.closeFolderDialogBtn.onclick = closeFolderDialog;
els.cancelFolderBtn.onclick = closeFolderDialog;
els.saveFolderBtn.onclick = function () {
  saveFolder().catch(function (error) {
    setStatus(error instanceof Error ? error.message : '保存文件夹失败');
  });
};

function updateTotpUi() {
  const enrollmentOpen = !els.totpEnrollmentPanel.classList.contains('hidden');
  els.enrollTotpBtn.classList.toggle('hidden', state.totpEnabled || enrollmentOpen);
  els.disableTotpBtn.classList.toggle('hidden', !state.totpEnabled);
}

/** @param {number} ts */
function formatDate(ts) {
  if (!ts) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ts));
}

/** @param {number} ts */
/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ recordActivity?: boolean }} [behavior]
 * @returns {Promise<any>}
 */
async function api(url, options, behavior) {
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
  const data = await res.json().catch(function () { return {}; });
  if (res.status === 401) {
    if (data.error === 'reauth_required') {
      lockVault('reauth_required');
      throw new Error('需要重新验证');
    }
    endSession();
    throw new Error('请先登录');
  }
  if (!res.ok) {
    if (res.status === 409 && data.error === 'revision_conflict') {
      throw new Error('这条笔记已在其他页面更新，请刷新后再编辑');
    }
    if (res.status === 503 && data.code === 'auth_not_configured') {
      throw new Error('服务端认证尚未正确配置，请检查必需 Secrets');
    }
    throw new Error(data.error || '请求失败');
  }
  if (behavior?.recordActivity !== false) recordUserActivity();
  return data;
}

/**
 * Loads every cursor page once per refresh so local search covers the complete
 * vault, not only the first page.
 * @param {boolean} [trash]
 * @returns {Promise<RawNote[]>}
 */
async function fetchRawNotes(trash = false) {
  /** @type {RawNote[]} */
  const notes = [];
  /** @type {string | null} */
  let cursor = null;
  const seenCursors = new Set();

  do {
    const base = '?limit=10' + (trash ? '&trash=1' : '');
    const query = cursor ? base + '&cursor=' + encodeURIComponent(cursor) : base;
    const data = await api('/api/notes' + query);
    if (!Array.isArray(data.notes)) {
      throw new Error('服务器返回的笔记列表格式无效');
    }
    if (!trash && Number.isSafeInteger(data.trashCount) && data.trashCount >= 0) {
      state.trashCount = data.trashCount;
    }
    notes.push(...data.notes);

    const nextCursor = typeof data.nextCursor === 'string' && data.nextCursor
      ? data.nextCursor
      : null;
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error('服务器返回了重复的分页游标');
    }
    if (nextCursor) seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return notes;
}

function renderList() {
  els.noteList.innerHTML = '';
  const folderName = typeof state.activeFolderId === 'string' ? state.folderMap.get(state.activeFolderId)?.name || '未分类' : '未分类';
  const categoryLabel = state.activeCategory === 'note' ? ' · 笔记' : state.activeCategory === 'password' ? ' · 密码' : '';
  els.listTitle.textContent = state.trashMode ? '最近删除' : folderName + categoryLabel;
  els.noteCount.textContent = state.notes.length ? ('共 ' + state.notes.length + ' 条') : '0 条';
  if (!state.trashMode && state.decryptFailedCount > 0) {
    els.noteCount.textContent += ' · ' + state.decryptFailedCount + ' 条无法解密';
  }
  if (!state.trashMode && state.legacyPlaintextCount > 0) {
    els.noteCount.textContent += ' · ' + state.legacyPlaintextCount + ' 条待加密';
  }

  if (!state.vaultUnlocked) {
    els.noteCount.textContent = state.noteCountMeta ? ('共 ' + state.noteCountMeta + ' 条（已加密）') : '0 条';
    els.noteList.innerHTML = '<div class="empty-feed">正文已加密。登录站点后，再输入本地解锁密钥才能看到内容和搜索结果。</div>';
    return;
  }

  if (!state.notes.length) {
    els.noteList.innerHTML = state.trashMode
      ? '<div class="empty-feed">最近删除中没有记录。</div>'
      : '<div class="empty-feed">现在还没有笔记。点击右上角“新建笔记”，写第一条就行。</div>';
    return;
  }

  if (!state.trashMode && state.decryptFailedCount > 0) {
    const warning = document.createElement('div');
    warning.className = 'decrypt-warning';
    warning.setAttribute('role', 'alert');
    warning.textContent = '有 ' + state.decryptFailedCount + ' 条笔记无法解密，已保留占位且不会被静默隐藏。请确认密码和加密配置后再处理。';
    els.noteList.appendChild(warning);
  }
  if (!state.trashMode && state.legacyPlaintextCount > 0) {
    const warning = document.createElement('div');
    warning.className = 'decrypt-warning';
    warning.setAttribute('role', 'status');
    warning.textContent = '有 ' + state.legacyPlaintextCount + ' 条历史笔记仍包含旧版明文。逐条打开并保存后会转换为客户端密文。';
    els.noteList.appendChild(warning);
  }

  sortVisibleNotes(state.notes, state.sortKey).forEach(function (note) {
    const record = note.record || decodeNoteRecord(note.content);
    const viewModel = buildNoteCardViewModel({
      title: note.title,
      record: record,
      folder: note.folderName,
      createdAt: note.created_at,
      updatedAt: note.updated_at
    });
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'note-list-row' + (note.decryptFailed ? ' decrypt-failed' : '');
    row.dataset.noteId = note.id;
    row.disabled = note.decryptFailed;

    const title = document.createElement('div');
    title.className = 'note-row-title';
    buildHighlightedTextSegments(viewModel.title, els.searchInput.value).forEach(function (segment) {
      if (!segment.highlighted) {
        title.append(document.createTextNode(segment.text));
        return;
      }
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = segment.text;
      title.append(mark);
    });

    const snippet = document.createElement('div');
    snippet.className = 'note-row-snippet' + (viewModel.snippet ? '' : ' is-empty');
    snippet.textContent = viewModel.snippet || '这条笔记还没有内容。';

    const labels = document.createElement('div');
    labels.className = 'note-row-labels';
    const type = document.createElement('span');
    type.className = 'note-row-label';
    type.textContent = viewModel.type === 'password' ? '密码' : '笔记';
    const folder = document.createElement('span');
    folder.className = 'note-row-label';
    folder.textContent = viewModel.folder;
    labels.append(type, folder);

    const dates = document.createElement('div');
    dates.className = 'note-row-dates';
    const updated = document.createElement('span');
    updated.textContent = state.trashMode && typeof note.deleted_at === 'number'
      ? '删除 ' + formatDate(note.deleted_at)
      : '更新 ' + formatDate(viewModel.updatedAt);
    const created = document.createElement('span');
    created.textContent = '创建 ' + formatDate(viewModel.createdAt);
    dates.append(updated, created);

    row.append(title, snippet, labels, dates);
    row.onclick = function () {
      openReader(note.id).catch(function (error) { setStatus(error.message || '打开笔记失败'); });
    };
    els.noteList.appendChild(row);
  });
  syncSelectedNoteRow();
}

function syncSelectedNoteRow() {
  els.noteList.querySelectorAll('[data-note-id]').forEach(function (element) {
    const selected = element instanceof HTMLElement && element.dataset.noteId === state.readerNoteId;
    element.classList.toggle('is-selected', selected);
    if (selected) element.setAttribute('aria-current', 'true');
    else element.removeAttribute('aria-current');
  });
}

async function refreshNotes() {
  if (!state.vaultUnlocked) {
    state.notes = [];
    state.allNotes = [];
    state.trashNotes = [];
    state.trashCount = 0;
    state.trashMode = false;
    state.decryptFailedCount = 0;
    state.legacyPlaintextCount = 0;
    await refreshMeta();
    renderList();
    return;
  }

  state.allNotes = await decryptNotes(await fetchRawNotes());
  state.noteCountMeta = state.allNotes.length;
  updateVaultUi();
  applySearch();
}

async function refreshTrash() {
  if (!state.vaultUnlocked) {
    state.trashNotes = [];
    state.trashCount = 0;
    applySearch();
    return;
  }
  state.trashNotes = await decryptNotes(await fetchRawNotes(true), false);
  state.trashCount = state.trashNotes.length;
  applySearch();
}

/** @param {'note' | 'password'} recordType */
function updateComposerRecordType(recordType) {
  const password = recordType === 'password';
  state.editorRecordType = recordType;
  els.editorTitle.classList.remove('hidden');
  els.editorCard.classList.toggle('is-document-composer', !password);
  els.passwordEditorFields.classList.toggle('hidden', !password);
  els.editorContent.classList.add('hidden');
  els.documentEditor.classList.toggle('hidden', password);
  els.editorPreview.classList.add('hidden');
  els.editorToolbar.classList.toggle('hidden', password);
  els.attachmentStatus.classList.toggle('hidden', password);
  els.mobilePasteStatus.classList.toggle('hidden', password);
  if (password) renderPasswordEditorFields();
}

function renderPasswordEditorFields() {
  renderPasswordEditor(els.passwordEditorFields, state.editorPasswordFields, function (fields) {
    state.editorPasswordFields = fields;
    renderPasswordEditorFields();
  });
}

function getComposerSnapshot() {
  return createComposerDraftSnapshot({
    recordType: state.editorRecordType,
    title: els.editorTitle.value,
    folderId: state.editorFolderId,
    fields: state.editorPasswordFields,
    markdown: state.editorRecordType === 'password' ? '' : getEditorSourceMarkdown(),
    pendingCount: state.attachmentDraft.images.length,
  });
}

function markEditorSourceDirty() {
  state.editorSourceDirty = true;
}

function getEditorSourceMarkdown() {
  if (!state.editorSourceDirty) return state.editorSourceMarkdown;
  state.editorSourceMarkdown = serializeEditorMarkdown(els.documentEditor);
  state.editorSourceDirty = false;
  return state.editorSourceMarkdown;
}

/** @param {string} text */
function setComposerSaveStatus(text) {
  els.composerSaveStatus.textContent = text;
}

function renderComposerFolderSelect() {
  const model = buildComposerFolderChoices(state.folders, state.editorFolderId);
  state.editorFolderId = model.selectedId;
  els.editorFolder.replaceChildren(...model.choices.map(function (choice) {
    const option = document.createElement('option');
    option.value = choice.id || '';
    option.textContent = choice.name;
    option.selected = choice.id === model.selectedId;
    return option;
  }));
}

/** @param {any} record */
function renderPasswordReaderFields(record) {
  if (!record || record.type !== 'password' || !Array.isArray(record.fields)) throw new Error('无效的密码记录');
  renderPasswordReader(els.passwordFields, record, navigator.clipboard, setStatus);
}

/** @param {Note | null} note */
function openComposer(note) {
  clearAttachmentDraft(state.attachmentDraft);
  state.composerPostSaveRecovery = null;
  state.editingId = note ? note.id : null;
  state.editorMode = 'source';
  state.pendingAttachmentIds = [];
  const record = note ? (note.record || decodeNoteRecord(note.content)) : null;
  const recordType = record?.type === 'password' || (!note && state.activeCategory === 'password') ? 'password' : 'note';
  state.editorFolderId = note
    ? (typeof record?.folderId === 'string' ? record.folderId : null)
    : (typeof state.activeFolderId === 'string' ? state.activeFolderId : null);
  state.editorPasswordFields = recordType === 'password' && Array.isArray(record?.fields)
    ? record.fields.map(function (/** @type {{ id: string, type: 'text' | 'secret' | 'multiline', label: string, value: string }} */ field) { return { ...field }; })
    : createDefaultPasswordFields();
  els.modalTitle.textContent = note ? (recordType === 'password' ? '编辑密码' : '编辑笔记') : (recordType === 'password' ? '新建密码' : '新建笔记');
  els.editorTitle.value = note ? String(note.title || record?.title || '') : '';
  const markdown = recordType === 'note' && record?.type === 'note' ? record.markdown : '';
  state.editorSourceMarkdown = markdown;
  state.editorSourceDirty = false;
  els.editorContent.value = markdown;
  renderComposerFolderSelect();
  updateComposerRecordType(recordType);
  if (recordType === 'note') {
    const attachmentMap = new Map(extractAttachmentIds(markdown).map(function (id) { return [id, `attachment://${id}`]; }));
    loadEditorMarkdown(els.documentEditor, markdown, attachmentMap, state.attachmentDraft.pendingAttachments);
  } else {
    els.documentEditor.replaceChildren();
  }
  setAttachmentStatus('');
  state.editingInline = Boolean(note && recordType === 'note');
  if (state.editingInline) {
    els.readerDocument.classList.add('hidden');
    els.readerEditor.appendChild(els.editorCard);
    els.readerEditor.classList.remove('hidden');
    els.readerDetail.classList.add('is-editing');
    els.editorCard.classList.add('reader-editor-card');
    els.editorModal.classList.add('hidden');
  } else {
    els.editorModal.appendChild(els.editorCard);
    els.editorCard.classList.remove('reader-editor-card');
    els.editorModal.classList.remove('hidden');
  }
  updateModalUi();
  state.composerInitialSnapshot = getComposerSnapshot();
  setComposerSaveStatus('');
  focusComposerPrimaryField(recordType, els.editorTitle, els.passwordEditorFields);
}

/** @param {boolean} [discardDraft] */
function closeComposer(discardDraft = true) {
  if (discardDraft) void discardAttachmentDraft();
  else {
    clearAttachmentDraft(state.attachmentDraft);
    state.pendingAttachmentIds = [];
  }
  if (state.editingInline) {
    els.readerEditor.classList.add('hidden');
    els.editorModal.appendChild(els.editorCard);
    els.editorCard.classList.remove('reader-editor-card');
    els.readerDocument.classList.remove('hidden');
    els.readerDetail.classList.remove('is-editing');
  }
  els.editorModal.classList.add('hidden');
  state.editingInline = false;
  state.editingId = null;
  state.composerPostSaveRecovery = null;
  state.editorPasswordFields = [];
  state.editorFolderId = null;
  state.editorSourceMarkdown = '';
  state.editorSourceDirty = false;
  state.composerInitialSnapshot = null;
  els.editorTitle.value = '';
  els.editorContent.value = '';
  els.documentEditor.replaceChildren();
  els.passwordEditorFields.replaceChildren();
  els.editorPreview.replaceChildren();
  setAttachmentStatus('');
  setComposerSaveStatus('');
  updateModalUi();
}

function prepareInlineReaderOpen() {
  if (!state.editingInline) return;
  els.readerEditor.classList.add('hidden');
  els.editorModal.appendChild(els.editorCard);
  els.editorCard.classList.remove('reader-editor-card');
  els.readerDocument.classList.remove('hidden');
  els.readerDetail.classList.remove('is-editing');
  els.editorModal.classList.add('hidden');
  state.editingInline = false;
  updateModalUi();
}

function restoreInlineComposer() {
  if (state.editingInline) return;
  els.readerDocument.classList.add('hidden');
  els.readerEditor.appendChild(els.editorCard);
  els.readerEditor.classList.remove('hidden');
  els.readerDetail.classList.add('is-editing');
  els.editorCard.classList.add('reader-editor-card');
  els.editorModal.classList.add('hidden');
  state.editingInline = true;
  updateModalUi();
}

function requestCloseComposer() {
  if (state.composerSaving) return;
  if (state.composerInitialSnapshot !== null && state.composerInitialSnapshot !== getComposerSnapshot() && !confirm('放弃未保存内容吗？')) return;
  closeComposer();
}

/** @param {string} noteId */
async function openReader(noteId) {
  if (state.editingInline) throw new Error('请先保存或取消当前编辑');
  const source = state.trashMode ? state.trashNotes : state.allNotes;
  const note = source.find(function (item) { return item.id === noteId; });
  if (!note || note.decryptFailed) throw new Error('找不到可阅读的笔记');
  if (!state.vaultKey) throw new Error('请先解锁内容');
  const vaultKey = state.vaultKey;
  const operationId = state.readerOperation.begin();
  clearAttachmentUrls();
  state.listScrollTop = els.noteListScroll.scrollTop;
  state.hasListScrollSnapshot = true;
  state.readerNoteId = noteId;
  syncWorkspacePresentation();
  syncSelectedNoteRow();
  const record = note.record || decodeNoteRecord(note.content);
  const actions = state.trashMode ? getTrashReaderActionModel() : getReaderActionModel(record);
  els.readerTitle.textContent = note.title || '无标题';
  els.readerPath.textContent = (state.trashMode ? '最近删除 / ' : '') + (record.type === 'password' ? '密码' : '笔记') + ' / ' + (note.folderName || '未分类');
  els.readerMeta.textContent = state.trashMode && typeof note.deleted_at === 'number'
    ? '删除 ' + formatDate(getTrashRowMeta(note).primaryTime) + ' · 原更新 ' + formatDate(note.updated_at)
    : '创建 ' + formatDate(note.created_at) + ' · 更新 ' + formatDate(note.updated_at);
  els.readerStandardActions.classList.toggle('hidden', state.trashMode);
  els.readerTrashActions.classList.toggle('hidden', !state.trashMode);
  els.readerCopyBtn.classList.toggle('hidden', !actions.copyVisible);
  els.readerShareBtn.classList.toggle('hidden', !actions.shareVisible);
  els.readerEditBtn.classList.toggle('hidden', !actions.editVisible);
  els.readerRestoreBtn.classList.toggle('hidden', !actions.restoreVisible);
  els.readerPermanentDeleteBtn.classList.toggle('hidden', !actions.permanentDeleteVisible);
  els.readerMoreMenu.classList.add('hidden');
  els.readerMoreBtn.setAttribute('aria-expanded', 'false');
  els.readerContent.replaceChildren();
  els.readerContent.classList.remove('hidden');
  els.passwordFields.replaceChildren();
  els.passwordFields.classList.add('hidden');
  els.readerEmptyState.classList.add('hidden');
  els.readerDetail.classList.remove('hidden');
  els.readerView.scrollTop = 0;
  updateScrollUi();
  const plan = buildReaderRenderPlan(record);
  if (!plan.renderMarkdown) {
    els.readerContent.classList.add('hidden');
    els.passwordFields.classList.remove('hidden');
    renderPasswordReaderFields(record);
    return;
  }

  const attachmentMap = new Map();
  if (plan.attachmentIds.length) {
    const listed = await api('/api/attachments?noteId=' + encodeURIComponent(note.id));
    if (!state.readerOperation.isCurrent(operationId) || state.readerNoteId !== noteId || state.vaultKey !== vaultKey) return;
    const allowed = new Map((/** @type {Array<{ id: string, mime_type: string }>} */ (listed.attachments || [])).map(function (item) { return [item.id, item]; }));
    for (const id of plan.attachmentIds) {
      if (!state.readerOperation.isCurrent(operationId) || state.readerNoteId !== noteId || state.vaultKey !== vaultKey) return;
      const metadata = allowed.get(id);
      if (!metadata) continue;
      try {
        const response = await fetch('/api/attachments/' + encodeURIComponent(id), { credentials: 'same-origin' });
        if (!state.readerOperation.isCurrent(operationId) || state.readerNoteId !== noteId || state.vaultKey !== vaultKey) return;
        if (!response.ok) throw new Error('attachment unavailable');
        const ciphertext = await response.arrayBuffer();
        if (!state.readerOperation.isCurrent(operationId) || state.readerNoteId !== noteId || state.vaultKey !== vaultKey) return;
        const blob = await decryptAttachment(ciphertext, metadata.mime_type, vaultKey);
        if (!state.readerOperation.isCurrent(operationId) || state.readerNoteId !== noteId || state.vaultKey !== vaultKey) return;
        const url = URL.createObjectURL(blob);
        state.attachmentUrls.add(url);
        attachmentMap.set(id, url);
      } catch {
        // Text remains visible; an unavailable image is simply omitted.
      }
    }
  }
  if (!state.readerOperation.isCurrent(operationId) || state.readerNoteId !== noteId || state.vaultKey !== vaultKey) return;
  els.readerContent.append(renderMarkdown(plan.markdown, attachmentMap));
}

function closeReader() {
  if (state.editingInline) {
    setStatus('请先保存或取消当前编辑');
    return;
  }
  state.readerOperation.cancel();
  clearAttachmentUrls();
  els.readerEmptyState.classList.remove('hidden');
  els.readerDetail.classList.add('hidden');
  els.readerMoreMenu.classList.add('hidden');
  els.readerMoreBtn.setAttribute('aria-expanded', 'false');
  els.readerStandardActions.classList.remove('hidden');
  els.readerTrashActions.classList.add('hidden');
  els.readerTitle.textContent = '';
  els.readerPath.textContent = '';
  els.readerMeta.textContent = '';
  els.readerContent.replaceChildren();
  els.passwordFields.replaceChildren();
  const restore = state.hasListScrollSnapshot ? state.listScrollTop : null;
  state.hasListScrollSnapshot = false;
  state.readerNoteId = null;
  syncWorkspacePresentation();
  syncSelectedNoteRow();
  if (restore !== null) window.requestAnimationFrame(function () {
    els.noteListScroll.scrollTop = restore;
    updateScrollUi();
  });
}

function getCurrentReaderNote() {
  const source = state.trashMode ? state.trashNotes : state.allNotes;
  return state.readerNoteId
    ? source.find(function (note) { return note.id === state.readerNoteId; }) || null
    : null;
}

async function copyCurrentReaderNote() {
  const note = getCurrentReaderNote();
  if (!note || note.decryptFailed) throw new Error('找不到可复制的笔记');
  const text = getSafeRecordText(note.record, note.content);
  if (text === null) throw new Error('密码记录请逐字段复制');
  await navigator.clipboard.writeText(text);
  setStatus('已复制：' + (note.title || '无标题'));
}

/** @param {ReturnType<typeof addPendingImage>} pending */
async function uploadPendingEditorImage(pending) {
  const noteId = state.editingId || state.attachmentDraft.noteId;
  if (!noteId || !state.vaultKey) throw new Error('请先解锁内容');
  const encrypted = await encryptAttachment(pending.blob, state.vaultKey);
  /** @type {Record<string, string>} */
  const headers = {
    'content-type': 'application/octet-stream',
    'x-note-id': noteId,
    'x-mime-type': encrypted.mimeType,
    'content-length': String(encrypted.byteLength)
  };
  if (!state.editingId) headers['x-note-draft'] = '1';
  const response = await api('/api/attachments', {
    method: 'POST',
    headers: headers,
    body: encrypted.ciphertext
  });
  const id = String(response.attachment.id);
  pending.attachmentId = id;
  state.pendingAttachmentIds.push(id);
  markEditorSourceDirty();
}

/** @param {Blob} image */
function queueEditorImage(image) {
  if (!state.vaultKey) throw new Error('请先解锁内容');
  if (!state.editingId && !state.attachmentDraft.noteId) state.attachmentDraft.noteId = crypto.randomUUID();
  const pending = addPendingImage(state.attachmentDraft, image);
  const imageElement = document.createElement('img');
  imageElement.src = pending.url;
  imageElement.alt = '图片';
  imageElement.setAttribute('data-markdown-src', pending.token);
  const selection = window.getSelection();
  if (selection && selection.rangeCount) {
    const range = selection.getRangeAt(0);
    if (els.documentEditor.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(imageElement);
      range.setStartAfter(imageElement);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      els.documentEditor.append(imageElement);
    }
  } else {
    els.documentEditor.append(imageElement);
  }
  markEditorSourceDirty();
  setAttachmentStatus(`正在浏览器加密并上传 ${state.attachmentDraft.images.length} 张图片…`);
  const upload = uploadPendingEditorImage(pending);
  pending.uploadPromise = upload;
  upload.then(function () {
    if (!state.attachmentDraft.images.includes(pending)) return;
    const uploaded = state.attachmentDraft.images.filter(function (item) { return item.attachmentId; }).length;
    setAttachmentStatus(`${uploaded} 张图片已加密上传，保存笔记后完成关联。`);
  }).catch(function (error) {
    pending.error = error;
    if (!state.attachmentDraft.images.includes(pending)) return;
    setAttachmentStatus(error instanceof Error ? error.message : '图片上传失败');
  });
}

async function saveComposer() {
  if (state.composerSaving) return;
  const savingHost = state.editingInline ? els.readerEditor : els.editorModal;
  const releaseSaving = beginComposerSaving(state, {
    saveButton: els.saveBtn,
    cancelButton: els.cancelBtn,
    host: savingHost,
  });
  setComposerSaveStatus('保存中…');
  try {
  const password = state.editorRecordType === 'password';
  const rawTitle = els.editorTitle.value.trim();
  await Promise.all(state.attachmentDraft.images.map(function (image) {
    if (image.error) throw image.error;
    return image.uploadPromise || Promise.resolve();
  }));
  let markdown = password ? '' : getEditorSourceMarkdown();
  els.editorContent.value = markdown;
  if (!password) {
    for (const image of state.attachmentDraft.images) {
      if (!image.attachmentId) throw new Error('图片尚未上传完成');
      markdown = replacePendingToken(markdown, image.token, image.attachmentId);
    }
  }
  if (!rawTitle && !markdown) throw new Error('标题和内容至少写一个');
  if (!state.vaultUnlocked || !state.vaultKey) {
    throw new Error('请先输入本地解锁密钥');
  }

  const title = rawTitle || '无标题';
  const passwordPayload = password ? buildPasswordSavePayload(title, state.editorPasswordFields, state.editorFolderId) : null;

  setStatus('保存中…');

  const content = passwordPayload ? passwordPayload.content : buildNoteSaveContent(markdown, state.editorFolderId);
  const encryptedTitle = await encryptValue(title);
  const encryptedContent = await encryptValue(content);
  const attachmentIds = password ? [] : extractAttachmentIds(markdown);

  let data;
  if (state.editingId) {
    const currentNote = getComposerRetryNote(state.editingId, state.allNotes, state.composerPostSaveRecovery);
    if (!currentNote) {
      throw new Error('找不到待编辑的笔记，请刷新后重试');
    }
    data = await api('/api/notes/' + encodeURIComponent(state.editingId), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: encryptedTitle,
        content: encryptedContent,
        revision: currentNote.revision,
        attachmentIds: attachmentIds
      })
    });
  } else {
    data = await api('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: state.attachmentDraft.noteId || undefined,
        title: encryptedTitle,
        content: encryptedContent,
        attachmentIds: attachmentIds
      })
    });
  }

  const savedNote = data && data.note;
  const committedNoteId = savedNote && typeof savedNote.id === 'string'
    ? savedNote.id
    : state.editingId || state.attachmentDraft.noteId;
  const committedRevision = savedNote ? Number(savedNote.revision) : NaN;
  if (!committedNoteId || !Number.isSafeInteger(committedRevision) || committedRevision < 1) {
    throw new Error('服务器保存响应格式无效');
  }
  state.editingId = committedNoteId;
  state.editorSourceMarkdown = markdown;
  state.editorSourceDirty = false;
  state.composerPostSaveRecovery = state.composerPostSaveRecovery
    ? updateComposerSaveRecovery(state.composerPostSaveRecovery, { id: committedNoteId, revision: committedRevision }, attachmentIds)
    : createComposerSaveRecovery({
      noteId: committedNoteId,
      revision: committedRevision,
      attachmentIds,
    });
  markComposerSaveCommitted(state, getComposerSnapshot());

  const reopenReaderId = state.editingInline ? state.editingId : null;
  await completeComposerSave({
    refreshNotes,
    openReader,
    closeComposer,
    reopenReaderId,
    prepareReaderOpen: prepareInlineReaderOpen,
    restoreComposer: restoreInlineComposer,
  });
  setStatus('已保存');
  setComposerSaveStatus('');
  } catch (error) {
    setComposerSaveStatus(error instanceof Error ? error.message : '保存失败');
    throw error;
  } finally {
    releaseSaving();
  }
}

/** @param {string} id */
async function deleteNote(id) {
  if (!id) {
    setStatus('当前没有可删除的记录');
    return;
  }
  if (!confirm('确定删除这条笔记吗？')) return;

  const currentNote = state.allNotes.find(function (note) {
    return note.id === id;
  });
  if (!currentNote) throw new Error('找不到待删除的笔记，请刷新后重试');

  await api('/api/notes/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: { 'if-match': String(currentNote.revision) }
  });

  await refreshNotes();
  setStatus('已移入最近删除');
}

/** @param {Note} note */
async function restoreNote(note) {
  await api('/api/notes/' + encodeURIComponent(note.id) + '/restore', {
    method: 'POST',
    headers: { 'if-match': String(note.revision) }
  });
  closeReader();
  await refreshNotes();
  await refreshTrash();
  setStatus('已恢复笔记');
}

/** @param {Note} note */
async function permanentlyDeleteNote(note) {
  if (!confirm('永久删除这条笔记及其附件？此操作无法恢复。')) return;
  await api('/api/notes/' + encodeURIComponent(note.id) + '/permanent', {
    method: 'DELETE',
    headers: { 'if-match': String(note.revision) }
  });
  closeReader();
  await refreshNotes();
  await refreshTrash();
  setStatus('已永久删除');
}

/** @param {Note} note */
function openShareDialog(note) {
  if (note.decryptFailed) {
    setStatus('无法分享未成功解密的笔记');
    return;
  }
  if (state.shareCreating) {
    setStatus('上一条分享链接仍在创建，请稍候');
    return;
  }
  const activeElement = document.activeElement;
  state.shareReturnFocus = activeElement instanceof HTMLElement ? activeElement : null;
  state.shareOperationId += 1;
  state.sharingNoteId = note.id;
  els.shareNoteLabel.textContent = '分享“' + (note.title || '无标题') + '”';
  els.shareExpiry.value = '86400';
  els.shareSetup.classList.remove('hidden');
  els.shareResult.classList.add('hidden');
  els.shareLinkInput.value = '';
  els.shareExpiryLabel.textContent = '';
  els.createShareBtn.classList.remove('hidden');
  els.createShareBtn.disabled = false;
  els.createShareBtn.textContent = '创建一次性链接';
  els.cancelShareBtn.textContent = '取消';
  els.shareModal.classList.remove('hidden');
  els.shareModal.setAttribute('aria-hidden', 'false');
  updateModalUi();
  els.shareExpiry.focus();
}

/** @param {boolean} [force] */
function closeShareDialog(force) {
  if (state.shareCreating && !force) {
    setStatus('链接正在创建，请稍候');
    return;
  }
  const returnFocus = state.shareReturnFocus;
  state.shareOperationId += 1;
  setShareCreating(false);
  els.shareModal.classList.add('hidden');
  els.shareModal.setAttribute('aria-hidden', 'true');
  els.shareLinkInput.value = '';
  els.shareResult.classList.add('hidden');
  state.sharingNoteId = null;
  state.shareReturnFocus = null;
  updateModalUi();
  if (!force && returnFocus && returnFocus.isConnected) returnFocus.focus();
}

/** @param {boolean} creating */
function setShareCreating(creating) {
  state.shareCreating = creating;
  els.shareExpiry.disabled = creating;
  els.closeShareModalBtn.disabled = creating;
  els.cancelShareBtn.disabled = creating;
  els.createShareBtn.disabled = creating;
  els.createShareBtn.textContent = creating ? '加密并创建中…' : '创建一次性链接';
  if (creating) {
    els.shareModal.setAttribute('aria-busy', 'true');
    els.shareModal.focus();
  } else {
    els.shareModal.removeAttribute('aria-busy');
  }
}

/** @param {number} operationId @param {string} noteId */
function isCurrentShareOperation(operationId, noteId) {
  return operationId === state.shareOperationId &&
    noteId === state.sharingNoteId &&
    !els.shareModal.classList.contains('hidden');
}

/**
 * A forced close is not exposed in the UI, but if another application action
 * invalidates a completed request, consume its newly-created record so it
 * cannot remain as an unreachable orphan.
 * @param {string} token
 * @param {string} proof
 */
async function discardStaleShare(token, proof) {
  try {
    await fetch('/api/shares/' + encodeURIComponent(token) + '/consume', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proof: proof })
    });
  } catch {
    // Best effort only: closing the page can still interrupt any browser request.
  }
}

async function createShareLink() {
  const note = state.allNotes.find(function (item) {
    return item.id === state.sharingNoteId;
  });
  if (!note || note.decryptFailed) throw new Error('找不到可分享的已解密笔记');

  const expiresInSeconds = Number(els.shareExpiry.value);
  if (![3600, 86400, 604800].includes(expiresInSeconds)) {
    throw new Error('请选择有效的链接期限');
  }

  const noteId = note.id;
  const operationId = ++state.shareOperationId;
  setShareCreating(true);
  try {
    const encrypted = await encryptShare(note);
    const data = await api('/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ciphertext: encrypted.ciphertext,
        proof: encrypted.proof,
        expiresInSeconds: expiresInSeconds
      })
    });
    const token = String(data.token || '');
    const expiresAt = Number(data.expiresAt);
    if (!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(token) || !Number.isSafeInteger(expiresAt)) {
      throw new Error('服务器返回的分享信息无效');
    }

    if (!isCurrentShareOperation(operationId, noteId)) {
      await discardStaleShare(token, encrypted.proof);
      return;
    }

    const shareUrl = new URL('/share', window.location.origin);
    shareUrl.searchParams.set('t', token);
    shareUrl.hash = encrypted.keyFragment;
    els.shareLinkInput.value = shareUrl.toString();
    els.shareExpiryLabel.textContent = '最晚有效至 ' + formatDate(expiresAt) + '；首次主动查看后立即失效。';
    els.shareSetup.classList.add('hidden');
    els.shareResult.classList.remove('hidden');
    els.createShareBtn.classList.add('hidden');
    els.cancelShareBtn.textContent = '完成';
    els.copyShareLinkBtn.focus();
    setStatus('一次性分享链接已创建');
  } catch (error) {
    if (!isCurrentShareOperation(operationId, noteId)) return;
    throw error;
  } finally {
    if (isCurrentShareOperation(operationId, noteId)) setShareCreating(false);
  }
}

async function copyShareLink() {
  const link = els.shareLinkInput.value;
  if (!link) throw new Error('请先创建分享链接');
  try {
    await navigator.clipboard.writeText(link);
    setStatus('分享链接已复制');
  } catch {
    els.shareLinkInput.focus();
    els.shareLinkInput.select();
    setStatus('请手动复制已选中的链接');
  }
}

/**
 * @param {CryptoConfig} config
 */
async function verifyKeyCheck(config) {
  if (!config.keyCheck) return;
  try {
    const marker = await decryptValue(config.keyCheck);
    if (marker !== KEY_CHECK_MARKER) {
      throw new Error('marker mismatch');
    }
  } catch (error) {
    throw new Error('当前密码无法通过密钥校验');
  }
}

/**
 * Initializes the set-once key check only after a real login and successful
 * loading of existing notes.
 * @param {CryptoConfig} config
 */
async function initializeKeyCheck(config) {
  const encryptedMarker = await encryptValue(KEY_CHECK_MARKER);
  let data;
  try {
    data = await api('/api/crypto-config/key-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyCheck: encryptedMarker })
    });
  } catch (error) {
    throw new Error('无法初始化密钥校验标记。请确认后端已升级，然后退出当前会话并重新登录');
  }

  if (typeof data.keyCheck !== 'string' || !data.keyCheck) {
    throw new Error('服务器未返回有效的密钥校验标记');
  }
  config.keyCheck = data.keyCheck;
  await verifyKeyCheck(config);
}

/**
 * @param {string} passphrase
 * @param {boolean} allowKeyCheckInit
 */
async function unlockVault(passphrase, allowKeyCheckInit) {
  if (!passphrase) {
    throw new Error('请输入密码');
  }

  const config = await getCryptoConfig();
  if (!config.keyCheck && !allowKeyCheckInit) {
    throw new Error('当前会话尚未建立密钥校验标记。请退出当前会话后重新登录');
  }

  state.vaultKey = await deriveVaultKey(passphrase, config);
  try {
    await verifyKeyCheck(config);
    state.vaultUnlocked = true;
    state.unlockError = '';
    await refreshFolders();
    await refreshNotes();

    if (!config.keyCheck) {
      if (state.decryptFailedCount > 0) {
        throw new Error('旧笔记未能全部解密，已停止初始化密钥校验标记');
      }
      await initializeKeyCheck(config);
    }
  } catch (error) {
    state.vaultUnlocked = false;
    state.vaultKey = null;
    throw error;
  }
}

/** @param {string} password */
async function beginTwoFactorLogin(password) {
  const data = await api('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: password })
  });
  if (data.code !== 'two_factor_required' || typeof data.challengeId !== 'string') throw new Error('服务器未返回有效的二次验证挑战');
  state.pendingLoginChallenge = data.challengeId;
  state.pendingLoginPassword = password;
  showTotpView();
}

function getPendingTotpCode() {
  if (!els.totpRecoveryPanel.classList.contains('hidden')) return els.totpRecoveryInput.value.trim();
  return getTotpDigits().map(function (input) { return normalizeTotpInput(input.value); }).join('');
}

async function verifyPendingTotp() {
  if (!state.pendingLoginChallenge || !state.pendingLoginPassword) throw new Error('二次验证挑战已失效，请重新登录');
  if (state.totpVerifying) return;
  state.totpVerifying = true;
  setTotpVerificationPending(true);
  try {
    const code = getPendingTotpCode();
    const data = await api('/api/login/totp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: state.pendingLoginChallenge, code: code })
    });
    if (!data.ok) throw new Error('验证码无效');
    const password = state.pendingLoginPassword;
    state.pendingLoginChallenge = null;
    state.pendingLoginPassword = '';
    state.sessionAuthenticated = true;
    await unlockVault(password, true);
    clearSensitiveInputs();
    showApp();
    setStatus('已通过 Authenticator 验证');
  } finally {
    state.totpVerifying = false;
    setTotpVerificationPending(false);
  }
}

function submitTotpWhenComplete() {
  if (!els.totpRecoveryPanel.classList.contains('hidden')) return;
  if (!getCompleteTotpCode(getTotpDigits())) return;
  verifyPendingTotp().catch(function (error) {
    els.totpStatus.textContent = error instanceof Error ? error.message : '验证码无效';
  });
}

async function enrollTotp() {
  const password = window.prompt('请输入当前密码以绑定 Authenticator');
  if (!password) return;
  const data = await api('/api/auth/totp/enroll', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: password })
  });
  els.totpSecretLabel.textContent = String(data.secret || '');
  els.totpRecoveryCodes.value = '';
  els.totpEnrollmentPanel.classList.remove('hidden');
  els.securityPanelStatus.textContent = '请先在 Authenticator 中添加密钥，再输入当前验证码确认。';
  updateTotpUi();
}

async function confirmTotpEnrollment() {
  const code = window.prompt('请输入 Authenticator 当前验证码');
  if (!code) return;
  const data = await api('/api/auth/totp/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code })
  });
  state.totpEnabled = true;
  els.totpRecoveryCodes.value = Array.isArray(data.recoveryCodes) ? data.recoveryCodes.join('\n') : '';
  els.securityPanelStatus.textContent = '二次验证已启用；请妥善保存恢复码。';
  updateTotpUi();
}

async function disableTotp() {
  const password = window.prompt('请输入当前密码');
  const code = window.prompt('请输入 Authenticator 当前验证码');
  if (!password || !code) return;
  await api('/api/auth/totp/disable', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: password, code: code })
  });
  state.totpEnabled = false;
  els.totpEnrollmentPanel.classList.add('hidden');
  els.totpSecretLabel.textContent = '';
  els.totpRecoveryCodes.value = '';
  els.securityPanelStatus.textContent = '二次验证已关闭。';
  updateTotpUi();
  setStatus('已关闭二次验证');
}

/** @param {string} password @param {string} code */
async function submitReauth(password, code) {
  await api('/api/auth/reauth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: password, code: code || undefined })
  });
  state.reauthRequired = false;
  state.sessionAuthenticated = true;
  await unlockVault(password, false);
  showApp();
  setStatus('重新验证成功');
}

async function checkSession() {
  await loadPublicConfig();
  showChecking();
  const data = await api('/api/session');
  if (data.authenticated) {
    state.sessionAuthenticated = true;
    state.reauthRequired = Boolean(data.reauthRequired);
    state.vaultUnlocked = false;
    state.vaultKey = null;
    state.unlockError = '';
    await refreshMeta();
    state.authMode = 'unlock';
    showLogin();
    renderList();
  } else {
    state.sessionAuthenticated = false;
    state.reauthRequired = false;
    state.totpEnabled = false;
    state.vaultUnlocked = false;
    state.vaultKey = null;
    state.unlockError = '';
    showLogin();
    renderList();
  }
}

els.loginBtn.onclick = async function () {
  try {
    if (state.pendingLoginChallenge) {
      await verifyPendingTotp();
      return;
    }
    const unlockOnly = state.sessionAuthenticated && !state.vaultUnlocked;
    let performedLogin = false;
    els.loginStatus.textContent = unlockOnly ? '解锁中…' : '登录中…';
    const password = els.passwordInput.value;
    if (!password) throw new Error('请输入密码');
    if (!unlockOnly) {
      const loginData = await api('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: password })
      });
      if (loginData.code === 'two_factor_required') {
        state.pendingLoginChallenge = String(loginData.challengeId || '');
        state.pendingLoginPassword = password;
        showTotpView();
        return;
      }
      performedLogin = true;
    } else if (state.reauthRequired) {
      const code = window.prompt('请输入 Authenticator 当前验证码或恢复码') || '';
      await submitReauth(password, code);
      clearSensitiveInputs();
      return;
    }
    state.sessionAuthenticated = true;
    await unlockVault(password, performedLogin);
    clearSensitiveInputs();
    showApp();
    setStatus(unlockOnly ? '已解锁' : '已登录并解锁');

    els.loginStatus.textContent = '';
  } catch (error) {
    state.vaultUnlocked = false;
    state.vaultKey = null;
    const message = error instanceof Error ? error.message : '登录失败';
    if (state.sessionAuthenticated) {
      state.unlockError = message;
      await refreshMeta();
      showLogin();
    } else {
      showLogin();
    }
    els.loginStatus.textContent = message;
  }
};

[els.passwordInput].forEach(function (input) {
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') els.loginBtn.click();
  });
});

els.vaultUnlockInput.addEventListener('keydown', function (event) {
  if (event.key === 'Enter') els.unlockBtn.click();
});

getTotpDigits().forEach(function (input, index) {
  input.addEventListener('input', function () {
    const value = normalizeTotpInput(input.value);
    input.value = value.slice(-1);
    if (value) moveTotpFocus(getTotpDigits(), index, 1);
    submitTotpWhenComplete();
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Backspace' && !input.value) moveTotpFocus(getTotpDigits(), index, -1);
    if (event.key === 'ArrowLeft') moveTotpFocus(getTotpDigits(), index, -1);
    if (event.key === 'ArrowRight') moveTotpFocus(getTotpDigits(), index, 1);
    if (event.key === 'Enter') els.totpVerifyBtn.click();
  });
  input.addEventListener('paste', function (event) {
    event.preventDefault();
    const digits = normalizeTotpInput(event.clipboardData?.getData('text') || '');
    getTotpDigits().forEach(function (target, targetIndex) {
      if (targetIndex >= index && targetIndex - index < digits.length) target.value = digits[targetIndex - index];
    });
    moveTotpFocus(getTotpDigits(), Math.min(index + digits.length, getTotpDigits().length - 1), 0);
    submitTotpWhenComplete();
  });
});
els.totpRecoveryToggleBtn.onclick = function () {
  const showRecovery = els.totpRecoveryPanel.classList.contains('hidden');
  els.totpRecoveryPanel.classList.toggle('hidden', !showRecovery);
  els.totpRecoveryToggleBtn.textContent = showRecovery ? '使用验证码' : '使用恢复码';
  if (showRecovery) els.totpRecoveryInput.focus();
  else getTotpDigits()[0]?.focus();
};
els.totpBackBtn.onclick = function () {
  state.pendingLoginChallenge = null;
  state.pendingLoginPassword = '';
  showLogin();
};
els.totpVerifyBtn.onclick = function () {
  verifyPendingTotp().catch(function (error) {
    els.totpStatus.textContent = error instanceof Error ? error.message : '验证码无效';
  });
};

els.searchInput.addEventListener('input', function () {
  updateSearchUi();
  applySearch();
});

els.clearSearchBtn.onclick = function () {
  els.searchInput.value = '';
  updateSearchUi();
  applySearch();
};

els.navigationBtn.onclick = function () { openNavigation(); };
els.closeNavigationBtn.onclick = function () { closeNavigation(); };
els.navigationBackdrop.onclick = function () { closeNavigation(); };

els.newBtn.onclick = function () {
  openComposer(null);
};

els.feedNewBtn.onclick = function () {
  openComposer(null);
};

els.fabNewBtn.onclick = function () {
  openComposer(null);
};

els.sortBtn.onclick = function () {
  const open = els.sortMenu.classList.toggle('hidden') === false;
  els.sortBtn.setAttribute('aria-expanded', String(open));
};

els.sortMenu.querySelectorAll('[data-sort-key]').forEach(function (element) {
  element.addEventListener('click', function () {
    const key = element.getAttribute('data-sort-key');
    if (key !== 'updated' && key !== 'created' && key !== 'title') return;
    state.sortKey = key;
    els.sortMenu.classList.add('hidden');
    els.sortBtn.setAttribute('aria-expanded', 'false');
    renderList();
    setStatus(key === 'updated' ? '已按最近更新排序' : key === 'created' ? '已按最近创建排序' : '已按标题排序');
  });
});

els.unlockBtn.onclick = function () {
  unlockVault(els.vaultUnlockInput.value, false)
    .then(function () {
      els.vaultUnlockInput.value = '';
      setStatus('已解锁本地密文');
    })
    .catch(function (error) {
      state.vaultUnlocked = false;
      state.vaultKey = null;
      state.unlockError = '当前密码无法解锁现有加密笔记';
      updateVaultUi();
      setStatus(error.message || '解锁失败');
    });
};

els.fabTopBtn.onclick = function () {
  getActiveScrollElement().scrollTo({ top: 0, behavior: 'smooth' });
};

async function logout() {
  await discardAttachmentDraft();
  await api('/api/logout', { method: 'POST' }, { recordActivity: false });
  endSession();
}

els.loginLogoutBtn.onclick = function () {
  logout().catch(function (error) {
    els.loginStatus.textContent = error instanceof Error ? error.message : '退出失败';
  });
};

els.readerBackBtn.onclick = closeReader;
els.readerCopyBtn.onclick = function () {
  copyCurrentReaderNote().catch(function (error) {
    setStatus(error instanceof Error ? error.message : '复制失败，请检查剪贴板权限');
  });
};
els.readerShareBtn.onclick = function () {
  const note = getCurrentReaderNote();
  if (!note || note.decryptFailed || state.trashMode) {
    setStatus('找不到可分享的笔记');
    return;
  }
  if (getSafeRecordText(note.record, note.content) === null) {
    setStatus('密码记录不支持分享');
    return;
  }
  openShareDialog(note);
};
els.readerEditBtn.onclick = function () {
  const note = getCurrentReaderNote();
  if (!note || note.decryptFailed || state.trashMode) {
    setStatus('找不到可编辑的笔记');
    return;
  }
  openComposer(note);
};
els.readerMoreBtn.onclick = function () {
  els.readerMoreMenu.classList.toggle('hidden');
  els.readerMoreBtn.setAttribute('aria-expanded', String(!els.readerMoreMenu.classList.contains('hidden')));
};
els.readerDeleteBtn.onclick = function () {
  const note = getCurrentReaderNote();
  if (!note || note.decryptFailed) return;
  deleteNote(note.id).then(closeReader).catch(function (error) { setStatus(error.message || '删除失败'); });
};
els.readerRestoreBtn.onclick = function () {
  const note = getCurrentReaderNote();
  if (!note || note.decryptFailed || !state.trashMode) return;
  restoreNote(note).catch(function (error) { setStatus(error.message || '恢复失败'); });
};
els.readerPermanentDeleteBtn.onclick = function () {
  const note = getCurrentReaderNote();
  if (!note || note.decryptFailed || !state.trashMode) return;
  permanentlyDeleteNote(note).catch(function (error) { setStatus(error.message || '永久删除失败'); });
};
els.editorFolder.onchange = function () {
  state.editorFolderId = els.editorFolder.value || null;
};
els.enrollTotpBtn.onclick = function () { enrollTotp().catch(function (error) { setStatus(error.message || '绑定失败'); }); };
els.confirmTotpBtn.onclick = function () { confirmTotpEnrollment().catch(function (error) { setStatus(error.message || '验证失败'); }); };
els.disableTotpBtn.onclick = function () { disableTotp().catch(function (error) { setStatus(error.message || '关闭失败'); }); };

els.editorToolbar.querySelectorAll('[data-editor-command]').forEach(function (button) {
  button.addEventListener('mousedown', function (event) {
    event.preventDefault();
  });
  button.addEventListener('click', function () {
    const command = button.getAttribute('data-editor-command') || '';
    runEditorCommand(els.documentEditor, command);
    markEditorSourceDirty();
    els.documentEditor.focus();
  });
});
els.insertLinkBtn.onclick = function () {
  const url = window.prompt('输入 https/http 链接');
  if (url && !runEditorCommand(els.documentEditor, 'link', url.trim())) setStatus('请输入有效的 http/https 链接');
  if (url) markEditorSourceDirty();
  els.documentEditor.focus();
};
els.insertImageBtn.onclick = function () {
  els.documentEditor.focus();
  setStatus('请直接在正文粘贴图片，或将图片拖入编辑区');
};
els.documentEditor.addEventListener('input', function () {
  markEditorSourceDirty();
  if (els.documentEditor.textContent?.trim()) els.documentEditor.removeAttribute('data-empty');
});

/** @param {ClipboardEvent} event */
function handleEditorPaste(event) {
  if (state.composerSaving) {
    event.preventDefault();
    setAttachmentStatus('正在保存，请稍候');
    return;
  }
  if (state.editorRecordType !== 'note') return;
  const images = extractPastedImages(event);
  if (!images.length) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    for (const image of images) queueEditorImage(image);
  } catch (error) {
    setAttachmentStatus(error instanceof Error ? error.message : '图片上传失败');
  }
}

/** @param {DragEvent} event */
function isImageDragEvent(event) {
  const items = Array.from(event.dataTransfer?.items || []);
  if (items.some(function (item) { return item.kind === 'file' && item.type.startsWith('image/'); })) return true;
  const files = Array.from(event.dataTransfer?.files || []);
  return files.some(function (file) { return file.type.startsWith('image/'); });
}

els.editorCard.addEventListener('paste', handleEditorPaste);
els.editorCard.addEventListener('dragover', function (event) {
  if (state.editorRecordType !== 'note') return;
  if (!isImageDragEvent(event)) return;
  event.preventDefault();
  if (state.composerSaving) return;
  els.editorCard.classList.add('drag-over');
});
els.editorCard.addEventListener('dragleave', function () { els.editorCard.classList.remove('drag-over'); });
els.editorCard.addEventListener('drop', function (event) {
  if (state.editorRecordType !== 'note') return;
  if (!isImageDragEvent(event)) return;
  event.preventDefault();
  els.editorCard.classList.remove('drag-over');
  if (state.composerSaving) {
    setAttachmentStatus('正在保存，请稍候');
    return;
  }
  const image = extractDroppedImage(event);
  if (image) {
    try {
      queueEditorImage(image);
    } catch (error) {
      setAttachmentStatus(error instanceof Error ? error.message : '图片上传失败');
    }
  }
});

els.cancelBtn.onclick = requestCloseComposer;
els.editorModal.addEventListener('click', function (event) {
  if (event.target === els.editorModal) requestCloseComposer();
});
els.saveBtn.onclick = function () {
  saveComposer().catch(function (error) {
    setStatus(error.message || '保存失败');
  });
};
els.closeShareModalBtn.onclick = function () {
  closeShareDialog();
};
els.cancelShareBtn.onclick = function () {
  closeShareDialog();
};
els.createShareBtn.onclick = function () {
  createShareLink().catch(function (error) {
    setStatus(error instanceof Error ? error.message : '创建分享链接失败');
  });
};
els.copyShareLinkBtn.onclick = function () {
  copyShareLink().catch(function (error) {
    setStatus(error instanceof Error ? error.message : '复制分享链接失败');
  });
};

document.addEventListener('keydown', function (event) {
  if (event.key === 'Tab' && !els.settingsPanel.classList.contains('hidden')) {
    trapFocus(event, els.settingsPanel);
  } else if (event.key === 'Tab' && !els.shareModal.classList.contains('hidden')) {
    trapFocus(event, els.shareModal);
  } else if (event.key === 'Tab' && state.navigationOpen) {
    trapFocus(event, els.workspaceNavigation);
  }
  if (event.key === 'Escape') {
    if (!els.settingsPanel.classList.contains('hidden')) {
      event.preventDefault();
      closeSettings();
    } else if (!els.folderDialog.classList.contains('hidden')) {
      event.preventDefault();
      closeFolderDialog();
    } else if (!els.shareModal.classList.contains('hidden')) {
      event.preventDefault();
      closeShareDialog();
    } else if (state.editingInline || !els.editorModal.classList.contains('hidden')) {
      if (state.composerSaving) setStatus('正在保存，请稍候');
      else requestCloseComposer();
    } else if (state.navigationOpen) {
      event.preventDefault();
      closeNavigation();
    } else if (!els.readerMoreMenu.classList.contains('hidden')) {
      els.readerMoreMenu.classList.add('hidden');
      els.readerMoreBtn.setAttribute('aria-expanded', 'false');
      els.readerMoreBtn.focus();
    }
  }
  const isSave = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
  if (isSave && (state.editingInline || !els.editorModal.classList.contains('hidden'))) {
    event.preventDefault();
    saveComposer().catch(function (error) {
      setStatus(error.message || '保存失败');
    });
  }
});

els.noteListScroll.addEventListener('scroll', updateScrollUi, { passive: true });
els.readerView.addEventListener('scroll', updateScrollUi, { passive: true });
window.addEventListener('resize', handleWorkspaceResize, { passive: true });

['pointerdown', 'keydown', 'touchstart'].forEach(function (eventName) {
  document.addEventListener(eventName, recordUserActivity, { passive: true });
});
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') recordUserActivity();
});

updateSearchUi();
updateScrollUi();
updateModalUi();
syncWorkspacePresentation();
checkSession().catch(function (error) {
  showLogin();
  els.loginStatus.textContent = error instanceof Error ? error.message : '无法连接到服务';
});
