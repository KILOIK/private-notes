import { describe, expect, it } from 'vitest';
import {
	buildNoteSnippet,
	buildNoteSaveContent,
	decodeNoteRecord,
	encodeNoteRecord,
	encodePasswordRecord,
	getSafeRecordText,
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

	it('builds ordinary note save content with the selected folder', () => {
		expect(decodeNoteRecord(buildNoteSaveContent('# Folder note', 'folder-1'))).toEqual({
			v: 1,
			type: 'note',
			folderId: 'folder-1',
			markdown: '# Folder note',
		});
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

	it('accepts partial password fields and rejects malformed definitions', () => {
		expect(normalizePasswordFields([{ id: 'username', type: 'text', label: '用户名', value: 'alice' }])).toEqual([
			{ id: 'username', type: 'text', label: '用户名', value: 'alice' },
		]);
		expect(() => normalizePasswordFields([{ id: ' ', type: 'text', label: 'x', value: '' }])).toThrow(/field id/i);
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

	it('encodes password records with an independent title property', () => {
		const encoded = encodePasswordRecord({ type: 'password', folderId: 'folder-1', title: 'Ignored', fields: [
			{ id: 'name', type: 'text', label: '名称', value: 'A' },
			{ id: 'username', type: 'text', label: '用户名', value: 'u' },
			{ id: 'password', type: 'secret', label: '密码', value: 'p' },
			{ id: 'url', type: 'text', label: '网址', value: '' },
			{ id: 'notes', type: 'multiline', label: '备注', value: '' },
		] });
		expect(Object.keys(JSON.parse(encoded))).toEqual(['v', 'type', 'folderId', 'title', 'fields']);
		expect(decodeNoteRecord(encoded)).toEqual({
			v: 1,
			type: 'password',
			folderId: 'folder-1',
			title: 'Ignored',
			fields: [
				{ id: 'name', type: 'text', label: '名称', value: 'A' },
				{ id: 'username', type: 'text', label: '用户名', value: 'u' },
				{ id: 'password', type: 'secret', label: '密码', value: 'p' },
				{ id: 'url', type: 'text', label: '网址', value: '' },
				{ id: 'notes', type: 'multiline', label: '备注', value: '' },
			],
		});
	});

	it('keeps an independent password title and accepts zero fields', () => {
		const content = encodePasswordRecord({ type: 'password', folderId: null, title: '身份记录', fields: [] });
		expect(decodeNoteRecord(content)).toEqual({
			v: 1,
			type: 'password',
			folderId: null,
			title: '身份记录',
			fields: [],
		});
	});

	it('derives a legacy password title without restoring deleted fields', () => {
		const record = decodeNoteRecord(JSON.stringify({
			v: 1,
			type: 'password',
			folderId: null,
			fields: [{ id: 'name', type: 'text', label: '名称', value: '旧账号' }],
		}));
		expect(record).toEqual({
			v: 1,
			type: 'password',
			folderId: null,
			title: '旧账号',
			fields: [{ id: 'name', type: 'text', label: '名称', value: '旧账号' }],
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

	it('keeps password secrets out of list summaries', () => {
		const record = decodeNoteRecord(JSON.stringify({ v: 1, type: 'password', folderId: null, fields: [
			{ id: 'name', type: 'text', label: '名称', value: 'Account' },
			{ id: 'username', type: 'text', label: '用户名', value: 'private-user' },
			{ id: 'password', type: 'secret', label: '密码', value: 'private-secret' },
			{ id: 'url', type: 'text', label: '网址', value: '' },
			{ id: 'notes', type: 'multiline', label: '备注', value: '' },
		] }));
		const model = buildNoteCardViewModel({ title: 'Account', record, folder: '工作', createdAt: 1, updatedAt: 2 });
		expect(model.snippet).toBe('密码记录');
		expect(JSON.stringify(model)).not.toContain('private-secret');
		expect(JSON.stringify(model)).not.toContain('private-user');
	});

	it('returns only Markdown for safe note sharing and copying', () => {
		const note = decodeNoteRecord(JSON.stringify({ v: 1, type: 'note', folderId: null, markdown: '# Share me' }));
		const password = decodeNoteRecord(JSON.stringify({ v: 1, type: 'password', folderId: null, fields: [
			{ id: 'name', type: 'text', label: '名称', value: 'Account' },
			{ id: 'username', type: 'text', label: '用户名', value: 'alice' },
			{ id: 'password', type: 'secret', label: '密码', value: 'secret' },
			{ id: 'url', type: 'text', label: '网址', value: '' },
			{ id: 'notes', type: 'multiline', label: '备注', value: '' },
		] }));
		expect(getSafeRecordText(note, 'legacy')).toBe('# Share me');
		expect(getSafeRecordText(null, 'legacy')).toBe('legacy');
		expect(getSafeRecordText(password, 'legacy')).toBeNull();
	});
});
