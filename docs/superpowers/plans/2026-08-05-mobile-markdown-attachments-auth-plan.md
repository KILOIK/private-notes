# Mobile Markdown Attachments and Authenticator Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended; execution later) or superpowers:executing-plans (inline execution later) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Private Notes with a mobile-first Markdown memo experience, client-encrypted R2 image attachments, deployment-wide TOTP authentication, and a server-enforced 30-minute idle re-verification window without changing the existing client-encryption or vault-isolation boundary.

**Architecture:** Keep encrypted note title/body fields and the existing `enc:v1` envelope. Add focused Worker modules for TOTP, server-side session activity, and R2 attachment lifecycle; add browser modules for safe Markdown rendering, block-style Markdown helpers, and attachment crypto. The Worker never decrypts note or image content, while D1 stores only attachment/session metadata and R2 stores binary ciphertext.

**Tech Stack:** Cloudflare Workers, D1, R2, TypeScript, Web Crypto API, browser ES modules, Vitest Workers pool, existing static-assets frontend, CSS media queries.

## Global Constraints

- Node.js `>=22.0.0`.
- Preserve the existing `PBKDF2-SHA256 + AES-256-GCM` vault key derivation and `enc:v1` note ciphertext format.
- Preserve HttpOnly, Secure, SameSite=Strict session cookies, vault isolation, revision optimistic locking, and one-time-share atomic consumption.
- Authenticator is one deployment-wide TOTP configuration, not one secret per vault.
- Idle timeout is 30 minutes of user inactivity; the existing 30-day absolute Session lifetime remains.
- TOTP secret is encrypted at rest and recovery codes are stored only as hashes.
- R2 is private to the Worker; do not expose a public bucket URL or direct public object access.
- Images are encrypted in the browser before upload; initial application limit is 10 MB per image.
- Markdown preview rejects raw HTML, scripts, dangerous URL schemes, and external images; only `attachment://<id>` image references are rendered.
- Mobile opens notes in reader mode; desktop uses list + content split view; delete remains inside a secondary “More” menu with confirmation.
- Run `wrangler types` after changing `wrangler.jsonc` bindings.
- Never write note plaintext, image plaintext, vault keys, TOTP secrets, or recovery-code plaintext to logs, D1, R2, `localStorage`, or `sessionStorage`.

---

## File Map

### Backend and infrastructure

- Modify: `wrangler.jsonc` — add the private `ATTACHMENTS` R2 binding.
- Modify: `worker-configuration.d.ts` — regenerate Worker binding types after Wrangler config changes.
- Modify: `src/schema.ts` — include new migration names in the bootstrap safety allowlist and schema checks.
- Create: `migrations/0008_attachments.sql` — attachment metadata table and vault/note/status indexes.
- Create: `migrations/0009_totp_sessions.sql` — global TOTP metadata, recovery-code hashes, and server-side session activity table.
- Modify: `src/auth.ts` — versioned session payloads, session-row lifecycle, TOTP challenge state, and idle checks while retaining existing credential fingerprints and rate limits.
- Create: `src/totp.ts` — RFC 6238-compatible base32/HMAC/dynamic-truncation code, secret generation, code validation, and recovery-code helpers.
- Create: `src/totp-secret.ts` — encrypt/decrypt the deployment-wide TOTP secret with a key derived from the Worker signing secret.
- Create: `src/attachments.ts` — validate attachment requests, authorize vault/note ownership, persist D1 metadata, and stream R2 ciphertext.
- Modify: `src/index.ts` — route login/TOTP/reauth/idle responses, attachment endpoints, note `attachmentIds` validation, and `ctx.waitUntil()` cleanup.
- Modify: `public/_headers` — permit same-origin `blob:` image rendering while keeping external images blocked.

### Browser application

