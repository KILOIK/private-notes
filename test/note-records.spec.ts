import { describe, expect, it } from 'vitest';
import {
	buildNoteSnippet,
	decodeNoteRecord,
	encodeNoteRecord,
	encodePasswordRecord,
	normalizePasswordFields,
} from '../public/note-records.js';

describe('note record codecs', () => {
	it('decodes legacy Markdown as a v1 note record', () => {
		expect(decodeNoteRecord('# Hello\n\nLegacy')).toEqual({ v: 1, type: 'note', folderId: null, markdown: '# Hello\n\nLegacy' });
	});

	it('round trips a structured note record', () => {
		const record = { v: 1, type: 'note', folderId: 'folder-1', markdown: '**hello**' } as const;
		expect(decodeNoteRecord(encodeNoteRecord(record))).toEqual(record);
	});

	it('normalizes fixed password fields before custom fields', () => {
		const fields = normalizePasswordFields([
			{ id: 'url', type: 'url', label: 'URL', value: 12 },
			{ id: 'custom', type: 'text', label: 'Token', value: 99 },
			{ id: 'name', type: 'text', label: 'Name', value: 'Alice' },
		]);
		expect(fields.map((field) => field.id)).toEqual(['name', 'username', 'password', 'url', 'notes', 'custom']);
		expect(fields[0]).toMatchObject({ id: 'name', value: 'Alice' });
		expect(fields[1]).toMatchObject({ id: 'username', value: '' });
		expect(fields[3]).toMatchObject({ id: 'url', value: '12' });
		expect(Object.isFrozen(fields)).toBe(true);
		expect(Object.isFrozen(fields[0])).toBe(true);
	});

	it('rejects malformed password field definitions', () => {
		expect(() => normalizePasswordFields([{ id: 'missing', type: 'text', label: 'x', value: '' }])).toThrow(/fixed/i);
		expect(() => normalizePasswordFields([
			{ id: 'name', type: 'unknown', label: 'Name', value: '' },
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
	});

	it('encodes password records with normalized immutable fields', () => {
		const encoded = encodePasswordRecord({ type: 'password', title: 'Example', fields: [
			{ id: 'name', type: 'text', label: 'Name', value: 'A' },
			{ id: 'username', type: 'text', label: 'Username', value: 'u' },
			{ id: 'password', type: 'secret', label: 'Password', value: 'p' },
			{ id: 'url', type: 'url', label: 'URL', value: '' },
			{ id: 'notes', type: 'multiline', label: 'Notes', value: '' },
		] });
		const decoded = decodeNoteRecord(encoded);
		expect(decoded).toMatchObject({ v: 1, type: 'password', title: 'Example' });
	});

	it('builds a plain text character-limited Markdown snippet', () => {
		expect(buildNoteSnippet({ markdown: '# Hello **world**\n\n[link](https://example.com) and `code`' }, 10)).toBe('Hello wor…');
		expect(buildNoteSnippet({ markdown: '<img src=x onerror=alert(1)>safe' }, 20)).not.toContain('<img');
	});
});
