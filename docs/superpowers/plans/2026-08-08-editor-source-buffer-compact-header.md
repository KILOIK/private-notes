# 编辑器源 Markdown 缓存与紧凑头部 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留原有加密 Markdown 存储协议，修复编辑保存时反斜杠重复并精简笔记编辑器头部。

**Architecture:** 在当前编辑会话中增加源 Markdown 缓存和 dirty 状态。未修改时保存原始源文本，修改后只序列化一次并继续沿用现有 `buildNoteSaveContent`、`enc:v1` 加密和附件 token 流程。编辑器 DOM 仅调整头部布局和图片拖拽事件承载位置，不引入新的运行时依赖。

**Tech Stack:** 原生 HTML/CSS/JavaScript、TypeScript 检查、Vitest 4、Cloudflare Workers/D1 现有 API。

## Global Constraints

- 不改变现有加密存储：仍使用同一 Markdown 字符串进入现有 `enc:v1` 加密流程。
- 不新增数据库字段、API 字段或运行时依赖。
- 不修改 PBKDF2、AES-GCM、认证 Cookie、附件加密和分享协议。
- 普通笔记仍只保存加密 Markdown，不保存富文本 HTML。
- 保留正文粘贴图片、编辑区域拖拽图片、附件加密、保存失败恢复和重试行为。
- 生产代码修改前必须先有失败测试，并实际观察测试失败原因。

---

### Task 1: Markdown 反斜杠保真

**Files:**
- Modify: `public/document-editor.js`
- Test: `test/document-editor.spec.ts`

**Interfaces:** 保持 `loadEditorMarkdown(editor, markdown, attachments, pendingAttachments)` 和 `serializeEditorMarkdown(editor): string` 签名不变。

- [ ] **Step 1: Write the failing regression tests**

在 `test/document-editor.spec.ts` 增加两个测试：

```ts
it('preserves a literal backslash in a text node when serializing', () => {
  const editor = new EditorNode('div');
  editor.append(element('p', [text(String.raw`pmr\_01@126.com`)]));
  expect(serializeEditorMarkdown(editor as never)).toBe(String.raw`pmr\_01@126.com`);
});

it('keeps markdown escapes stable after load and serialize', () => {
  const { documentStub } = createEditorDocument();
  withDocument(documentStub, () => {
    const editor = new EditorNode('div');
    const source = String.raw`联系 pmr\_01@126.com`;
    loadEditorMarkdown(editor as never, source);
    expect(serializeEditorMarkdown(editor as never)).toBe(source);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

运行 `npx vitest run test/document-editor.spec.ts`。预期新增测试失败，失败值中出现多余反斜杠；如果测试报错而不是断言失败，先修正测试夹具。

- [ ] **Step 3: Implement minimal serialization fix**

修改 `escapeText()`，不再把已有反斜杠加入转义字符集合；继续转义反引号、星号、下划线、波浪线和方括号。代码节点继续只转义反引号围栏冲突。

- [ ] **Step 4: Verify GREEN and regressions**

运行 `npx vitest run test/document-editor.spec.ts test/composer-draft.spec.ts test/composer-recovery.spec.ts`，确认全部通过。

- [ ] **Step 5: Commit**

```bash
git add public/document-editor.js test/document-editor.spec.ts
git commit -m "fix: preserve literal backslashes in markdown editor"
```

### Task 2: 编辑会话源 Markdown 缓存

**Files:**
- Modify: `public/app.js`
- Modify: `public/composer-draft.js` only if snapshot needs the source/dirty contract
- Test: `test/composer-draft.spec.ts`, `test/composer-recovery.spec.ts`, `test/index.spec.ts`

**Interfaces:** 新增内部状态 `editorSourceMarkdown: string`、`editorSourceDirty: boolean`；不改变 API payload。

- [ ] **Step 1: Write failing state and shell tests**

增加测试断言：

```ts
it('keeps the original markdown source available for an untouched composer', () => {
  const snapshot = createComposerDraftSnapshot({
    recordType: 'note',
    title: '联系人',
    folderId: null,
    markdown: String.raw`pmr\_01@126.com`,
    pendingCount: 0,
  });
  expect(snapshot).toContain(String.raw`pmr\_01@126.com`);
});
```

在 `test/index.spec.ts` 的应用脚本静态检查中要求存在 `editorSourceMarkdown`、`editorSourceDirty` 和保存成功后重置源缓存的逻辑标识。

- [ ] **Step 2: Run focused tests and observe RED**

运行 `npx vitest run test/composer-draft.spec.ts test/composer-recovery.spec.ts test/index.spec.ts`，确认新状态契约尚不存在或保存路径仍会直接序列化 DOM。

- [ ] **Step 3: Add source buffer lifecycle**

在 `state` 中加入：

```js
editorSourceMarkdown: '',
editorSourceDirty: false,
```

在 `openComposer(note)` 中用解密 Markdown 初始化源缓存并清除 dirty；在 `closeComposer()` 中清空。新增内部函数：

```js
function markEditorSourceDirty() {
  state.editorSourceDirty = true;
}