- Modify: `public/index.html` — add TOTP challenge/enrollment controls, responsive note navigation, More menus, editor toolbar, editor mode controls, image drop/paste affordances, and attachment settings text.
- Modify: `public/app.js` — orchestrate state, API calls, reader/editor transitions, list metadata, idle lock, TOTP flows, attachment lifecycle, and share payload assembly.
- Create: `public/markdown.js` — dependency-free allowlisted Markdown parser/renderer and source helpers.
- Create: `public/attachment-crypto.js` — browser image encryption/decryption, binary envelope handling, paste/drop extraction, and blob URL cleanup.
- Modify: `public/share-crypto.js` — extend the share envelope type with encrypted attachment entries while preserving `share:v1` framing.
- Modify: `public/share.js` — download/decrypt attachment entries from a consumed share and revoke their blob URLs on teardown.
- Modify: `public/styles.css` — mobile reader/editor states, desktop split layout, compact list timestamps, toolbar, attachment blocks, More menu, and safe-area/focus styles.

### Tests and docs

- Modify: `vitest.config.mts` — expose an in-memory R2 binding and migration list to Workers tests.
- Modify: `test/env.d.ts` — type the test-only R2 binding if generated types do not expose it.
- Modify: `test/apply-migrations.ts` — apply the new migrations in test setup.
- Modify: `test/index.spec.ts` — integration coverage for migrations, TOTP routes, idle reauth, attachments, note references, and share regression.
- Create: `test/totp.spec.ts` — deterministic RFC test vectors and recovery-code behavior.
- Create: `test/markdown.spec.ts` — safe renderer and Markdown helper tests.
- Create: `test/attachment-crypto.spec.ts` — browser crypto envelope and blob lifecycle tests.
- Modify: `README.md` — R2 provisioning, TOTP enrollment/recovery, idle-lock behavior, attachment limits, and rollback instructions.
- Modify: `.dev.vars.example` — document optional TOTP test flags and the fact that production TOTP state lives in D1, not a secret variable.

---

## Task 1: Import and verify the upstream baseline

**Files:**
- Add to Git: all synchronized upstream files currently untracked in the workspace, excluding `.superpowers/` and generated visual-companion content.
- Test: existing `npm run check` suite.

**Interfaces:**
- Produces a clean, tracked baseline commit that later tasks can compare against.

- [ ] **Step 1: Install the locked dependency set**

Run:

```bash
npm ci
```

Expected: installation completes using `package-lock.json` without changing application source files.

- [ ] **Step 2: Run the pre-change verification suite**

Run:

```bash
npm run check
```

Expected: typecheck, client check, tool tests, and Workers integration tests pass before feature work begins. Record any baseline failure instead of silently attributing it to later tasks.

- [ ] **Step 3: Track the synchronized source baseline**

Run:

```bash
git add .dev.vars.example .editorconfig .github .gitignore .node-version .prettierrc .vscode AGENTS.md README.md migrations package-lock.json package.json public src test tools tsconfig.client.json tsconfig.json vitest.config.mts worker-configuration.d.ts wrangler.jsonc
git commit -m "chore: import private-notes upstream baseline"
```

Expected: the imported source is tracked separately from the approved design and implementation commits.

---

## Task 2: Add schema and R2 binding scaffolding

**Files:**
- Create: `migrations/0008_attachments.sql`
- Create: `migrations/0009_totp_sessions.sql`
- Modify: `src/schema.ts`
- Modify: `wrangler.jsonc`
- Modify: `vitest.config.mts`
- Modify: `test/apply-migrations.ts`
- Modify: `test/index.spec.ts`
- Regenerate: `worker-configuration.d.ts`

**Interfaces:**
- Produces tables `note_attachments`, `auth_recovery_codes`, and `auth_sessions` plus the `ATTACHMENTS: R2Bucket` binding used by later tasks.

- [ ] **Step 1: Write migration bootstrap assertions**

Extend the existing empty-D1 bootstrap test with exact table and journal expectations:

