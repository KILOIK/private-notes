/**
 * Finish the non-encrypted UI work after an API note save. The composer is
 * closed only after refreshing the list and, for inline editing, reopening the
 * reader have both succeeded. This keeps the editor and attachment draft
 * reusable when either operation fails.
 *
 * @param {{
 *   refreshNotes: () => Promise<void>,
 *   openReader: (id: string) => Promise<void>,
 *   closeComposer: (discardDraft?: boolean) => void,
 *   reopenReaderId: string | null,
 *   prepareReaderOpen?: () => void,
 *   restoreComposer?: () => void,
 * }} options
 */
export async function completeComposerSave(options) {
  await options.refreshNotes();
  if (options.reopenReaderId) {
    if (options.prepareReaderOpen) options.prepareReaderOpen();
    try {
      await options.openReader(options.reopenReaderId);
    } catch (error) {
      if (options.restoreComposer) options.restoreComposer();
      throw error;
    }
  }
  options.closeComposer(false);
}
