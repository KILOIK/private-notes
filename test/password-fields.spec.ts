import { describe, expect, it, vi } from 'vitest';
import {
	addCustomField,
	copyFieldValue,
	createDefaultPasswordFields,
	removeCustomField,
	toggleSecretVisibility,
} from '../public/password-fields.js';

describe('password field helpers', () => {
	it('creates the five fixed fields in stable order and with the expected types', () => {
		expect(createDefaultPasswordFields()).toEqual([
			{ id: 'name', type: 'text', label: '名称', value: '' },
			{ id: 'username', type: 'text', label: '用户名', value: '' },
			{ id: 'password', type: 'secret', label: '密码', value: '' },
			{ id: 'url', type: 'text', label: '网址', value: '' },
			{ id: 'notes', type: 'multiline', label: '备注', value: '' },
		]);
	});

	it('adds a custom field with a unique id and requested type', () => {
		const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue('custom-1');
		const fields = addCustomField(createDefaultPasswordFields(), 'secret');
		expect(fields.at(-1)).toEqual({ id: 'custom-1', type: 'secret', label: '自定义字段', value: '' });
		expect(randomUUID).toHaveBeenCalledTimes(1);
		randomUUID.mockRestore();
	});

	it('removes only custom fields and rejects fixed-field removal', () => {
		const fields = addCustomField(createDefaultPasswordFields(), 'text');
		const customId = fields.at(-1)?.id;
		expect(customId).toBeTruthy();
		expect(removeCustomField(fields, customId!)).toHaveLength(5);
		expect(() => removeCustomField(fields, 'password')).toThrow(/fixed/i);
	});

	it('toggles only the target secret input without returning its plaintext value', () => {
		const first = { type: 'password', value: 'top-secret' };
		const second = { type: 'password', value: 'other-secret' };

		expect(toggleSecretVisibility(first as never)).toBeUndefined();
		expect(first.type).toBe('text');
		expect(first.value).toBe('top-secret');
		expect(second.type).toBe('password');
		expect(toggleSecretVisibility(first as never)).toBeUndefined();
		expect(first.type).toBe('password');
	});

	it('copies the exact string through only the supplied clipboard API', async () => {
		const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
		await expect(copyFieldValue('exact-value', clipboard)).resolves.toBeUndefined();
		expect(clipboard.writeText).toHaveBeenCalledOnce();
		expect(clipboard.writeText).toHaveBeenCalledWith('exact-value');
		expect(() => copyFieldValue(42 as never, clipboard)).toThrow(/string/i);
	});

	it('propagates clipboard failures without logging or substitution', async () => {
		const error = new Error('clipboard unavailable');
		const clipboard = { writeText: vi.fn().mockRejectedValue(error) };
		await expect(copyFieldValue('secret', clipboard)).rejects.toBe(error);
		expect(clipboard.writeText).toHaveBeenCalledWith('secret');
	});
});
