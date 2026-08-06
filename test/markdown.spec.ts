import { expect, it } from 'vitest';
import {
	buildReaderRenderPlan,
	extractAttachmentIds,
	insertMarkdownAtSelection,
	replaceAttachmentReference,
} from '../public/markdown.js';

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
