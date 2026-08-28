import { describe, expect, it, vi } from 'vitest';
import { insertPasswordBlock, loadEditorMarkdown, runEditorCommand, serializeEditorMarkdown } from '../public/document-editor.js';

class EditorNode {
	tagName = '';
	nodeType = 1;
	childNodes: EditorNode[] = [];
	textContent = '';
	className = '';
	attributes = new Map<string, string>();
	parentNode: EditorNode | null = null;
	ownerDocument: { execCommand?: ReturnType<typeof vi.fn> } | null = null;

	constructor(tagName = '', text = '') {
		this.tagName = tagName.toUpperCase();
		this.textContent = text;
		if (!tagName) this.nodeType = 3;
	}

	append(...children: EditorNode[]) {
		children.forEach((child) => {
			child.parentNode = this;
			if (!child.tagName && child.childNodes.length) this.childNodes.push(...child.childNodes);
			else this.childNodes.push(child);
		});
	}

	insertBefore(child: EditorNode, reference: EditorNode | null) {
		child.parentNode = this;
		const index = reference ? this.childNodes.indexOf(reference) : -1;
		if (index < 0) this.childNodes.push(child);
		else this.childNodes.splice(index, 0, child);
	}

	replaceChildren(...children: EditorNode[]) {
		this.childNodes = children.length === 1 && !children[0].tagName ? children[0].childNodes.slice() : children;
	}

	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}

	getAttribute(name: string) {
		return this.attributes.get(name) || null;
	}

	removeAttribute(name: string) {
		this.attributes.delete(name);
	}

	contains(node: EditorNode): boolean {
		return node === this || this.childNodes.includes(node) || this.childNodes.some((child) => child.contains(node));
	}

	focus() {}
}

function createEditorDocument() {
	const execCommand = vi.fn(() => true);
	const documentStub = {
		createDocumentFragment: () => new EditorNode(),
		createElement: (tagName: string) => new EditorNode(tagName),
		createTextNode: (text: string) => new EditorNode('', text),
		execCommand,
	};
	return { documentStub, execCommand };
}

function withDocument<T>(documentStub: ReturnType<typeof createEditorDocument>['documentStub'], callback: () => T) {
	const runtime = globalThis as unknown as { document?: unknown; window?: unknown };
	const previousDocument = runtime.document;
	const previousWindow = runtime.window;
	Object.assign(runtime, { document: documentStub, window: { location: { origin: 'https://notes.example.test' } } });
	try {
		return callback();
	} finally {
		Object.assign(runtime, { document: previousDocument, window: previousWindow });
	}
}

function text(value: string) {
	return new EditorNode('', value);
}

function element(tagName: string, children: EditorNode[] = [], attributes: Record<string, string> = {}) {
	const node = new EditorNode(tagName);
	children.forEach((child) => node.append(child));
	Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
	return node;
}

