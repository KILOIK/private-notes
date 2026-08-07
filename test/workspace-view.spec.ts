import { describe, expect, it } from 'vitest';
import { getReaderActionModel, getWorkspaceMode, getWorkspacePresentation } from '../public/workspace-view.js';

describe('workspace presentation', () => {
	it('uses exact breakpoints', () => {
		expect(getWorkspaceMode(767)).toBe('mobile');
		expect(getWorkspaceMode(768)).toBe('compact');
		expect(getWorkspaceMode(1179)).toBe('compact');
		expect(getWorkspaceMode(1180)).toBe('wide');
		expect(() => getWorkspaceMode(-1)).toThrow(RangeError);
	});

	it('shows one mobile layer', () => {
		expect(getWorkspacePresentation(390, null, false)).toMatchObject({ activeView: 'list', showList: true, showReader: false });
		expect(getWorkspacePresentation(390, 'n1', false)).toMatchObject({ activeView: 'reader', showList: false, showReader: true, showReaderBack: true });
		expect(getWorkspacePresentation(1024, 'n1', true)).toMatchObject({ mode: 'compact', showNavigation: true, navigationModal: true });
		expect(getWorkspacePresentation(1440, null, true)).toMatchObject({ mode: 'wide', showNavigation: true, navigationOpen: false });
	});

	it('returns from mobile reader to list without opening navigation', () => {
		const reader = getWorkspacePresentation(430, 'n1', false);
		const list = getWorkspacePresentation(430, null, reader.navigationOpen);
		expect(reader.activeView).toBe('reader');
		expect(list).toMatchObject({ activeView: 'list', showList: true, showReader: false, navigationOpen: false });
	});

	it('keeps password-wide operations unavailable', () => {
		expect(getReaderActionModel({ type: 'note' })).toEqual({ copyVisible: true, shareVisible: true, editVisible: true });
		expect(getReaderActionModel({ type: 'password' })).toEqual({ copyVisible: false, shareVisible: false, editVisible: true });
	});
});
