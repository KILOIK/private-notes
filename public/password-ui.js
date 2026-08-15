import { addCustomField, copyFieldValue, removePasswordField, toggleSecretVisibility } from './password-fields.js';
import { encodePasswordRecord } from './note-records.js';
import { buildPasswordDisplayModel } from './workspace-model.js';

/**
 * @typedef {{ id: string, type: 'text' | 'secret' | 'multiline', label: string, value: string }} PasswordField
 */

/** @param {string} title @param {PasswordField[]} fields @param {string | null} folderId */
export function buildPasswordSavePayload(title, fields, folderId) {
  return {
    title: String(title || '').trim() || '无标题',
    content: encodePasswordRecord({ type: 'password', folderId: folderId, title: String(title || '').trim() || '无标题', fields: fields })
  };
}

/**
 * @param {'note' | 'password'} recordType
 * @param {HTMLInputElement} titleInput
 * @param {HTMLElement} passwordFields
 */
export function focusComposerPrimaryField(recordType, titleInput, passwordFields) {
  void recordType;
  void passwordFields;
  titleInput.focus();
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
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'input password-custom-label';
    labelInput.value = field.label;
    labelInput.setAttribute('aria-label', '字段名称');
    labelInput.addEventListener('input', function () {
      field.label = labelInput.value;
    });
    wrapper.append(labelInput);

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

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn secondary password-field-action';
    remove.textContent = '删除字段';
    remove.onclick = function () {
      onFieldsChange(removePasswordField(fields, field.id));
    };
    wrapper.append(remove);
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
  const displayFields = buildPasswordDisplayModel(record.fields);
  displayFields.forEach(function (display) {
    const field = record.fields.find(function (item) { return item.id === display.id; });
    if (!field) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'password-field password-reader-field' + (display.multiline ? ' is-multiline' : '');
    const label = document.createElement('span');
    label.className = 'password-field-label password-reader-label';
    label.textContent = display.label;
    wrapper.append(label);

    const value = document.createElement('button');
    value.type = 'button';
    value.className = 'password-reader-value';
    value.textContent = display.hidden ? '•'.repeat(Math.max(8, Array.from(display.value).length)) : display.value;
    value.setAttribute('aria-label', '复制' + display.label);
    value.setAttribute('title', '点击复制');
    value.onclick = function () {
      copyFieldValue(display.value, clipboard)
        .then(function () { onStatus('字段已复制'); })
        .catch(function () { onStatus('复制失败，请检查剪贴板权限'); });
    };
    wrapper.append(value);

    if (display.hidden) {
      const actions = document.createElement('div');
      actions.className = 'password-reader-actions';
      let hidden = true;
      const visibility = document.createElement('button');
      visibility.type = 'button';
      visibility.className = 'icon-btn password-field-action password-visibility-toggle';
      visibility.textContent = '';
      visibility.setAttribute('aria-label', '显示密码');
      visibility.setAttribute('title', '显示密码');
      visibility.onclick = function () {
        hidden = !hidden;
        value.textContent = hidden ? '•'.repeat(Math.max(8, Array.from(display.value).length)) : display.value;
        visibility.setAttribute('aria-label', hidden ? '显示密码' : '隐藏密码');
        visibility.setAttribute('title', hidden ? '显示密码' : '隐藏密码');
      };
      actions.append(visibility);
      wrapper.append(actions);
    }
    container.append(wrapper);
  });
}
