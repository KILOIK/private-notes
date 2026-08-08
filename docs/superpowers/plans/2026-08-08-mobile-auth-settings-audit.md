# 移动端认证与登录设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复移动端密码/设置界面，建立独立 Authenticator 页面，并支持登录文案、空闲超时和登录设备记录配置。

**Architecture:** 保持现有 `/api/login`、`/api/login/totp` 和 session cookie 协议。新增版本化 `app_meta` 配置读写、认证 session 元数据字段和一个独立的前端认证步骤模型；移动端只调整布局与可操作区域，不改变加密笔记数据流。

**Tech Stack:** 原生 HTML/CSS/ES modules、TypeScript、Cloudflare Workers、D1、Vitest 4。

## Global Constraints

- 不修改 PBKDF2、AES-GCM、`enc:v1`、Vault 隔离、认证 Cookie、Authenticator 验证算法、附件加密和分享协议。
- 普通笔记仍只保存加密 Markdown，不保存富文本 HTML。
- 不引入新的运行时依赖或完整富文本编辑器。
- 配置只允许纯文本；不允许 HTML、脚本或事件属性。
- 设备记录不记录密码、TOTP secret、恢复码或笔记明文。
- migration 只新增元数据字段/键，不删除或改写既有笔记和认证密文。

---

### Task 1: 移动端密码字段布局

**Files:**
- Modify: `public/workspace.css`, `public/styles.css`
- Modify: `public/password-ui.js` only if the current DOM cannot support the layout
- Test: `test/password-ui.spec.ts` or a new focused layout-model test

**Interfaces:** Preserve the current `renderPasswordReader()` output semantics, copy/show handlers, and multiline field behavior.

- [ ] Write a failing test proving a multiline password field keeps a full-width value region and separate action region on mobile.
- [ ] Run the focused test and observe the missing layout contract.
- [ ] Implement the smallest responsive CSS/DOM change: mobile fields stack label above content; value uses `min-width:0` and `overflow-wrap:anywhere`; action buttons remain 44px; no root horizontal overflow.
- [ ] Run the focused password UI tests and existing reader tests.
- [ ] Commit `fix: widen mobile password reader content`.

### Task 2: Mobile settings sheet and compact entry

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`, `public/workspace.css`
- Modify: `test/index.spec.ts`, `test/ui-state.spec.ts`

**Interfaces:** Preserve `openSettings()`, `closeSettings()`, `settingsReturnFocus`, and existing TOTP enrollment controls.

- [ ] Add failing static/state tests for a mobile settings backdrop, background inert state, compact settings trigger, and focus restoration.
- [ ] Run them and verify the current drawer behavior fails the contract.
- [ ] Implement a fixed mobile sheet with backdrop, scroll lock, `aria-hidden`, and `inert` on the workspace background; keep desktop right drawer; compact the mobile settings button without changing its action.
- [ ] Verify open/close state tests and shell structure.
- [ ] Commit `fix: keep mobile settings out of workspace content`.

### Task 3: Standalone Authenticator view

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`
- Create: `public/totp-input.js`
- Modify: `test/index.spec.ts`, `test/ui-state.spec.ts`
- Create: `test/totp-input.spec.ts`

**Interfaces:** Preserve `/api/login/totp` payload `{ challengeId, code }`; add `normalizeTotpInput(value)` and `moveTotpFocus(inputs, index, direction)` in `public/totp-input.js`.

- [ ] Add failing tests for six-cell input normalization, paste of six digits, backspace focus movement, and standalone `totpView` shell.
- [ ] Run the focused tests and observe missing module/view failures.
- [ ] Implement the independent auth step: password view -> TOTP view on `two_factor_required`; six inputs with auto advance/backspace/paste; recovery-code link; return to existing unlock flow on success; never persist challenge id.
- [ ] Run TOTP, auth-state, and API regression tests.
- [ ] Commit `feat: use standalone authenticator verification view`.

### Task 4: Versioned login branding and timeout configuration

**Files:**
- Create: `migrations/0012_auth_settings.sql`
- Modify: `src/auth.ts`, `src/index.ts`, `src/schema.ts`, `src/branding.ts`
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`
- Modify: `test/index.spec.ts`, `test/auth.spec.ts`

**Interfaces:** Add `getAuthSettings(env)`, `normalizeLoginBranding(value)`, `normalizeIdleTimeoutSeconds(value)`, protected `GET/PUT /api/auth/settings`, and public `GET /api/public-config`.

- [ ] Add failing API tests for defaults, public read, protected write, invalid text/timeout rejection, and server-side timeout enforcement.
- [ ] Run the tests and observe missing migration/config endpoints.
- [ ] Add the non-destructive migration with `branding_login:v1` and `session_idle_timeout_seconds:v1` defaults represented through read fallback; do not alter note ciphertext or cookies.
- [ ] Implement server normalization, protected writes with current-password recheck, public read, and `getSession()` timeout lookup.
- [ ] Implement settings form save/load and update the login page title/description from public config.
- [ ] Run migration, API, and static shell tests.
- [ ] Commit `feat: configure login branding and idle timeout`.

### Task 5: Login device records

**Files:**
- Create: `migrations/0013_auth_device_metadata.sql`
- Modify: `src/auth.ts`, `src/index.ts`, `src/schema.ts`
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`
- Modify: `test/index.spec.ts`, `test/auth.spec.ts`

**Interfaces:** Add protected `GET /api/auth/devices`; session creation records `device_label`, `user_agent`, `login_ip`, `login_at`; response excludes `id_hash` and token fields.

- [ ] Add failing tests for session metadata creation, old-row null compatibility, current-device marking, descending order, and sensitive-field omission.
- [ ] Run the focused tests and observe missing response fields.
- [ ] Implement metadata capture using the existing request IP helper, the new `0013_auth_device_metadata.sql` columns/index, protected list endpoint, and settings rendering.
- [ ] Run API and schema regression tests.
- [ ] Commit `feat: show authenticated device history`.

### Task 6: Integrated browser QA and final review

**Files:** Modify only files covered by Tasks 1–5 if QA exposes a concrete defect; add focused regression tests for every fix.

- [ ] Run all targeted tests from Tasks 1–5.
- [ ] Run `npm run check`.
- [ ] Run `npx wrangler dev --port 8787` and verify desktop, compact desktop, and 390×844 mobile flows.
- [ ] Confirm settings background cannot be clicked while sheet is open, TOTP is a separate view, login branding updates after reload, timeout is enforced server-side, and device records contain no hash/token.
- [ ] Run a fresh full-suite verification and perform an independent read-only branch review.
- [ ] Commit only concrete QA fixes, if any.
