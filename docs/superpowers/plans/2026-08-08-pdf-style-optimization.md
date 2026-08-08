# PDF 样式与工作区优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按《样式修改.pdf》将现有加密笔记优化为层级更清晰、密度更合理、操作更接近在线文档的三栏工作区，同时完整保留现有客户端加密、认证、附件和分享安全模型。

**Architecture:** 在已经完成的经典三栏基础上，继续沿用 `workspace-view.js` 的响应式状态模型和 `app.js` 的单一状态源。前端先完成导航、列表、正文和密码记录的交互重构；最近删除单独扩展 D1/API/客户端状态，并通过软删除标记隔离普通查询与回收站查询。所有纯展示模型优先放入独立无 DOM 模块，便于 Vitest 覆盖。

**Tech Stack:** Cloudflare Workers、D1、R2、原生 HTML/CSS/ES modules、Vitest、Wrangler。

## Global Constraints

- 不修改 PBKDF2、AES-GCM、`enc:v1`、Vault 隔离、认证 Cookie 或密钥生命周期。
- 不把笔记标题、正文、密码字段或文件夹名称改为明文存储。
- 不修改现有 API 路由语义，除非最近删除需要新增明确的回收站接口。
- 保留 30 分钟无操作锁定、Authenticator、附件加密、阅后即焚分享和 latest-operation 防旧结果回写。
- 桌面宽屏保持 `216px 360px minmax(0, 1fr)`；紧凑桌面使用导航抽屉；手机一次只显示列表、阅读或编辑中的一个层级。
- 所有按钮继续使用真实按钮、清晰焦点样式和至少 `44x44px` 的触控目标；图标按钮必须提供 `aria-label`。
- 每个行为先写失败测试，再写最小实现；每个任务独立验证并提交。
- 不暂存 `.superpowers/`、既有未相关文档或用户已有工作区改动。

## Existing Baseline

- `docs/superpowers/specs/2026-08-07-classic-three-column-notes-redesign-design.md` 和对应计划已经定义了基础三栏、移动导航和列表/正文职责。
- `public/index.html`、`public/workspace.css`、`public/app.js` 已包含基础三栏结构、文件夹、正文操作和密码字段功能。
- `public/folder-model.js` 已提供文件夹排序、名称解析和筛选纯函数。
- `public/password-ui.js` 已提供密码字段编辑和保存模型。
- 当前删除逻辑位于 `public/app.js` 与 Worker 路由中，属于直接删除，需要在最近删除任务中改造。

---

### Task 1: 建立 PDF 版工作区数据展示模型

**Files:**
- Create: `public/workspace-model.js`
- Modify: `test/workspace-view.spec.ts`
- Create: `test/workspace-model.spec.ts`

**Interfaces:**
- `buildNavigationModel(notes, folders, activeCategory, activeFolderId, trashCount)` 返回左栏分组、计数和当前项。
- `getSortOptions()` 返回排序选项。
- `sortVisibleNotes(notes, sortKey)` 返回不修改原数组的记录列表。
- `buildPasswordDisplayModel(fields)` 返回默认隐藏、复制可用和备注多行等展示元数据。

- [ ] **Step 1: 写失败测试**

覆盖：全部/未分类计数、笔记/密码子分类、文件夹计数、最近删除计数、排序稳定性、密码字段默认隐藏和备注多行。

- [ ] **Step 2: 运行纯函数测试确认失败**

Run: `npx vitest run test/workspace-model.spec.ts`

Expected: FAIL，因为新模块和导出函数不存在。

- [ ] **Step 3: 实现最小纯函数**

只处理已解密到内存中的展示模型；不读取 DOM、不访问网络、不保存敏感值。

- [ ] **Step 4: 验证通过**

Run: `npx vitest run test/workspace-model.spec.ts test/workspace-view.spec.ts`

- [ ] **Step 5: 提交**

```bash
git add public/workspace-model.js test/workspace-model.spec.ts test/workspace-view.spec.ts
git commit -m "feat: model PDF workspace navigation and display state"
```

