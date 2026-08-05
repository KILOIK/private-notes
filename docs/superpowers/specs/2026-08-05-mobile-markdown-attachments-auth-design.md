# Private Notes 移动端 Markdown、图片与二次验证升级设计

**日期：** 2026-08-05  
**状态：** 待用户审阅的设计稿  
**目标仓库：** `KILOIK/private-notes`

## 1. 背景与目标

现有应用是 Cloudflare Workers + D1 的私人笔记应用。浏览器使用 PBKDF2-SHA256 派生 AES-256-GCM 密钥，标题和正文以 `enc:v1` 密文写入 D1；Worker 负责访问认证、Session、限流、revision 乐观锁和一次性分享，但不拥有笔记解密密钥。

本次升级目标：

1. 不改变现有认证、客户端加密、vault 隔离、分享原子销毁和 fail-closed 安全边界。
2. 以手机为主，采用备忘录式列表、阅读和编辑逻辑。
3. 支持 Markdown 渲染与编辑，保留可见的 Markdown 源码能力。
4. 支持浏览器端加密图片，并通过 Cloudflare R2 保存密文。
5. 登录增加一个部署级 Authenticator（TOTP）验证。
6. 连续 30 分钟无用户操作后，清除本地解锁状态并要求重新验证。

## 2. 已确认的产品决策

- 手机端采用“阅读优先”：打开笔记先显示渲染结果，点击“编辑”后进入全屏编辑器。
- 桌面端采用左侧笔记列表 + 右侧阅读/编辑区的分栏布局。
- 列表项显示标题、摘要、创建时间和最近更新时间，默认按最近更新时间倒序。
- 删除动作隐藏在“更多”菜单中，并要求二次确认，不放在主按钮区。
- Markdown 编辑器采用工具栏辅助的备忘录式交互，同时保留“查看 Markdown 源码”。
- 图片入口采用“粘贴 / 拖拽优先”：桌面端支持拖拽和剪贴板粘贴，手机端使用系统复制图片后粘贴；首版不增加常驻相册/相机按钮。
- 图片在浏览器端加密后上传 R2，D1 只保存关联元数据。
- Authenticator 为整个部署共用一个 TOTP，不按 vault 分开绑定。
- 30 分钟是空闲超时，不改变现有 Session 的最长有效期。

## 3. 非目标

- 不做多人协作、评论、实时同步或离线数据库同步。
- 不做服务端 Markdown 渲染，不允许 Worker 读取正文或图片明文。
- 不抓取或默认渲染外部图片。
- 不在首版引入完整所见即所得文档模型；工具栏直接对 Markdown 源码执行结构化插入。
- 不做图片裁剪、压缩、OCR、缩略图服务或图像识别。
- 不改变已有一次性分享的“密钥位于 URL fragment、领取后原子删除”语义。

## 4. 总体架构

### 4.1 浏览器层

新增职责拆分为四个小模块：

- `markdown-editor`：维护 Markdown 源码、光标位置和工具栏插入操作。
- `markdown-renderer`：把允许的 Markdown 子集渲染为安全 DOM；原始 HTML、脚本、危险协议和外部图片全部拒绝。
- `attachment-crypto`：使用现有 vault key 为图片生成随机 IV、执行 AES-GCM 加解密、创建和撤销内存中的 `blob:` URL。
- `auth-ui`：密码登录、TOTP 挑战、绑定/解绑、恢复码显示和 30 分钟锁定状态。

工具栏不维护第二套隐藏文档模型，而是在当前光标处插入标题、列表、强调、链接、图片引用等 Markdown 语法。这样可保持源码可预测，也能继续使用现有正文加密字段。

### 4.2 Worker 层

现有认证和笔记 API 保持不变，新增：

- 全局 TOTP 绑定与验证接口。
- 带 Session/vault 校验的附件元数据、上传、下载和删除接口。
- 30 分钟空闲状态检查。

Worker 从请求中读取或写入密文，不对笔记内容和图片明文执行解析。附件上传使用 `application/octet-stream` 二进制请求，避免 Base64 JSON 的额外体积和 CPU 消耗。

### 4.3 Cloudflare 资源

`wrangler.jsonc` 新增一个 R2 binding，例如 `ATTACHMENTS`。R2 只允许 Worker 内部访问，不配置公开域名或公开 `r2.dev` URL。Cloudflare 官方 R2 Workers API 文档（2026-08-05 核对）支持通过 binding 调用 `get`、`put`、`delete`。

