import { buildNoteSnippet } from './note-records.js';

const ATTACHMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {{ title?: string, record: any, folder?: string, createdAt: number, updatedAt: number }} note
 */
export function buildNoteCardViewModel(note) {
  const record = note.record || { type: 'note', markdown: '' };
  return {
    title: String(note.title || '无标题'),
    snippet: record.type === 'note' ? buildNoteSnippet(record) : '密码记录',
    type: record.type === 'password' ? 'password' : 'note',
    folder: String(note.folder || '未分类'),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt
  };
}

/** @param {any} record */
export function buildReaderRenderPlan(record) {
  if (record && record.type === 'note') {
    const markdown = String(record.markdown || '');
    return {
      renderMarkdown: true,
      markdown: markdown,
      attachmentIds: extractAttachmentIds(markdown)
    };
  }
  return { renderMarkdown: false, markdown: '', attachmentIds: [] };
}

/** @param {string} source */
export function extractAttachmentIds(source) {
  const ids = [];
  const seen = new Set();
  const pattern = /attachment:\/\/([0-9a-f-]{36})/gi;
  let match;
  while ((match = pattern.exec(source || ''))) {
    const id = match[1].toLowerCase();
    if (ATTACHMENT_ID_PATTERN.test(id) && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** @param {HTMLTextAreaElement} textarea @param {string} insertion */
export function insertMarkdownAtSelection(textarea, insertion) {
  const start = Number.isSafeInteger(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
  const end = Number.isSafeInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
  const before = textarea.value.slice(0, start);
  const selected = textarea.value.slice(start, end);
  const after = textarea.value.slice(end);
  const pairable = new Set(['**', '__', '*', '_', '`']);
  const wrapped = insertion.includes('$0')
    ? insertion.replace('$0', selected)
    : pairable.has(insertion) && selected
      ? insertion + selected + insertion
      : insertion + selected;
  textarea.value = before + wrapped + after;
  const selectedStart = before.length + insertion.length;
  const selectedEnd = selectedStart + selected.length;
  if (pairable.has(insertion) && selected) {
    textarea.selectionStart = selectedStart;
    textarea.selectionEnd = selectedEnd;
  } else {
    textarea.selectionStart = before.length + wrapped.length;
    textarea.selectionEnd = before.length + wrapped.length;
  }
  return textarea.value;
}

/** @param {string} source @param {string} attachmentId @param {string} altText */
export function replaceAttachmentReference(source, attachmentId, altText) {
  if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) throw new Error('invalid attachment id');
  const reference = `![${String(altText || '图片').replace(/[\[\]]/g, '')}](attachment://${attachmentId.toLowerCase()})`;
  const pattern = /!\[[^\]]*\]\(attachment:\/\/[0-9a-f-]{36}\)/i;
  return pattern.test(source || '') ? String(source).replace(pattern, reference) : `${source || ''}${source ? '\n\n' : ''}${reference}`;
}

/** @param {string} url */
function isSafeLink(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** @param {string} text @param {Map<string, string>} attachments */
function renderInline(text, attachments) {
  const fragment = document.createDocumentFragment();
  const tokenPattern = /(!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)|\[([^\]]+)\]\(([^)\s]+)\)|(`+)([^`]+)\3|(\*\*|__)(.+?)\10|(\*|_)(.+?)\11)/g;
  let cursor = 0;
  let match;
  while ((match = tokenPattern.exec(text))) {
    if (match.index > cursor) fragment.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[1]) {
      const url = match[3];
      if (url.toLowerCase().startsWith('attachment://')) {
        const id = url.slice('attachment://'.length).toLowerCase();
        const resolved = attachments.get(id);
        if (resolved) {
          const image = document.createElement('img');
          image.src = resolved;
          image.alt = match[2] || '图片';
          image.loading = 'lazy';
          fragment.append(image);
        } else {
          fragment.append(document.createTextNode(match[2] || '[图片]'));
        }
      } else {
        fragment.append(document.createTextNode(match[2] || '[图片]'));
      }
    } else if (match[5]) {
      if (isSafeLink(match[6])) {
        const link = document.createElement('a');
        link.href = match[6];
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.textContent = match[5];
        fragment.append(link);
      } else {
        fragment.append(document.createTextNode(match[5]));
      }
    } else if (match[7]) {
      const code = document.createElement('code');
      code.textContent = match[8];
      fragment.append(code);
    } else if (match[9]) {
      const strong = document.createElement('strong');
      strong.textContent = match[10];
      fragment.append(strong);
    } else {
      const emphasis = document.createElement('em');
      emphasis.textContent = match[12];
      fragment.append(emphasis);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
  return fragment;
}

/** @param {string} source @param {Map<string, string>} [attachments] */
export function renderMarkdown(source, attachments = new Map()) {
  if (typeof document === 'undefined') throw new Error('Markdown rendering requires a browser document');
  const root = document.createDocumentFragment();
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (fence[1]) code.className = `language-${fence[1]}`;
      code.textContent = codeLines.join('\n');
      pre.append(code);
      root.append(pre);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      element.append(renderInline(heading[2], attachments));
      root.append(element);
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quoteLines.push(lines[index++].replace(/^\s*>\s?/, ''));
      const quote = document.createElement('blockquote');
      quote.append(renderInline(quoteLines.join('\n'), attachments));
      root.append(quote);
      continue;
    }
    const unordered = /^\s*[-+*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (index < lines.length) {
        const itemMatch = (ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/).exec(lines[index]);
        if (!itemMatch) break;
        const item = document.createElement('li');
        item.append(renderInline(itemMatch[1], attachments));
        list.append(item);
        index += 1;
      }
      root.append(list);
      continue;
    }
    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() &&
      !/^\s*```/.test(lines[index]) && !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) && !/^\s*[-+*]\s+/.test(lines[index]) && !/^\s*\d+[.)]\s+/.test(lines[index])) {
      paragraphLines.push(lines[index++]);
    }
    const paragraph = document.createElement('p');
    paragraphLines.forEach((part, partIndex) => {
      if (partIndex) paragraph.append(document.createElement('br'));
      paragraph.append(renderInline(part, attachments));
    });
    root.append(paragraph);
  }
  return root;
}
