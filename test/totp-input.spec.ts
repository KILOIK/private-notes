import { describe, expect, it, vi } from 'vitest';
import { applyTotpInput, getCompleteTotpCode, moveTotpFocus, normalizeTotpInput } from '../public/totp-input.js';

describe('totp input helpers', () => {
	it('normalizes pasted and typed values to at most six digits', () => {
		expect(normalizeTotpInput(' 12a3-4567 ')).toBe('123456');
		expect(normalizeTotpInput(null)).toBe('');
	});

	it('returns a code only when all six inputs contain one digit', () => {
		expect(getCompleteTotpCode([{ value: '1' }, { value: '2' }, { value: '3' }, { value: '4' }, { value: '5' }, { value: '6' }])).toBe('123456');
		expect(getCompleteTotpCode([{ value: '1' }, { value: '2' }, { value: '' }, { value: '4' }, { value: '5' }, { value: '6' }])).toBeNull();
		expect(getCompleteTotpCode([{ value: '12' }, { value: '2' }, { value: '3' }, { value: '4' }, { value: '5' }, { value: '6' }])).toBeNull();
	});

	it('distributes a complete six-digit input event across the six code cells', () => {
		const inputs = Array.from({ length: 6 }, () => ({ value: '' }));
		expect(applyTotpInput(inputs, 0, '123456')).toBe('123456');
		expect(inputs.map((input) => input.value).join('')).toBe('123456');
		expect(getCompleteTotpCode(inputs)).toBe('123456');
	});

	it('moves focus one cell in the requested direction without leaving the range', () => {
		const inputs = Array.from({ length: 6 }, () => ({ focus: vi.fn() }));
		expect(moveTotpFocus(inputs, 2, 1)).toBe(3);
		expect(inputs[3].focus).toHaveBeenCalledOnce();
		expect(moveTotpFocus(inputs, 0, -1)).toBe(0);
		expect(inputs[0].focus).toHaveBeenCalledOnce();
	});
});
