import { describe, expect, it, vi } from 'vitest';
import { moveTotpFocus, normalizeTotpInput } from '../public/totp-input.js';

describe('totp input helpers', () => {
	 it('normalizes pasted and typed values to at most six digits', () => {
		expect(normalizeTotpInput(' 12a3-4567 ')).toBe('123456');
		expect(normalizeTotpInput(null)).toBe('');
	});

	it('moves focus one cell in the requested direction without leaving the range', () => {
		const inputs = Array.from({ length: 6 }, () => ({ focus: vi.fn() }));
		expect(moveTotpFocus(inputs, 2, 1)).toBe(3);
		expect(inputs[3].focus).toHaveBeenCalledOnce();
		expect(moveTotpFocus(inputs, 0, -1)).toBe(0);
		expect(inputs[0].focus).toHaveBeenCalledOnce();
	});
});
