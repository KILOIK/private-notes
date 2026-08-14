import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createDefaultPasswordFields } from '../public/password-fields.js';
import { decodeNoteRecord } from '../public/note-records.js';
import { buildPasswordSavePayload, focusComposerPrimaryField, renderPasswordEditor, renderPasswordReader } from '../public/password-ui.js';

class TestElement {
	children: TestElement[] = [];
	className = '';
	textContent = '';
	type = '';
	value = '';
	rows = 0;
	readOnly = false;
	focused = false;
	onclick: (() => void) | null = null;
	attributes = new Map<string, string>();
	private listeners = new Map<string, Array<() => void>>();

	append(...children: TestElement[]) {
		this.children.push(...children);
	}

	replaceChildren(...children: TestElement[]) {
		this.children = children;
	}

	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}

	focus() {
		this.focused = true;
	}

	querySelector(selector: string) {
		if (selector !== '.password-editor-value') return null;
		return descendants(this).find((element) => element.className.includes('password-editor-value')) || null;
	}

	addEventListener(name: string, callback: () => void) {
		const callbacks = this.listeners.get(name) || [];
		callbacks.push(callback);
		this.listeners.set(name, callbacks);
	}

	dispatch(name: string) {
		for (const callback of this.listeners.get(name) || []) callback();
	}
}

function installDocument() {
	const runtime = globalThis as unknown as { document?: unknown; HTMLInputElement?: unknown };
	const previousDocument = runtime.document;
	const previousInputElement = runtime.HTMLInputElement;
	Object.assign(runtime, {
		document: { createElement: () => new TestElement() },
		HTMLInputElement: TestElement,
	});
	return () => Object.assign(runtime, {
		document: previousDocument,
		HTMLInputElement: previousInputElement,
	});
}

function descendants(root: TestElement): TestElement[] {
	return root.children.flatMap((child) => [child, ...descendants(child)]);
}

describe('password editor and reader behavior', () => {
	it('keeps mobile password labels and values in horizontal columns', async () => {
		const styles = await (await env.ASSETS.fetch(new Request('https://example.com/workspace.css'))).text();
		expect(styles).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.password-reader-field\s*\{[\s\S]*?grid-template-columns:\s*minmax\(54px, 72px\) minmax\(0, 1fr\) auto;/);
		expect(styles).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.password-reader-field \.password-reader-value\s*\{[\s\S]*?grid-column:\s*2;/);
		expect(styles).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.password-reader-field \.password-reader-label\s*\{[\s\S]*?font-size:\s*12px;/);
		expect(styles).toMatch(/\.password-reader-field \.password-field-action\s*\{[\s\S]*?min-width:\s*44px;/);
	});

	it('focuses the independent title for both note and password records', () => {
		const title = new TestElement();
		const passwordFields = new TestElement();
		const name = new TestElement();
		name.className = 'input password-editor-value';
		passwordFields.append(name);

		focusComposerPrimaryField('password', title as never, passwordFields as never);
		expect(name.focused).toBe(false);
		expect(title.focused).toBe(true);

		title.focused = false;
		focusComposerPrimaryField('note', title as never, passwordFields as never);
		expect(title.focused).toBe(true);
	});

	it('adds fields and removes default fields through editor controls', () => {
		const restore = installDocument();
		try {
			const container = new TestElement();
			let fields = createDefaultPasswordFields();
			const update = vi.fn((next) => { fields = next; });

			renderPasswordEditor(container, fields, update);
			expect(descendants(container).filter((element) => element.className.includes('password-editor-value'))).toHaveLength(5);
			expect(descendants(container).find((element) => element.value === '' && element.type === 'password')).toBeTruthy();
			const defaultRemoveButtons = descendants(container).filter((element) => element.textContent === '删除字段');
			expect(defaultRemoveButtons).toHaveLength(5);
			defaultRemoveButtons[0].onclick?.();
			expect(fields.map((field) => field.id)).not.toContain('name');

			renderPasswordEditor(container, fields, update);

			const addSecret = descendants(container).find((element) => element.textContent === '添加隐藏字段');
			expect(addSecret?.onclick).toBeTypeOf('function');
			addSecret?.onclick?.();
			expect(update).toHaveBeenCalledTimes(2);
			expect(fields).toHaveLength(5);
			expect(fields.at(-1)?.type).toBe('secret');
		} finally {
			restore();
		}
	});

	it('serializes password fields with an independent title and preserves folder id', () => {
		const fields = createDefaultPasswordFields();
		fields[0].value = 'Example account';
		fields[2].value = 'not-logged-secret';

		const payload = buildPasswordSavePayload('Identity record', fields.slice(1), 'folder-1');
		expect(payload.title).toBe('Identity record');
		expect(decodeNoteRecord(payload.content)).toMatchObject({
			type: 'password',
			folderId: 'folder-1',
			title: 'Identity record',
			fields: expect.not.arrayContaining([expect.objectContaining({ id: 'name' })]),
		});
	});

	it('copies the clicked reader value and keeps secret visibility separate', async () => {
		const restore = installDocument();
		try {
			const container = new TestElement();
			const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
			const status = vi.fn();
			const fields = createDefaultPasswordFields();
			fields[0].value = '';
			fields[2].value = 'not-logged-secret';
			fields[4].value = 'line 1\nline 2';

			renderPasswordReader(container, { type: 'password', fields }, clipboard, status);
			const controls = descendants(container);
			expect(controls.filter((element) => element.className.includes('password-reader-field'))).toHaveLength(2);
			const secret = controls.find((element) => element.className.includes('password-reader-value') && element.textContent.includes('•'));
			expect(secret?.textContent).toBe('•'.repeat('not-logged-secret'.length));
			expect(secret?.type).toBe('button');
			secret?.onclick?.();
			await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('not-logged-secret'));
			expect(clipboard.writeText).toHaveBeenCalledTimes(1);
			expect(status).toHaveBeenCalledWith('字段已复制');
			const visibility = controls.find((element) => element.className.includes('password-visibility-toggle'));
			expect(visibility?.attributes.get('aria-label')).toBe('显示密码');
			visibility?.onclick?.();
			expect(secret?.textContent).toBe('not-logged-secret');
			expect(clipboard.writeText).toHaveBeenCalledTimes(1);
			expect(controls.some((element) => element.className.includes('password-field-copy'))).toBe(false);
		} finally {
			restore();
		}
	});
});
