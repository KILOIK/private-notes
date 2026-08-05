# 私人笔记分类、文件夹、密码记录与移动端粘贴图片设计

**日期：** 2026-08-05  
**状态：** 待用户审阅  
**目标仓库：** `KILOIK/private-notes`

## 1. 目标与约束

本设计是在现有移动 Markdown、私有 R2 图片附件、部署级 Authenticator 和 30 分钟空闲重新验证功能之上的增量升级。

目标：

1. 增加“笔记类”和“密码类”两种内容类型。
2. 支持一级文件夹归纳，未选择文件夹时归入“未分类”。
3. 密码记录使用固定字段、可复制、默认隐藏，并支持自定义字段。
4. 将安全验证和退出登录放入右上角设置区。
5. 笔记列表使用标题、短简介、类型、文件夹和时间的主流列表样式，详情页再展示完整内容。
6. 手机端在正文编辑区域直接粘贴图片，行为接近飞书；新建和编辑笔记均支持。

不可改变的安全边界：

- PBKDF2-SHA256 派生 AES-256-GCM vault key 的现有逻辑保持不变。
- Worker 不解密笔记、密码字段、文件夹名称或图片。
- D1 只保存密文和必要元数据；R2 只保存浏览器加密后的图片密文。
- vault 隔离、revision 乐观锁、一次性分享、Authenticator 和 30 分钟 idle reauth 语义保持不变。
- 本次不引入服务端明文搜索、多人协作、嵌套文件夹或完整所见即所得编辑器。

## 2. 数据模型

### 2.1 文件夹表

新增 `migrations/0010_note_folders.sql`，创建：

```sql
CREATE TABLE note_folders (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_note_folders_vault_id ON note_folders(vault_id, id);
CREATE INDEX idx_note_folders_vault_updated ON note_folders(vault_id, updated_at DESC, id ASC);
```

`name` 是浏览器使用 vault key 加密后的 `enc:v1` 字符串。文件夹名称不以明文进入请求、D1、R2 或日志。删除文件夹使用硬删除；笔记正文中的旧 folder ID 不被改写，因此客户端遇到不存在的 folder ID 时显示“未分类”。

### 2.2 普通笔记记录

现有 `notes.title` 和 `notes.content` 字段继续保存 `enc:v1` 密文。新版本解密后的 `content` 为：

```ts
type NoteRecord = {
  v: 1;
  type: 'note';
  folderId: string | null;
  markdown: string;
};
```

`title` 仍是独立加密字段，用于列表标题。列表摘要由浏览器从 `markdown` 生成，服务端不参与。

### 2.3 密码记录

密码类也使用现有 `notes` 表，不新增明文密码表。解密后的 `content` 为：

```ts
type PasswordFieldType = 'text' | 'secret' | 'multiline';

type PasswordField = {
  id: string;
  label: string;
  type: PasswordFieldType;
  value: string;
};

type PasswordRecord = {
  v: 1;
  type: 'password';
  folderId: string | null;
  fields: PasswordField[];
};
```

固定字段 ID 和默认标签：

| ID | 标签 | 类型 |
|---|---|---|
| `name` | 名称 | `text` |
| `username` | 用户名 | `text` |
| `password` | 密码 | `secret` |
| `url` | 网址 | `text` |
| `notes` | 备注 | `multiline` |

自定义字段只能使用上述三种类型，字段 `id` 由客户端生成 UUID。固定字段不可删除，但允许为空；自定义字段可新增、编辑和删除。密码记录的 `name` 同步写入现有加密 `title` 字段作为列表标题副本；读取时 `name` 字段是权威值，旧副本不一致时以 `name` 为准。

### 2.4 旧数据兼容

- 解密后不是结构化 JSON 的旧正文继续按 Markdown 普通笔记处理，`folderId = null`。
- 旧笔记不做批量迁移；首次编辑或保存时才转换为 `NoteRecord`。
- 不识别或版本过高的结构化记录只显示“无法读取此版本”，不覆盖原密文。

