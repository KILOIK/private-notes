import { describe, expect, it, vi } from 'vitest';
import { createDefaultPasswordFields } from '../public/password-fields.js';
import { decodeNoteRecord } from '../public/note-records.js';
import { buildPasswordSavePayload, renderPasswordEditor, renderPasswordReader } from '../public/password-ui.js';

class TestElement {
	children: TestElement[] = [];
	className = '';
	textContent = '';
	type = '';
	value = '';
	rows = 0;
	readOnly = false;
	onclick: (() => void) | null = null;
	private listeners = new Map<string, Array<() => void>>();

	append(...children: TestElement[]) {
		this.children.push(...children);
	}

	replaceChildren(...children: TestElement[]) {
		this.children = children;
	}

	setAttribute() {}

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
	it('creates fixed password fields, adds and removes a custom field through editor controls', () => {
		const restore = installDocument();
		try {
			const container = new TestElement();
			let fields = createDefaultPasswordFields();
			const update = vi.fn((next) => { fields = next; });

			renderPasswordEditor(container, fields, update);
			expect(descendants(container).filter((element) => element.className.includes('password-editor-value'))).toHaveLength(5);
			expect(descendants(container).find((element) => element.value === '' && element.type === 'password')).toBeTruthy();

			const addSecret = descendants(container).find((element) => element.textContent === '添加隐藏字段');
			expect(addSecret?.onclick).toBeTypeOf('function');
			addSecret?.onclick?.();
			expect(update).toHaveBeenCalledOnce();
			expect(fields).toHaveLength(6);
			expect(fields.at(-1)?.type).toBe('secret');

			renderPasswordEditor(container, fields, update);
			const remove = descendants(container).find((element) => element.textContent === '删除字段');
			expect(remove?.onclick).toBeTypeOf('function');
			remove?.onclick?.();
			expect(fields).toHaveLength(5);
		} finally {
			restore();
		}
	});

	it('serializes password fields with the name as title and preserves folder id', () => {
		const fields = createDefaultPasswordFields();
		fields[0].value = 'Example account';
		fields[2].value = 'not-logged-secret';

		const payload = buildPasswordSavePayload(fields, 'folder-1');
		expect(payload.title).toBe('Example account');
		expect(decodeNoteRecord(payload.content)).toMatchObject({
			type: 'password',
			folderId: 'folder-1',
			fields: expect.arrayContaining([
				expect.objectContaining({ id: 'name', value: 'Example account' }),
			]),
		});
	});

	it('renders secret reader fields masked and copies only the clicked field value', async () => {
		const restore = installDocument();
		try {
			const container = new TestElement();
			const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
			const status = vi.fn();
			const fields = createDefaultPasswordFields();
			fields[0].value = 'Example account';
			fields[2].value = 'not-logged-secret';

			renderPasswordReader(container, { type: 'password', fields }, clipboard, status);
			const controls = descendants(container);
			const secret = controls.find((element) => element.type === 'password');
			expect(secret?.value).toBe('not-logged-secret');
			const copy = controls.filter((element) => element.textContent === '复制')[2];
			expect(copy?.onclick).toBeTypeOf('function');
			copy?.onclick?.();
			await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('not-logged-secret'));
			expect(clipboard.writeText).toHaveBeenCalledTimes(1);
			expect(status).toHaveBeenCalledWith('字段已复制');
		} finally {
			restore();
		}
	});
});
