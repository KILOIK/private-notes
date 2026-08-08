import { describe, expect, it } from 'vitest';
import { beginComposerSaving } from '../public/composer-saving.js';

describe('composer saving state', () => {
	it('releases the original inline host after editor mode changes', () => {
		const state = { composerSaving: false, editingInline: true };
		const saveButton = { disabled: false };
		const cancelButton = { disabled: false };
		const attributes = new Map<string, string>();
		const host = {
			inert: false,
			setAttribute(name: string, value: string) { attributes.set(name, value); },
			removeAttribute(name: string) { attributes.delete(name); },
		};

		const release = beginComposerSaving(state, { saveButton, cancelButton, host });
		expect(state.composerSaving).toBe(true);
		expect([saveButton.disabled, cancelButton.disabled]).toEqual([true, true]);
		expect(host.inert).toBe(true);
		expect(attributes.get('aria-busy')).toBe('true');

		state.editingInline = false;
		release();
		expect(state.composerSaving).toBe(false);
		expect([saveButton.disabled, cancelButton.disabled]).toEqual([false, false]);
		expect(host.inert).toBe(false);
		expect(attributes.has('aria-busy')).toBe(false);
	});
});
