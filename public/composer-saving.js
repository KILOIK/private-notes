/**
 * @param {{ composerSaving: boolean }} state
 * @param {{
 *   saveButton: { disabled: boolean },
 *   cancelButton: { disabled: boolean },
 *   host: { inert: boolean, setAttribute(name: string, value: string): void, removeAttribute(name: string): void }
 * }} elements
 * @param {boolean} saving
 */
export function setComposerSaving(state, elements, saving) {
  state.composerSaving = saving;
  elements.saveButton.disabled = saving;
  elements.cancelButton.disabled = saving;
  elements.host.inert = saving;
  if (saving) elements.host.setAttribute('aria-busy', 'true');
  else elements.host.removeAttribute('aria-busy');
}

/**
 * @param {{ composerSaving: boolean }} state
 * @param {{ saveButton: { disabled: boolean }, cancelButton: { disabled: boolean }, host: { inert: boolean, setAttribute(name: string, value: string): void, removeAttribute(name: string): void } }} elements
 * @returns {() => void}
 */
export function beginComposerSaving(state, elements) {
  setComposerSaving(state, elements, true);
  return function releaseComposerSaving() {
    setComposerSaving(state, elements, false);
  };
}
