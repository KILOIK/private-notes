# 在线文档式笔记与密码记录版面优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成未分类导航归位、普通笔记所见即所得编辑、Markdown 阅读报错修复、密码默认字段可删除和密码阅读版面重构，同时保持现有客户端加密与数据兼容。

**Architecture:** 继续使用原生 HTML/CSS/ES modules 和 `app.js` 单一状态源。新增无网络、无密钥访问的 `document-editor.js`，负责受控编辑 DOM 与 Markdown 的双向转换和格式命令；密码记录在现有加密内容对象中增加独立 `title`，并让字段数组成为真正可选列表。所有数据转换和 UI 行为先由 Vitest 覆盖，再接入现有加密、附件、阅读和响应式工作区。

**Tech Stack:** 原生 HTML/CSS/JavaScript ES modules、ContentEditable、Cloudflare Workers 静态前端、Vitest 4、TypeScript 5.9、Wrangler 4。

## Global Constraints

- 不修改 PBKDF2、AES-GCM、`enc:v1`、Vault 隔离、认证 Cookie、30 分钟锁定、Authenticator、D1/R2 密文、附件加密和阅后即焚分享模型。
- 普通笔记继续保存加密 Markdown，不在服务端保存富文本 HTML。
- 密码标题和字段继续只作为加密内容及加密标题保存，不新增明文数据库字段。
- 不引入完整富文本编辑器或新的运行时依赖。
- Markdown 和编辑 DOM 只允许白名单结构；危险 URL 和未知 HTML 不得进入可执行 DOM。
- 密码秘密值不能进入列表摘要、整条复制或分享流程。
- 所有功能按失败测试、最小实现、通过测试的顺序完成。
- 不暂存 `.superpowers/` 和用户已有的未跟踪设计/计划文件。
- 桌面、紧凑桌面和移动端都要保持键盘焦点可见、44px 触控目标和无页面级横向滚动。

---

## File Structure

- Create `public/document-editor.js`: Markdown 到可编辑 DOM、可编辑 DOM 到 Markdown、格式命令和编辑器初始化。
- Modify `public/markdown.js`: 修复内联 token 分支并补齐删除线、下划线的安全渲染。
- Modify `public/password-fields.js`: 允许删除任意密码字段。
- Modify `public/note-records.js`: 支持独立密码标题和可为空的字段数组，兼容旧记录。
- Modify `public/password-ui.js`: 独立标题保存、任意字段删除、正文优先阅读 DOM。
- Modify `public/workspace-model.js`: 密码阅读字段过滤和展示元数据。
- Modify `public/index.html`: 未分类归入文件夹、在线文档工具栏与画布结构。
- Modify `public/app.js`: 接入所见即所得编辑器、密码独立标题和现有附件/加密保存流程。
- Modify `public/workspace.css`: 文档工具栏/画布和密码阅读详情表的响应式样式。
- Modify tests under `test/`: 覆盖 Markdown、编辑器、密码模型、密码 UI、导航和工作区静态结构。

---

### Task 1: 修复 Markdown 内联渲染报错

**Files:**
- Modify: `public/markdown.js`
- Modify: `test/markdown.spec.ts`

**Interfaces:**
- Produces: `renderMarkdown(source, attachments?, pendingAttachments?)` 对粗体、斜体、删除线、下划线、链接、代码和图片使用明确命名分支。
- Preserves: `extractAttachmentIds()`、`replaceAttachmentReference()` 和安全链接协议限制。

- [ ] **Step 1: 写失败回归测试**

在 `test/markdown.spec.ts` 增加最小 DOM stub，并验证原来的最小复现：

```ts
it('renders inline Markdown without treating non-image tokens as images', () => {
  const restore = installMarkdownDocument();
  try {
    const fragment = renderMarkdown('**bold** [docs](https://example.com) `code` ~~old~~ <u>under</u>');
    expect(flattenTags(fragment)).toEqual(['P', 'STRONG', 'A', 'CODE', 'S', 'U']);
  } finally {
    restore();
  }
});
```

