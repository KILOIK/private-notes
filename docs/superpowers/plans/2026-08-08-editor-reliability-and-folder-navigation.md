# 编辑器可靠性与文件夹二级分类 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让在线文档的块级 Markdown 在真实浏览器 DOM 中稳定保存，修复内联保存后的不可点击状态，并将笔记/密码筛选移动到文件夹的二级导航中。

**Architecture:** 保留加密 Markdown 与 `activeFolderId + activeCategory` 这两个现有状态字段。`document-editor.js` 负责递归序列化浏览器生成的块级 DOM，`composer-saving.js` 负责将一次保存锁定绑定到固定宿主，`workspace-model.js` 产生每个文件夹的总数和类型计数，`app.js` 仅负责把这些模型接入现有编辑、保存和筛选流程。

**Tech Stack:** 原生 HTML/CSS/ES modules、ContentEditable、Vitest 4、TypeScript 5.9、Cloudflare Workers 静态前端。

## Global Constraints

- 不修改 PBKDF2、AES-GCM、`enc:v1`、Vault 隔离、认证 Cookie、Authenticator、D1/R2 密文、附件加密和分享协议。
- 普通笔记仍保存加密 Markdown；服务端不保存富文本 HTML。
- 不引入新的运行时依赖或完整富文本编辑器。
- 输出仅允许白名单 DOM 和 `http/https` 链接；图片仅允许 `attachment://` 与 `pending://`。
- 保存失败必须保留编辑内容和附件草稿，并恢复当前编辑宿主的可操作状态。
- 初次解锁时默认选择未分类；仅当前文件夹展开二级“笔记 / 密码”筛选。
- 不暂存 `.superpowers/`、现有未跟踪规划文档或用户未授权的文件。

---

## File Structure

- Create `public/composer-draft.js`: 生成编辑器初始快照和当前快照，用于取消前的脏状态确认。
- Modify `public/document-editor.js`: 递归块级序列化透明包装节点、列表与代码块。
- Modify `public/composer-saving.js`: 用可释放的保存租约锁定并解除同一个编辑宿主。
- Modify `public/workspace-model.js`: 计算每个文件夹的总数、笔记数、密码数和活动键。
- Modify `public/app.js`: 接入草稿快照、保存宿主、顶栏状态、文件夹树事件与默认未分类选择。
- Modify `public/index.html`: 移除全局分类栏，添加顶栏保存状态和树状文件夹容器。
- Modify `public/styles.css` and `public/workspace.css`: sticky 操作栏、工具栏偏移、文件夹子筛选与移动端样式。
- Modify `test/document-editor.spec.ts`, `test/composer-saving.spec.ts`, `test/workspace-model.spec.ts`, `test/index.spec.ts`.
- Create `test/composer-draft.spec.ts`.

## Task 1: 正确序列化浏览器包装的列表与代码块

**Files:**
- Modify: `public/document-editor.js`
- Modify: `test/document-editor.spec.ts`

**Interfaces:**
- Preserves: `loadEditorMarkdown(editor, markdown, attachments?, pendingAttachments?)`、`serializeEditorMarkdown(editor)`、`runEditorCommand(editor, command, value?)`。
- Produces: 内部 `serializeBlocks(nodes, depth?)`，将透明包装节点展开为规范化 Markdown 块。

- [ ] **Step 1: 写有序列表包装的失败测试**

在 `test/document-editor.spec.ts` 加入 `DIV → OL → LI` 结构，并断言根编辑器输出保留编号：

```ts
it('keeps ordered lists when a browser wraps them in a div', () => {
  const editor = new EditorNode('div');
  editor.append(element('div', [
    element('ol', [
      element('li', [text('第一项')]),
      element('li', [text('第二项')]),
    ]),
  ]));

  expect(serializeEditorMarkdown(editor as never)).toBe('1. 第一项\n2. 第二项');
});
```

- [ ] **Step 2: 写代码块包装的失败测试**

在同一文件加入 `DIV → PRE → CODE.language-ts` 结构：

```ts
it('keeps fenced code when a browser wraps pre/code nodes', () => {
  const editor = new EditorNode('div');
  editor.append(element('div', [
    element('pre', [element('code', [text('const value = 1;')], { class: 'language-ts' })]),
  ]));

  expect(serializeEditorMarkdown(editor as never)).toBe('```ts\nconst value = 1;\n```');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run test/document-editor.spec.ts`

