import { renderMarkdown } from './markdown.js';

const COMMANDS = new Map([
  ['undo', ['undo', undefined]],
  ['redo', ['redo', undefined]],
  ['paragraph', ['formatBlock', '<p>']],
  ['heading', ['formatBlock', '<h2>']],
  ['bold', ['bold', undefined]],
  ['italic', ['italic', undefined]],
  ['underline', ['underline', undefined]],
  ['strike', ['strikeThrough', undefined]],
  ['quote', ['formatBlock', '<blockquote>']],
  ['unordered-list', ['insertUnorderedList', undefined]],
  ['ordered-list', ['insertOrderedList', undefined]],
  ['code-block', ['formatBlock', '<pre>']],
]);

const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'PRE']);

/** @param {unknown} value @returns {string} */
function getText(value) {
  if (!value || typeof value !== 'object') return '';
  const node = /** @type {{ childNodes?: ArrayLike<unknown>, textContent?: unknown }} */ (value);
  if (node.childNodes && node.childNodes.length) {
    return Array.from(node.childNodes).map(getText).join('');
  }
  return String(node.textContent || '');
}

/** @param {any} node */
function childrenOf(node) {
  return node && node.childNodes ? Array.from(node.childNodes) : [];
}

/** @param {any} node @param {string} name */
function getAttribute(node, name) {
  if (node && typeof node.getAttribute === 'function') return node.getAttribute(name) || '';
  return String(node?.attributes?.[name] || node?.dataset?.[name.replace(/^data-/, '')] || '');
}

/** @param {any} node */
function getTagName(node) {
  return String(node?.tagName || '').toUpperCase();
}

/** @param {any} node */
function hasBlockChild(node) {
  return childrenOf(node).some(function (child) {
    return BLOCK_TAGS.has(getTagName(child));
  });
}

