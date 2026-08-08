import { describe, expect, it } from 'vitest';
import { createComposerDraftSnapshot } from '../public/composer-draft.js';

describe('composer draft snapshot', () => {
	it('keeps the original markdown source available for an untouched composer', () => {
		const snapshot = createComposerDraftSnapshot({
			recordType: 'note',
			title: '联系人',
			folderId: null,
			markdown: String.raw`pmr\_01@126.com`,
			pendingCount: 0,
		});

		expect(JSON.parse(snapshot).markdown).toBe(String.raw`pmr\_01@126.com`);
	});

	it('changes when a note title, folder, body, or pending image changes', () => {
		const base = createComposerDraftSnapshot({
			recordType: 'note',
			title: '标题',
			folderId: 'work',
			fields: [],
			markdown: '正文',
			pendingCount: 0,
		});

		expect(createComposerDraftSnapshot({ recordType: 'note', title: '新标题', folderId: 'work', fields: [], markdown: '正文', pendingCount: 0 })).not.toBe(base);
		expect(createComposerDraftSnapshot({ recordType: 'note', title: '标题', folderId: 'life', fields: [], markdown: '正文', pendingCount: 0 })).not.toBe(base);
		expect(createComposerDraftSnapshot({ recordType: 'note', title: '标题', folderId: 'work', fields: [], markdown: '新正文', pendingCount: 0 })).not.toBe(base);
		expect(createComposerDraftSnapshot({ recordType: 'note', title: '标题', folderId: 'work', fields: [], markdown: '正文', pendingCount: 1 })).not.toBe(base);
	});
});