function getEditorSourceMarkdown() {
  if (!state.editorSourceDirty) return state.editorSourceMarkdown;
  state.editorSourceMarkdown = serializeEditorMarkdown(els.documentEditor);
  return state.editorSourceMarkdown;
}
```

正文 `input`、工具栏命令、正文图片插入和 pending token 更新后调用 `markEditorSourceDirty()`。保存时使用 `getEditorSourceMarkdown()`，完成附件 token 替换后再写入 `state.editorSourceMarkdown`；保存成功后保留最终 Markdown 并将 dirty 设为 false。保存异常不得清空源缓存。

- [ ] **Step 4: Verify source-buffer behavior**

运行 `npx vitest run test/composer-draft.spec.ts test/composer-recovery.spec.ts test/composer-post-save.spec.ts test/document-editor.spec.ts test/index.spec.ts`。

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/composer-draft.js test/composer-draft.spec.ts test/composer-recovery.spec.ts test/index.spec.ts
git commit -m "fix: preserve editor markdown source across saves"
```

### Task 3: 紧凑编辑器头部与图片交互区域

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Test: `test/index.spec.ts`, `test/ui-state.spec.ts`

**Interfaces:** 保留 `editorTitle`、`editorFolder`、`cancelBtn`、`saveBtn`、`documentEditor` 和现有附件 API。

- [ ] **Step 1: Write failing shell/layout tests**

在 `test/index.spec.ts` 增加静态契约：

```ts
expect(appHtml).toContain('class="composer-title-input"');
expect(appHtml).toContain('class="composer-folder-action"');
expect(appHtml).not.toContain('记录会在此设备加密后保存，正文支持在线文档式编辑。');
expect(appHtml).not.toContain('将图片粘贴或拖到这里，图片会先在浏览器加密');
expect(appScript).toContain('els.editorCard.addEventListener(\'drop\'');
```

- [ ] **Step 2: Run focused tests and observe RED**

运行 `npx vitest run test/index.spec.ts test/ui-state.spec.ts`，确认现有头部仍包含描述和可视图片提示，且文件夹不在保存操作栏。

- [ ] **Step 3: Reorder the composer markup**

将 `editorTitle` 放入 `.modal-head` 并使用 `composer-title-input` 样式；保留 `modalTitle` 作为视觉隐藏的无障碍标题。将文件夹 label/select 包入 `composer-folder-action` 并移动到 `composerActionBar` 的按钮组前。删除可视 `attachmentDropZone` 提示节点，保留 `attachmentStatus` 和 `mobilePasteStatus` 的反馈区域。

- [ ] **Step 4: Preserve paste/drop handling on the editor surface**

移除对已删除提示节点的强制依赖，把 `paste`、`dragover`、`dragleave`、`drop` 监听挂到 `editorCard`，`handleEditorPaste` 继续处理正文和图片；拖拽图片仍调用现有 `queueEditorImage()`，不改变附件 API。

- [ ] **Step 5: Implement compact responsive styles**

增加 `.composer-title-input` 的无边框大标题样式、`.composer-folder-action` 的紧凑布局和移动端换行规则；保持 `.composer-action-bar` sticky，确保取消/保存和文件夹选择在 390px 宽度可见，根元素无横向滚动。

- [ ] **Step 6: Verify shell and responsive behavior**

运行 `npx vitest run test/index.spec.ts test/ui-state.spec.ts test/document-editor.spec.ts`；再用本地 Worker 检查 390×844、900px、1280px 三个视口，确认标题、文件夹、取消/保存可见，图片提示不存在，编辑器无横向溢出。

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/styles.css public/app.js test/index.spec.ts test/ui-state.spec.ts
git commit -m "fix: compact note composer header"
```

### Task 4: 集成验证与交付

**Files:** 仅修改前述文件；如 QA 发现具体缺陷，先添加对应失败测试。

- [ ] **Step 1: Run focused regression suite**

```bash
npx vitest run \
  test/document-editor.spec.ts \
  test/composer-draft.spec.ts \
  test/composer-recovery.spec.ts \
  test/composer-post-save.spec.ts \
  test/composer-saving.spec.ts \
  test/index.spec.ts \
  test/ui-state.spec.ts
```

- [ ] **Step 2: Run full project checks**

运行 `npm run check`，必须通过类型检查、工具测试和完整 Vitest 套件。

- [ ] **Step 3: Perform browser QA**

使用本地 `wrangler dev` 在 390×844、900px、1280px 检查编辑头部和长文档滚动；确认打开后未修改直接保存不会增加反斜杠，修改后保存只产生一次序列化，粘贴/拖拽图片仍能进入现有加密附件流程。

- [ ] **Step 4: Review and commit any concrete QA fix**

每个 QA 缺陷都先添加回归测试，再提交最小修正。

- [ ] **Step 5: Final verification**

重新运行 `npm run check` 和 `git diff --check`，确认工作区干净后再决定合并到 `main`。
