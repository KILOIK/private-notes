import { describe, expect, it, vi } from 'vitest';
import { completeComposerSave } from '../public/composer-post-save.js';

describe('composer post-save transaction', () => {
	it('does not close the composer when refreshing notes fails', async () => {
		const refreshNotes = vi.fn(async () => {
			throw new Error('刷新失败');
		});
		const openReader = vi.fn(async () => {});
		const closeComposer = vi.fn();

		await expect(completeComposerSave({
			refreshNotes,
			openReader,
			closeComposer,
			reopenReaderId: null,
		})).rejects.toThrow('刷新失败');
		expect(closeComposer).not.toHaveBeenCalled();
		expect(openReader).not.toHaveBeenCalled();
	});

	it('restores the composer when inline reader reopening fails', async () => {
		const refreshNotes = vi.fn(async () => {});
		const openReader = vi.fn(async () => {
			throw new Error('打开失败');
		});
		const closeComposer = vi.fn();
		const prepareReaderOpen = vi.fn();
		const restoreComposer = vi.fn();

		await expect(completeComposerSave({
			refreshNotes,
			openReader,
			closeComposer,
			reopenReaderId: 'note-1',
			prepareReaderOpen,
			restoreComposer,
		})).rejects.toThrow('打开失败');
		expect(prepareReaderOpen).toHaveBeenCalledOnce();
		expect(restoreComposer).toHaveBeenCalledOnce();
		expect(closeComposer).not.toHaveBeenCalled();
	});

	it('closes only after all post-save operations succeed', async () => {
		const events: string[] = [];
		const refreshNotes = vi.fn(async () => { events.push('refresh'); });
		const openReader = vi.fn(async () => { events.push('open'); });
		const closeComposer = vi.fn(() => { events.push('close'); });

		await completeComposerSave({
			refreshNotes,
			openReader,
			closeComposer,
			reopenReaderId: 'note-1',
		});
		expect(events).toEqual(['refresh', 'open', 'close']);
		expect(closeComposer).toHaveBeenCalledWith(false);
	});
});
