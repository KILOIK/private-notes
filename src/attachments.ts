const NOTE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTACHMENT_ID_PATTERN = NOTE_ID_PATTERN;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

type AttachmentEnv = {
	DB: D1Database;
	ATTACHMENTS: R2Bucket;
};

type AttachmentRow = {
	id: string;
	vault_id: string;
	note_id: string;
	object_key: string;
	mime_type: string;
	byte_length: number;
	width: number | null;
	height: number | null;
	status: 'pending' | 'attached' | 'detached';
	created_at: number;
	attached_at: number | null;
	detached_at: number | null;
};

export type AttachmentMetadata = Omit<AttachmentRow, 'vault_id' | 'object_key'>;

export class AttachmentError extends Error {
	constructor(readonly status: number, readonly code: string, message: string) {
		super(message);
		this.name = 'AttachmentError';
	}
}

function normalizeUuid(value: string, field: string) {
	if (!NOTE_ID_PATTERN.test(value)) throw new AttachmentError(400, 'invalid_id', `${field} must be a UUID`);
	return value.toLowerCase();
}

function metadata(row: AttachmentRow): AttachmentMetadata {
	const { vault_id: _vaultId, object_key: _objectKey, ...safe } = row;
	return safe;
}

async function readBodyWithLimit(request: Request) {
	if (!request.body) throw new AttachmentError(400, 'empty_attachment', 'attachment body is required');
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > MAX_ATTACHMENT_BYTES) {
			await reader.cancel();
			throw new AttachmentError(413, 'payload_too_large', 'attachment body is too large');
		}
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

async function getRow(env: AttachmentEnv, vaultId: string, attachmentId: string) {
	return env.DB.prepare(
		`SELECT id, vault_id, note_id, object_key, mime_type, byte_length, width, height,
				status, created_at, attached_at, detached_at
		 FROM note_attachments
		 WHERE id = ? AND vault_id = ?
		 LIMIT 1`
	)
		.bind(attachmentId, vaultId)
		.first<AttachmentRow>();
}

export async function createAttachment(
	env: AttachmentEnv,
	ctx: ExecutionContext,
	vaultId: string,
	noteId: string,
	request: Request
): Promise<AttachmentMetadata> {
	const normalizedNoteId = normalizeUuid(noteId, 'noteId');
	const note = await env.DB.prepare('SELECT id FROM notes WHERE id = ? AND vault_id = ? LIMIT 1')
		.bind(normalizedNoteId, vaultId)
		.first<{ id: string }>();
	if (!note && request.headers.get('x-note-draft') !== '1') {
		throw new AttachmentError(404, 'not_found', 'note not found');
	}

	if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/octet-stream') {
		throw new AttachmentError(415, 'unsupported_media_type', 'content-type must be application/octet-stream');
	}
	const mimeType = request.headers.get('x-mime-type')?.trim().toLowerCase() || '';
	if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
		throw new AttachmentError(415, 'unsupported_media_type', 'only supported image MIME types are accepted');
	}
	const declaredLength = request.headers.get('content-length');
	if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_ATTACHMENT_BYTES)) {
		throw new AttachmentError(413, 'payload_too_large', 'attachment body is too large');
	}

	const body = await readBodyWithLimit(request);
	const id = crypto.randomUUID();
	const objectKey = `attachments/${crypto.randomUUID()}`;
	const now = Date.now();
	await env.DB.prepare(
		`INSERT INTO note_attachments
			(id, vault_id, note_id, object_key, mime_type, byte_length, width, height, status, created_at, attached_at, detached_at)
		 VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', ?, NULL, NULL)`
	)
		.bind(id, vaultId, normalizedNoteId, objectKey, mimeType, body.byteLength, now)
		.run();

	try {
		await env.ATTACHMENTS.put(objectKey, body, {
			httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'no-store' },
			customMetadata: { mimeType, noteId: normalizedNoteId, vaultId },
		});
	} catch (error) {
		await env.DB.prepare('DELETE FROM note_attachments WHERE id = ? AND status = \'pending\'').bind(id).run();
		throw error;
	}

	const row = await getRow(env, vaultId, id);
	if (!row) throw new Error('attachment metadata disappeared');
	// Keep the object pending until a successful note save references it. This
	// allows failed saves to leave the prior attachment association untouched.
	void ctx;
	return metadata(row);
}

export async function listAttachments(env: AttachmentEnv, vaultId: string, noteId: string) {
	const normalizedNoteId = normalizeUuid(noteId, 'noteId');
	const result = await env.DB.prepare(
		`SELECT id, vault_id, note_id, object_key, mime_type, byte_length, width, height,
				status, created_at, attached_at, detached_at
		 FROM note_attachments
		 WHERE vault_id = ? AND note_id = ? AND status IN ('pending', 'attached')
		 ORDER BY created_at ASC, id ASC`
	)
		.bind(vaultId, normalizedNoteId)
		.all<AttachmentRow>();
	return (result.results ?? []).map(metadata);
}

export async function getAttachment(env: AttachmentEnv, vaultId: string, attachmentId: string) {
	const id = normalizeUuid(attachmentId, 'attachmentId');
	const row = await getRow(env, vaultId, id);
	if (!row || row.status === 'detached') return null;
	const object = await env.ATTACHMENTS.get(row.object_key);
	if (!object || !('body' in object) || !object.body) return null;
	const headers = new Headers({
		'content-type': 'application/octet-stream',
		'content-length': String(row.byte_length),
		'cache-control': 'no-store',
		'x-attachment-mime-type': row.mime_type,
		'x-content-type-options': 'nosniff',
	});
	return new Response(object.body, { headers });
}

