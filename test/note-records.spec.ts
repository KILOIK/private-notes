import { describe, expect, it } from 'vitest';
import {
	buildNoteSnippet,
	decodeNoteRecord,
	encodeNoteRecord,
	encodePasswordRecord,
	normalizePasswordFields,
} from '../public/note-records.js';
import { buildNoteCardViewModel } from '../public/markdown.js';

type PasswordField = {
	id: string;
	type: 'text' | 'secret' | 'multiline';
	label: string;
	value: string;
};

describe('note record codecs', () => {
	it('decodes legacy Markdown as a v1 note record', () => {
		const record = decodeNoteRecord('# Hello\n\nLegacy');
		expect(record).toEqual({ v: 1, type: 'note', folderId: null, markdown: '# Hello\n\nLegacy' });
		expect(Object.isFrozen(record)).toBe(true);
	});

	it('round trips a structured note record', () => {
		const record = { v: 1, type: 'note', folderId: 'folder-1', markdown: '**hello**' } as const;
		expect(decodeNoteRecord(encodeNoteRecord(record))).toEqual(record);
	});

	it('normalizes fixed password fields before custom fields', () => {
		const fields = normalizePasswordFields([
			{ id: 'url', type: 'text', label: '', value: 12 },
			{ id: 'custom', type: 'text', label: 'Token', value: 99 },
			{ id: 'notes', type: 'multiline', label: '', value: '' },
			{ id: 'password', type: 'secret', label: '', value: '' },
			{ id: 'name', type: 'text', label: '', value: 'Alice' },
			{ id: 'username', type: 'text', label: '', value: '' },
		]);
		expect(fields.map((field: PasswordField) => field.id)).toEqual(['name', 'username', 'password', 'url', 'notes', 'custom']);
		expect(fields.slice(0, 5)).toEqual([
			{ id: 'name', type: 'text', label: '名称', value: 'Alice' },
			{ id: 'username', type: 'text', label: '用户名', value: '' },
			{ id: 'password', type: 'secret', label: '密码', value: '' },
			{ id: 'url', type: 'text', label: '网址', value: '12' },
			{ id: 'notes', type: 'multiline', label: '备注', value: '' },
		]);
		expect(Object.isFrozen(fields)).toBe(true);
		expect(Object.isFrozen(fields[0])).toBe(true);
	});

	it('rejects malformed password field definitions', () => {
		expect(() => normalizePasswordFields([{ id: 'missing', type: 'text', label: 'x', value: '' }])).toThrow(/fixed/i);
		expect(() => normalizePasswordFields([
			{ id: 'name', type: 'unknown', label: 'Name', value: '' },
		])).toThrow(/field type/i);
		expect(() => normalizePasswordFields([
			{ id: 'name', type: 'text', label: '', value: '' },
			{ id: 'username', type: 'text', label: '', value: '' },
			{ id: 'password', type: 'secret', label: '', value: '' },
			{ id: 'url', type: 'text', label: '', value: '' },
			{ id: 'notes', type: 'multiline', label: '', value: '' },
			{ id: 'custom', type: 'url', label: 'Website', value: '' },
		])).toThrow(/field type/i);
		expect(() => normalizePasswordFields([
			{ id: 'name', type: 'text', label: 'Name', value: '' },
			{ id: 'custom', type: 'text', label: ' ', value: '' },
		])).toThrow(/label/i);
		expect(() => normalizePasswordFields([
			{ id: 'name', type: 'text', label: 'Name', value: '' },
			{ id: 'name', type: 'text', label: 'Duplicate', value: '' },
		])).toThrow(/duplicate/i);
		expect(() => decodeNoteRecord(JSON.stringify({ v: 2, type: 'note', markdown: '' }))).toThrow(/version/i);
		expect(() => decodeNoteRecord(JSON.stringify({ type: 'note', markdown: '' }))).toThrow(/version/i);
	});

	it('encodes password records without a duplicate title property', () => {
		const encoded = encodePasswordRecord({ type: 'password', folderId: 'folder-1', title: 'Ignored', fields: [
			{ id: 'name', type: 'text', label: '名称', value: 'A' },
			{ id: 'username', type: 'text', label: '用户名', value: 'u' },
			{ id: 'password', type: 'secret', label: '密码', value: 'p' },
			{ id: 'url', type: 'text', label: '网址', value: '' },
			{ id: 'notes', type: 'multiline', label: '备注', value: '' },
		] });
		expect(Object.keys(JSON.parse(encoded))).toEqual(['v', 'type', 'folderId', 'fields']);
		expect(decodeNoteRecord(encoded)).toEqual({
			v: 1,
			type: 'password',
			folderId: 'folder-1',
			fields: [
				{ id: 'name', type: 'text', label: '名称', value: 'A' },
				{ id: 'username', type: 'text', label: '用户名', value: 'u' },
				{ id: 'password', type: 'secret', label: '密码', value: 'p' },
				{ id: 'url', type: 'text', label: '网址', value: '' },
				{ id: 'notes', type: 'multiline', label: '备注', value: '' },
			],
		});
	});

	it('builds a plain text character-limited Markdown snippet', () => {
		expect(buildNoteSnippet({ markdown: '# Hello **world**\n\n[link](https://example.com) and `code`' }, 10)).toBe('Hello wor…');
		expect(buildNoteSnippet({ markdown: '<img src=x onerror=alert(1)>safe' }, 20)).toBe('safe');
		expect(buildNoteSnippet({ markdown: '😀😀😀' }, 3)).toBe('😀😀😀');
		expect(buildNoteSnippet({ markdown: '😀😀😀' }, 2)).toBe('😀…');
	});

	it('builds a mainstream note card view model with a plain-text snippet', () => {
		const record = decodeNoteRecord('# Sprint **plan**\n\n- Ship reader details');
		expect(buildNoteCardViewModel({
			title: 'Weekly planning',
			record,
			folder: 'Work',
			createdAt: 1717200000000,
			updatedAt: 1717286400000,
		})).toEqual({
			title: 'Weekly planning',
			snippet: 'Sprint plan Ship reader details',
			type: 'note',
			folder: 'Work',
			createdAt: 1717200000000,
			updatedAt: 1717286400000,
		});
	});
});
