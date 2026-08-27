import { expect, it } from 'vitest';
import {
	buildHighlightedTextSegments,
	buildReaderRenderPlan,
	extractAttachmentIds,
	insertMarkdownAtSelection,
	stripPasswordBlocks,
	renderMarkdown,
	replaceAttachmentReference,
} from '../public/markdown.js';

class MarkdownTestNode {
	tagName = '';
	childNodes: MarkdownTestNode[] = [];
	textContent = '';
	href = '';
	target = '';
	rel = '';
	src = '';
	alt = '';
	loading = '';
	className = '';
	attributes = new Map<string, string>();

	constructor(tagName = '') {
		this.tagName = tagName.toUpperCase();
	}

	append(...children: MarkdownTestNode[]) {
		this.childNodes.push(...children);
	}

	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}

	getAttribute(name: string) {
		return this.attributes.get(name) || null;
	}
}

function installMarkdownDocument() {
	const runtime = globalThis as unknown as { document?: unknown; window?: unknown };
	const previousDocument = runtime.document;
	const previousWindow = runtime.window;
	Object.assign(runtime, {
		document: {
			createDocumentFragment: () => new MarkdownTestNode(),
			createElement: (tagName: string) => new MarkdownTestNode(tagName),
			createTextNode: (text: string) => Object.assign(new MarkdownTestNode(), { textContent: text }),
		},
		window: { location: { origin: 'https://notes.example.test' } },
	});
	return () => Object.assign(runtime, { document: previousDocument, window: previousWindow });
}

function flattenTags(root: MarkdownTestNode): string[] {
	return root.childNodes.flatMap((child) => [child.tagName, ...flattenTags(child)]).filter(Boolean);
}

function flattenText(root: MarkdownTestNode): string {
	return root.textContent || root.childNodes.map(flattenText).join('');
}

function findByAttribute(root: MarkdownTestNode, name: string, value: string): MarkdownTestNode | null {
	if (typeof root?.getAttribute === 'function' && root.getAttribute(name) === value) return root;
	for (const child of root.childNodes) {
		const found = findByAttribute(child, name, value);
		if (found) return found;
	}
	return null;
}

it('keeps highlighted note titles as text segments instead of HTML', () => {
	expect(buildHighlightedTextSegments('<img src=x onerror=alert(1)> Weekly', '<img')).toEqual([
		{ text: '<img', highlighted: true },
		{ text: ' src=x onerror=alert(1)> Weekly', highlighted: false },
	]);
	expect(buildHighlightedTextSegments('Alpha ALPHA', 'alpha')).toEqual([
		{ text: 'Alpha', highlighted: true },
		{ text: ' ', highlighted: false },
		{ text: 'ALPHA', highlighted: true },
	]);
});

it('extracts unique attachment references and ignores malformed tokens', () => {
	expect(extractAttachmentIds('![a](attachment://11111111-1111-4111-8111-111111111111)\n![b](attachment://11111111-1111-4111-8111-111111111111)\n![x](attachment://bad)')).toEqual([
		'11111111-1111-4111-8111-111111111111',
	]);
});

it('inserts toolbar Markdown while preserving the textarea selection', () => {
	const textarea = { value: 'hello world', selectionStart: 6, selectionEnd: 11 } as unknown as Parameters<typeof insertMarkdownAtSelection>[0];
	insertMarkdownAtSelection(textarea, '**');
	expect(textarea.value).toBe('hello **world**');
	expect(textarea.selectionStart).toBe(8);
	expect(textarea.selectionEnd).toBe(13);
});

it('replaces or appends an attachment reference', () => {
	const id = '22222222-2222-4222-8222-222222222222';
	expect(replaceAttachmentReference('![old](attachment://11111111-1111-4111-8111-111111111111)', id, 'new')).toBe(`![new](attachment://${id})`);
	expect(replaceAttachmentReference('note', id, 'image')).toContain(`![image](attachment://${id})`);
});

it('loads attachment references only for note reader details', () => {
	const id = '33333333-3333-4333-8333-333333333333';
	expect(buildReaderRenderPlan({
		type: 'note',
		markdown: `![encrypted image](attachment://${id})`,
	})).toEqual({
		renderMarkdown: true,
		markdown: `![encrypted image](attachment://${id})`,
		attachmentIds: [id],
	});
});