/** @param {string} url */
function isSafeLink(url) {
  try {
    const origin = typeof window === 'undefined' ? 'https://notes.example.test' : window.location.origin;
    const parsed = new URL(url, origin);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** @param {string} value */
function escapeText(value) {
  return String(value || '').replace(/[\\`*_~\[\]]/g, '\\$&');
}

/** @param {any} node @returns {string} */
function serializeInline(node) {
  if (!node) return '';
  if (node.nodeType === 3 || !node.tagName) return escapeText(String(node.textContent || ''));
  const tag = String(node.tagName).toUpperCase();
  if (tag === 'BR') return '\n';
  if (tag === 'STRONG' || tag === 'B') return `**${childrenOf(node).map(serializeInline).join('')}**`;
  if (tag === 'EM' || tag === 'I') return `*${childrenOf(node).map(serializeInline).join('')}*`;
  if (tag === 'U') return `<u>${childrenOf(node).map(serializeInline).join('')}</u>`;
  if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') return `~~${childrenOf(node).map(serializeInline).join('')}~~`;
  if (tag === 'CODE') return `\`${getText(node).replace(/`/g, '\\`')}\``;
  if (tag === 'A') {
    const href = getAttribute(node, 'href');
    return isSafeLink(href) ? `[${childrenOf(node).map(serializeInline).join('')}](${href})` : childrenOf(node).map(serializeInline).join('');
  }
  if (tag === 'IMG') {
    const source = getAttribute(node, 'data-markdown-src');
    const alt = getAttribute(node, 'alt') || '图片';
    if (/^(?:attachment|pending):\/\/[^\s]+$/i.test(source)) return `![${alt.replace(/[\[\]]/g, '')}](${source})`;
    return alt;
  }
  return childrenOf(node).map(serializeInline).join('');
}

/** @param {any} list @param {number} [depth] */
function serializeList(list, depth = 0) {
  const tag = getTagName(list);
  const indent = '  '.repeat(depth);
  return childrenOf(list).filter(function (child) {
    return getTagName(child) === 'LI';
  }).map(function (item, index) {
    const children = childrenOf(item);
    const nestedLists = children.filter(function (child) {
      const childTag = getTagName(child);
      return childTag === 'UL' || childTag === 'OL';
    });
    const content = children.filter(function (child) {
      const childTag = getTagName(child);
      return childTag !== 'UL' && childTag !== 'OL';
    }).map(serializeInline).join('').trim();
    const marker = tag === 'OL' ? `${index + 1}. ` : '- ';
    const lines = [`${indent}${marker}${content}`.trimEnd()];
    nestedLists.forEach(function (nested) {
      const serialized = serializeList(nested, depth + 1);
      if (serialized) lines.push(serialized);
    });
    return lines.join('\n');
  }).join('\n').trimEnd();
}

/** @param {any[]} nodes @returns {string[]} */
function serializeBlocks(nodes) {
  return nodes.flatMap(function (node) {
    const tag = getTagName(node);
    if ((tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') && hasBlockChild(node)) {
      return serializeBlocks(childrenOf(node));
    }
    const markdown = serializeBlock(node);
    return markdown ? [markdown] : [];
  });
}

/** @param {any} node @returns {string} */
function serializeBlock(node) {
  if (!node) return '';
  if (node.nodeType === 3 || !node.tagName) return escapeText(String(node.textContent || '')).trim();
  const tag = getTagName(node);
  if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag.slice(1)))} ${childrenOf(node).map(serializeInline).join('')}`.trim();
  if (tag === 'P' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') return childrenOf(node).map(serializeInline).join('').trim();
  if (tag === 'BLOCKQUOTE') {
    return serializeBlocks(childrenOf(node)).join('\n').split('\n').map((line /** @type {string} */) => `> ${line}`.trimEnd()).join('\n').trim();
  }
  if (tag === 'UL' || tag === 'OL') {
    return serializeList(node);
  }
  if (tag === 'PRE') {
    const code = childrenOf(node).find((child) => getTagName(child) === 'CODE');
    const languageMatch = /(?:^|\s)language-([\w-]+)/.exec(String(getAttribute(code, 'class') || ''));
    const language = languageMatch ? languageMatch[1] : '';
    return `\`\`\`${language}\n${getText(code || node)}\n\`\`\``.trim();
  }
  return serializeInline(node).trim();
}

/** @param {HTMLElement} editor */
export function ensureEditorPlaceholder(editor) {
  if (editor.childNodes.length) return;
  const paragraph = document.createElement('p');
  paragraph.append(document.createElement('br'));
  editor.replaceChildren(paragraph);
  editor.setAttribute('data-empty', 'true');
}

/** @param {HTMLElement} editor @param {string} markdown @param {Map<string, string>} [attachments] @param {Map<string, string>} [pendingAttachments] */
export function loadEditorMarkdown(editor, markdown, attachments = new Map(), pendingAttachments = new Map()) {
  editor.replaceChildren(renderMarkdown(markdown, attachments, pendingAttachments));
  editor.setAttribute('contenteditable', 'true');
  editor.removeAttribute('data-empty');
  if (!String(markdown || '').trim()) ensureEditorPlaceholder(editor);
}

/** @param {HTMLElement} editor */
export function serializeEditorMarkdown(editor) {
  return serializeBlocks(childrenOf(editor)).join('\n\n').trim();
}

/** @param {HTMLElement} editor @param {string} command @param {string} [value] */
export function runEditorCommand(editor, command, value) {
  const doc = editor.ownerDocument || document;
  if (command === 'link') {
    if (!value || !isSafeLink(value) || typeof doc.execCommand !== 'function') return false;
    editor.focus();
    return Boolean(doc.execCommand('createLink', false, value));
  }
  const entry = COMMANDS.get(command);
  if (!entry || typeof doc.execCommand !== 'function') return false;
  editor.focus();
  const commandName = String(entry[0]);
  const commandValue = typeof entry[1] === 'string' ? entry[1] : undefined;
  return Boolean(doc.execCommand(commandName, false, commandValue));
}
