# 笔记分类、一级文件夹、密码记录与移动端粘贴图片实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有客户端加密、vault 隔离、Authenticator 和 idle reauth 的前提下，增加笔记/密码分类、一级文件夹、结构化密码字段，并修复手机正文区域直接粘贴图片的流程。

**Architecture:** 新增一个仅存密文名称的 D1 `note_folders` 表；笔记类型、folder ID、密码字段和普通 Markdown 继续作为客户端加密后的 `notes.content`。浏览器增加纯数据模型、文件夹状态、密码字段和附件草稿模块，`app.js` 只负责页面编排；Worker 增加文件夹 CRUD，并允许带随机 draft note ID 的 pending 图片在笔记创建时原子关联。

**Tech Stack:** Cloudflare Workers, D1, R2, TypeScript, browser Web Crypto, vanilla HTML/CSS/JS, Vitest, `@cloudflare/vitest-pool-workers`.

## Global Constraints

- 不改变 PBKDF2-SHA256、AES-256-GCM、`enc:v1`、vault 隔离、Authenticator 或 30 分钟 idle reauth。
- `note_folders.name`、笔记标题/正文、密码字段和图片内容在服务端始终是密文或加密二进制。
- 文件夹仅支持一级；删除文件夹不删除笔记，只让客户端回退到“未分类”。
- 图片只允许 JPEG、PNG、GIF、WebP，单图上限 10 MB；R2 bucket 继续使用 `private-notes-r2`。
- 粘贴纯文本时保持浏览器默认行为；只在检测到图片时拦截 `paste`。
- 所有新行为先写失败测试，确认失败后再写最小实现；每个任务独立提交。
- 不提交现有未跟踪目录 `.superpowers/brainstorm/`。

---

### Task 1: Add folder storage and encrypted folder CRUD API

**Files:**
- Create: `migrations/0010_note_folders.sql`
- Modify: `src/schema.ts`
- Modify: `src/index.ts`
- Modify: `test/apply-migrations.ts`
- Test: `test/index.spec.ts`

**Interfaces:**
- Consumes: existing `requireActiveSession`, `requireEncryptedValue`, `requireNoteId`, `json`, and D1 migration journal.
- Produces: `GET /api/folders`, `POST /api/folders`, `PUT /api/folders/:id`, and `DELETE /api/folders/:id`.

- [ ] **Step 1: Write failing migration and API tests**