```ts
expect((journal.results ?? []).map((row) => row.name)).toEqual([
  '0001_init.sql', '0002_notes_fts.sql', '0003_app_meta.sql',
  '0004_auth_rate_limits.sql', '0005_note_vaults.sql',
  '0006_hardening.sql', '0007_one_time_shares.sql',
  '0008_attachments.sql', '0009_totp_sessions.sql'
]);
expect(new Set((tables.results ?? []).map((row) => row.name))).toEqual(
  new Set(['app_meta', 'auth_rate_limits', 'auth_recovery_codes',
    'auth_sessions', 'd1_migrations', 'note_attachments', 'note_shares', 'notes'])
);
```

- [ ] **Step 2: Run the focused migration test and verify it fails**

Run:

```bash
npx vitest run test/index.spec.ts -t "bootstraps only a completely empty D1 database"
```

Expected: FAIL because the new migration names and tables do not exist yet.

- [ ] **Step 3: Implement the migrations and bootstrap allowlist**

Create `note_attachments` with a primary key on `id`, a unique index on `(vault_id, object_key)`, and indexes on `(vault_id, note_id, status)` and `(status, created_at)`. Create `auth_recovery_codes` with a unique `code_hash` and consumed timestamp. Create `auth_sessions` with a unique `id_hash`, vault ID, created/last-activity/last-reauth/expiry/revocation timestamps.

Add both migration names to `APPLICATION_MIGRATION_NAMES` and the `APPLICATION_TABLE_NAMES` safety check in `src/schema.ts`.

Add this binding to `wrangler.jsonc`:

```jsonc
"r2_buckets": [
  { "binding": "ATTACHMENTS", "bucket_name": "private-notes-attachments" }
]
```

Expose an in-memory R2 binding through the Workers test configuration, then run:

```bash
npx wrangler types
```

- [ ] **Step 4: Run the focused migration and type checks**

Run:

```bash
npx vitest run test/index.spec.ts -t "bootstraps only a completely empty D1 database"
npm run typecheck
```

Expected: PASS with the new journal/table list and an `ATTACHMENTS` binding type.

- [ ] **Step 5: Commit the schema boundary**

```bash
git add migrations/0008_attachments.sql migrations/0009_totp_sessions.sql src/schema.ts wrangler.jsonc worker-configuration.d.ts vitest.config.mts test/apply-migrations.ts test/index.spec.ts
git commit -m "feat: add attachment and authenticator storage bindings"
```

---

## Task 3: Implement deterministic TOTP and secret-at-rest helpers

**Files:**
- Create: `src/totp.ts`
- Create: `src/totp-secret.ts`
- Create: `test/totp.spec.ts`

**Interfaces:**
- `generateTotpSecret(): string`
- `verifyTotpCode(secret: string, code: string, nowMs: number, allowedSkewSteps: number): Promise<{ valid: boolean; counter: number | null }>`
- `generateRecoveryCodes(count: number): string[]`
- `hashRecoveryCode(code: string): Promise<string>`
- `encryptTotpSecret(secret: string, signingSecret: string): Promise<string>`
- `decryptTotpSecret(ciphertext: string, signingSecret: string): Promise<string>`

- [ ] **Step 1: Write RFC-vector and input-validation tests**

Use the RFC 6238 SHA-1 test secret and timestamps in `test/totp.spec.ts`. Assert exact six-digit codes for the published timestamps, reject non-six-digit/non-numeric values, reject malformed base32, and accept only the configured adjacent time-step window.

```ts
it('matches the RFC 6238 SHA-1 vectors', async () => {
  const secret = '12345678901234567890';
  await expect(verifyTotpCode(secret, '287082', 59_000, 0)).resolves.toMatchObject({ valid: true });
  await expect(verifyTotpCode(secret, '081804', 1_111_111_109_000, 0)).resolves.toMatchObject({ valid: true });
});
```

- [ ] **Step 2: Run the focused unit tests and verify they fail**

Run:

