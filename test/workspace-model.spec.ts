import { describe, expect, it } from 'vitest';
import { buildNavigationModel, buildPasswordDisplayModel, getSortOptions, sortVisibleNotes } from '../public/workspace-model.js';

const folders = [
	{ id: 'work', name: '工作' },
	{ id: 'life', name: '生活' },
];

const notes = [
	{ id: 'n1', title: 'Alpha', created_at: 10, updated_at: 30, record: { type: 'note', folderId: 'work', markdown: '正文' }, folderName: '工作' },
	{ id: 'n2', title: 'Beta', created_at: 20, updated_at: 20, record: { type: 'password', folderId: null, fields: [] }, folderName: '未分类' },
	{ id: 'n3', title: 'Gamma', created_at: 30, updated_at: 40, record: { type: 'note', folderId: null, markdown: '正文' }, folderName: '未分类' },
];

describe('PDF workspace model', () => {
	it('builds navigation counts and grouped entries', () => {
		const model = buildNavigationModel(notes, folders, 'all', undefined, 2);
		expect(model.totalCount).toBe(3);
		expect(model.uncategorizedCount).toBe(2);
		expect(model.categoryCounts).toEqual({ all: 3, note: 2, password: 1 });
		expect(model.folderCounts).toEqual({ work: 1, life: 0 });
		expect(model.trashCount).toBe(2);
		expect(model.activeKey).toBe('all');
	});

	it('sorts visible notes without mutating input', () => {
		expect(getSortOptions()).toEqual([
		{ key: 'updated', label: '最近更新' },
		{ key: 'created', label: '最近创建' },
		{ key: 'title', label: '标题' },
	]);
		expect(sortVisibleNotes(notes, 'updated').map((note) => note.id)).toEqual(['n3', 'n1', 'n2']);
		expect(sortVisibleNotes(notes, 'created').map((note) => note.id)).toEqual(['n3', 'n2', 'n1']);
		expect(sortVisibleNotes(notes, 'title').map((note) => note.id)).toEqual(['n1', 'n2', 'n3']);
		expect(notes.map((note) => note.id)).toEqual(['n1', 'n2', 'n3']);
	});

	it('keeps password display safe and marks multiline fields', () => {
		const model = buildPasswordDisplayModel([
			{ id: 'username', type: 'text', label: '用户名', value: 'user@example.com' },
			{ id: 'password', type: 'secret', label: '密码', value: 'secret-value' },
			{ id: 'notes', type: 'multiline', label: '备注', value: 'long\nnotes' },
		]);
		expect(model).toEqual([
			{ id: 'username', label: '用户名', value: 'user@example.com', hidden: false, multiline: false, copyVisible: true },
			{ id: 'password', label: '密码', value: 'secret-value', hidden: true, multiline: false, copyVisible: true },
			{ id: 'notes', label: '备注', value: 'long\nnotes', hidden: false, multiline: true, copyVisible: true },
		]);
	});
});