### Task 2: 左栏资料库层级、计数和折叠

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/workspace.css`
- Modify: `test/index.spec.ts`
- Modify: `test/folder-model.spec.ts`

**Interfaces:**
- Consumes: Task 1 `buildNavigationModel` 和现有 `folder-model.js`。
- Produces: `renderNavigationModel()`、左栏折叠状态、文件夹图标按钮和记录计数 DOM。

- [ ] **Step 1: 写失败静态/模型测试**

断言左栏包含全部、未分类、笔记、密码、我的文件夹、最近删除和新建文件夹入口；断言文件夹记录计数来自展示模型；断言 `disableTotpBtn` 不受本任务影响。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/index.spec.ts test/folder-model.spec.ts`

- [ ] **Step 3: 重排左栏 HTML**

将分类改为总入口下的子分类，将自定义文件夹放入“我的文件夹”分组，底部增加最近删除入口；文件夹行使用图标、名称、计数和更多菜单触发器。

- [ ] **Step 4: 接入渲染和交互**

使用 `renderNavigationModel()` 更新计数、当前态、文件夹新增/重命名入口和最近删除入口；保留现有筛选条件与锁定后的敏感 DOM 清理。

- [ ] **Step 5: 增加折叠行为**

桌面端切换 `data-navigation-collapsed`；紧凑桌面继续使用抽屉；手机保持单层导航，不显示常驻三栏。

- [ ] **Step 6: 验证**

Run: `npx vitest run test/index.spec.ts test/folder-model.spec.ts test/workspace-view.spec.ts`

并在 `1440x1024`、`1024x768`、`390x844` 视口检查左栏计数、折叠、抽屉和返回状态。

- [ ] **Step 7: 提交**

```bash
git add public/index.html public/app.js public/workspace.css test/index.spec.ts test/folder-model.spec.ts
git commit -m "feat: reorganize workspace navigation with counts"
```

### Task 3: 中栏排序与新建入口

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/workspace.css`
- Modify: `public/workspace-model.js`
- Create: `test/note-list-model.spec.ts`

**Interfaces:**
- Consumes: `sortVisibleNotes(notes, sortKey)`。
- Produces: 排序按钮、排序菜单、紧凑图标式新建按钮和排序状态持久化到当前会话。

- [ ] **Step 1: 写失败测试**

覆盖最近更新、最近创建、标题升序三种排序，以及时间相同情况下按 ID 的稳定次序。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/note-list-model.spec.ts`

- [ ] **Step 3: 实现排序菜单和列表重渲染**

排序只影响内存中的可见列表，不改变服务器记录顺序；搜索和文件夹筛选先完成，再对结果排序。

- [ ] **Step 4: 将新建入口改为图标按钮**

保留 `newBtn`、`fabNewBtn` 的现有事件目标，增加 `aria-label="新建笔记"` 和可见 tooltip，避免破坏已有事件绑定。

- [ ] **Step 5: 验证**

Run: `npx vitest run test/note-list-model.spec.ts test/index.spec.ts test/composer-saving.spec.ts`

- [ ] **Step 6: 提交**

```bash
git add public/index.html public/app.js public/workspace.css public/workspace-model.js test/note-list-model.spec.ts
git commit -m "feat: add note list sorting and compact create action"
```

### Task 4: 右栏图标化阅读操作

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/workspace.css`
- Modify: `test/workspace-view.spec.ts`

**Interfaces:**
- Consumes: 现有 `getReaderActionModel(record)`、`openReader()`、分享/复制/编辑事件。
- Produces: 图标按钮视觉样式、密码记录隐藏不适用的复制/分享操作、更多菜单中的删除。

- [ ] **Step 1: 写失败测试**

断言笔记显示复制/分享/编辑，密码只显示编辑和字段级复制；所有图标按钮有无障碍名称；删除仍只存在更多菜单。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/workspace-view.spec.ts test/index.spec.ts`

- [ ] **Step 3: 替换按钮视觉**

使用现有按钮 ID，改为图标 + `aria-label`，不修改事件绑定和权限模型。

- [ ] **Step 4: 验证长内容约束**

检查长链接、恢复码、代码块和图片均在正文栏内部换行或自身滚动，不产生页面级横向滚动。

- [ ] **Step 5: 提交**