```bash
npx vitest run test/totp.spec.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement base32 decoding, HMAC-SHA1 truncation, and secret encryption**

Use `crypto.subtle.sign('HMAC', ...)`, an 8-byte counter, dynamic truncation, and constant-time comparison. Generate 20 random secret bytes and encode them with unpadded base32. Derive an AES-GCM wrapping key from the deployment signing secret with HKDF-SHA-256 and use a fresh random IV for each stored TOTP-secret ciphertext.

- [ ] **Step 4: Add recovery-code tests and implementation**

Generate 10 printable recovery codes, assert uniqueness, hash them before persistence, and ensure hash output is deterministic for the same input while the plaintext code never appears in the hash string.

- [ ] **Step 5: Run the unit tests and commit**

Run:

```bash
npx vitest run test/totp.spec.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/totp.ts src/totp-secret.ts test/totp.spec.ts
git commit -m "feat: add TOTP and recovery-code primitives"
```

---

## Task 4: Add deployment-wide TOTP login and server-side idle sessions

**Files:**
- Modify: `src/auth.ts`
- Modify: `src/index.ts`
- Modify: `test/index.spec.ts`

**Interfaces:**
- `getSession(request, env): Promise<SessionData>` returns `{ authenticated, vaultId, reauthRequired, sessionId }`.
- `createPendingTwoFactorChallenge(env, vaultId, passwordFingerprint): Promise<string>` stores only a short-lived hashed challenge.
- `verifyTwoFactorChallenge(env, challengeId, codeOrRecoveryCode): Promise<SessionData | null>` consumes a valid challenge atomically.
- `touchSessionActivity(env, sessionId, nowMs): Promise<void>` updates activity only for user-action endpoints.
- `requireActiveSession(request, env, options): Promise<SessionData>` returns an active session or throws a `reauth_required` response.

- [ ] **Step 1: Write integration tests for the existing login contract**

Assert that a deployment with no TOTP metadata still returns the current 200 login response and a cookie, while a deployment with `totp_enabled=1` returns `202` plus `{ code: 'two_factor_required', challengeId }` without setting the full session cookie.

- [ ] **Step 2: Write failing tests for TOTP enrollment and recovery**

Cover: password-gated enrollment, confirmation with the current code, global scope across the guest vault, wrong-code rate limiting, single-use recovery code, disable with current TOTP, and generic unauthorized errors.

- [ ] **Step 3: Write failing tests for idle enforcement**

Insert a session row with `last_activity_at = Date.now() - 30*60*1000 - 1`, call `/api/notes`, and assert `401`/`reauth_required` with no note body. Call `/api/auth/reauth` with valid password + TOTP and assert the same session resumes with updated timestamps.

- [ ] **Step 4: Implement versioned session rows without weakening current cookie checks**

Add a random session ID to the signed cookie payload, keep credential fingerprint and HMAC validation, insert/update the matching `auth_sessions` row, and reject missing/expired/revoked/idle rows. Treat legacy v2 cookies as requiring a one-time upgrade path; when TOTP is enabled, legacy cookies must complete TOTP before being upgraded.

- [ ] **Step 5: Implement TOTP metadata and routes**

Use `app_meta` keys for the global enable flag and encrypted secret; store recovery-code hashes atomically. Add the login challenge, confirm, enroll, disable, and reauth routes before the generic authenticated route guard. Reuse `getLoginRateLimit`, `recordFailedLogin`, and `clearFailedLogins` for both password and TOTP failures.

- [ ] **Step 6: Apply idle checks to user-action routes only**

Exclude `/api/session`, `/api/health`, and the TOTP challenge endpoint from activity refresh. Refresh activity for note reads/writes, attachment operations, share creation, and key-check operations. Return a stable JSON `{ ok:false, error:'reauth_required' }` without exposing ciphertext when the session is idle.

- [ ] **Step 7: Run backend auth tests and commit**

Run:

```bash
npx vitest run test/index.spec.ts -t "TOTP|two-factor|idle|session"
npm run typecheck
```

Expected: PASS.

```bash
git add src/auth.ts src/index.ts test/index.spec.ts
git commit -m "feat: add deployment-wide TOTP and idle reauthentication"
```

---

## Task 5: Implement R2 attachment authorization and lifecycle

**Files:**
- Create: `src/attachments.ts`
- Modify: `src/index.ts`
- Modify: `test/index.spec.ts`

**Interfaces:**
- `createAttachment(env, ctx, vaultId, noteId, request): Promise<AttachmentMetadata>`
- `listAttachments(env, vaultId, noteId): Promise<AttachmentMetadata[]>`
- `getAttachment(env, vaultId, attachmentId): Promise<Response | null>`
- `detachAttachment(env, ctx, vaultId, attachmentId): Promise<boolean>`
- `validateAttachmentIds(env, vaultId, noteId, ids): Promise<void>`

- [ ] **Step 1: Write failing R2 integration tests**

Cover binary upload with valid `application/octet-stream`, 10 MB rejection, non-image MIME rejection, note/vault authorization, metadata listing, ciphertext download, deletion, and a failed note save leaving the prior attachment attached.

```ts
const uploaded = await api('/api/attachments', {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/octet-stream', 'x-note-id': noteId, 'x-mime-type': 'image/png' },
  body: encryptedImageBytes
});
expect(uploaded.status).toBe(201);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npx vitest run test/index.spec.ts -t "attachment"
```

Expected: FAIL because no attachment route exists.

- [ ] **Step 3: Implement strict binary request validation**

Require an authenticated active session, a valid UUID note ID, an existing note owned by the session vault, an image MIME allowlist (`image/jpeg`, `image/png`, `image/gif`, `image/webp`), a declared `content-length` no greater than 10 MB plus envelope overhead, and a streamed body size check. Generate a fresh attachment UUID and opaque R2 object key on the Worker.

- [ ] **Step 4: Implement D1/R2 write and cleanup semantics**

Write a `pending` D1 row before `ATTACHMENTS.put`, delete the row if the R2 write fails, and mark omitted IDs `detached` during a successful note save. Use `ctx.waitUntil()` for best-effort R2 deletion and a later lazy cleanup of stale `pending`/`detached` rows; never delete an object until the D1 state says it is detached.

- [ ] **Step 5: Extend note create/update validation**

Parse optional `attachmentIds` as a unique array of UUIDs, call `validateAttachmentIds`, and include the list in the same D1 transaction as the note revision update. Keep the current 428/409 revision behavior unchanged.

- [ ] **Step 6: Run attachment and regression tests, then commit**

Run:

```bash
npx vitest run test/index.spec.ts -t "attachment|revision|vault"
npm run typecheck
```

Expected: PASS.

```bash
git add src/attachments.ts src/index.ts test/index.spec.ts
git commit -m "feat: add private R2 attachment lifecycle"
```

---

## Task 6: Add browser attachment crypto and Markdown-safe references

**Files:**
- Create: `public/attachment-crypto.js`
- Create: `test/attachment-crypto.spec.ts`
- Modify: `public/share-crypto.js`

**Interfaces:**
- `encryptAttachment(blob, vaultKey): Promise<{ ciphertext: ArrayBuffer; mimeType: string; byteLength: number }>`
- `decryptAttachment(ciphertext, mimeType, vaultKey): Promise<Blob>`
- `extractPastedImage(event): File | null`
- `extractDroppedImage(event): File | null`
- `revokeAttachmentUrls(urls: Set<string>): void`
- `encryptSharedPayload(payload): Promise<SharedEncryptionResult>` accepts optional attachment entries without changing `share:v1` framing.

- [ ] **Step 1: Write failing browser crypto tests**

Assert that two encryptions of the same image differ, decrypting with the same key round-trips bytes and MIME type, a wrong key or tampered byte rejects, and `revokeAttachmentUrls` calls `URL.revokeObjectURL` exactly once per URL.

- [ ] **Step 2: Run the focused client tests and verify they fail**

Run:

```bash
npx vitest run test/attachment-crypto.spec.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the binary image envelope**

