import { describe, expect, it } from 'vitest';
import { getTrashReaderActionModel, getTrashRowMeta } from '../public/trash-ui-state.js';

describe('trash UI state', () => {
	it('removes regular reader commands and exposes restore and permanent delete', () => {
		expect(getTrashReaderActionModel()).toEqual({
			copyVisible: false,
			shareVisible: false,
			editVisible: false,
			restoreVisible: true,
			permanentDeleteVisible: true,
		});
	});

	it('uses the deletion timestamp as the primary trash row time', () => {
		expect(getTrashRowMeta({ deleted_at: 50, updated_at: 40 })).toEqual({ primaryTime: 50, secondaryTime: 40 });
		expect(() => getTrashRowMeta({ deleted_at: null, updated_at: 40 })).toThrow(RangeError);
	});
});
