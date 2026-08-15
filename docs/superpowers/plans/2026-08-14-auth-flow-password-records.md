# Authenticator、密码展示与登录记录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变加密或登录协议的前提下，完成 Authenticator 自动提交、密码字段点击复制与手机横向布局，并将登录记录裁剪为最近 100 条且分页显示。

**Architecture:** `src/auth.ts` 负责会话创建后的同 Vault 裁剪及 keyset 分页，`src/index.ts` 负责 cursor 编解码和 API 响应。`public/password-ui.js`、`public/workspace.css` 与 `public/app.js` 分别负责密码字段交互、阅读器布局、Authenticator 和设置页状态。

**Tech Stack:** Cloudflare Workers、D1、TypeScript、原生浏览器 JavaScript/CSS、Vitest、`@cloudflare/vitest-pool-workers`。

## Global Constraints

- 保持 TOTP 算法、恢复码、Cookie 格式、Vault 隔离和客户端加密协议不变。
- 不新增 D1 migration 或外部依赖；继续使用 `auth_sessions` 的 `idx_auth_sessions_vault_login_at`。
- 每 Vault 仅保留按 `COALESCE(login_at, created_at) DESC, id_hash DESC` 排序的前 100 条会话；被裁剪会话不能再通过 `/api/session`。
- 设备 API 固定每页 10 条，以 URL-safe Base64 JSON cursor 返回下一页；无效 cursor 返回 `400 invalid_cursor`。
- 所有密码字段正文都可复制真实值；secret 默认掩码，眼睛控制不复制内容。
- 仅在 `max-width: 767px` 覆盖密码阅读布局；标签在左侧窄列，内容在右侧主列。

---

### Task 1: 会话保留与设备记录分页 API

**Files:**
- Modify: `src/auth.ts:316-363, 468-495`
- Modify: `src/index.ts:74-82, 362-397, 684-688`
- Modify: `test/index.spec.ts:390-435`

**Interfaces:**
- Consumes: `createSessionToken(env, vaultId, existingSessionId?, metadata?)` and `requireActiveSession(request, env, { touch: true })`.
- Produces: `listAuthDevices(env, vaultId, currentSessionId, cursor, limit)` returning `{ devices, nextCursor }`; `nextCursor` is `{ loginAt: number, idHash: string } | null`.
- Produces: `GET /api/auth/devices?cursor=<opaque>` returning `{ ok: true, devices, nextCursor }` with 10 maximum records.

- [ ] **Step 1: Write failing Worker integration tests**

Add tests after the current device-metadata cases. One must create a real first session, insert 100 newer default-Vault rows, then log in again. Assert the table has 100 rows, the first Cookie returns `{ authenticated: false }`, the new Cookie returns `{ authenticated: true }`, the first device page has 10 rows plus a string cursor, and page two has 10 `loginIp` values disjoint from page one. The second test calls `/api/auth/devices?cursor=not-a-valid-cursor` and expects `400` with `code: 'invalid_cursor'`.