Prepend a version marker and 12-byte IV to AES-GCM ciphertext; never convert image bytes to Base64. Reject files over 10 MB before encryption, reject non-image MIME types, and clear temporary `ArrayBuffer`/`Uint8Array` references after upload or failure where the browser permits.

- [ ] **Step 4: Implement paste/drop extraction and URL lifecycle**

Read `DataTransferItemList` and clipboard items for the first supported image file, ignore HTML/text-only clipboard entries, create blob URLs only for decrypted display, and revoke them when closing a note, logging out, entering idle lock, or replacing an attachment.

- [ ] **Step 5: Extend the share envelope tests and implementation**

Keep the existing `{ v: 1, title, content, createdAt, sharedAt }` fields valid for text-only shares. Add an optional `attachments` array containing encrypted image bytes, MIME type, and the source attachment ID; share decryption must reject an unknown payload version or malformed attachment entry.

- [ ] **Step 6: Run client typecheck and commit**

Run:

```bash
npx vitest run test/attachment-crypto.spec.ts test/index.spec.ts -t "share crypto"
npm run typecheck:client
```

Expected: PASS.

```bash
git add public/attachment-crypto.js public/share-crypto.js test/attachment-crypto.spec.ts
git commit -m "feat: encrypt image attachments in the browser"
```