```bash
git add public/index.html public/app.js public/workspace.css test/workspace-view.spec.ts
git commit -m "style: simplify reader actions into icon controls"
```

### Task 5: 右栏原地编辑和图片粘贴

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/workspace.css`
- Modify: `public/attachment-draft.js`
- Modify: `test/composer-saving.spec.ts`
- Modify: `test/attachment-draft.spec.ts`

**Interfaces:**
- Consumes: 现有编辑器、附件草稿、Markdown 预览和保存流程。
- Produces: `readerView` 内的编辑状态切换，不依赖独立 `editorModal` 作为笔记编辑主入口。

- [ ] **Step 1: 写失败状态测试**

断言点击编辑后正文区域进入编辑态，标题/文件夹/Markdown/附件/保存控件在同一阅读层级；取消后恢复原正文和滚动位置。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/composer-saving.spec.ts test/attachment-draft.spec.ts`

- [ ] **Step 3: 增加原地编辑结构**

新增 `readerEditor` 区域并复用现有编辑字段，保证保存期间沿用 `inert`/最新操作校验；旧弹窗暂时保留用于兼容其他入口，待浏览器验收后再移除。

- [ ] **Step 4: 接入剪贴板图片**

将正文区域的 paste/drop 事件交给现有附件草稿逻辑，图片先客户端加密，状态提示显示在编辑工具栏附近，不增加独立大面积图片卡片。

- [ ] **Step 5: 验证**

Run: `npx vitest run test/composer-saving.spec.ts test/attachment-draft.spec.ts test/markdown.spec.ts`

- [ ] **Step 6: 提交**

```bash
git add public/index.html public/app.js public/workspace.css public/attachment-draft.js test/composer-saving.spec.ts test/attachment-draft.spec.ts
git commit -m "feat: edit notes inline with encrypted image paste"
```

### Task 6: 密码字段紧凑展示

**Files:**
- Modify: `public/password-ui.js`
- Modify: `public/app.js`
- Modify: `public/workspace.css`
- Modify: `test/password-ui.spec.ts`

**Interfaces:**
- Consumes: 现有密码字段模型和 `getReaderActionModel`。
- Produces: 单行字段展示模型，包含字段名、隐藏/显示值、复制按钮和备注多行标记。

- [ ] **Step 1: 写失败测试**

覆盖普通字段默认完整显示、密码默认隐藏、密码显示切换、每字段独立复制、长值不撑宽和备注允许多行。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/password-ui.spec.ts`

- [ ] **Step 3: 实现紧凑 DOM 和样式**

使用 `min-width: 0`、`overflow-wrap: anywhere` 和字段级 flex/grid；复制按钮改为图标但保留可访问名称；不把秘密值写入列表摘要。

- [ ] **Step 4: 验证**

Run: `npx vitest run test/password-ui.spec.ts test/password-fields.spec.ts test/note-records.spec.ts`

- [ ] **Step 5: 提交**

```bash
git add public/password-ui.js public/app.js public/workspace.css test/password-ui.spec.ts
git commit -m "style: compact password field presentation"
```

### Task 7: 最近删除数据模型和 API

**Files:**
- Create: `migrations/0011_note_trash.sql`
- Modify: `src/schema.ts`
- Modify: `src/index.ts`
- Modify: `src/attachments.ts`
- Create: `test/trash-api.spec.ts`
- Modify: `test/apply-migrations.ts`

**Interfaces:**
- Produces: `deleted_at`/软删除状态字段；普通列表排除已删除记录；回收站查询、恢复、永久删除接口。
- API 行为：`GET /api/notes?trash=1`、`POST /api/notes/:id/restore`、`DELETE /api/notes/:id/permanent`，具体鉴权沿用现有会话和 Vault 访问控制。

- [ ] **Step 1: 写失败 Worker/API 测试**

覆盖删除后普通查询隐藏、回收站可见、恢复回到原记录、永久删除清理附件、无权限/不存在记录返回现有风格错误。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/trash-api.spec.ts`

- [ ] **Step 3: 添加迁移和类型**

新增可为空的删除时间/状态字段和必要索引；不触碰加密内容列和既有附件格式。

- [ ] **Step 4: 实现服务端路由**

