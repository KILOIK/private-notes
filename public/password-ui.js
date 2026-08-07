import { addCustomField, copyFieldValue, removeCustomField, toggleSecretVisibility } from './password-fields.js';
import { encodePasswordRecord } from './note-records.js';

const FIXED_FIELD_IDS = new Set(['name', 'username', 'password', 'url', 'notes']);

/**
 * @typedef {{ id: string, type: 'text' | 'secret' | 'multiline', label: string, value: string }} PasswordField
 */

/** @param {PasswordField[]} fields @param {string | null} folderId */
export function buildPasswordSavePayload(fields, folderId) {
  const name = fields.find(function (field) { return field.id === 'name'; });
  return {
    title: String(name?.value || ''),
    content: encodePasswordRecord({ type: 'password', folderId: folderId, fields: fields })
  };
}

/**
 * @param {HTMLElement} container
 * @param {PasswordField[]} fields
 * @param {(fields: PasswordField[]) => void} onFieldsChange
 */
export function renderPasswordEditor(container, fields, onFieldsChange) {
  container.replaceChildren();
  const hint = document.createElement('span');
  hint.className = 'per-field-copy';
  hint.textContent = '密码字段默认隐藏；每个字段均可单独复制。';
  container.append(hint);

  fields.forEach(function (field) {
    const wrapper = document.createElement('div');
    wrapper.className = 'password-field password-editor-field';
    const label = document.createElement('label');
    label.className = 'password-field-label';
    label.textContent = field.label;
    wrapper.append(label);

    if (!FIXED_FIELD_IDS.has(field.id)) {
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'input password-custom-label';
      labelInput.value = field.label;
      labelInput.setAttribute('aria-label', '字段名称');
      labelInput.addEventListener('input', function () {
        field.label = labelInput.value;
        label.textContent = field.label || '自定义字段';
      });
      wrapper.append(labelInput);
    }

    let input;
    if (field.type === 'multiline') {
      input = document.createElement('textarea');
      input.className = 'textarea password-editor-value';
      input.rows = 3;
    } else {
      input = document.createElement('input');
      input.className = 'input password-editor-value';
      input.type = field.type === 'secret' ? 'password' : 'text';
    }
    input.value = field.value;
    input.setAttribute('aria-label', field.label);
    input.addEventListener('input', function () {
      field.value = input.value;
    });
    wrapper.append(input);

    if (field.type === 'secret' && input instanceof HTMLInputElement) {
      const visibility = document.createElement('button');
      visibility.type = 'button';
      visibility.className = 'btn secondary password-field-action';
      visibility.textContent = '显示';
      visibility.onclick = function () {
        toggleSecretVisibility(input);
        visibility.textContent = input.type === 'password' ? '显示' : '隐藏';
      };
      wrapper.append(visibility);
    }

    if (!FIXED_FIELD_IDS.has(field.id)) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn secondary password-field-action';
      remove.textContent = '删除字段';
      remove.onclick = function () {
        onFieldsChange(removeCustomField(fields, field.id));
      };
      wrapper.append(remove);
    }
    container.append(wrapper);
  });

  const customFields = document.createElement('div');
  customFields.className = 'password-custom-actions';
  ['text', 'secret', 'multiline'].forEach(function (type) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn secondary';
    add.textContent = type === 'text' ? '添加文本字段' : type === 'secret' ? '添加隐藏字段' : '添加多行字段';
    add.onclick = function () {
      onFieldsChange(addCustomField(fields, /** @type {'text' | 'secret' | 'multiline'} */ (type)));
    };
    customFields.append(add);
  });
  container.append(customFields);
}

/**
 * @param {HTMLElement} container
 * @param {{ type: 'password', fields: PasswordField[] }} record
 * @param {{ writeText(value: string): Promise<void> }} clipboard
 * @param {(status: string) => void} onStatus
 */
export function renderPasswordReader(container, record, clipboard, onStatus) {
  container.replaceChildren();
  record.fields.forEach(function (field) {
    const wrapper = document.createElement('div');
    wrapper.className = 'password-field';
    const label = document.createElement('label');
    label.className = 'password-field-label';
    label.textContent = String(field.label || '字段');
    wrapper.append(label);

    let input;
    if (field.type === 'multiline') {
      input = document.createElement('textarea');
      input.className = 'textarea password-reader-value';
      input.rows = 3;
      input.readOnly = true;
    } else {
      input = document.createElement('input');
      input.className = 'input password-reader-value';
      input.type = field.type === 'secret' ? 'password' : 'text';
      input.readOnly = true;
    }
    input.value = field.value;
    input.setAttribute('aria-label', String(field.label || '字段'));
    wrapper.append(input);

    if (field.type === 'secret' && input instanceof HTMLInputElement) {
      const visibility = document.createElement('button');
      visibility.type = 'button';
      visibility.className = 'btn secondary password-field-action';
      visibility.textContent = '显示';
      visibility.onclick = function () {
        toggleSecretVisibility(input);
        visibility.textContent = input.type === 'password' ? '显示' : '隐藏';
      };
      wrapper.append(visibility);
    }

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn secondary per-field-copy';
    copy.textContent = '复制';
    copy.onclick = function () {
      copyFieldValue(field.value, clipboard)
        .then(function () { onStatus('字段已复制'); })
        .catch(function () { onStatus('复制失败，请检查剪贴板权限'); });
    };
    wrapper.append(copy);
    container.append(wrapper);
  });
}