---

## Task 7: Implement the allowlisted Markdown renderer and editor helpers

**Files:**
- Create: `public/markdown.js`
- Create: `test/markdown.spec.ts`
- Modify: `public/app.js`

**Interfaces:**
- `renderMarkdown(source: string, attachments: Map<string, string>): DocumentFragment`
- `extractAttachmentIds(source: string): string[]`
- `insertMarkdownAtSelection(textarea: HTMLTextAreaElement, insertion: string): void`
- `replaceAttachmentReference(source: string, attachmentId: string, altText: string): string`

- [ ] **Step 1: Write failing renderer tests**

Cover headings, paragraphs, unordered/ordered lists, blockquotes, fenced code, emphasis, safe links, `attachment://` images, malformed syntax, raw HTML removal, `javascript:` rejection, and external image omission.

```js
const fragment = renderMarkdown('<script>alert(1)</script>\n![x](attachment://a)', new Map([['a', 'blob:test']]))
assert.equal(fragment.querySelector('script'), null)
assert.equal(fragment.querySelector('img')?.getAttribute('src'), 'blob:test')
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npx vitest run test/markdown.spec.ts
```

Expected: FAIL because `public/markdown.js` does not exist.

- [ ] **Step 3: Implement an allowlisted DOM renderer**

Parse line blocks into DOM nodes using `textContent`, never assign untrusted source to `innerHTML`. Support the confirmed common syntax only. Create links only for `https:`/`http:` with `target="_blank"` and `rel="noreferrer noopener"`; create images only when the URL matches the attachment scheme and resolves from the provided map. Render unsupported constructs as escaped plain text.

- [ ] **Step 4: Implement cursor-preserving Markdown helpers**

Insert toolbar snippets at the current textarea selection, preserve selection after insertion, and make image insertion produce an attachment reference only after the R2 upload returns an ID. `extractAttachmentIds` must de-duplicate IDs and ignore malformed tokens.

- [ ] **Step 5: Run renderer tests and client typecheck, then commit**

Run:

```bash
npx vitest run test/markdown.spec.ts
npm run typecheck:client
```

Expected: PASS.

```bash
git add public/markdown.js test/markdown.spec.ts public/app.js
git commit -m "feat: add safe Markdown rendering and source helpers"
```

---

## Task 8: Build the mobile reader/editor and desktop split UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `public/_headers`

**Interfaces:**
- `openReader(noteId): Promise<void>` loads note attachments and renders the note.
- `openComposer(note): void` enters assisted Markdown editing with source/preview controls.
- `saveComposer(): Promise<void>` encrypts title/body, validates attachment references, and writes the revision.
- `lockVault(reason: 'idle' | 'logout' | 'reauth_required'): void` clears decrypted state and blob URLs.

- [ ] **Step 1: Add shell assertions and failing client behavior checks**