it('keeps password reader details out of the Markdown renderer', () => {
	expect(buildReaderRenderPlan({
		type: 'password',
		fields: [{ id: 'password', value: 'never render this' }],
	})).toEqual({
		renderMarkdown: false,
		markdown: '',
		attachmentIds: [],
	});
});

it('renders inline Markdown without treating non-image tokens as images', () => {
	const restore = installMarkdownDocument();
	try {
		const fragment = renderMarkdown('**bold** [docs](https://example.com) `code` ~~old~~ <u>under</u>') as unknown as MarkdownTestNode;
		expect(flattenTags(fragment)).toEqual(['P', 'STRONG', 'A', 'CODE', 'S', 'U']);
	} finally {
		restore();
	}
});

it('unescapes legacy punctuation escapes but preserves literal backslashes', () => {
	const restore = installMarkdownDocument();
	try {
		const fragment = renderMarkdown(String.raw`联系 pmr\_01@126.com，路径 C:\\tmp\\notes`) as unknown as MarkdownTestNode;
		const paragraph = fragment.childNodes[0];
		expect(flattenText(paragraph)).toBe(String.raw`联系 pmr_01@126.com，路径 C:\\tmp\\notes`);
	} finally {
		restore();
	}
});

it('unescapes legacy punctuation escapes inside formatted text', () => {
	const restore = installMarkdownDocument();
	try {
		const fragment = renderMarkdown(String.raw`**pmr\_01@126.com**`) as unknown as MarkdownTestNode;
		const strong = fragment.childNodes[0].childNodes[0].childNodes[0];
		expect(strong.tagName).toBe('STRONG');
		expect(strong.textContent).toBe('pmr_01@126.com');
	} finally {
		restore();
	}
});

it('does not parse underscores inside words as emphasis', () => {
	const restore = installMarkdownDocument();
	try {
		const fragment = renderMarkdown('版本 a_b_c 与 user_name') as unknown as MarkdownTestNode;
		const paragraph = fragment.childNodes[0];
		expect(flattenTags(fragment)).toEqual(['P']);
		expect(flattenText(paragraph)).toBe('版本 a_b_c 与 user_name');
	} finally {
		restore();
	}
});

it('renders password blocks inside the document with a masked input', () => {
	const restore = installMarkdownDocument();
	try {
		const fragment = renderMarkdown('正文前\n\n:::password\nsecret\n:::\n\n正文后') as unknown as MarkdownTestNode;
		expect(flattenTags(fragment)).toContain('INPUT');
		const block = findByAttribute(fragment, 'data-password-block', 'true');
		expect(block).not.toBeNull();
		const input = block!.childNodes[1];
		expect(input.getAttribute('type')).toBe('password');
		expect(input.getAttribute('value')).toBe('secret');
	} finally {
		restore();
	}
});

it('removes password block contents from safe copy/share text', () => {
	const markdown = '正文前\n\n:::password\nsecret\n:::\n\n正文后';
	expect(stripPasswordBlocks(markdown)).toBe('正文前\n\n正文后');
});

it('keeps unsafe links inert and resolves only known encrypted attachments', () => {
	const restore = installMarkdownDocument();
	try {
		const unsafe = renderMarkdown('[unsafe](javascript:alert(1))') as unknown as MarkdownTestNode;
		expect(flattenTags(unsafe)).toEqual(['P']);
		const missing = renderMarkdown('![missing](attachment://11111111-1111-4111-8111-111111111111)') as unknown as MarkdownTestNode;
		expect(flattenTags(missing)).toEqual(['P']);
		const attachments = new Map([['11111111-1111-4111-8111-111111111111', 'blob:encrypted-image']]);
		const resolved = renderMarkdown('![resolved](attachment://11111111-1111-4111-8111-111111111111)', attachments) as unknown as MarkdownTestNode;
		expect(flattenTags(resolved)).toEqual(['P', 'IMG']);
	} finally {
		restore();
	}
});
