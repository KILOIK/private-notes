import { describe, expect, it } from 'vitest';
import { matchesNoteFilter, resolveFolderName, sortFolders } from '../public/folder-model.js';

describe('folder model', () => {
	it('sorts folders by newest update and then id', () => {
		const folders = [
			{ id: 'z', name: 'Z', updated_at: 10 },
			{ id: 'b', name: 'B', updated_at: 20 },
			{ id: 'a', name: 'A', updated_at: 20 },
		];

		expect(sortFolders(folders).map((folder) => folder.id)).toEqual(['a', 'b', 'z']);
		expect(folders.map((folder) => folder.id)).toEqual(['z', 'b', 'a']);
	});

	it('resolves absent and deleted folder IDs as 未分类', () => {
		const folders = new Map([['folder-1', { id: 'folder-1', name: '工作' }]]);

		expect(resolveFolderName(folders, 'folder-1')).toBe('工作');
		expect(resolveFolderName(folders, null)).toBe('未分类');
		expect(resolveFolderName(folders, 'deleted-folder')).toBe('未分类');
	});

	it('filters legacy, structured, and password records by category and resolved folder', () => {
		const folders = new Map([['folder-1', { id: 'folder-1', name: '工作' }]]);
		const legacy = { content: '# Legacy note' };
		const note = { content: JSON.stringify({ v: 1, type: 'note', folderId: 'folder-1', markdown: 'Structured' }) };
		const password = { content: JSON.stringify({
			v: 1,
			type: 'password',
			folderId: 'deleted-folder',
			fields: [
				{ id: 'name', type: 'text', label: '名称', value: 'Example' },
				{ id: 'username', type: 'text', label: '用户名', value: 'name' },
				{ id: 'password', type: 'secret', label: '密码', value: 'secret' },
				{ id: 'url', type: 'text', label: '网址', value: '' },
				{ id: 'notes', type: 'multiline', label: '备注', value: '' },
			],
		}) };

		expect(matchesNoteFilter(legacy, 'all', null, folders)).toBe(true);
		expect(matchesNoteFilter(legacy, 'note', null, folders)).toBe(true);
		expect(matchesNoteFilter(legacy, 'password', null, folders)).toBe(false);
		expect(matchesNoteFilter(note, 'note', 'folder-1', folders)).toBe(true);
		expect(matchesNoteFilter(note, 'all', null, folders)).toBe(false);
		expect(matchesNoteFilter(password, 'password', null, folders)).toBe(true);
		expect(matchesNoteFilter(password, 'password', 'deleted-folder', folders)).toBe(false);
	});
});