根据 2026-08-05 核对的 Cloudflare R2 与 Workers 限制文档，R2 单对象上限远高于本应用需求，而 Workers Free 单请求体上限为 100 MB、HTTP 请求 CPU 上限为 10 ms；因此首版将应用级图片大小限制设为单图 10 MB，并在客户端加密前和 Worker 接收时各校验一次。

## 5. 数据模型与加密

### 5.1 附件表

新增 migration `0008_attachments.sql`，创建 `note_attachments`：

- `id`：随机 UUID，主键。
- `vault_id`：所属 vault。
- `note_id`：所属笔记。
- `object_key`：随机 R2 对象键，不包含原始文件名。
- `mime_type`：仅允许图片 MIME 白名单。
- `byte_length`：密文对象大小。
- `width`、`height`：可选尺寸元数据。
- `status`：`pending`、`attached` 或 `detached`。
- `created_at`、`attached_at`、`detached_at`。

不把原始文件名、图片说明和 Markdown alt 文本写入明文元数据；这些内容留在加密 Markdown 中。D1 元数据会泄露图片数量、类型、大小和时间，这属于本次附件功能明确接受的最小元数据泄露范围。

### 5.2 图片密文格式

浏览器使用当前 vault key 对原始图片字节执行 AES-256-GCM，每张图片生成新的 96-bit 随机 IV。R2 对象为二进制密文包：固定版本标识、IV、GCM ciphertext；不做 Base64 编码。R2 对象键和附件 ID 都是随机值，解密密钥不进入请求、D1 或 R2。

Markdown 使用内部引用：

```markdown
![旅行照片](attachment://<attachment-id>)
```

渲染器只接受 `attachment://` 图片引用；普通外部图片 URL 不渲染。

### 5.3 部署级 TOTP

新增 migration `0009_totp_sessions.sql`：

- `app_meta` 保存 TOTP 状态和使用部署签名密钥保护的密文 secret。
- `auth_recovery_codes` 保存恢复码哈希、消费时间和状态。
- `auth_sessions` 保存随机 Session ID 的哈希、vault、创建时间、最近活动时间、最近完整验证时间、过期时间和撤销时间。

TOTP secret 使用 Web Crypto 的派生密钥 + AES-GCM 保护，不使用 vault key。这样 Worker 可以验证登录，但 TOTP secret 不以明文存入 D1；同时仍处于现有 Worker/部署管理员可信边界内。

## 6. API 与数据流

### 6.1 登录与重新验证

- `POST /api/login`：先校验访问密码；若部署已绑定 TOTP，返回 `two_factor_required`，不签发完整 Session。
- `POST /api/login/totp`：提交短期 challenge ID + TOTP 或恢复码，成功后创建 `auth_sessions` 行并签发 HttpOnly Session Cookie。
- `POST /api/auth/totp/enroll`：要求当前完整 Session，返回一次性二维码数据和手动密钥；不会重复返回已绑定 secret。
- `POST /api/auth/totp/confirm`：输入验证码确认绑定，并原子写入恢复码哈希。
- `POST /api/auth/reauth`：30 分钟空闲后重新提交访问密码 + TOTP，更新会话活动时间并允许继续访问。
- `POST /api/auth/totp/disable`：要求访问密码 + 当前 TOTP 或恢复码。

旧版无 TOTP 的部署继续使用当前登录流程，直到用户主动完成绑定；绑定完成后新登录必须完成两步验证。

### 6.2 附件

- `POST /api/attachments`：认证后上传二进制图片密文，Worker 生成附件 ID 和 R2 object key，初始状态为 `pending`。
- `GET /api/attachments?noteId=...`：返回当前 vault 下某笔记的附件元数据。
- `GET /api/attachments/:id`：认证、vault 和 note 归属校验后流式返回 R2 密文。
- `DELETE /api/attachments/:id`：只允许所属 vault 删除；先标记 `detached`，再通过 `ctx.waitUntil()` 删除 R2 对象。

现有创建/更新笔记请求增加 `attachmentIds` 数组。Worker 校验这些 ID 是否属于当前 vault 和笔记，并在 D1 事务中将引用附件标记为 `attached`，遗漏附件标记为 `detached`。保存失败时不改变旧笔记和旧附件引用。

### 6.3 一次性分享