## 3. API 与客户端数据流

### 3.1 文件夹 API

新增以下认证后接口，均要求当前完整 Session 和当前 vault：

- `GET /api/folders`：返回 `{ id, name, created_at, updated_at }`，其中 `name` 为密文。
- `POST /api/folders`：接收可选客户端 UUID 和加密 `name`，同 vault 内 ID 冲突返回 409。
- `PUT /api/folders/:id`：更新加密名称，并使用 `updated_at` 做乐观锁；冲突返回 409。
- `DELETE /api/folders/:id`：删除文件夹，不触碰笔记和附件。

服务端只校验 UUID、密文格式、长度和 vault 归属，不解析名称或笔记内容。

### 3.2 笔记 API 变化

笔记创建和更新 API 继续接收加密 `title`、加密 `content`、`revision` 和 `attachmentIds`。`folderId`、类型和所有字段都在加密 `content` 内，避免新增可观察的分类元数据。

客户端在保存前校验 `folderId` 是否来自当前 vault 的文件夹列表；服务端不根据密文推断 folder 归属。

### 3.3 新建笔记的图片暂存

现有附件 API 要求 `noteId`。为支持“新建笔记未保存时直接粘贴图片”，客户端在第一次粘贴图片时生成随机 `draftNoteId`，并在内存中维护：

```ts
type PendingImage = {
  token: string;
  blob: Blob;
  mimeType: string;
  attachmentId?: string;
};
```

处理流程：

1. 在光标处插入仅存在于内存的 `attachment-pending://token` 占位引用，预览使用临时 `blob:` URL。
2. 使用 `draftNoteId` 调用附件上传接口。Worker 在当前 vault 内允许“尚不存在的 noteId”作为短期 pending 附件，仍写入 `vault_id`、随机 object key 和 `pending` 状态；跨 vault 读取、下载和删除仍被拒绝。
3. 用户保存时，客户端把占位引用替换为真实 `attachment://id`，使用 `POST /api/notes` 携带 `id: draftNoteId`、加密标题/正文和 `attachmentIds`。Worker 在同一 D1 batch 中创建笔记并将 pending 附件标记为 `attached`。
4. 如果创建冲突或保存失败，笔记密文不被覆盖，pending 附件保持可重试；取消编辑时客户端删除 pending 附件，24 小时清理任务作为兜底。

编辑已有笔记时沿用现有上传流程。图片上传成功但笔记保存失败时，旧附件保持 `attached`，新附件保持 `pending`，不删除旧引用。

### 3.4 粘贴识别

编辑弹窗和 Markdown `textarea` 共同监听 `paste`：

- 剪贴板含支持的图片 MIME 时拦截默认粘贴，按顺序处理全部图片项；
- 纯文本、HTML 链接或无图片时不拦截，让浏览器正常粘贴文本；
- 仅允许 `image/jpeg`、`image/png`、`image/gif`、`image/webp`，单图上限保持 10 MB；
- 上传状态显示“处理中 / 已完成 / 失败可重试”，不把图片转成 Base64 写入正文。

## 4. 界面信息架构

### 4.1 手机端

- 顶部显示当前分类，右上角齿轮进入设置。
- 分类切换：`全部`、`笔记`、`密码`。
- 文件夹使用横向可滚动筛选条，始终包含`未分类`。
- 列表卡片显示标题、短简介、类型、文件夹、创建时间和最近更新时间；不显示完整正文。
- 点击列表项进入阅读详情；笔记详情渲染安全 Markdown，密码详情显示字段卡片。
- 密码字段默认隐藏，`secret` 字段显示眼睛切换按钮，每个字段单独复制。
- 编辑笔记进入全屏编辑页；正文区域直接粘贴图片，无需先打开文件选择器。
- 删除动作位于“更多”菜单并二次确认。

### 4.2 桌面端