```ts
const first = await login(DEFAULT_PASSWORD, '203.0.113.10');
await env.DB.prepare('UPDATE auth_sessions SET login_at = 0 WHERE login_ip = ?').bind('203.0.113.10').run();
for (let index = 1; index <= 100; index += 1) {
  await env.DB.prepare(
    `INSERT INTO auth_sessions (id_hash, vault_id, created_at, last_activity_at, last_reauth_at, expires_at, revoked_at, login_ip, login_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).bind(String(index).padStart(43, 'a'), 'default', index, index, index, Date.now() + 1_000_000, `198.51.100.${index}`, index).run();
}
const newest = await login(DEFAULT_PASSWORD, '203.0.113.250');
```

- [ ] **Step 2: Run RED**

Run: `npm run test:ci -- test/index.spec.ts -t "retains only the newest 100 sessions|rejects malformed device-history cursors"`

Expected: FAIL because the API returns every row, has no `nextCursor`, and ignores malformed cursors.

- [ ] **Step 3: Implement bounded cleanup and keyset pagination**

In `src/auth.ts`, define `MAX_AUTH_DEVICE_RECORDS = 100` and `AUTH_DEVICE_PAGE_SIZE = 10`. Add `trimAuthSessions(env, vaultId)` after the `createSessionToken` upsert:

```ts
await env.DB.prepare(
  `DELETE FROM auth_sessions
   WHERE vault_id = ?
     AND id_hash NOT IN (
       SELECT id_hash FROM auth_sessions
       WHERE vault_id = ?
       ORDER BY COALESCE(login_at, created_at) DESC, id_hash DESC
       LIMIT ?
     )`
).bind(normalizedVaultId, normalizedVaultId, MAX_AUTH_DEVICE_RECORDS).run();
```

Replace `listAuthDevices` with a function accepting `cursor` and `limit`. Use a CTE limited to the latest 100 rows, apply `(login_at < ? OR (login_at = ? AND id_hash < ?))` when a cursor exists, request `limit + 1`, and derive `nextCursor` from the final safe row. Do not expose `id_hash` in `devices`.

In `src/index.ts`, add `DeviceCursor`, `encodeDeviceCursor`, and `decodeDeviceCursor` next to note cursors. Reuse `base64UrlDecode`; require non-negative safe `loginAt` and `/^[A-Za-z0-9_-]{43}$/` `idHash`; throw `new ApiError(400, 'invalid_cursor', 'invalid device cursor')` for every invalid shape. The route passes cursor and page size to `listAuthDevices`, then emits the serialized next cursor.

- [ ] **Step 4: Run GREEN**

Run: `npm run test:ci -- test/index.spec.ts -t "records authenticated device metadata|keeps null-compatible device history|retains only the newest 100 sessions|rejects malformed device-history cursors"`

Expected: PASS; the null-compatible case stays valid because sorting and cursor fields use `COALESCE(login_at, created_at)`.

- [ ] **Step 5: Commit**

Run: `git add src/auth.ts src/index.ts test/index.spec.ts && git commit -m "feat: retain and page recent login records"`

### Task 1b: 设置页登录记录翻页控件

**Files:**
- Modify: `public/index.html:141-145`
- Modify: `public/styles.css:290-304`
- Modify: `public/app.js:70-92, 215-220, 466-476, 927-953, 1251-1258`
- Modify: `test/index.spec.ts:512-520`

**Interfaces:**
- Consumes: `GET /api/auth/devices?cursor=<opaque>` with `devices` and `nextCursor`.
- Produces: visible `上一页` / `下一页` controls only when another device page exists; a cursor stack restores prior pages without refetching every earlier cursor.

- [ ] **Step 1: Write a failing shell-contract test**

Add a Worker asset test requiring all four controls: `authDevicesPagination`, `authDevicesPreviousBtn`, `authDevicesNextBtn`, and `authDevicesPageLabel`.

- [ ] **Step 2: Run RED**

Run: `npm run test:ci -- test/index.spec.ts -t "serves login-device pagination controls"`

Expected: FAIL because the original settings section only contains `authDevicesList`.

- [ ] **Step 3: Implement cursor-stack navigation**

Add the controls immediately after `authDevicesList`. Store `authDevicesCurrentCursor`, `authDevicesPreviousCursors`, `authDevicesNextCursor`, and `authDevicesLoading` in app state. `loadAuthDevices(cursor, reset)` calls the API with `encodeURIComponent(cursor)`, updates the list only after a successful response, and keeps the current list when navigation fails. Next pushes the current cursor before loading the returned cursor; previous pops it and restores it on failure. Disable controls while loading and hide the control group when only one page exists.

- [ ] **Step 4: Run GREEN**

Run: `npm run test:ci -- test/index.spec.ts -t "serves login-device pagination controls|retains only the newest 100 sessions and pages the device history"`

Expected: PASS. The page shell exposes the controls and the existing API test still proves two non-overlapping pages.

- [ ] **Step 5: Include in final commit**

Run: `git add public/index.html public/styles.css public/app.js test/index.spec.ts`

### Task 2: 密码字段点击复制、眼睛图标与移动端横向阅读

**Files:**
- Modify: `public/password-ui.js:114-160`
- Modify: `public/workspace.css:611-674, 1025-1060`
- Modify: `test/password-ui.spec.ts:50-160`

**Interfaces:**
- Consumes: `copyFieldValue(value, clipboard)` and `buildPasswordDisplayModel(fields)`.
- Produces: a `.password-reader-value` button that copies its field value and a `.password-visibility-toggle` icon button for secrets.
- Produces: mobile `.password-reader-field` CSS with label/value/action columns.

- [ ] **Step 1: Write failing reader and CSS tests**

Extend `TestElement` to retain attributes in a `Map<string, string>`. Replace the text-copy-button assertions with a test that locates the `.password-reader-value`, invokes `onclick`, and waits for `clipboard.writeText('not-logged-secret')`. It must assert the value is a `button`, no element has `.password-field-copy`, and the `.password-visibility-toggle` starts with `aria-label` `显示密码`, then reveals the value without triggering another clipboard write.

Add a CSS assertion against `workspace.css` requiring the mobile field grid and columns:

```ts
expect(styles).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.password-reader-field\s*\{[\s\S]*?grid-template-columns:\s*minmax\(54px, 72px\) minmax\(0, 1fr\) auto/);
expect(styles).toMatch(/\.password-reader-field \.password-reader-value\s*\{[\s\S]*?grid-column:\s*2/);
expect(styles).toMatch(/\.password-reader-field \.password-reader-label\s*\{[\s\S]*?font-size:\s*12px/);
```

- [ ] **Step 2: Run RED**

Run: `npm run test:ci -- test/password-ui.spec.ts`

Expected: FAIL because values are `div`/`pre`, each field has a `.password-field-copy` button, the secret control contains text, and the mobile CSS collapses to one column.

- [ ] **Step 3: Implement direct-copy reader fields and compact mobile layout**

In `renderPasswordReader`, create each value as a `button` with `type = 'button'` and class `password-reader-value`. Its `onclick` calls `copyFieldValue(display.value, clipboard)` and preserves the current success/failure status messages. For hidden secrets, show the mask in `textContent` but always copy `display.value`.

Replace the secret control with class `icon-btn password-field-action password-visibility-toggle`, empty text, and dynamic `aria-label`/`title` values `显示密码` and `隐藏密码`. Do not append a separate copy button; this click handler only toggles the mask.

In `workspace.css`, make the value button visually plain, left aligned, full-width in its content column, focus-visible, and at least 44px high. Use `.password-visibility-toggle::before { content: '\\1F441'; }` for the eye glyph. Replace mobile single-column rules with this horizontal grid, preserving it for multiline records:

```css
.password-reader-field { grid-template-columns: minmax(54px, 72px) minmax(0, 1fr) auto; align-items: start; gap: 8px; }
.password-reader-field .password-reader-label { grid-column: 1; grid-row: 1; font-size: 12px; }
.password-reader-field .password-reader-value { grid-column: 2; grid-row: 1; width: 100%; }
.password-reader-actions { grid-column: 3; grid-row: 1; width: auto; }
```

- [ ] **Step 4: Run GREEN**

Run: `npm run test:ci -- test/password-ui.spec.ts test/password-fields.spec.ts`

Expected: PASS. The reader test proves plaintext is supplied only to the real Clipboard API, eye visibility is independent, and CSS keeps the mobile grid horizontal.

- [ ] **Step 5: Commit**

Run: `git add public/password-ui.js public/workspace.css test/password-ui.spec.ts && git commit -m "feat: simplify password field copying on mobile"`

### Task 3: Authenticator 六位输入自动验证

**Files:**
- Modify: `public/totp-input.js:1-10`
- Modify: `public/app.js:26-102, 2307-2324, 2473-2512`
- Modify: `test/totp-input.spec.ts:1-22`

**Interfaces:**
- Consumes: `normalizeTotpInput(value)`, `moveTotpFocus(inputs, index, direction)`, and existing `verifyPendingTotp()`.
- Produces: `getCompleteTotpCode(inputs): string | null` and a `state.totpVerifying` mutex shared by manual and automatic verification.

- [ ] **Step 1: Write the failing completion-helper test**

Import `getCompleteTotpCode` from `public/totp-input.js`. Assert six single digits return `'123456'`; a missing digit and a multi-character value each return `null`.

```ts
expect(getCompleteTotpCode([{ value: '1' }, { value: '2' }, { value: '3' }, { value: '4' }, { value: '5' }, { value: '6' }])).toBe('123456');
expect(getCompleteTotpCode([{ value: '1' }, { value: '2' }, { value: '' }, { value: '4' }, { value: '5' }, { value: '6' }])).toBeNull();
expect(getCompleteTotpCode([{ value: '12' }, { value: '2' }, { value: '3' }, { value: '4' }, { value: '5' }, { value: '6' }])).toBeNull();
```

- [ ] **Step 2: Run RED**

Run: `npm run test:ci -- test/totp-input.spec.ts`

Expected: FAIL because `getCompleteTotpCode` does not exist.

- [ ] **Step 3: Implement automatic, mutually exclusive verification**

Export `getCompleteTotpCode(inputs)` from `public/totp-input.js`; it accepts six input-like objects and returns a joined code only if every value matches `/^\d$/`.

In `public/app.js`, add `totpVerifying: false` to the state typedef and object. Add `setTotpVerificationPending(pending)` to disable the verify button and all six digit inputs. Wrap `verifyPendingTotp` in the mutex so both manual and automatic calls return when already verifying, set pending before its request, and clear it in `finally`.

Add `submitTotpWhenComplete()` that reads `getCompleteTotpCode(getTotpDigits())`, returns unless recovery mode is hidden and a complete code is present, and invokes the existing `verifyPendingTotp().catch(...)` error path. Call it at the end of each digit `input` listener and after the paste loop. Reset pending controls when showing or leaving the TOTP view.

- [ ] **Step 4: Run GREEN**

Run: `npm run test:ci -- test/totp-input.spec.ts test/index.spec.ts -t "switches password login to a deployment-wide two-factor challenge"`

Expected: PASS. The helper proves automatic submission begins only after all six fields are complete; Worker behavior keeps the same challenge contract.

- [ ] **Step 5: Commit**

Run: `git add public/totp-input.js public/app.js test/totp-input.spec.ts && git commit -m "feat: auto-submit completed authenticator codes"`

### Task 4: 集成验收与发布准备

**Files:**
- Verify: `test/index.spec.ts`, `test/password-ui.spec.ts`, `test/totp-input.spec.ts`
- Verify: `public/index.html`, `public/app.js`, `public/password-ui.js`, `public/workspace.css`

**Interfaces:**
- Consumes: all Task 1-3 implementations.
- Produces: fresh check evidence and a manually verified desktop/mobile key journey before push.

- [ ] **Step 1: Run type and focused behavior checks**

Run: `npm run typecheck && npm run typecheck:test && npm run typecheck:client && npm run test:ci -- test/index.spec.ts test/password-ui.spec.ts test/totp-input.spec.ts`

Expected: exit code 0 with all listed suites passing.

- [ ] **Step 2: Run the complete project check**

Run: `npm run check`

Expected: exit code 0, including Worker integration, browser JavaScript checking, tools tests, and full Vitest suite.

- [ ] **Step 3: Verify the affected browser journey**

Run: `npm run dev`

At 375px and desktop width, verify that the sixth typed or pasted TOTP digit sends one request without clicking; password values copy on click; the eye toggles only secret visibility; mobile labels and content share a row; and the settings drawer navigates multiple device pages after 10 records.

- [ ] **Step 4: Review and commit**

Run: `git diff --check && git status --short && git log --oneline -4`

Expected: no whitespace errors and only intended source, tests, and documentation changes on `codex/auth-flow-password-records`.

Run: `git add public/app.js public/index.html public/password-ui.js public/totp-input.js public/workspace.css src/auth.ts src/index.ts test/index.spec.ts test/password-ui.spec.ts test/totp-input.spec.ts docs/superpowers/plans/2026-08-14-auth-flow-password-records.md && git commit -m "feat: streamline secure login and password records"`

- [ ] **Step 5: Push the verified branch**

Run: `git push -u origin codex/auth-flow-password-records`

Expected: remote branch is created without force push; report the commit SHA and verification evidence.