Add tests named `creates the note_folders table`, `stores only encrypted folder names`, `isolates folders by vault`, `rejects duplicate folder ids`, and `updates folders with an optimistic revision` in `test/index.spec.ts`. The POST body must be `{ id, name }`, PUT must be `{ name, revision }`, and the response must expose only `{ id, name, created_at, updated_at }`.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run test/index.spec.ts -t "folder|note_folders"`  
Expected: FAIL because the migration and `/api/folders` routes do not exist.

- [ ] **Step 3: Add the migration and schema journal entry**

Create `migrations/0010_note_folders.sql` with `id`, `vault_id`, encrypted `name`, timestamps, the `(vault_id, id)` unique index, and the `(vault_id, updated_at DESC, id ASC)` index. Add `note_folders` to `APPLICATION_TABLE_NAMES`, add `0010_note_folders.sql` to `APPLIED_MIGRATIONS`, include the same table/index creation in `initializeFreshDatabase`, and append `0010_note_folders.sql` to `REQUIRED_MIGRATIONS` in `test/apply-migrations.ts`.

- [ ] **Step 4: Implement the four folder routes**

In `src/index.ts`, validate folder IDs with the existing UUID pattern and validate `name` with `requireEncryptedValue(body.name, 'name', MAX_ENCRYPTED_TITLE_LENGTH)`. POST accepts an optional client UUID and returns 409 on an occupied ID. PUT requires a positive `revision`, updates only when `updated_at = revision`, and returns 409 on a stale revision. DELETE removes only the row for the current vault. Never decrypt or log `name`.

- [ ] **Step 5: Run the focused tests to verify they pass**

Run: `npx vitest run test/index.spec.ts -t "folder|note_folders"`  
Expected: PASS, including the guest-vault isolation assertion and the D1 plaintext assertion.

- [ ] **Step 6: Commit the storage/API task**

```bash
git add migrations/0010_note_folders.sql src/schema.ts src/index.ts test/apply-migrations.ts test/index.spec.ts
git commit -m "feat: add encrypted folder storage and API"
```

### Task 2: Add encrypted note/password record codecs and legacy compatibility

**Files:**
- Create: `public/note-records.js`
- Create: `test/note-records.spec.ts`

**Interfaces:**
- Produces `decodeNoteRecord(content)`, `encodeNoteRecord(record)`, `encodePasswordRecord(record)`, `normalizePasswordFields(fields)`, and `buildNoteSnippet(record, maxLength)`.

- [ ] **Step 1: Write failing codec tests**

Create tests for: legacy Markdown decoding to `{ v: 1, type: 'note', folderId: null, markdown }`; note record round-trip; password fixed-field normalization; rejection of missing fixed IDs, unknown field types, empty custom labels, duplicate IDs, and versions other than `1`; and snippet generation that removes Markdown syntax and truncates by characters.

- [ ] **Step 2: Run the codec tests to verify they fail**

Run: `npx vitest run test/note-records.spec.ts`  
Expected: FAIL because `public/note-records.js` does not exist.

- [ ] **Step 3: Implement the minimal record module**

Use `JSON.parse` only after confirming the decrypted string is an object with `v: 1`. Treat non-JSON strings as legacy Markdown. Keep fixed password IDs `name`, `username`, `password`, `url`, and `notes`; append custom fields after them, preserve values as strings, and return a normalized immutable copy. `buildNoteSnippet` must use plain text derived from Markdown and never render HTML.

- [ ] **Step 4: Run the codec tests to verify they pass**

Run: `npx vitest run test/note-records.spec.ts`  
Expected: PASS with no console output containing field values.

- [ ] **Step 5: Commit the codec task**

```bash
git add public/note-records.js test/note-records.spec.ts tsconfig.client.json
git commit -m "feat: add encrypted note and password record codecs"
```

### Task 3: Add client folder state, filtering, and encrypted API helpers

**Files:**
- Create: `public/folder-model.js`
- Create: `test/folder-model.spec.ts`
- Modify: `public/app.js`

**Interfaces:**
- `folder-model.js` exports `sortFolders(folders)`, `resolveFolderName(folderMap, folderId)`, and `matchesNoteFilter(note, category, folderId, folderMap)`.
- `app.js` owns `state.folders`, `state.activeCategory`, and `state.activeFolderId`.

- [ ] **Step 1: Write failing folder-model tests**

Test that folders sort by `updated_at DESC, id ASC`, missing IDs resolve to `未分类`, and category/folder filters accept legacy notes, structured notes, password records, and deleted folders.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/folder-model.spec.ts`  
Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement folder helpers and app loading**

Load `/api/folders` after vault unlock, keep the encrypted `name` only in the folder API response until `decryptValue` produces the display name, and clear both encrypted and plaintext folder state on idle lock/logout. Use the helpers when applying list filters; do not add folder/category query parameters to `/api/notes`.

- [ ] **Step 4: Run helper and regression tests**

Run: `npx vitest run test/folder-model.spec.ts test/note-records.spec.ts test/index.spec.ts -t "notes|folder"`  
Expected: PASS; existing note pagination and vault isolation remain unchanged.

- [ ] **Step 5: Commit the folder-state task**

```bash
git add public/folder-model.js test/folder-model.spec.ts public/app.js
git commit -m "feat: add client folder filters and state"
```

### Task 4: Restructure HTML/CSS for categories, folders, settings, and detail states

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Modify: `test/index.spec.ts`

**Interfaces:**
- Produces stable elements: `settingsBtn`, `settingsPanel`, `settingsLogoutBtn`, `categoryNav`, `folderNav`, `noteList`, `readerView`, `passwordFields`, `passwordEditorFields`, and `folderDialog`.

- [ ] **Step 1: Add failing static asset assertions**

Extend the existing static-assets test to require the category navigation, folder navigation, settings panel, settings logout button, password detail/editor containers, per-field copy label, mobile paste status, and absence of a standalone topbar logout button.

- [ ] **Step 2: Run the static test to verify it fails**

Run: `npx vitest run test/index.spec.ts -t "static|asset|settings"`  
Expected: FAIL because the new IDs and layout do not exist.

- [ ] **Step 3: Implement the responsive structure**

Move security controls and logout into a right-side settings drawer. Add mobile category tabs and horizontally scrollable folders; keep the desktop C layout with left navigation, list column, and reader/editor column. Keep delete only in the existing More menu. Add accessible labels, `aria-current`, safe-area padding, and focus return for the drawer/dialog.

- [ ] **Step 4: Run the static test and client typecheck**

Run: `npx vitest run test/index.spec.ts -t "static|asset|settings" && npm run typecheck:client`  
Expected: PASS with no missing-element errors during module initialization.

- [ ] **Step 5: Commit the layout task**

```bash
git add public/index.html public/styles.css public/app.js test/index.spec.ts
git commit -m "feat: add category folder and settings layout"
```

### Task 5: Render mainstream note lists and type-specific details

