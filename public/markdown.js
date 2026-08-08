import { buildNoteSnippet } from './note-records.js';

const ATTACHMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Produces plain-text highlight ranges so callers never need to interpolate
 * decrypted note titles into HTML.
 * @param {string} text
 * @param {string} query
 */
export function buildHighlightedTextSegments(text, query) {
  const source = String(text || '');
  const needle = String(query || '').trim();
  if (!needle) return [{ text: source, highlighted: false }];
  const pattern = new RegExp(escapeRegExp(needle), 'gi');
  const segments = [];
  let cursor = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > cursor) segments.push({ text: source.slice(cursor, match.index), highlighted: false });
    segments.push({ text: match[0], highlighted: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), highlighted: false });
  return segments.length ? segments : [{ text: source, highlighted: false }];
}

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

/** @param {string} text @param {Map<string, string>} attachments @param {Map<string, string>} pendingAttachments */
function renderInline(text, attachments, pendingAttachments) {
  const fragment = document.createDocumentFragment();
  const tokenPattern = /!\[(?<imageAlt>[^\]]*)\]\((?<imageUrl>[^)\s]+)(?:\s+["'](?<imageTitle>[^"']*)["'])?\)|\[(?<linkText>[^\]]+)\]\((?<linkUrl>[^)\s]+)\)|(?<codeTicks>`+)(?<codeText>[^`]+)\k<codeTicks>|(?<strongMarker>\*\*|__)(?<strongText>.+?)\k<strongMarker>|(?<strikeMarker>~~)(?<strikeText>.+?)\k<strikeMarker>|<u>(?<underlineText>.+?)<\/u>|(?<emMarker>\*|_)(?<emText>.+?)\k<emMarker>/g;
  let cursor = 0;
  let match;
  while ((match = tokenPattern.exec(text))) {
    if (match.index > cursor) fragment.append(document.createTextNode(text.slice(cursor, match.index)));
    const groups = match.groups || {};
    if (typeof groups.imageUrl === 'string') {
      const url = groups.imageUrl;
      if (url.toLowerCase().startsWith('attachment://')) {
        const id = url.slice('attachment://'.length).toLowerCase();
        const resolved = attachments.get(id);
        if (resolved) {
          const image = document.createElement('img');
          image.setAttribute('data-markdown-src', url);
          image.src = resolved;
          image.alt = groups.imageAlt || '图片';
          image.loading = 'lazy';
          fragment.append(image);
        } else {
          fragment.append(document.createTextNode(groups.imageAlt || '[图片]'));
        }
      } else if (url.toLowerCase().startsWith('pending://')) {
        const resolved = pendingAttachments.get(url);
        if (resolved) {
          const image = document.createElement('img');
          image.setAttribute('data-markdown-src', url);
          image.src = resolved;
          image.alt = groups.imageAlt || '图片';
          image.loading = 'lazy';
          fragment.append(image);
        } else {
          fragment.append(document.createTextNode(groups.imageAlt || '[图片]'));
        }
      } else {
        fragment.append(document.createTextNode(groups.imageAlt || '[图片]'));
      }
    } else if (typeof groups.linkText === 'string') {
      if (isSafeLink(groups.linkUrl)) {
        const link = document.createElement('a');
        link.href = groups.linkUrl;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.textContent = groups.linkText;
        fragment.append(link);
      } else {
        fragment.append(document.createTextNode(groups.linkText));
      }
    } else if (groups.codeTicks) {
      const code = document.createElement('code');
      code.textContent = groups.codeText;
      fragment.append(code);
    } else if (groups.strongMarker) {
      const strong = document.createElement('strong');
      strong.textContent = groups.strongText;
      fragment.append(strong);
    } else if (groups.strikeMarker) {
      const strike = document.createElement('s');
      strike.textContent = groups.strikeText;
      fragment.append(strike);
    } else if (typeof groups.underlineText === 'string') {
      const underline = document.createElement('u');
      underline.textContent = groups.underlineText;
      fragment.append(underline);
    } else if (groups.emMarker) {
      const emphasis = document.createElement('em');
      emphasis.textContent = groups.emText;
      fragment.append(emphasis);
    } else {
      fragment.append(document.createTextNode(match[0]));
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
  return fragment;
}

/** @param {string} source @param {Map<string, string>} [attachments] @param {Map<string, string>} [pendingAttachments] */
export function renderMarkdown(source, attachments = new Map(), pendingAttachments = new Map()) {
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
      element.append(renderInline(heading[2], attachments, pendingAttachments));
      root.append(element);
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quoteLines.push(lines[index++].replace(/^\s*>\s?/, ''));
      const quote = document.createElement('blockquote');
      quote.append(renderInline(quoteLines.join('\n'), attachments, pendingAttachments));
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
        item.append(renderInline(itemMatch[1], attachments, pendingAttachments));
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
      paragraph.append(renderInline(part, attachments, pendingAttachments));
    });
    root.append(paragraph);
  }
  return root;
}
