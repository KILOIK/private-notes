import { describe, expect, it } from 'vitest';
import { setComposerSaving } from '../public/composer-saving.js';

describe('composer saving state', () => {
	it('disables save, cancel, and close while marking the dialog busy', () => {
		const state = { composerSaving: false };
		const saveButton = { disabled: false };
		const cancelButton = { disabled: false };
		const closeButton = { disabled: false };
		const attributes = new Map<string, string>();
		const modal = {
			setAttribute(name: string, value: string) { attributes.set(name, value); },
			removeAttribute(name: string) { attributes.delete(name); },
		};

		setComposerSaving(state, { saveButton, cancelButton, closeButton, modal }, true);
		expect(state.composerSaving).toBe(true);
		expect([saveButton.disabled, cancelButton.disabled, closeButton.disabled]).toEqual([true, true, true]);
		expect(attributes.get('aria-busy')).toBe('true');

		setComposerSaving(state, { saveButton, cancelButton, closeButton, modal }, false);
		expect(state.composerSaving).toBe(false);
		expect([saveButton.disabled, cancelButton.disabled, closeButton.disabled]).toEqual([false, false, false]);
		expect(attributes.has('aria-busy')).toBe(false);
	});
});