**Files:**
- Modify: `public/app.js`
- Modify: `public/markdown.js`
- Modify: `public/styles.css`
- Test: `test/note-records.spec.ts`, `test/markdown.spec.ts`

- [ ] **Step 1: Add failing list/detail behavior tests**

Add pure tests for a note card view-model containing title, snippet, type, folder, created time, and updated time; assert through `buildNoteSnippet` that full Markdown is not used as the list summary; assert that attachment loading is requested only for note records; and assert that password records never pass through the Markdown renderer. Keep DOM-only checks in the static-assets test and the final smoke checklist.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run test/note-records.spec.ts test/markdown.spec.ts -t "snippet|detail|password"`  
Expected: FAIL because the current list renders full content and has no password branch.

- [ ] **Step 3: Implement list and reader branches**

Update `decryptNotes` to attach the decoded record and folder display name. Refactor `renderList` to render only the mainstream card metadata and apply the active category/folder filter. Update `openReader` to fetch attachments only for note records, render Markdown for notes, and render a password detail container for password records. Keep the existing create/update timestamps and hidden delete menu.

- [ ] **Step 4: Run focused and regression tests**

Run: `npx vitest run test/note-records.spec.ts test/markdown.spec.ts test/index.spec.ts -t "note|reader|password|share"`  
Expected: PASS, including old Markdown rendering and share regressions.

- [ ] **Step 5: Commit the list/detail task**

```bash
git add public/app.js public/markdown.js public/styles.css test/note-records.spec.ts test/markdown.spec.ts test/index.spec.ts
git commit -m "feat: render filtered note lists and typed details"
```

### Task 6: Add password editor, hidden fields, custom fields, and copy actions

**Files:**
- Create: `public/password-fields.js`
- Create: `test/password-fields.spec.ts`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Interfaces:**
- `password-fields.js` exports `createDefaultPasswordFields()`, `addCustomField(fields, type)`, `removeCustomField(fields, id)`, `toggleSecretVisibility(element)`, and `copyFieldValue(value, clipboard)`.

- [ ] **Step 1: Write failing password-field tests**

Test default fixed fields and types, custom field creation/removal, rejection of fixed-field removal, no plaintext returned by visibility helpers, and `copyFieldValue` calling only the supplied clipboard API with the exact value.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/password-fields.spec.ts`  
Expected: FAIL because `public/password-fields.js` does not exist.

- [ ] **Step 3: Implement the pure field helpers**

Keep the fixed field order stable. Generate custom IDs with `crypto.randomUUID()`. `copyFieldValue` must reject non-string values and propagate clipboard failures without logging. Visibility changes must affect only the target input element.

- [ ] **Step 4: Wire the password editor and detail view**

When creating a password record, show fixed fields plus an “add custom field” control; hide the ordinary Markdown editor. On save, validate and encode `PasswordRecord`, synchronize `name` to encrypted `title`, and preserve folder ID. On detail, render each field with the correct input type, default masked state, per-field copy button, and no Markdown HTML.

- [ ] **Step 5: Run tests and client typecheck**

Run: `npx vitest run test/password-fields.spec.ts test/note-records.spec.ts && npm run typecheck:client`  
Expected: PASS with no clipboard or field value logs.

- [ ] **Step 6: Commit the password task**

```bash
git add public/password-fields.js test/password-fields.spec.ts public/index.html public/app.js public/styles.css
git commit -m "feat: add structured password records and field copy"
```

### Task 7: Make mobile image paste work in new and existing notes

**Files:**
- Modify: `public/attachment-crypto.js`
- Create: `public/attachment-draft.js`
- Create: `test/attachment-draft.spec.ts`
- Modify: `public/markdown.js`
- Modify: `public/app.js`
- Modify: `src/attachments.ts`
- Modify: `src/index.ts`
- Modify: `test/attachment-crypto.spec.ts`
- Modify: `test/index.spec.ts`

**Interfaces:**
- `attachment-crypto.js` adds `extractPastedImages(event)` while preserving `extractPastedImage` as a compatibility wrapper.
- `attachment-draft.js` exports `createAttachmentDraft()`, `addPendingImage(draft, blob)`, `replacePendingToken(source, token, attachmentId)`, and `clearAttachmentDraft(draft)`.
- `renderMarkdown(source, attachments, pendingAttachments)` accepts a pending-token map used only by the editor preview.

- [ ] **Step 1: Write failing crypto, draft, and Worker tests**