分享创建仍完全在浏览器中完成：浏览器读取当前笔记 Markdown 和被引用的图片明文，使用新的分享密钥重新加密为一个独立 envelope，再调用现有分享创建 API。分享 envelope 包含：标题、正文、图片列表、图片 MIME 与密文 bytes。

收件人领取后，分享页在内存中解密并生成图片 `blob:` URL；Worker 仍只保存分享密文、proof 哈希和过期时间。若 envelope 超出现有分享密文限制，明确拒绝创建分享。

## 7. 移动端与桌面端交互

- 移动端默认进入阅读态；顶部显示返回和“更多”，底部显示分享、编辑、更多。
- 编辑态为全屏页面，工具栏辅助插入 Markdown，底部提供预览、源码和更多。
- 桌面端左侧列表显示标题、摘要、创建时间、最近更新时间；右侧内容区原地切换阅读、编辑和预览。
- 删除只出现在“更多”菜单，危险色 + 二次确认。
- 图片在桌面接受拖拽或粘贴；手机接受系统剪贴板图片粘贴。图片插入当前光标位置，作为独立图片块显示。
- 所有弹层支持 Escape 关闭、焦点回收、键盘访问和安全区域 padding。

## 8. 失败处理与兼容性

- 密码/TOTP 错误复用现有登录限流，错误信息保持泛化。
- TOTP 恢复码只允许消费一次。
- 空闲锁定时清除内存解密状态；未保存草稿只以加密形式暂留内存，刷新页面后不保证恢复。
- 图片上传失败不写入 Markdown 引用；上传成功但保存失败的 `pending` 对象在后续请求中按保留时间清理。
- 图片解密失败只显示该图片的占位错误，不阻断整条笔记。
- revision 冲突继续 fail-safe，禁止静默覆盖或误删。
- Markdown 原始 HTML、脚本、危险链接协议和外部图片全部拒绝。
- 现有笔记和分享密文不迁移；只新增表、binding 和 API。

## 9. 测试与验证

### Worker / D1 / R2

- TOTP 绑定、登录、错误限流、恢复码单次消费、解绑、重新绑定。
- 30 分钟 idle、完整 re-auth、30 天 absolute expiry、会话撤销。
- 附件上传/下载/删除、vault 隔离、note 归属、pending/attached/detached 状态转换。
- D1 revision 冲突、旧密文解密、分享一次性领取和分享超限拒绝。
- R2 未绑定或不可用时 fail closed，不暴露对象键或密文内容。

### Client

- Markdown 标题、列表、引用、代码、链接、图片引用和 malformed input。
- XSS 向量、原始 HTML、危险协议、外部图片阻断。
- 工具栏对光标位置的插入、图片粘贴/拖拽、源码/预览切换。
- 30 分钟锁定时清除 key、笔记 DOM 和 blob URL，重新验证后恢复加密草稿。
- 移动端触摸、键盘、焦点、safe-area 和屏幕阅读器标签。

### 部署验证

修改 `wrangler.jsonc` 的 R2 binding 后运行 `wrangler types`，再运行现有 `npm run check`、`npm audit` 和 `npm run deploy:dry-run`。生产升级顺序为：备份 D1 → 创建 staging R2/D1 → 应用 migration → 运行认证/附件/分享 smoke test → 再部署生产。

## 10. Cloudflare 约束记录

本设计基于 2026-08-05 查询的 Cloudflare R2 Workers API、R2 platform limits 和 Workers platform limits 官方文档：R2 通过 binding 操作对象，R2 对象上限远高于应用级图片上限；Workers Free 的 HTTP 请求体上限为 100 MB，但 CPU 时间为 10 ms，因此客户端加密、二进制直传和 10 MB 单图限制是有意的应用层约束。

## 11. 完成标准

完成后必须满足：

1. 未完成 TOTP 时，现有部署仍可按原流程登录。
2. 完成绑定后，密码和 TOTP 都正确才可建立完整 Session。
3. 30 分钟无用户操作后，服务端和客户端都进入重新验证状态。
4. D1、R2、日志和网络响应中都不存在笔记正文、图片明文或 TOTP secret。
5. 手机端可完成阅读、编辑、Markdown 预览、图片粘贴和保存。
6. 桌面端可完成列表筛选、分栏阅读/编辑、图片拖拽/粘贴和安全删除。
7. 现有加密笔记、revision、vault 隔离和一次性分享回归测试全部通过。
