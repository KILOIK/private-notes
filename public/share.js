import { createShareProof, decryptSharedPayload, parseShareKeyFragment } from './share-crypto.js';
import { revokeAttachmentUrls } from './attachment-crypto.js';
import { renderMarkdown } from './markdown.js';

/**
 * @typedef {{ token: string, keyBytes: Uint8Array }} ShareLinkData
 * @typedef {{ v: 1, title: string, content: string, createdAt: number, sharedAt: number, attachments?: Array<{ id: string, mimeType: string, ciphertext: string }> }} SharedNotePayload
 */

/** @param {string} id @returns {HTMLElement} */
function getElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error('页面缺少必要元素：' + id);
  return element;
}

/** @param {string} id @returns {HTMLButtonElement} */
function getButton(id) {
  const element = getElement(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error('页面元素类型错误：' + id);
  return element;
}

const els = {
  intro: getElement('shareIntro'),
  consumeBtn: getButton('consumeShareBtn'),
  status: getElement('shareStatus'),
  note: getElement('sharedNote'),
  meta: getElement('sharedMeta'),
  title: getElement('sharedTitle'),
  content: getElement('sharedContent'),
  clearBtn: getButton('clearSharedNoteBtn')
};

/** @type {ShareLinkData | null} */
let linkData = null;
const attachmentUrls = new Set();

/** @param {string} value */
function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** @param {string} message @param {boolean} [isError] */
function setStatus(message, isError) {
  els.status.textContent = message;
  els.status.classList.toggle('is-error', Boolean(isError));
}

function parseShareLink() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('t') || '';
  const fragment = url.hash.slice(1);
  window.history.replaceState(null, '', url.pathname);
  if (!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(token) || !fragment.startsWith('v1.')) {
    throw new Error('分享链接不完整或格式无效');
  }
  const keyBytes = parseShareKeyFragment(fragment);
  return { token: token, keyBytes: keyBytes };
}

/** @param {unknown} value @returns {SharedNotePayload} */
function validatePayload(value) {
  if (!value || typeof value !== 'object') throw new Error('分享内容格式无效');
  const payload = /** @type {Record<string, unknown>} */ (value);
  if (
    payload.v !== 1 ||
    typeof payload.title !== 'string' ||
    typeof payload.content !== 'string' ||
    !Number.isSafeInteger(payload.createdAt) ||
    !Number.isSafeInteger(payload.sharedAt)
  ) {
    throw new Error('分享内容格式无效');
  }
  if (payload.attachments !== undefined) {
    if (!Array.isArray(payload.attachments)) throw new Error('分享图片格式无效');
    for (const attachment of payload.attachments) {
      if (!attachment || typeof attachment !== 'object' || typeof attachment.id !== 'string' || typeof attachment.mimeType !== 'string' || typeof attachment.ciphertext !== 'string') {
        throw new Error('分享图片格式无效');
      }
    }
  }
  return /** @type {SharedNotePayload} */ (payload);
}

/** @param {number} timestamp */
function formatDate(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

function clearPageContent() {
  els.title.textContent = '';
  els.content.textContent = '';
  els.meta.textContent = '';
  els.note.classList.add('hidden');
  revokeAttachmentUrls(attachmentUrls);
  if (linkData) linkData.keyBytes.fill(0);
  linkData = null;
}

/** @param {SharedNotePayload} payload */
function renderSharedContent(payload) {
  const attachmentMap = new Map();
  for (const attachment of payload.attachments || []) {
    const url = URL.createObjectURL(new Blob([base64ToBytes(attachment.ciphertext)], { type: attachment.mimeType }));
    attachmentUrls.add(url);
    attachmentMap.set(attachment.id, url);
  }
  els.content.replaceChildren(renderMarkdown(payload.content || '', attachmentMap));
}

async function consumeShare() {
  if (!linkData) throw new Error('分享链接缺少解密密钥');
  els.consumeBtn.disabled = true;
  setStatus('正在领取并从当前在线数据库删除密文…');
  const proof = await createShareProof(linkData.keyBytes);
  const response = await fetch('/api/shares/' + encodeURIComponent(linkData.token) + '/consume', {
    method: 'POST',
    credentials: 'omit',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proof: proof })
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) {
    if (response.status === 410 && data.code === 'share_unavailable') {
      clearPageContent();
      throw new Error('这条分享已被查看、已过期或链接不完整');
    }
    throw new Error('暂时无法领取分享内容');
  }

  try {
    const payload = validatePayload(await decryptSharedPayload(data.ciphertext, linkData.keyBytes));
    linkData.keyBytes.fill(0);
    linkData = null;
    els.meta.textContent = '原笔记创建于 ' + formatDate(payload.createdAt) + ' · 在线 D1 记录已删除';
    els.title.textContent = payload.title || '无标题';
    renderSharedContent(payload);
    els.intro.classList.add('hidden');
    els.note.classList.remove('hidden');
    setStatus('已解密；关闭或刷新页面后无法再次获取。');
  } catch (error) {
    clearPageContent();
    throw new Error('在线 D1 记录已删除，但当前链接无法解密这条内容');
  }
}

els.consumeBtn.onclick = function () {
  consumeShare().catch(function (error) {
    if (linkData) els.consumeBtn.disabled = false;
    setStatus(error instanceof Error ? error.message : '无法查看分享内容', true);
  });
};

els.clearBtn.onclick = function () {
  clearPageContent();
  setStatus('当前页面中的明文已清除。');
};

window.addEventListener('pagehide', clearPageContent);

try {
  linkData = parseShareLink();
  els.consumeBtn.disabled = false;
  setStatus('链接有效。内容尚未领取，在线 D1 记录仍存在。');
} catch (error) {
  els.consumeBtn.disabled = true;
  setStatus(error instanceof Error ? error.message : '分享链接无效', true);
}