export async function detachAttachment(env: AttachmentEnv, ctx: ExecutionContext, vaultId: string, attachmentId: string) {
	const id = normalizeUuid(attachmentId, 'attachmentId');
	const row = await env.DB.prepare(
		`UPDATE note_attachments
		 SET status = 'detached', detached_at = ?
		 WHERE id = ? AND vault_id = ? AND status IN ('pending', 'attached')
		 RETURNING object_key`
	)
		.bind(Date.now(), id, vaultId)
		.first<{ object_key: string }>();
	if (!row) return false;
	scheduleDetachedObjectDeletion(env, ctx, vaultId, [id]);
	return true;
}

export async function detachPendingAttachment(
	env: AttachmentEnv,
	ctx: ExecutionContext,
	vaultId: string,
	attachmentId: string
) {
	const id = normalizeUuid(attachmentId, 'attachmentId');
	const row = await env.DB.prepare(
		`UPDATE note_attachments
		 SET status = 'detached', detached_at = ?
		 WHERE id = ? AND vault_id = ? AND status = 'pending'
		 RETURNING object_key`
	)
		.bind(Date.now(), id, vaultId)
		.first<{ object_key: string }>();
	if (!row) return false;
	scheduleDetachedObjectDeletion(env, ctx, vaultId, [id]);
	return true;
}

export function scheduleDetachedObjectDeletion(
	env: AttachmentEnv,
	ctx: ExecutionContext,
	vaultId: string,
	attachmentIds?: string[]
) {
	ctx.waitUntil(
		(async () => {
			const whereIds = attachmentIds?.length ? ` AND id IN (${attachmentIds.map(() => '?').join(', ')})` : '';
			const result = await env.DB.prepare(
				`SELECT id, object_key FROM note_attachments
				 WHERE vault_id = ? AND status = 'detached'${whereIds}`
			)
				.bind(vaultId, ...(attachmentIds ?? []))
				.all<{ id: string; object_key: string }>();
			await Promise.all((result.results ?? []).map((row) => env.ATTACHMENTS.delete(row.object_key)));
		})().catch(() => undefined)
	);
}

/** Best-effort cleanup for abandoned uploads. Pending rows are first marked
 * detached so no object is deleted while D1 still claims it is live. */
export function scheduleStaleAttachmentCleanup(env: AttachmentEnv, ctx: ExecutionContext) {
	ctx.waitUntil(
		(async () => {
			const cutoff = Date.now() - 24 * 60 * 60 * 1000;
			await env.DB.prepare(
				`UPDATE note_attachments SET status = 'detached', detached_at = ?
				 WHERE status = 'pending' AND created_at < ?`
			)
				.bind(Date.now(), cutoff)
				.run();
			const result = await env.DB.prepare(
				`SELECT object_key FROM note_attachments WHERE status = 'detached' AND detached_at < ?`
			)
				.bind(Date.now())
				.all<{ object_key: string }>();
			await Promise.all((result.results ?? []).map((row) => env.ATTACHMENTS.delete(row.object_key)));
		})().catch(() => undefined)
	);
}

export async function validateAttachmentIds(env: AttachmentEnv, vaultId: string, noteId: string, ids: string[]) {
	const normalizedNoteId = normalizeUuid(noteId, 'noteId');
	const normalizedIds = [...new Set(ids.map((id) => normalizeUuid(id, 'attachmentId')))];
	if (normalizedIds.length === 0) return;
	const placeholders = normalizedIds.map(() => '?').join(', ');
	const result = await env.DB.prepare(
		`SELECT id FROM note_attachments
		 WHERE vault_id = ? AND note_id = ? AND status IN ('pending', 'attached')
		   AND id IN (${placeholders})`
	)
		.bind(vaultId, normalizedNoteId, ...normalizedIds)
		.all<{ id: string }>();
	const found = new Set((result.results ?? []).map((row) => row.id));
	if (found.size !== normalizedIds.length) {
		throw new AttachmentError(400, 'invalid_attachment_ids', 'attachmentIds must belong to the note and vault');
	}
}

export async function validatePendingAttachmentIds(env: AttachmentEnv, vaultId: string, noteId: string, ids: string[]) {
	const normalizedNoteId = normalizeUuid(noteId, 'noteId');
	const normalizedIds = [...new Set(ids.map((id) => normalizeUuid(id, 'attachmentId')))];
	if (normalizedIds.length === 0) return;
	const placeholders = normalizedIds.map(() => '?').join(', ');
	const result = await env.DB.prepare(
		`SELECT id FROM note_attachments
		 WHERE vault_id = ? AND note_id = ? AND status = 'pending'
		   AND id IN (${placeholders})`
	)
		.bind(vaultId, normalizedNoteId, ...normalizedIds)
		.all<{ id: string }>();
	const found = new Set((result.results ?? []).map((row) => row.id));
	if (found.size !== normalizedIds.length) {
		throw new AttachmentError(400, 'invalid_attachment_ids', 'attachmentIds must be pending for the note and vault');
	}
}

export const ATTACHMENT_LIMIT_BYTES = MAX_ATTACHMENT_BYTES;
