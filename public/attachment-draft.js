/**
 * @typedef {{
 *   token: string,
 *   blob: Blob,
 *   url: string,
 *   attachmentId: string | null,
 *   uploadPromise: Promise<void> | null,
 *   error: unknown
 * }} PendingImage
 * @typedef {{
 *   noteId: string | null,
 *   images: PendingImage[],
 *   pendingAttachments: Map<string, string>
 * }} AttachmentDraft
 */

/** @returns {AttachmentDraft} */
export function createAttachmentDraft() {
  return {
    noteId: null,
    images: [],
    pendingAttachments: new Map(),
  };
}

/** @param {AttachmentDraft} draft @param {Blob} blob @returns {PendingImage} */
export function addPendingImage(draft, blob) {
  if (!(blob instanceof Blob)) throw new TypeError('image blob required');
  const token = `pending://${crypto.randomUUID()}`;
  const url = URL.createObjectURL(blob);
  const pending = { token, blob, url, attachmentId: null, uploadPromise: null, error: null };
  draft.images.push(pending);
  draft.pendingAttachments.set(token, url);
  return pending;
}

/** @param {string} source @param {string} token @param {string} attachmentId */
export function replacePendingToken(source, token, attachmentId) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactToken = new RegExp(`${escaped}(?![A-Za-z0-9._~:/?#\\[\\]@!$&'*+,;=%-])`, 'g');
  return String(source).replace(exactToken, `attachment://${attachmentId}`);
}

/** @param {AttachmentDraft} draft */
export function clearAttachmentDraft(draft) {
  for (const image of draft.images) URL.revokeObjectURL(image.url);
  draft.noteId = null;
  draft.images.length = 0;
  draft.pendingAttachments.clear();
}