describe('controlled Markdown document editor', () => {
	it('loads Markdown as editable block elements and preserves image sources', () => {
		const { documentStub } = createEditorDocument();
		withDocument(documentStub, () => {
			const editor = new EditorNode('div');
			loadEditorMarkdown(editor as never, '# Title\n\n**bold**');
			expect(editor.childNodes.map((node) => node.tagName)).toEqual(['H1', 'P']);
		});
	});

	it('serializes safe formatting, lists, quotes and images back to Markdown', () => {
		const editor = new EditorNode('div');
		editor.append(
			element('h2', [text('Heading')]),
			element('p', [
				element('strong', [text('bold')]), text(' '),
				element('em', [text('italic')]), text(' '),
				element('u', [text('under')]), text(' '),
				element('s', [text('old')]), text(' '),
				element('code', [text('code')]), text(' '),
				element('a', [text('link')], { href: 'https://example.com' }),
			]),
			element('blockquote', [text('quote')]),
			element('ul', [element('li', [text('one')]), element('li', [text('two')])]),
			element('img', [], { 'data-markdown-src': 'attachment://11111111-1111-4111-8111-111111111111', alt: 'image' }),
		);
		expect(serializeEditorMarkdown(editor as never)).toBe([
			'## Heading',
			'**bold** *italic* <u>under</u> ~~old~~ `code` [link](https://example.com)',
			'> quote',
			'- one\n- two',
			'![image](attachment://11111111-1111-4111-8111-111111111111)',
		].join('\n\n'));
	});

	it('keeps ordered lists when a browser wraps them in a div', () => {
		const editor = new EditorNode('div');
		editor.append(element('div', [
			element('ol', [
				element('li', [text('第一项')]),
				element('li', [text('第二项')]),
			]),
		]));

		expect(serializeEditorMarkdown(editor as never)).toBe('1. 第一项\n2. 第二项');
	});

	it('keeps fenced code when a browser wraps pre/code nodes', () => {
		const editor = new EditorNode('div');
		editor.append(element('div', [
			element('pre', [element('code', [text('const value = 1;')], { class: 'language-ts' })]),
		]));

		expect(serializeEditorMarkdown(editor as never)).toBe('```ts\nconst value = 1;\n```');
	});

	it('serializes an inline password block without changing surrounding text', () => {
		const passwordInput = element('input', [], { type: 'password', value: 'secret' });
		(passwordInput as unknown as { value: string }).value = 'secret';
		const passwordBlock = element('div', [element('span', [text('密码块')]), passwordInput], { 'data-password-block': 'true' });
		const editor = new EditorNode('div');
		editor.append(element('p', [text('正文前')]), passwordBlock, element('p', [text('正文后')]));
		expect(serializeEditorMarkdown(editor as never)).toBe('正文前\n\n:::password\nsecret\n:::\n\n正文后');
	});

	it('moves selected editor text into a password block', () => {
		const editor = new EditorNode('div');
		const paragraph = element('p', [text('需要隐藏')]);
		editor.append(paragraph);
		const inserted: EditorNode[] = [];
		const range = {
			commonAncestorContainer: paragraph,
			startContainer: paragraph,
			toString: () => '需要隐藏',
			deleteContents: vi.fn(() => { paragraph.childNodes = []; }),
			insertNode: vi.fn((node: EditorNode) => { inserted.push(node); }),
			setStartAfter: vi.fn(),
			collapse: vi.fn(),
		};
		const selection = {
			rangeCount: 1,
			getRangeAt: () => range,
			removeAllRanges: vi.fn(),
			addRange: vi.fn(),
		};
		const { documentStub } = createEditorDocument();
		withDocument(documentStub, () => {
			(globalThis as unknown as { window: { getSelection: () => typeof selection } }).window.getSelection = () => selection;
			const block = insertPasswordBlock(editor as never);
			expect(inserted).toHaveLength(0);
			expect(block.childNodes[1].value).toBe('需要隐藏');
			expect(range.deleteContents).toHaveBeenCalled();
			expect(editor.childNodes).toEqual([paragraph, block]);
		});
	});

	it('preserves a literal backslash in a text node when serializing', () => {
		const editor = new EditorNode('div');
		editor.append(element('p', [text(String.raw`pmr\_01@126.com`)]));
		expect(serializeEditorMarkdown(editor as never)).toBe(String.raw`pmr\_01@126.com`);
	});

	it('removes obsolete escape slashes when loading and serializing ordinary text', () => {
		const { documentStub } = createEditorDocument();
		withDocument(documentStub, () => {
			const editor = new EditorNode('div');
			const source = String.raw`联系 pmr\_01@126.com`;
			loadEditorMarkdown(editor as never, source);
			expect(serializeEditorMarkdown(editor as never)).toBe('联系 pmr_01@126.com');
		});
	});

	it('does not add escape slashes to ordinary text containing Markdown punctuation', () => {
		const editor = new EditorNode('div');
		editor.append(element('p', [text('账号 user_name 与路径 C:\\tmp\\notes')]));
		expect(serializeEditorMarkdown(editor as never)).toBe('账号 user_name 与路径 C:\\tmp\\notes');
	});

	it('preserves repeated word-internal underscores without turning them into emphasis', () => {
		const editor = new EditorNode('div');
		editor.append(element('p', [text('版本 a_b_c 与 user_name')]));
		expect(serializeEditorMarkdown(editor as never)).toBe('版本 a_b_c 与 user_name');
	});

	it('does not serialize empty formatting wrappers as visible marker lines', () => {
		const editor = new EditorNode('div');
		editor.append(element('p', [element('strong', [element('br')]), text('正文')]));
		expect(serializeEditorMarkdown(editor as never)).toBe('正文');
	});

	it('keeps nested list indentation when serializing wrapped blocks', () => {
		const editor = new EditorNode('div');
		editor.append(element('div', [
			element('ol', [
				element('li', [
					text('父项'),
					element('ul', [element('li', [text('子项')])]),
				]),
			]),
		]));

		expect(serializeEditorMarkdown(editor as never)).toBe('1. 父项\n  - 子项');
	});

	it('drops unsafe links to plain text and maps toolbar commands', () => {
		const editor = new EditorNode('div');
		const unsafeLink = element('a', [text('unsafe')], { href: 'javascript:alert(1)' });
		editor.append(element('p', [unsafeLink]));
		expect(serializeEditorMarkdown(editor as never)).toBe('unsafe');

		const { documentStub, execCommand } = createEditorDocument();
		editor.ownerDocument = documentStub;
		expect(runEditorCommand(editor as never, 'bold')).toBe(true);
		expect(runEditorCommand(editor as never, 'heading')).toBe(true);
		expect(runEditorCommand(editor as never, 'ordered-list')).toBe(true);
		expect(runEditorCommand(editor as never, 'code-block')).toBe(true);
		expect(execCommand).toHaveBeenNthCalledWith(1, 'bold', false, undefined);
		expect(execCommand).toHaveBeenNthCalledWith(2, 'formatBlock', false, '<h2>');
		expect(execCommand).toHaveBeenNthCalledWith(3, 'insertOrderedList', false, undefined);
		expect(execCommand).toHaveBeenNthCalledWith(4, 'formatBlock', false, '<pre>');
	});
});
