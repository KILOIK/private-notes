import { expect, it } from 'vitest';
import {
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