Expected: FAIL；现有实现将列表输出为 `第一项第二项`，代码块输出为 `const value = 1;`。

- [ ] **Step 4: 以块级递归替换根节点假设**

在 `public/document-editor.js` 定义块级标签集合和递归序列化器：

```js
const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'PRE']);

function hasBlockChild(node) {
  return childrenOf(node).some(function (child) {
    return BLOCK_TAGS.has(String(child?.tagName || '').toUpperCase());
  });
}

function serializeBlocks(nodes) {
  return nodes.flatMap(function (node) {
    const tag = String(node?.tagName || '').toUpperCase();
    if ((tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') && hasBlockChild(node)) {
      return serializeBlocks(childrenOf(node));
    }
    const markdown = serializeBlock(node);
    return markdown ? [markdown] : [];
  });
}

export function serializeEditorMarkdown(editor) {
  return serializeBlocks(childrenOf(editor)).join('\n\n').trim();
}
```

调整 `serializeBlock()`：`DIV/SECTION/ARTICLE` 没有块级子节点时按段落处理；`PRE` 可从自身或首个 `CODE` 子节点读取文本和 `language-*` 类名；`UL/OL` 继续遍历 `LI`，嵌套列表通过递归块级序列化后以两个空格缩进。

- [ ] **Step 5: 运行编辑器与 Markdown 回归**

Run: `npx vitest run test/document-editor.spec.ts test/markdown.spec.ts`

Expected: PASS；新用例和既有安全 URL、附件引用用例全部通过。

- [ ] **Step 6: 提交**

```bash
git add public/document-editor.js test/document-editor.spec.ts
git commit -m "fix: preserve wrapped editor blocks in markdown"
```

## Task 2: 固定顶部操作栏与可恢复保存事务

**Files:**
- Create: `public/composer-draft.js`
- Modify: `public/composer-saving.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/workspace.css`
- Create: `test/composer-draft.spec.ts`
- Modify: `test/composer-saving.spec.ts`
- Modify: `test/index.spec.ts`

**Interfaces:**
- Produces: `createComposerDraftSnapshot({ recordType, title, folderId, fields, markdown, pendingCount }): string`。
- Produces: `beginComposerSaving(state, { saveButton, cancelButton, host }): () => void`；返回的函数永远解除传入的同一 `host`。
- Consumes: `serializeEditorMarkdown()`、现有 `saveComposer()`、`closeComposer()`、附件草稿状态。

- [ ] **Step 1: 写草稿快照失败测试**

创建 `test/composer-draft.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { createComposerDraftSnapshot } from '../public/composer-draft.js';

describe('composer draft snapshot', () => {
  it('changes when a note title, folder, body, or pending image changes', () => {
    const base = createComposerDraftSnapshot({ recordType: 'note', title: '标题', folderId: 'work', fields: [], markdown: '正文', pendingCount: 0 });
    expect(createComposerDraftSnapshot({ recordType: 'note', title: '新标题', folderId: 'work', fields: [], markdown: '正文', pendingCount: 0 })).not.toBe(base);
    expect(createComposerDraftSnapshot({ recordType: 'note', title: '标题', folderId: 'life', fields: [], markdown: '正文', pendingCount: 0 })).not.toBe(base);
    expect(createComposerDraftSnapshot({ recordType: 'note', title: '标题', folderId: 'work', fields: [], markdown: '新正文', pendingCount: 0 })).not.toBe(base);
    expect(createComposerDraftSnapshot({ recordType: 'note', title: '标题', folderId: 'work', fields: [], markdown: '正文', pendingCount: 1 })).not.toBe(base);
  });
});
```

- [ ] **Step 2: 写内联保存宿主失败测试**

扩展 `test/composer-saving.spec.ts`：

```ts
it('releases the original inline host after editor mode changes', () => {
  const state = { composerSaving: false };
  const readerHost = createHost();
  const controls = createControls(readerHost);
  const release = beginComposerSaving(state, controls);

  release();

  expect(readerHost.inert).toBe(false);
  expect(readerHost.attributes.has('aria-busy')).toBe(false);
  expect(state.composerSaving).toBe(false);
});
```

`createHost()` 和 `createControls()` 在测试文件内创建与现有 stub 等价的按钮和属性 Map；测试断言的是最初传入的 `readerHost`，不依赖之后 `editingInline` 的值。

- [ ] **Step 3: 写静态顶部栏失败测试**

