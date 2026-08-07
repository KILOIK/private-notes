/**
 * @param {{ composerSaving: boolean }} state
 * @param {{
 *   saveButton: { disabled: boolean },
 *   cancelButton: { disabled: boolean },
 *   closeButton: { disabled: boolean },
 *   modal: { inert: boolean, setAttribute(name: string, value: string): void, removeAttribute(name: string): void }
 * }} elements
 * @param {boolean} saving
 */
export function setComposerSaving(state, elements, saving) {
  state.composerSaving = saving;
  elements.saveButton.disabled = saving;
  elements.cancelButton.disabled = saving;
  elements.closeButton.disabled = saving;
  elements.modal.inert = saving;
  if (saving) elements.modal.setAttribute('aria-busy', 'true');
  else elements.modal.removeAttribute('aria-busy');
}
