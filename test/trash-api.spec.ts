import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'https://example.com';
const PASSWORD = 'test-default-password-with-strong-entropy';

function encryptedValue(label: string) {
	return `enc:v1:${btoa(JSON.stringify({ iv: btoa('123456789012'), data: btoa(`ciphertext:${label}`) }))}`;
}

function cookieFrom(response: Response) {
	return (response.headers.get('set-cookie') || '').split(';', 1)[0];
}

async function api(path: string, init?: RequestInit) {
	return exports.default.fetch(new Request(`${ORIGIN}${path}`, init));
}

async function login() {
	const response = await api('/api/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.89' },
		body: JSON.stringify({ password: PASSWORD }),
	});
	expect(response.status).toBe(200);
	return cookieFrom(response);
}

async function createNote(cookie: string) {
	const response = await api('/api/notes', {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify({
			id: crypto.randomUUID(),
			title: encryptedValue('trash-title'),
			content: encryptedValue('trash-content'),
		}),
	});
	expect(response.status).toBe(201);
	return (await response.json()) as { note: { id: string; revision: number } };
}

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare('DELETE FROM notes'),
		env.DB.prepare('DELETE FROM note_attachments'),
		env.DB.prepare('DELETE FROM auth_sessions'),
		env.DB.prepare('DELETE FROM app_meta'),
		env.DB.prepare('DELETE FROM auth_rate_limits'),
	]);
});

describe('note trash API', () => {
	it('moves deleted notes out of normal lists, restores them, and permanently removes them', async () => {
		const cookie = await login();
		const created = await createNote(cookie);
		const deleted = await api(`/api/notes/${created.note.id}`, {
			method: 'DELETE',
			headers: { cookie, 'if-match': String(created.note.revision) },
		});
		expect(deleted.status).toBe(200);
		const deletedBody = (await deleted.json()) as { note: { revision: number; deleted_at: number } };
		expect(deletedBody.note.deleted_at).toEqual(expect.any(Number));

		const normalList = await api('/api/notes', { headers: { cookie } });
		expect((await normalList.json()) as { notes: unknown[]; trashCount: number }).toMatchObject({ notes: [], trashCount: 1 });
		const trashList = await api('/api/notes?trash=1', { headers: { cookie } });
		expect((await trashList.json()) as { notes: Array<{ id: string }> }).toMatchObject({ notes: [{ id: created.note.id }] });

		const restored = await api(`/api/notes/${created.note.id}/restore`, {
			method: 'POST',
			headers: { cookie, 'if-match': String(deletedBody.note.revision) },
		});
		expect(restored.status).toBe(200);
		const restoredBody = (await restored.json()) as { note: { revision: number; deleted_at: number | null } };
		expect(restoredBody.note.deleted_at).toBeNull();

		const deletedAgain = await api(`/api/notes/${created.note.id}`, {
			method: 'DELETE',
			headers: { cookie, 'if-match': String(restoredBody.note.revision) },
		});
		const deletedAgainBody = (await deletedAgain.json()) as { note: { revision: number } };
		const permanent = await api(`/api/notes/${created.note.id}/permanent`, {
			method: 'DELETE',
			headers: { cookie, 'if-match': String(deletedAgainBody.note.revision) },
		});
		expect(permanent.status).toBe(200);
		const afterPermanent = await api('/api/notes?trash=1', { headers: { cookie } });
		expect((await afterPermanent.json()) as { notes: unknown[] }).toMatchObject({ notes: [] });
	});

	it('keeps attachments on soft delete and removes them only after permanent delete', async () => {
		const cookie = await login();
		const created = await createNote(cookie);
		const attachmentId = crypto.randomUUID();
		const objectKey = `attachments/${crypto.randomUUID()}`;
		await env.DB.prepare(
			`INSERT INTO note_attachments
				(id, vault_id, note_id, object_key, mime_type, byte_length, width, height, status, created_at, attached_at, detached_at)
			 VALUES (?, 'default', ?, ?, 'image/png', 3, NULL, NULL, 'attached', ?, ?, NULL)`
		)
			.bind(attachmentId, created.note.id, objectKey, Date.now(), Date.now())
			.run();
		await env.ATTACHMENTS.put(objectKey, new Uint8Array([1, 2, 3]));

		const softDeleted = await api(`/api/notes/${created.note.id}`, {
			method: 'DELETE',
			headers: { cookie, 'if-match': String(created.note.revision) },
		});
		const softDeletedBody = (await softDeleted.json()) as { note: { revision: number } };
		expect((await env.DB.prepare('SELECT status FROM note_attachments WHERE id = ?').bind(attachmentId).first<{ status: string }>())?.status).toBe('attached');
		expect(await env.ATTACHMENTS.get(objectKey)).not.toBeNull();

		const permanent = await api(`/api/notes/${created.note.id}/permanent`, {
			method: 'DELETE',
			headers: { cookie, 'if-match': String(softDeletedBody.note.revision) },
		});
		expect(permanent.status).toBe(200);
		expect((await env.DB.prepare('SELECT status FROM note_attachments WHERE id = ?').bind(attachmentId).first<{ status: string }>())?.status).toBe('detached');
		expect(await env.ATTACHMENTS.get(objectKey)).toBeNull();
	});
});