在 `test/index.spec.ts` 增加：

```ts
expect(appHtml).toContain('id="composerActionBar"');
expect(appHtml).toContain('id="composerSaveStatus"');
expect(appHtml).toContain('id="cancelBtn"');
expect(appHtml).toContain('id="saveBtn"');
expect(appHtml).not.toContain('id="closeModalBtn"');
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npx vitest run test/composer-draft.spec.ts test/composer-saving.spec.ts test/index.spec.ts`

Expected: FAIL；草稿模块、保存租约和顶部栏尚不存在。

- [ ] **Step 5: 实现草稿快照与保存租约**

创建 `public/composer-draft.js`：

```js
export function createComposerDraftSnapshot(draft) {
  return JSON.stringify({
    recordType: draft.recordType === 'password' ? 'password' : 'note',
    title: String(draft.title || ''),
    folderId: typeof draft.folderId === 'string' ? draft.folderId : null,
    fields: Array.isArray(draft.fields) ? draft.fields.map(function (field) {
      return { id: String(field.id || ''), type: String(field.type || ''), label: String(field.label || ''), value: String(field.value || '') };
    }) : [],
    markdown: String(draft.markdown || ''),
    pendingCount: Math.max(0, Number(draft.pendingCount) || 0),
  });
}
```

在 `public/composer-saving.js` 导出：

```js
export function beginComposerSaving(state, elements) {
  setComposerSaving(state, elements, true);
  return function releaseComposerSaving() {
    setComposerSaving(state, elements, false);
  };
}
```

同时将 `setComposerSaving()` 的元素参数收敛为 `saveButton`、`cancelButton` 与 `host`：它只禁用这两个顶部按钮，并在 `host` 上设置或删除 `inert`、`aria-busy`。删除原有 `closeButton` 参数与对 `closeModalBtn` 的依赖。

- [ ] **Step 6: 连接顶部栏、取消确认与稳定的 finally**

在 `public/index.html` 删除原 `closeModalBtn`，在 `modal-head` 后、工具栏前插入：

```html
<div id="composerActionBar" class="composer-action-bar" aria-label="编辑操作">
  <div id="composerSaveStatus" class="composer-save-status" role="status" aria-live="polite"></div>
  <div class="composer-action-buttons">
    <button id="cancelBtn" class="btn secondary" type="button">取消</button>
    <button id="saveBtn" class="btn" type="button">保存</button>
  </div>
</div>
```

在 `public/app.js`：

```js
function getComposerSnapshot() {
  return createComposerDraftSnapshot({
    recordType: state.editorRecordType,
    title: els.editorTitle.value,
    folderId: state.editorFolderId,
    fields: state.editorPasswordFields,
    markdown: state.editorRecordType === 'password' ? '' : serializeEditorMarkdown(els.documentEditor),
    pendingCount: state.attachmentDraft.images.length,
  });
}

function requestCloseComposer() {
  if (state.composerSaving) return;
  if (state.composerInitialSnapshot !== getComposerSnapshot() && !confirm('放弃未保存内容吗？')) return;
  closeComposer();
}
```

在 `openComposer()` 设置 `state.composerInitialSnapshot = getComposerSnapshot()`，在 `closeComposer()` 清空该状态。`saveComposer()` 开始时创建：

```js
const savingHost = state.editingInline ? els.readerEditor : els.editorModal;
const releaseSaving = beginComposerSaving(state, {
  saveButton: els.saveBtn,
  cancelButton: els.cancelBtn,
  host: savingHost,
});
```

把原 `updateComposerSaving(true/false)` 调用替换为 `releaseSaving()` 放在 `finally` 中；保存成功后把初始快照更新为当前快照。失败时将 `composerSaveStatus.textContent` 设为错误信息，不调用 `closeComposer()`。

在 CSS 中让 `.composer-action-bar` 位于工具栏之前并 sticky；`z-index` 高于工具栏，右侧按钮保持 44px 高度。`reader-editor-card` 的两层 sticky 区横向扩展到阅读器左右留白；移动端使用 16px 留白且不产生页面级横向滚动。

- [ ] **Step 7: 运行保存和页面结构测试**

Run: `npx vitest run test/composer-draft.spec.ts test/composer-saving.spec.ts test/document-editor.spec.ts test/index.spec.ts test/attachment-draft.spec.ts`

Expected: PASS；内联宿主在 release 后可用，取消脏编辑需要确认，顶部操作栏结构存在。