Add tests for all supported clipboard image items, text fallback, pending token replacement, draft cleanup, draft attachment upload against a non-existent note ID, atomic POST note creation with `id + attachmentIds`, failed note creation leaving pending rows, and cross-vault denial.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run test/attachment-crypto.spec.ts test/attachment-draft.spec.ts test/index.spec.ts -t "paste|draft|pending attachment"`  
Expected: FAIL because only the drop-zone first-image path exists and the Worker currently requires an existing note for every upload.

- [ ] **Step 3: Implement pure clipboard and draft helpers**

Read `DataTransferItemList` in order, return every supported image `File`, and leave text-only events untouched. Maintain pending token/Blob metadata in memory, create local object URLs for preview, and replace only the exact pending token when an attachment ID is returned. Revoke every temporary URL during draft cleanup.

- [ ] **Step 4: Implement the Worker draft upload path**

Add an explicit `x-note-draft: 1` header requirement for uploads whose `noteId` does not yet exist. Permit those rows only for the current vault and `pending` status; keep normal uploads requiring an existing note. Keep the current 10 MB/MIME checks and stale cleanup. Ensure POST `/api/notes` validates pending IDs and updates them to `attached` in the same D1 batch as the insert.

- [ ] **Step 5: Wire paste handling across the editor**

Listen on the editor modal and `editorContent`, prevent default only when `extractPastedImages` returns images, generate a draft note ID on first image, insert pending tokens at the current selection, encrypt/upload each image, and update the status text. On save, replace all pending tokens before encrypting content; on cancel, logout, idle lock, or reauth failure, delete pending rows and revoke Blob URLs. Keep drag-and-drop behavior as a compatibility path.

- [ ] **Step 6: Run attachment and regression tests**

Run: `npx vitest run test/attachment-crypto.spec.ts test/attachment-draft.spec.ts test/index.spec.ts -t "attachment|paste|draft|share"`  
Expected: PASS, including existing attachment lifecycle and share tests.

- [ ] **Step 7: Commit the paste task**

```bash
git add public/attachment-crypto.js public/attachment-draft.js public/markdown.js public/app.js src/attachments.ts src/index.ts test/attachment-crypto.spec.ts test/attachment-draft.spec.ts test/index.spec.ts
git commit -m "feat: support direct mobile image paste and draft attachments"
```

### Task 8: Add folder management UI and settings behavior

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `test/index.spec.ts`

- [ ] **Step 1: Add failing interaction assertions**

Extend static and client tests to require folder create/rename/delete controls, category/folder `aria-current` updates, settings drawer focus return, settings logout, and security panel visibility only inside settings.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/index.spec.ts -t "folder controls|settings drawer|logout"`  
Expected: FAIL because the controls are not wired to the folder API and the current security/logout controls remain in the main workspace.

- [ ] **Step 3: Implement folder management interactions**

Add encrypted name creation/rename using `encryptValue`, call the folder endpoints, refresh state after mutations, and keep the active selection at `未分类` when the selected folder is deleted. Move Authenticator controls and logout into the settings drawer without changing their existing API calls or idle-lock behavior.

- [ ] **Step 4: Run interaction/static checks**

Run: `npx vitest run test/index.spec.ts -t "folder controls|settings drawer|logout" && npm run typecheck:client`  
Expected: PASS.

- [ ] **Step 5: Commit the settings/folder UI task**

```bash
git add public/index.html public/app.js public/styles.css test/index.spec.ts
git commit -m "feat: add folder management and settings drawer"
```

### Task 9: Update documentation and perform full verification

**Files:**
- Modify: `README.md`
- Modify: `worker-configuration.d.ts` if `wrangler types` changes generated bindings
- Modify: `docs/superpowers/specs/2026-08-05-notes-folders-passwords-paste-design.md` only if implementation exposes a discovered contract correction

- [ ] **Step 1: Document production migration and usage**

Document `0010_note_folders.sql`, encrypted folder names, password fixed/custom fields, direct mobile paste behavior, pending draft cleanup, `private-notes-r2`, and the requirement to keep recovery codes. State that old Markdown notes are read without batch migration.

- [ ] **Step 2: Run the complete verification suite**

Run:

```bash
npm run check
npm audit
npm run deploy:dry-run
```

Expected: all type checks and tests pass, audit reports no new vulnerability, and Wrangler dry-run succeeds with the existing private R2 binding.

- [ ] **Step 3: Run the final smoke checklist**

Verify manually on a phone-sized viewport: create a note, paste an image directly into the body, save and reopen it, create a password record, copy each field, create/rename/delete a folder, open settings, logout, login with Authenticator, and wait/use the idle reauth path. Verify desktop C layout and hidden delete menu at a wide viewport.

- [ ] **Step 4: Commit documentation and verification metadata**

```bash
git add README.md worker-configuration.d.ts
git commit -m "docs: document folders passwords and mobile paste"
```
