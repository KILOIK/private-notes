const FIXED_FIELD_IDS = new Set(['name', 'username', 'password', 'url', 'notes']);
const FIELD_TYPES = new Set(['text', 'secret', 'multiline']);

/**
 * @typedef {{ id: string, type: 'text' | 'secret' | 'multiline', label: string, value: string }} PasswordField
 */

/** @returns {PasswordField[]} */
export function createDefaultPasswordFields() {
  return [
    { id: 'name', type: 'text', label: '名称', value: '' },
    { id: 'username', type: 'text', label: '用户名', value: '' },
    { id: 'password', type: 'secret', label: '密码', value: '' },
    { id: 'url', type: 'text', label: '网址', value: '' },
    { id: 'notes', type: 'multiline', label: '备注', value: '' }
  ];
}

/**
 * @param {PasswordField[]} fields
 * @param {'text' | 'secret' | 'multiline'} type
 * @returns {PasswordField[]}
 */
export function addCustomField(fields, type) {
  if (!Array.isArray(fields)) throw new TypeError('password fields required');
  if (!FIELD_TYPES.has(type)) throw new Error('unknown field type');
  return fields.concat({
    id: crypto.randomUUID(),
    type,
    label: '自定义字段',
    value: ''
  });
}

/**
 * @param {PasswordField[]} fields
 * @param {string} id
 * @returns {PasswordField[]}
 */
export function removeCustomField(fields, id) {
  if (!Array.isArray(fields)) throw new TypeError('password fields required');
  if (FIXED_FIELD_IDS.has(id)) throw new Error('fixed fields cannot be removed');
  return fields.filter(function (field) { return field.id !== id; });
}

/** @param {HTMLInputElement} element */
export function toggleSecretVisibility(element) {
  if (!element || typeof element !== 'object' || (element.type !== 'password' && element.type !== 'text')) {
    throw new TypeError('secret input required');
  }
  element.type = element.type === 'password' ? 'text' : 'password';
}

/**
 * @param {string} value
 * @param {{ writeText(value: string): Promise<void> }} clipboard
 * @returns {Promise<void>}
 */
export function copyFieldValue(value, clipboard) {
  if (typeof value !== 'string') throw new TypeError('field value must be a string');
  if (!clipboard || typeof clipboard.writeText !== 'function') throw new TypeError('clipboard API required');
  return clipboard.writeText(value);
}