另加安全用例：`javascript:` 链接只显示文字；不存在的附件图片降级为 alt 文本；合法附件 Map 渲染 `IMG`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/markdown.spec.ts`

Expected: FAIL，当前 `renderMarkdown('**bold**')` 抛出读取 `undefined.toLowerCase` 的错误。

- [ ] **Step 3: 用命名捕获组实现明确 token 分支**

将 `renderInline()` 的 token 模式改为不含最外层捕获组的命名分支：

```js
const tokenPattern = /!\[(?<imageAlt>[^\]]*)\]\((?<imageUrl>[^)\s]+)(?:\s+["'](?<imageTitle>[^"']*)["'])?\)|\[(?<linkText>[^\]]+)\]\((?<linkUrl>[^)\s]+)\)|(?<codeTicks>`+)(?<codeText>[^`]+)\k<codeTicks>|(?<strongMarker>\*\*|__)(?<strongText>.+?)\k<strongMarker>|(?<strikeMarker>~~)(?<strikeText>.+?)\k<strikeMarker>|<u>(?<underlineText>.+?)<\/u>|(?<emMarker>\*|_)(?<emText>.+?)\k<emMarker>/g;
```

按 `match.groups.imageUrl`、`linkUrl`、`codeTicks`、`strongMarker`、`strikeMarker`、`underlineText`、`emMarker` 顺序生成 DOM；图片 URL 仅在 `typeof url === 'string'` 后进入协议判断。

- [ ] **Step 4: 运行 Markdown 测试**

Run: `npx vitest run test/markdown.spec.ts`

Expected: PASS，粗体、链接和代码不再进入图片分支，危险 URL 仍被降级。

- [ ] **Step 5: 提交**

```bash
git add public/markdown.js test/markdown.spec.ts
git commit -m "fix: render inline markdown through explicit token branches"
```

### Task 2: 让密码标题独立并允许可变字段集合

**Files:**
- Modify: `public/password-fields.js`
- Modify: `public/note-records.js`
- Modify: `test/password-fields.spec.ts`
- Modify: `test/note-records.spec.ts`

**Interfaces:**
- Produces: `removePasswordField(fields, id): PasswordField[]`。
- Produces: 密码记录 `{ v: 1, type: 'password', folderId, title, fields }`。
- Compatibility: 没有 `title` 的旧记录使用 `name` 字段值作为 `record.title`，字段缺失或字段数组为空不再报错或自动补齐。

- [ ] **Step 1: 写字段删除失败测试**

```ts
it('removes default and custom fields without mutating the source', () => {
  const fields = createDefaultPasswordFields();
  const next = removePasswordField(fields, 'password');
  expect(next.map((field) => field.id)).not.toContain('password');
  expect(fields).toHaveLength(5);
});
```

- [ ] **Step 2: 写密码记录兼容失败测试**

```ts
it('keeps an independent title and accepts zero fields', () => {
  const content = encodePasswordRecord({ type: 'password', folderId: null, title: '身份记录', fields: [] });
  expect(decodeNoteRecord(content)).toEqual({ v: 1, type: 'password', folderId: null, title: '身份记录', fields: [] });
});

