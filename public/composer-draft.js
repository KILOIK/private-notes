/**
 * @param {{ recordType?: string, title?: unknown, folderId?: unknown, fields?: unknown[], markdown?: unknown, pendingCount?: unknown }} draft
 * @returns {string}
 */
export function createComposerDraftSnapshot(draft) {
  return JSON.stringify({
    recordType: draft.recordType === 'password' ? 'password' : 'note',
    title: String(draft.title || ''),
    folderId: typeof draft.folderId === 'string' ? draft.folderId : null,
    fields: Array.isArray(draft.fields) ? draft.fields.map(function (field) {
      return {
        id: String(field.id || ''),
        type: String(field.type || ''),
        label: String(field.label || ''),
        value: String(field.value || ''),
      };
    }) : [],
    markdown: String(draft.markdown || ''),
    pendingCount: Math.max(0, Number(draft.pendingCount) || 0),
  });
}
