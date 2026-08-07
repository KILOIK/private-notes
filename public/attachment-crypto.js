const ATTACHMENT_VERSION = 1;
const IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** @param {string} mimeType */
function requireImageMimeType(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (!SUPPORTED_IMAGE_TYPES.has(normalized)) throw new Error('unsupported image MIME type');
  return normalized;
}

/**
 * Encrypt an image as [version byte][12-byte IV][AES-GCM ciphertext].
 * @param {Blob} blob
 * @param {CryptoKey} vaultKey
 * @returns {Promise<{ ciphertext: ArrayBuffer, mimeType: string, byteLength: number }>}
 */
export async function encryptAttachment(blob, vaultKey) {
  if (!(blob instanceof Blob)) throw new TypeError('image blob required');
  if (blob.size > MAX_ATTACHMENT_BYTES) throw new Error('image is too large');
  const mimeType = requireImageMimeType(blob.type);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  try {
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, bytes));
    const envelope = new Uint8Array(1 + IV_LENGTH + encrypted.byteLength);
    envelope[0] = ATTACHMENT_VERSION;
    envelope.set(iv, 1);
    envelope.set(encrypted, 1 + IV_LENGTH);
    encrypted.fill(0);
    return { ciphertext: envelope.buffer, mimeType, byteLength: envelope.byteLength };
  } finally {
    bytes.fill(0);
    iv.fill(0);
  }
}

/**
 * @param {ArrayBuffer | Uint8Array} ciphertext
 * @param {string} mimeType
 * @param {CryptoKey} vaultKey
 * @returns {Promise<Blob>}
 */
export async function decryptAttachment(ciphertext, mimeType, vaultKey) {
  const normalizedMimeType = requireImageMimeType(mimeType);
  const bytes = ciphertext instanceof Uint8Array ? new Uint8Array(ciphertext) : new Uint8Array(ciphertext);
  if (bytes.byteLength < 1 + IV_LENGTH + GCM_TAG_LENGTH || bytes[0] !== ATTACHMENT_VERSION) {
    throw new Error('invalid attachment envelope');
  }
  const iv = bytes.slice(1, 1 + IV_LENGTH);
  const encrypted = bytes.slice(1 + IV_LENGTH);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, vaultKey, encrypted);
    const result = new Blob([plain], { type: normalizedMimeType });
    new Uint8Array(plain).fill(0);
    return result;
  } finally {
    iv.fill(0);
    encrypted.fill(0);
    bytes.fill(0);
  }
}

/** @param {DataTransferItemList | null | undefined} items */
function firstImageFromItems(items) {
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !SUPPORTED_IMAGE_TYPES.has(String(item.type || '').toLowerCase())) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

/** @param {ClipboardEvent} event */
export function extractPastedImages(event) {
  const items = event?.clipboardData?.items;
  if (!items) return [];
  const images = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !SUPPORTED_IMAGE_TYPES.has(String(item.type || '').toLowerCase())) continue;
    const file = item.getAsFile();
    if (file) images.push(file);
  }
  return images;
}

/** Compatibility wrapper for callers that only accept one pasted image. @param {ClipboardEvent} event */
export function extractPastedImage(event) {
  return extractPastedImages(event)[0] || null;
}

/** @param {DragEvent} event */
export function extractDroppedImage(event) {
  return firstImageFromItems(event?.dataTransfer?.items);
}

/** @param {Set<string>} urls */
export function revokeAttachmentUrls(urls) {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
}

export const ATTACHMENT_LIMIT_BYTES = MAX_ATTACHMENT_BYTES;