普通 DELETE 改为设置软删除时间；恢复清空删除时间；永久删除才执行既有附件删除逻辑。分享路由拒绝已删除记录。

- [ ] **Step 5: 验证 API 和迁移**

Run: `npx vitest run test/trash-api.spec.ts test/index.spec.ts`

并运行 `npx wrangler types`，确认绑定类型无回归。

- [ ] **Step 6: 提交**

```bash
git add migrations/0011_note_trash.sql src/schema.ts src/index.ts src/attachments.ts test/trash-api.spec.ts test/apply-migrations.ts worker-configuration.d.ts
git commit -m "feat: add encrypted note trash lifecycle"
```

### Task 8: 最近删除前端流程

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/workspace.css`
- Create: `test/trash-ui.spec.ts`

**Interfaces:**
- Consumes: Task 1 navigation model and Task 7 trash API。
- Produces: 最近删除列表、恢复、永久删除、数量更新、原文件夹恢复策略。

- [ ] **Step 1: 写失败 UI/model tests**

断言普通列表不显示已删除记录，最近删除显示删除时间，恢复后回到原筛选，原文件夹不存在时显示未分类。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/trash-ui.spec.ts`

- [ ] **Step 3: 实现客户端状态和命令**

新增 `state.trashMode`、`refreshTrash()`、`restoreNote()`、`permanentlyDeleteNote()`；删除后关闭阅读区并刷新计数，所有异步结果继续经过最新操作校验。

- [ ] **Step 4: 实现回收站 UI**

回收站使用与中栏一致的连续行；普通删除入口仍在正文更多菜单，回收站中仅显示恢复和永久删除。

- [ ] **Step 5: 验证**

Run: `npx vitest run test/trash-ui.spec.ts test/note-records.spec.ts test/ui-state.spec.ts`

- [ ] **Step 6: 提交**

```bash
git add public/index.html public/app.js public/workspace.css test/trash-ui.spec.ts
git commit -m "feat: add recent-deleted notes workflow"
```

### Task 9: 设置项视觉降权

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `test/index.spec.ts`

**Interfaces:**
- Consumes: 现有 `disableTotpBtn` 元素 ID 和 `app.js` 点击绑定。
- Produces: `.security-secondary-action` 低权重视觉契约。

- [ ] **Step 1: 写失败测试**

断言按钮位于 `.security-panel-actions` 外部，带有 `.security-secondary-action-btn`，且原 ID 保留。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/index.spec.ts -t "serves the application shell"`

- [ ] **Step 3: 实现**

将按钮移动到安全卡片底部，使用灰色、小字号、透明背景和悬停/焦点时的危险色文字；保留现有隐藏逻辑和确认流程。

- [ ] **Step 4: 验证**

Run: `npx vitest run test/index.spec.ts test/ui-state.spec.ts`

- [ ] **Step 5: 提交**

```bash
git add public/index.html public/styles.css test/index.spec.ts
git commit -m "style: de-emphasize disabling two-factor auth"
```

### Task 10: 响应式、可访问性和真实视口验收

**Files:**
- Modify: `public/workspace.css`
- Modify: `public/styles.css`
- Modify: `test/workspace-view.spec.ts`
- Modify: `test/index.spec.ts`

- [ ] **Step 1: 运行完整自动化测试**

Run: `npm test`

Expected: 所有 Vitest 测试通过。

- [ ] **Step 2: 类型检查和静态资源验证**

Run: `npm run typecheck:client` 和 `npx wrangler types`

- [ ] **Step 3: 浏览器视口验收**

在 `1440x1024`、`1024x768`、`390x844`、`430x932` 检查：左栏折叠/抽屉、列表滚动恢复、正文原地编辑、密码字段、长链接/代码块/图片、最近删除以及设置抽屉。

- [ ] **Step 4: 验证敏感状态清理**

确认锁定、401、退出登录和重新验证后，正文、密码值、恢复码、文件夹名和回收站内容均从敏感 DOM 清理。

- [ ] **Step 5: 最终检查**

Run: `git diff --check && git status --short`

确认只包含本计划相关提交和用户已有未相关文件，不暂存 `.superpowers/`。