- [ ] **Step 8: 提交**

```bash
git add public/composer-draft.js public/composer-saving.js public/app.js public/index.html public/styles.css public/workspace.css test/composer-draft.spec.ts test/composer-saving.spec.ts test/index.spec.ts
git commit -m "fix: keep composer actions available after saves"
```

## Task 3: 用文件夹二级分类替代全局分类栏

**Files:**
- Modify: `public/workspace-model.js`
- Modify: `public/vault-ui-state.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/workspace.css`
- Modify: `test/workspace-model.spec.ts`
- Modify: `test/index.spec.ts`
- Modify: `test/ui-state.spec.ts`

**Interfaces:**
- Changes: `buildNavigationModel(notes, folders, activeCategory, activeFolderId, trashCount)` 的 `folderCounts` 值变为 `{ total, note, password }`。
- Produces: `activeKey` 为 `folder:<id>:all|note|password` 或 `uncategorized:all|note|password`。
- Preserves: `matchesNoteFilter()`、搜索、阅读器、垃圾箱、现有 `activeCategory` 值域。

- [ ] **Step 1: 写文件夹类型计数失败测试**

修改 `test/workspace-model.spec.ts`：

```ts
it('groups total, note, and password counts under every folder', () => {
  const model = buildNavigationModel(notes, folders, 'password', 'work', 2);
  expect(model.folderCounts).toEqual({
    work: { total: 1, note: 1, password: 0 },
    life: { total: 0, note: 0, password: 0 },
  });
  expect(model.uncategorizedCounts).toEqual({ total: 2, note: 1, password: 1 });
  expect(model.activeKey).toBe('folder:work:password');
});
```

- [ ] **Step 2: 写默认未分类失败测试**

修改 `test/ui-state.spec.ts` 中已有的 Vault 文件夹清理用例，使其表达下次解锁时的默认筛选：

```ts
clearDecryptedFolderState(state);

expect(state.activeCategory).toBe('all');
expect(state.activeFolderId).toBeNull();
```

同时在 `test/index.spec.ts` 断言应用初始状态使用 `activeFolderId: null`，使第一次解锁后的一级选中项固定为未分类。

- [ ] **Step 3: 写导航结构失败测试**

在 `test/index.spec.ts` 增加：

```ts
expect(appHtml).not.toContain('id="categoryNav"');
expect(appHtml).not.toContain('id="navigationTotalCount"');
expect(appHtml).toContain('id="folderNav"');
expect(appScript).toContain('data-folder-category');
expect(appScript).toContain("state.activeFolderId = folderId === '__uncategorized__' ? null : folderId;");
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npx vitest run test/workspace-model.spec.ts test/ui-state.spec.ts test/index.spec.ts`

Expected: FAIL；模型只有扁平总数，页面仍包含 `categoryNav`。

- [ ] **Step 5: 扩展导航模型和默认筛选**

在 `public/workspace-model.js` 初始化：

```js
const folderCounts = Object.fromEntries(folders.map(function (folder) {
  return [folder.id, { total: 0, note: 0, password: 0 }];
}));
const uncategorizedCounts = { total: 0, note: 0, password: 0 };
```

遍历每条笔记时为目标文件夹或未分类的 `total` 与对应类型加一。返回冻结的计数对象和以下活动键：

```js
const scope = activeFolderId === null ? 'uncategorized' : `folder:${activeFolderId}`;
const activeKey = `${scope}:${activeCategory}`;
```

将 `public/app.js` 的初始 `state.activeFolderId` 改为 `null`，并让 `clearDecryptedFolderState()` 重置为 `null`。垃圾箱仍显式使用 `activeFolderId = undefined`、`activeCategory = 'all'`，因为它不渲染文件夹树的活动项。

- [ ] **Step 6: 渲染并处理文件夹树**

在 `public/index.html` 删除 `categoryNav` 和其“资料库”标签，并将 `folderNav` 改为空容器；`renderFolders()` 每次重新生成未分类和自定义文件夹的完整树，避免静态未分类按钮与动态二级项的状态不同步。父项和条件子项由以下结构生成：