it('derives a title from the legacy name field without restoring deleted fields', () => {
  const record = decodeNoteRecord(JSON.stringify({ v: 1, type: 'password', folderId: null, fields: [
    { id: 'name', type: 'text', label: '名称', value: '旧账号' },
  ] }));
  expect(record.title).toBe('旧账号');
  expect(record.fields).toHaveLength(1);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run test/password-fields.spec.ts test/note-records.spec.ts`

Expected: FAIL，固定字段仍禁止删除，归一化仍要求五个固定字段且编码丢弃标题。

- [ ] **Step 4: 实现可变字段和独立标题**

`removePasswordField()` 只验证数组并返回过滤后的新数组。`normalizePasswordFields()` 继续检查 ID 唯一、类型白名单和标签，但不再补齐缺失固定字段；固定 ID 存在时仅使用默认类型和空标签回退。编码结果显式包含标题：

```js
const result = {
  v: 1,
  type: 'password',
  folderId: typeof record.folderId === 'string' ? record.folderId : null,
  title: String(record.title || ''),
  fields: normalizePasswordFields(record.fields),
};
```

解码时用 `typeof parsed.title === 'string' ? parsed.title : legacyName?.value || ''`。

- [ ] **Step 5: 运行模型测试**

Run: `npx vitest run test/password-fields.spec.ts test/note-records.spec.ts`

Expected: PASS，旧记录、新记录和零字段记录均稳定。

- [ ] **Step 6: 提交**

```bash
git add public/password-fields.js public/note-records.js test/password-fields.spec.ts test/note-records.spec.ts
git commit -m "feat: separate password titles from optional fields"
```

### Task 3: 重构密码编辑器字段交互

**Files:**
- Modify: `public/password-ui.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `test/password-ui.spec.ts`
- Modify: `test/index.spec.ts`

**Interfaces:**
- Changes: `buildPasswordSavePayload(title, fields, folderId)`。
- Changes: `focusComposerPrimaryField(recordType, titleInput, passwordFields)` 对两种记录都聚焦独立标题。
- Consumes: Task 2 `removePasswordField()` 和密码记录 `record.title`。

- [ ] **Step 1: 写密码编辑器失败测试**

```ts
it('deletes a default field and saves the independent title', () => {
  const fields = createDefaultPasswordFields();
  const payload = buildPasswordSavePayload('身份记录', fields.slice(1), 'folder-1');
  expect(payload.title).toBe('身份记录');
  expect(decodeNoteRecord(payload.content)).toMatchObject({ title: '身份记录', folderId: 'folder-1' });
});
```

在 DOM 测试中查找五个“删除字段”按钮，点击默认 `名称` 对应按钮后断言回调数组长度为 4。

- [ ] **Step 2: 写静态结构失败测试**

在 `test/index.spec.ts` 断言 `editorTitle` 对密码编辑也保持可见，并将 placeholder 改为“记录标题”；密码字段区有独立说明而不是把名称作为标题。

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run test/password-ui.spec.ts test/index.spec.ts`

Expected: FAIL，保存仍从 `name` 派生标题，默认字段没有删除按钮，密码模式隐藏标题输入。

- [ ] **Step 4: 修改密码编辑 DOM**

删除 `FIXED_FIELD_IDS` 的 UI 特判。每个字段都渲染字段标签、值、秘密显示切换和低权重“删除字段”按钮；标签输入对所有字段可编辑，空标签显示“字段”。添加按钮仍创建文本、隐藏、多行三类字段。

- [ ] **Step 5: 接入独立标题**

`updateComposerRecordType()` 不再隐藏 `editorTitle`。`openComposer()` 对密码优先使用 `note.title`，没有外层标题时使用 `record.title`；`saveComposer()` 调用：

```js
const title = els.editorTitle.value.trim() || '无标题';
const passwordPayload = password
  ? buildPasswordSavePayload(title, state.editorPasswordFields, state.editorFolderId)
  : null;
```

- [ ] **Step 6: 运行密码编辑测试**

Run: `npx vitest run test/password-ui.spec.ts test/password-fields.spec.ts test/note-records.spec.ts test/index.spec.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add public/password-ui.js public/app.js public/index.html test/password-ui.spec.ts test/index.spec.ts
git commit -m "feat: let password records use independent editable titles"
```

### Task 4: 重做密码阅读页为正文优先详情表

**Files:**
- Modify: `public/workspace-model.js`
- Modify: `public/password-ui.js`
- Modify: `public/workspace.css`
- Modify: `test/password-ui.spec.ts`
- Modify: `test/workspace-model.spec.ts`

**Interfaces:**
- Changes: `buildPasswordDisplayModel(fields)` 过滤空值并返回 `{ id, label, value, hidden, multiline, copyVisible }[]`。
- Produces: `.password-reader-label`、`.password-reader-value`、`.password-reader-actions` 三列 DOM。

- [ ] **Step 1: 写展示模型失败测试**

```ts
it('hides empty fields while retaining secret and multiline metadata', () => {
  expect(buildPasswordDisplayModel([
    { id: 'username', type: 'text', label: '用户名', value: '' },
    { id: 'password', type: 'secret', label: '密码', value: 'secret' },
    { id: 'notes', type: 'multiline', label: '备注', value: 'line 1\nline 2' },
  ])).toHaveLength(2);
});
```

- [ ] **Step 2: 写阅读 DOM 失败测试**

断言普通正文使用文本元素而不是只读输入；秘密初始显示等长圆点，显示按钮切换到原值；复制按钮仍只复制当前字段。

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run test/workspace-model.spec.ts test/password-ui.spec.ts`

Expected: FAIL，空字段仍显示，正文仍使用表单输入控件。

- [ ] **Step 4: 实现正文优先 DOM**

`renderPasswordReader()` 为每行创建标签、正文 `div` 或 `pre`、右侧 actions。秘密值初始正文：

```js
function maskSecret(value) {
  return '•'.repeat(Math.max(8, Array.from(value).length));
}
```

显示按钮只切换当前正文的 `textContent` 和 `aria-label`；复制仍使用闭包中的原始 `display.value`，不从 DOM 回读。

- [ ] **Step 5: 实现桌面与移动样式**

桌面使用 `grid-template-columns: minmax(96px, 150px) minmax(0, 1fr) auto`；字段正文 16px、`overflow-wrap:anywhere`；操作区靠右且按钮透明。移动端将标签和正文改为两行，操作仍占右列并保持 44px。

- [ ] **Step 6: 运行密码阅读测试**

Run: `npx vitest run test/workspace-model.spec.ts test/password-ui.spec.ts test/workspace-view.spec.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add public/workspace-model.js public/password-ui.js public/workspace.css test/password-ui.spec.ts test/workspace-model.spec.ts
git commit -m "style: prioritize password field content in reader"
```

### Task 5: 将未分类移入我的文件夹分组

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/workspace.css`
- Modify: `test/index.spec.ts`

**Interfaces:**
- Preserves: `uncategorizedNav`、`navigationUncategorizedCount`、`data-folder-id="__uncategorized__"` 和现有筛选事件绑定。
- Changes: `folderNav` 固定包含未分类按钮，再动态添加用户文件夹。

- [ ] **Step 1: 写静态层级失败测试**

解析 `public/index.html` 字符串位置并断言：`我的文件夹` 标题早于 `uncategorizedNav`，`uncategorizedNav` 位于 `folderNav` 开始和结束标签之间，不再存在 `aria-label="未分类记录"` 的独立导航。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/index.spec.ts`

Expected: FAIL，未分类仍在文件夹标题之前的独立 nav。

- [ ] **Step 3: 重排 HTML 并保护固定节点**

将未分类按钮放入 `folderNav` 首项。`renderFolders()` 清理动态文件夹时继续只删除 `data-folder-id` 且排除 `__uncategorized__`：

```js
els.folderNav.querySelectorAll('[data-folder-id]:not([data-folder-id="__uncategorized__"])')
  .forEach(function (element) { element.remove(); });
```

空状态仅在没有自定义文件夹时显示在未分类之后。

- [ ] **Step 4: 调整统一文件夹样式**

让 `uncategorizedNav` 使用文件夹行的间距、数量和选中态；不显示管理菜单。资料库分组只保留全部、笔记、密码。

- [ ] **Step 5: 运行导航测试**

Run: `npx vitest run test/index.spec.ts test/folder-model.spec.ts test/workspace-model.spec.ts`

Expected: PASS，计数和筛选模型不变。

- [ ] **Step 6: 提交**

```bash
git add public/index.html public/app.js public/workspace.css test/index.spec.ts
git commit -m "style: place uncategorized notes with folders"
```

### Task 6: 建立受控所见即所得 Markdown 编辑模块

**Files:**
- Create: `public/document-editor.js`
- Create: `test/document-editor.spec.ts`
- Modify: `public/markdown.js`

**Interfaces:**
- Produces: `loadEditorMarkdown(editor, markdown, attachments?, pendingAttachments?): void`。
- Produces: `serializeEditorMarkdown(editor): string`。
- Produces: `runEditorCommand(editor, command, value?): boolean`，其中 command 为 `undo | redo | paragraph | heading | bold | italic | underline | strike | quote | unordered-list | ordered-list | inline-code | code-block | link`。
- Produces: `ensureEditorPlaceholder(editor): void`。

- [ ] **Step 1: 写 Markdown 到编辑 DOM 失败测试**

```ts
it('loads Markdown as editable block elements', () => {
  loadEditorMarkdown(editor, '# Title\n\n**bold** and `code`');
  expect(editor.children.map((node) => node.tagName)).toEqual(['H1', 'P']);
});
```

验证渲染图片保留 `data-markdown-src="attachment://..."`，以便保存时恢复原引用而不是 object URL。

- [ ] **Step 2: 写编辑 DOM 到 Markdown 失败测试**

构造 H2、P/STRONG/EM/U/S/CODE/A、BLOCKQUOTE、UL/LI、OL/LI、PRE/CODE、IMG，断言得到规范化 Markdown：

```ts
expect(serializeEditorMarkdown(editor)).toBe(
  '## Heading\n\n**bold** *italic* <u>under</u> ~~old~~ `code` [link](https://example.com)\n\n> quote\n\n- one\n- two'
);
```

未知节点只序列化安全文本；危险链接只保留链接文字；空编辑器返回空字符串。

- [ ] **Step 3: 写命令路由失败测试**

stub `ownerDocument.execCommand`，验证 `bold -> bold`、`heading -> formatBlock/h2`、`unordered-list -> insertUnorderedList`、`link -> createLink`、`code-block -> formatBlock/pre`；无选区或危险链接返回 `false`。

- [ ] **Step 4: 运行测试确认失败**

Run: `npx vitest run test/document-editor.spec.ts`

Expected: FAIL，因为模块不存在。

- [ ] **Step 5: 实现白名单序列化器**

按节点类型递归：文本转义 `\\`、`*`、`_`、`[`、`]`；块级节点之间用两个换行规范化；`BR` 为换行；`IMG` 只接受 `attachment://` 或 `pending://` 的 `data-markdown-src`；`A` 只接受 http/https。

- [ ] **Step 6: 实现编辑器加载和命令映射**

`loadEditorMarkdown()` 复用 Task 1 的 `renderMarkdown()`，为图片保留原始 Markdown 源。`runEditorCommand()` 聚焦编辑器后调用当前文档的 `execCommand`，链接值先通过与阅读器一致的安全 URL 判断。

- [ ] **Step 7: 运行编辑模块和 Markdown 测试**

Run: `npx vitest run test/document-editor.spec.ts test/markdown.spec.ts`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add public/document-editor.js public/markdown.js test/document-editor.spec.ts
git commit -m "feat: add controlled markdown document editor"
```

### Task 7: 将普通笔记编辑流程接入在线文档画布

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/workspace.css`
- Modify: `test/index.spec.ts`
- Modify: `test/composer-saving.spec.ts`

**Interfaces:**
- Consumes: Task 6 `loadEditorMarkdown()`、`serializeEditorMarkdown()`、`runEditorCommand()`。
- Preserves: `editorTitle`、`editorFolder`、`saveBtn`、`cancelBtn`、`attachmentDropZone`、`attachmentStatus`、现有附件上传和保存 ID。

- [ ] **Step 1: 写编辑器结构失败测试**

在 `test/index.spec.ts` 断言：

```ts
expect(appHtml).toContain('id="documentEditor"');
expect(appHtml).toContain('contenteditable="true"');
expect(appHtml).toContain('aria-label="笔记正文"');
expect(appHtml).toContain('data-editor-command="undo"');
expect(appHtml).toContain('data-editor-command="bold"');
expect(appHtml).toContain('data-editor-command="ordered-list"');
expect(appHtml).toContain('data-editor-command="code-block"');
```

- [ ] **Step 2: 写保存来源失败测试**

扩展 composer 保存模型测试，断言普通笔记保存使用序列化后的 Markdown，密码记录不读取 `documentEditor`；附件 pending token 替换仍发生在序列化 Markdown 上。

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run test/index.spec.ts test/composer-saving.spec.ts`

Expected: FAIL，当前结构只有 Markdown textarea 和预览切换。

- [ ] **Step 4: 替换笔记编辑结构**

保留同一个 `editorCard`，将普通笔记部分改为 `.document-composer`：粘性 `.document-toolbar`、大标题 `editorTitle`、`contenteditable` 的 `documentEditor`、附件状态和底部保存/取消。移除预览按钮和普通笔记 textarea 的可见主路径；可保留隐藏 textarea 作为短期兼容值容器，但所有编辑和保存只以 `documentEditor` 为准。

- [ ] **Step 5: 接入打开、关闭和保存**

`openComposer()` 对普通笔记调用 `loadEditorMarkdown()`；`saveComposer()` 调用 `serializeEditorMarkdown()`，再替换 pending 图片 token；`closeComposer()` 清空编辑 DOM。密码模式隐藏文档工具栏和正文，但显示独立标题与字段区。

- [ ] **Step 6: 接入工具栏、链接、粘贴和图片**

为 `[data-editor-command]` 绑定 `runEditorCommand()`。链接继续使用现有 prompt，但执行 `link` 命令；图片选择和 paste/drop 继续进入现有 `handleEditorImage()`，插入带 `data-markdown-src` 的图片节点，并在保存时恢复 pending token。

- [ ] **Step 7: 实现在线文档视觉**

桌面编辑器：工具栏粘性、单行横向可滚、画布最大宽度约 900px、标题 36px、正文 16px/1.8、无大卡片阴影。移动端：工具栏 `overflow-x:auto`，标题 28px，画布左右 16px，底部操作不遮挡正文。

- [ ] **Step 8: 运行编辑流程测试**

Run: `npx vitest run test/document-editor.spec.ts test/composer-saving.spec.ts test/attachment-draft.spec.ts test/markdown.spec.ts test/index.spec.ts`

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add public/index.html public/app.js public/workspace.css test/index.spec.ts test/composer-saving.spec.ts
git commit -m "feat: edit notes in an online document canvas"
```

### Task 8: 完整回归与真实浏览器设计 QA

**Files:**
- Modify if required by QA: `public/index.html`
- Modify if required by QA: `public/app.js`
- Modify if required by QA: `public/workspace.css`
- Modify if required by QA: related `test/*.spec.ts`

**Interfaces:**
- Produces: 五项需求在桌面、紧凑桌面和手机视口的最终可用状态。
- Preserves: 全部现有 Vitest、类型检查、工具测试和 Worker 行为。

- [ ] **Step 1: 运行针对性测试**

Run: `npx vitest run test/markdown.spec.ts test/document-editor.spec.ts test/password-fields.spec.ts test/note-records.spec.ts test/password-ui.spec.ts test/workspace-model.spec.ts test/index.spec.ts test/composer-saving.spec.ts test/attachment-draft.spec.ts`

Expected: PASS。

- [ ] **Step 2: 运行完整项目检查**

Run: `npm run check`

Expected: 类型检查、客户端类型检查、测试类型检查、工具测试和全部 Vitest 均通过。

- [ ] **Step 3: 启动本地预览并用应用内浏览器验收**

Run: `npx wrangler dev --port 8787`

使用应用内 Browser 在桌面宽屏、紧凑桌面和手机视口检查：未分类位置、旧 Markdown 打开、普通笔记编辑/保存/重开、默认密码字段删除/保存/重开、密码阅读字段正文与右侧按钮。

- [ ] **Step 4: 对照参考图做组合比较**

分别截取当前实现，并与用户提供的图一至图五按相同目标区域比较。重点检查层级、工具栏密度、标题大小、字段正文宽度、操作权重、内边距、边框、圆角、溢出和移动触控目标。发现差异时先补失败测试，再做最小修正并重复截图比较。

- [ ] **Step 5: 验证安全与兼容路径**

确认锁定或退出后编辑 DOM、密码字段和秘密显示值被清空；密码没有整体复制/分享；普通笔记保存内容仍由 `buildNoteSaveContent(markdown, folderId)` 进入现有加密流程；附件仍使用 `attachment://` 引用。

- [ ] **Step 6: 提交 QA 修正**

若 QA 产生修改：

```bash
git add public/index.html public/app.js public/workspace.css public/document-editor.js public/markdown.js public/password-fields.js public/note-records.js public/password-ui.js public/workspace-model.js test
git commit -m "fix: align document and password layouts with references"
```

若没有修改则不创建空提交。

- [ ] **Step 7: 最终验证并准备合并**

Run: `git status --short && npm run check`

Expected: 仅保留用户原有未跟踪文件，检查全部通过；随后使用 `superpowers:finishing-a-development-branch` 合并至 `main` 并推送 `origin/main`。
