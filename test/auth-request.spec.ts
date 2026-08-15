import { describe, expect, it } from 'vitest';
import { shouldPreserveSessionOnUnauthorized } from '../public/auth-request.js';

describe('auth request error handling', () => {
	it('keeps interactive authentication pages alive after credential or code failures', () => {
		expect(shouldPreserveSessionOnUnauthorized('/api/login/totp')).toBe(true);
		expect(shouldPreserveSessionOnUnauthorized('/api/auth/reauth')).toBe(true);
		expect(shouldPreserveSessionOnUnauthorized('/api/notes')).toBe(false);
	});
});