```js
function appendFolderFilters(container, folderId, counts) {
  const children = document.createElement('div');
  children.className = 'folder-subfilters';
  children.hidden = state.activeFolderId !== folderId;
  ['note', 'password'].forEach(function (category) {
    const child = document.createElement('button');
    child.type = 'button';
    child.className = 'folder-subfilter';
    child.dataset.folderId = folderId === null ? '__uncategorized__' : folderId;
    child.dataset.folderCategory = category;
    child.textContent = `${category === 'note' ? '笔记' : '密码'} ${counts[category]}`;
    children.append(child);
  });
  container.append(children);
}
```

父项点击设置 `activeFolderId`、`activeCategory = 'all'`。子项点击设置同一文件夹与 `activeCategory = 'note' | 'password'`。`renderFilterNav()` 使用 `data-folder-category` 为父项和子项设置 `.is-active` 与 `aria-current`；只有活动文件夹的 `.folder-subfilters` 不隐藏。`renderList()` 的标题改为当前文件夹名称，二级筛选时追加“· 笔记”或“· 密码”，避免在没有全局“全部”筛选后仍显示“全部笔记”。

在 `workspace.css` 添加树缩进、父项/子项活动态、44px 子项触控目标和移动端可见焦点样式；移除无使用者的 `.category-nav`、`.category-tab` 规则。

- [ ] **Step 7: 运行导航回归**

Run: `npx vitest run test/workspace-model.spec.ts test/ui-state.spec.ts test/index.spec.ts test/folder-model.spec.ts`

Expected: PASS；每个文件夹的类型计数、默认未分类和新 HTML 结构均正确。

- [ ] **Step 8: 提交**

```bash
git add public/workspace-model.js public/vault-ui-state.js public/app.js public/index.html public/workspace.css test/workspace-model.spec.ts test/ui-state.spec.ts test/index.spec.ts
git commit -m "feat: nest note types under folders"
```

## Task 4: 端到端回归与响应式验收

**Files:**
- Modify if QA requires it: `public/app.js`, `public/document-editor.js`, `public/index.html`, `public/styles.css`, `public/workspace.css`, and affected tests.

**Interfaces:**
- Preserves: 现有加密保存、附件上传、锁定清理、阅读器与垃圾箱流程。
- Produces: 桌面、紧凑桌面和移动端均无页面级横向滚动的稳定编辑体验。

- [ ] **Step 1: 运行针对性测试**

Run: `npx vitest run test/document-editor.spec.ts test/markdown.spec.ts test/composer-draft.spec.ts test/composer-saving.spec.ts test/attachment-draft.spec.ts test/workspace-model.spec.ts test/ui-state.spec.ts test/index.spec.ts test/folder-model.spec.ts`

Expected: PASS。

- [ ] **Step 2: 运行完整项目检查**

Run: `npm run check`

Expected: 三项 TypeScript 检查、16 个工具测试和全量 Vitest 均通过。

- [ ] **Step 3: 在本地预览检查顶部栏与导航**

Run: `npx wrangler dev --port 8787`

在应用内浏览器依次验证：

1. 打开一篇足够长的普通笔记并进入内联编辑；滚动正文，确认“取消 / 保存”和工具栏仍可见。
2. 用工具栏插入有序列表和代码块，保存后重开笔记，确认阅读器仍显示列表编号和 fenced code block 样式。
3. 保存一次内联编辑，再重新打开编辑器；确认标题、正文、取消和保存均可点击。对 API 失败或附件失败路径，确认状态栏出现错误且可再次保存。
4. 在未分类与一个自定义文件夹间切换，确认只有当前文件夹展开，父项显示全部，子项只筛选对应笔记/密码。
5. 切换 1280px、900px 与 390×844 视口，确认操作栏、工具栏、文件夹树均无页面级横向溢出，按钮至少 44px 高。

- [ ] **Step 4: 检查安全与清理路径**

锁定 Vault 或退出当前会话后确认：编辑 DOM、密码字段、标题、附件草稿与文件夹二级项的解密内容均被清空；不新增全局明文分类或服务端明文数据。

- [ ] **Step 5: 提交 QA 修正（仅在有修改时）**

```bash
git add public/document-editor.js public/composer-draft.js public/composer-saving.js public/workspace-model.js public/vault-ui-state.js public/app.js public/index.html public/styles.css public/workspace.css test
git commit -m "fix: polish editor and folder navigation QA"
```

- [ ] **Step 6: 最终检查**

Run: `git status --short && npm run check`

Expected: 除用户已有未跟踪文件外没有工作变更，检查全部通过。之后使用 `superpowers:verification-before-completion` 与 `superpowers:finishing-a-development-branch` 完成整合。