Add stable IDs for reader view, mobile list view, editor toolbar, preview/source toggle, More menu, TOTP challenge/enrollment panels, and attachment status. Extend the existing `test/index.spec.ts` static-assets test to assert those IDs and the `blob:` CSP token; keep behavioral logic covered by the pure helper tests in `test/markdown.spec.ts` and `test/attachment-crypto.spec.ts`.

- [ ] **Step 2: Implement the responsive layout skeleton**

Use CSS media queries to show the desktop list/content split at wide widths and a mobile list → reader → full-screen editor flow below 640 px. Keep safe-area padding and focus-visible outlines. Render each list item with title, summary, `创建时间`, and `最近更新时间`; keep sorting based on `updated_at`.

- [ ] **Step 3: Move delete into the More menu**

Remove the visible red delete button from note cards and reader actions. Add a More menu item with danger styling and the existing revision-aware confirmation path. Ensure keyboard Escape closes the menu and focus returns to its trigger.

- [ ] **Step 4: Implement assisted Markdown editing**

Use the existing textarea/source as the canonical value. Add toolbar actions for heading, bold, italic, list, quote, code, link, preview, source, and image insertion. The toolbar calls `insertMarkdownAtSelection`, so no second block-document model is introduced.

- [ ] **Step 5: Implement attachment paste/drop UI**

Handle `paste` and `drop` on the editor surface, encrypt the first valid image with `attachment-crypto.js`, upload it to `/api/attachments`, insert `![图片](attachment://id)` at the cursor, and show an inline pending/uploaded/error state. Do not add a permanent album/camera button in this release.

- [ ] **Step 6: Implement reader rendering and cleanup**

On reader open, fetch attachment metadata and ciphertext, decrypt only the referenced images, render the Markdown fragment, and revoke URLs on reader close, idle lock, logout, replacement, or failed re-auth. A failed image becomes a non-sensitive error tile while text remains readable.

- [ ] **Step 7: Update CSP and run client checks**

Change `public/_headers` from `img-src 'self'` to `img-src 'self' blob:` while keeping scripts, styles, connect, and object policies same-origin only. Run:

```bash
npm run typecheck:client
npm run check
```

Expected: PASS with responsive UI and no CSP regression in the existing shell test.

- [ ] **Step 8: Commit the primary UI**

```bash
git add public/index.html public/app.js public/styles.css public/_headers
git commit -m "feat: add mobile reader and assisted Markdown editor"
```

---

## Task 9: Add TOTP and idle-lock UI flows

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Interfaces:**
- `beginTwoFactorLogin(password): Promise<void>`
- `confirmTotpEnrollment(code): Promise<void>`
- `submitReauth(password, code): Promise<void>`
- `scheduleIdleLock(): void`
- `recordUserActivity(): void`

- [ ] **Step 1: Add failing interaction checks**

Assert the login view can render password → TOTP challenge, the settings area can show one-time enrollment data and recovery codes without persisting them, and idle lock clears the key/notes after 30 minutes of synthetic time.

- [ ] **Step 2: Implement two-step login and enrollment UI**

After `/api/login` returns `two_factor_required`, preserve the password only in the current event handler, switch to the six-digit TOTP input, and then derive the vault key after the second step succeeds. Add a locked settings panel accessible only after a fully verified session; enrollment shows QR payload/manual secret once, requires confirmation, and displays recovery codes once.

- [ ] **Step 3: Implement activity tracking and idle lock**

Listen for meaningful pointer, keyboard, touch, visibility, and successful user-action API events. Do not refresh on background health/session checks. At 30 minutes, call `lockVault('idle')`, clear sensitive inputs, close editor/share/More menus, show the reauth view, and keep only an in-memory encrypted draft buffer.

- [ ] **Step 4: Handle `reauth_required` globally**

Update `api()` so a 401 response with `error === 'reauth_required'` invokes `lockVault`, preserves a safe status message, and does not mark the deployment as logged out. Successful reauth restores the reader/editor state only after the vault key and referenced attachments are reloaded.

- [ ] **Step 5: Run the client checks and commit**

Run:

```bash
npm run typecheck:client
npm run check
```