采用已确认的 C 方案：左侧分类/文件夹导航，中间笔记列表，右侧阅读或编辑区。左侧包含 `全部`、`笔记`、`密码`、`未分类` 和一级文件夹；右侧按类型显示 Markdown 阅读器或密码字段阅读器。

### 4.3 设置区

右上角齿轮打开设置抽屉/面板，包含部署级 Authenticator 绑定、解绑、恢复码提示和退出登录。主工作区不再放置醒目的退出登录按钮。关闭设置后恢复之前的列表、详情和滚动位置。

### 4.4 文件夹操作

支持新建、重命名、删除和选择文件夹；不支持嵌套。删除文件夹后，引用该 ID 的笔记显示在“未分类”，笔记本身不删除。空文件夹可以独立存在。

## 5. 密码字段交互与安全

- 密码类编辑器显示固定字段表单和“添加自定义字段”。
- 自定义字段可选择普通文本、密码隐藏或多行文本；标签不能为空，字段值可为空。
- 详情页不使用 Markdown 渲染密码值；网址只作为普通文本展示，点击时由用户明确触发安全链接操作。
- 复制调用系统 Clipboard API，成功显示短暂提示；不写入日志、`localStorage` 或 `sessionStorage`，不主动覆盖用户剪贴板。
- 进入 idle lock、退出或重新验证失败时清除内存中的字段对象和详情 DOM。

## 6. 错误处理与安全边界

- 剪贴板权限不足、图片格式不支持或超过大小限制时只提示当前操作失败，普通文本编辑不受影响。
- 图片加密/上传失败移除 pending 引用，允许重试；图片解密失败只显示图片占位错误，不阻断正文。
- 文件夹同 vault 重名返回明确错误；删除只解除归属。
- 版本未知或结构损坏的内容只读保护，禁止自动覆盖原密文。
- revision 冲突保持现有 fail-safe 语义；保存失败不改变旧附件关联。
- Markdown 继续拒绝原始 HTML、脚本、危险协议和外部图片。

## 7. 测试与部署验收

### 客户端测试

- 结构化 NoteRecord/PasswordRecord 编解码、旧 Markdown 兼容和 folder 缺失回退。
- 固定字段、自定义字段类型、默认隐藏、显示切换和单字段复制。
- 文件夹筛选、摘要生成、时间显示和列表/详情切换。
- `paste` 事件的图片识别、文本回退、多图片排队、超限拒绝和 pending 清理。
- 新建笔记 draftNoteId、附件关联、取消清理和失败重试。
- Markdown 安全渲染、blob URL 回收和 idle lock 清理。

### Worker / D1 / R2 测试

- `note_folders` migration、vault 隔离、密文格式校验、重名和 revision 冲突。
- 新建笔记 pending 附件的创建、原子关联、跨 vault 拒绝和 stale cleanup。
- 旧笔记、附件、分享、Authenticator、30 分钟 reauth 的完整回归。

### 部署步骤

1. 备份生产 D1。
2. 应用 `0010_note_folders.sql`，保持私有 R2 bucket `private-notes-r2` 不变。
3. 运行 `npm run check`、`npm audit`、`npm run deploy:dry-run`。
4. 在手机浏览器完成：新建笔记直接粘贴图片、保存、重新打开、复制密码字段、设置区退出登录和 idle reauth smoke test。
5. 推送 `main`，由已绑定的 Cloudflare 自动部署。

## 8. 完成标准

1. 旧笔记无需批量迁移即可读取和编辑。
2. 手机正文区域可直接粘贴图片，且新建笔记可随保存完成加密上传和关联。
3. 笔记/密码分类、一级文件夹、未分类回退可用。
4. 密码默认星标隐藏，固定字段和自定义字段可单独复制。
5. 设置区包含安全验证和退出登录。
6. 列表显示标题、摘要、创建时间和最近更新时间，详情页展示完整内容。
7. 现有加密、vault 隔离、分享、Authenticator、idle reauth 和附件回归测试全部通过。
