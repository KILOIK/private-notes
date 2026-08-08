import { describe, expect, it } from 'vitest';
import { createComposerDraftSnapshot } from '../public/composer-draft.js';

describe('composer draft snapshot', () => {
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
