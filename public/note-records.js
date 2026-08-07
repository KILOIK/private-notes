const RECORD_VERSION = 1;
const FIXED_PASSWORD_IDS = ['name', 'username', 'password', 'url', 'notes'];
const FIELD_TYPES = new Set(['text', 'secret', 'multiline']);
const FIXED_DEFAULTS = {
  name: { type: 'text', label: '名称' },
  username: { type: 'text', label: '用户名' },
  password: { type: 'secret', label: '密码' },
  url: { type: 'text', label: '网址' },
  notes: { type: 'multiline', label: '备注' },
};

/** @param {any} value @returns {any} */
function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (value && typeof value === 'object') {
    /** @type {Record<string, any>} */
    const copy = {};
    for (const [key, item] of Object.entries(value)) copy[key] = immutable(item);
    return Object.freeze(copy);
  }
  return value;
}

/** @param {any} record @returns {any} */
function requireVersion(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('invalid record');
  if (record.v !== RECORD_VERSION) throw new Error('unsupported record version');
  return record;
}

/** @param {unknown} fields */
export function normalizePasswordFields(fields) {
  if (!Array.isArray(fields)) throw new Error('password fields required');
  const byId = new Map();
  for (const field of fields) {
    if (!field || typeof field !== 'object' || typeof field.id !== 'string' || !field.id.trim()) throw new Error('invalid field id');
    const id = field.id.trim();
    if (byId.has(id)) throw new Error('duplicate field id');
    const type = String(field.type || '');
    if (!FIELD_TYPES.has(type)) throw new Error('unknown field type');
    const label = String(field.label ?? '');
    if (!label.trim() && !FIXED_PASSWORD_IDS.includes(id)) throw new Error('field label required');
    byId.set(id, { id, type, label, value: String(field.value ?? '') });
  }
  for (const id of FIXED_PASSWORD_IDS) if (!byId.has(id)) throw new Error(`missing fixed field: ${id}`);
  const normalized = [];
  for (const id of FIXED_PASSWORD_IDS) {
    const field = byId.get(id);
    const defaults = /** @type {any} */ (FIXED_DEFAULTS)[id];
    normalized.push({ ...field, type: defaults.type, label: field.label || defaults.label });
    byId.delete(id);
  }
  for (const field of byId.values()) normalized.push(field);
  return immutable(normalized);
}

/** @param {string} content */
export function decodeNoteRecord(content) {
  if (typeof content !== 'string') throw new TypeError('record content must be a string');
  let parsed;
  try { parsed = JSON.parse(content); } catch { return immutable({ v: 1, type: 'note', folderId: null, markdown: content }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return immutable({ v: 1, type: 'note', folderId: null, markdown: content });
  requireVersion(parsed);
  if (parsed.type === 'note') {
    if (typeof parsed.markdown !== 'string') throw new Error('invalid note markdown');
    return immutable({ v: 1, type: 'note', folderId: typeof parsed.folderId === 'string' ? parsed.folderId : null, markdown: parsed.markdown });
  }
  if (parsed.type === 'password') {
    return immutable({ v: 1, type: 'password', folderId: typeof parsed.folderId === 'string' ? parsed.folderId : null, fields: normalizePasswordFields(parsed.fields) });
  }
  throw new Error('unknown record type');
}

/** @param {any} record */
export function encodeNoteRecord(record) {
  if (!record || typeof record !== 'object' || record.type !== 'note' || typeof record.markdown !== 'string') throw new Error('invalid note record');
  return JSON.stringify({ v: 1, type: 'note', folderId: typeof record.folderId === 'string' ? record.folderId : null, markdown: record.markdown });
}

/** @param {string} markdown @param {string | null} folderId */
export function buildNoteSaveContent(markdown, folderId) {
  return encodeNoteRecord({ type: 'note', folderId: folderId, markdown: markdown });
}

/** @param {any} record */
export function encodePasswordRecord(record) {
  if (!record || typeof record !== 'object' || record.type !== 'password') throw new Error('invalid password record');
  const result = { v: 1, type: 'password', folderId: typeof record.folderId === 'string' ? record.folderId : null, fields: normalizePasswordFields(record.fields) };
  return JSON.stringify(result);
}

/**
 * Returns user-facing Markdown for a note record, or the legacy plaintext
 * fallback. Password records are intentionally never returned here so list
 * copy and sharing cannot expose their serialized fields.
 * @param {any} record
 * @param {string} legacyContent
 * @returns {string|null}
 */
export function getSafeRecordText(record, legacyContent = '') {
  if (!record) return String(legacyContent || '');
  if (record.type === 'note') return String(record.markdown || '');
  return null;
}

/** @param {any} record @param {number} maxLength */
export function buildNoteSnippet(record, maxLength = 140) {
  const markdown = typeof record === 'string' ? record : String(record?.markdown || '');
  const plain = markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#]/g, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  const limit = Math.max(0, Number.isFinite(maxLength) ? Math.floor(maxLength) : 140);
  const characters = Array.from(plain);
  if (characters.length <= limit) return plain;
  if (limit <= 1) return '…'.slice(0, limit);
  return characters.slice(0, limit - 1).join('') + '…';
}