Expected: PASS.

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat: add TOTP challenge and idle lock UI"
```

---

## Task 10: Extend one-time sharing for encrypted attachments

**Files:**
- Modify: `public/share-crypto.js`
- Modify: `public/share.js`
- Modify: `public/share.html`
- Modify: `public/share.css`
- Modify: `public/app.js`
- Modify: `test/index.spec.ts`

**Interfaces:**
- `collectShareAttachments(note): Promise<SharedAttachmentEntry[]>`
- `decryptSharedAttachments(payload, keyBytes): Promise<Map<string, string>>`
- `cleanupSharedAttachmentUrls(urls): void`

- [ ] **Step 1: Write failing text-only compatibility and image-share tests**

Assert the old text-only payload decrypts unchanged, an attachment-bearing payload round-trips, malformed attachment entries reject, and an oversized envelope is refused before `/api/shares` is called.

- [ ] **Step 2: Implement browser-side share packaging**

Resolve only `attachment://` references in the selected note, download/decrypt those R2 objects, and include re-encrypted image bytes under the existing one-time share key. Preserve the existing stale-operation cleanup path if the share modal closes after the Worker has already created a share row.

- [ ] **Step 3: Implement share-page rendering and teardown**

Decrypt attachment entries in `public/share.js`, create blob URLs with MIME types from the envelope, render the Markdown fragment, and revoke all URLs after destruction, expiry, decode failure, or page unload. Never fetch the sender’s private attachment endpoint from the share page.

- [ ] **Step 4: Run sharing regression tests and commit**

Run:

```bash
npx vitest run test/index.spec.ts -t "share|attachment"
npm run typecheck:client
```

Expected: PASS.

```bash
git add public/share-crypto.js public/share.js public/share.html public/share.css public/app.js test/index.spec.ts
git commit -m "feat: include encrypted images in one-time shares"
```

---

## Task 11: Add deployment documentation and production-safe rollout checks

**Files:**
- Modify: `README.md`
- Modify: `.dev.vars.example`
- Modify: `test/index.spec.ts`

**Interfaces:**
- Documents the exact R2 bucket setup, migration order, TOTP recovery procedure, 10 MB image limit, and rollback behavior.

- [ ] **Step 1: Add configuration and migration assertions**

Test that the generated Wrangler config contains the `ATTACHMENTS` binding and that an empty D1 bootstrap applies both new migrations without accepting an unrelated schema.

- [ ] **Step 2: Document staging-first deployment**

Add instructions for creating a staging R2 bucket, applying D1 migrations, running `npm run check`, running `npm run deploy:dry-run`, enabling TOTP only after a successful recovery-code test, and recording a D1 Time Travel restore point before production migration.

- [ ] **Step 3: Document user-visible recovery and limits**

Explain that losing both the Authenticator and recovery codes blocks login, that idle reauth requires password + TOTP, that images are encrypted before R2, and that sharing may reject notes whose encrypted attachment package exceeds the existing share limit.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
npm run check
npm audit
npm run deploy:dry-run
```

Expected: all checks pass; dry run lists the new R2 binding and migrations without deploying or mutating production data.

- [ ] **Step 5: Commit documentation and rollout checks**

```bash
git add README.md .dev.vars.example test/index.spec.ts
git commit -m "docs: document attachment and authenticator rollout"
```

---

## Self-review checklist

- [ ] Existing `enc:v1` note encryption remains unchanged.
- [ ] Existing vault credentials, rate limiting, cookie flags, revision checks, and one-time-share consume semantics are covered by regression tests.
- [ ] Global TOTP enrollment, login challenge, recovery, disable, and idle reauth each have explicit tests.
- [ ] Attachment lifecycle covers upload, authorization, save association, failed save, detach, R2 deletion, and stale cleanup.
- [ ] Markdown rendering never assigns untrusted source to `innerHTML` and never renders external images.
- [ ] Mobile reader/editor, desktop split view, timestamps, hidden delete action, paste/drop upload, and blob URL cleanup each have implementation tasks.
- [ ] The plan contains no dependency on a future unassigned decision.
