# 移动端密码展示、独立二次验证与登录设置设计

## 背景

现有版本已经完成编辑器块级 Markdown 保存和保存事务宿主修复，但三张移动端截图暴露出新的产品问题：密码展示页在窄屏下正文列过窄，设置抽屉覆盖正常内容，Authenticator 验证仍嵌在密码登录卡片中。用户还需要在设置中修改登录页文案、会话超时时间，并查看登录设备记录。

## 目标

1. 手机端密码正文优先于字段标签和操作按钮，正文可读且不发生页面级横向滚动。
2. 设置入口和设置面板在移动端不遮挡正常内容，打开后背景不可操作。
3. 密码登录成功后进入独立的 Authenticator 验证页面；不使用弹窗或密码输入框下方的内嵌验证块。
4. 设置页可安全修改登录页标题、说明和会话空闲超时时间。
5. 设置页可查看当前 Vault 的登录设备、IP、登录时间、最后活动时间和状态。

## 非目标与不变约束

- 不修改 PBKDF2、AES-GCM、`enc:v1`、Vault 隔离、认证 Cookie、Authenticator 验证算法、附件加密和分享协议。
- 普通笔记仍只保存加密 Markdown，不保存富文本 HTML。
- 不引入新的运行时依赖或完整富文本编辑器。
- 登录文案是公开 UI 配置，只允许纯文本；不允许通过配置注入 HTML、脚本或事件属性。
- 设备记录属于认证元数据，不记录密码、TOTP secret、恢复码或笔记明文。
- migration 只新增元数据字段/键，不删除或改写既有笔记和认证密文；失败时保留原 migration 和数据库备份恢复路径。

## 设计

### 移动端密码展示

保持桌面端标签、正文、操作按钮的横向布局。视口宽度不超过 600px 时，每个字段改为两层结构：第一层显示字段名，第二层由正文和操作按钮组成。正文 `min-width: 0`、`overflow-wrap: anywhere`，多行字段占满内容宽度；复制/显示按钮保持至少 44px 触控目标。字段容器和阅读器正文使用 `box-sizing: border-box`，页面根容器禁止横向溢出。

### 设置面板

桌面端继续使用右侧抽屉。移动端设置改为从安全区下方铺满宽度的全屏 sheet，并显示固定遮罩；打开时锁定背景滚动、将背景区域设为 inert，关闭时恢复触发按钮焦点。顶部栏移动端将设置按钮压缩为图标按钮，搜索框不再被设置按钮挤成独占一行。sheet 内的分组仍按“登录页面 / 会话安全 / 登录设备 / 退出登录”排列。

### 独立 Authenticator 页面

新增登录认证步骤状态 `password`、`totp`、`unlock`。`/api/login` 返回 `two_factor_required` 时，客户端保存 challenge id 并只显示 `totpView`，隐藏密码登录卡片；密码不会重新展示在验证码页面。验证码页面包含六个单字符输入框、验证码说明、验证按钮和恢复码入口。输入框支持自动前进、退格回退、整段粘贴；提交失败保留当前输入并显示错误。验证成功后回到现有解锁流程，不改变服务端 `/api/login/totp` 请求格式。

### 登录页文案与会话超时配置

在 `app_meta` 增加版本化配置键：

- `branding_login:v1`：JSON `{ title, description }`
- `session_idle_timeout_seconds:v1`：整数秒

服务端提供公开读取接口，只返回登录页所需的纯文本和规范化超时秒数；写入接口要求现有 active session，并再次校验当前访问密码。标题限制 64 个 Unicode 字符，说明限制 160 个 Unicode 字符；空值回退到环境变量/默认值。超时使用固定选项 300、900、1800、3600、14400 秒，默认 1800 秒。服务端 `getSession()` 每次按数据库配置判断 `reauthRequired`，客户端 idle timer 使用同一返回值。

### 登录设备记录

新增 D1 migration，为 `auth_sessions` 增加可空的 `device_label`、`user_agent`、`login_ip`、`login_at` 字段，并建立按 `vault_id, login_at DESC` 的索引。创建 session 时从现有请求上下文记录设备信息、客户端 User-Agent、IP 和登录时间；旧 session 的新增字段保持 null，页面显示“历史记录”。设备列表接口只返回当前 Vault 的脱敏展示字段和状态，不返回 `id_hash` 或 session token。列表默认按登录时间倒序，当前会话标记“当前设备”。

## 数据流

```text
登录密码 -> /api/login -> two_factor_required
                         -> totpView -> /api/login/totp -> session cookie
设置打开 -> GET public config + GET device list
设置保存 -> active session + 当前密码校验 -> app_meta / auth_sessions
请求 API -> getSession() 读取 timeout 配置 -> 超时则 reauth_required
```

## 错误处理

- 配置读取失败：使用内置默认值并在设置页显示“暂时无法读取服务器配置”。
- 配置写入失败：保留输入值，不关闭 sheet，显示服务端错误。
- 非法标题/说明/超时值：客户端和服务端双重拒绝，不写入数据库。
- 设备列表读取失败：设置页保留其他分组并显示单独错误，不影响笔记阅读。
- TOTP challenge 过期或验证码错误：停留在独立验证页，允许重新输入；challenge 不写入 localStorage。

## 测试与验收

- 单元测试：移动密码字段布局模型、登录步骤状态、验证码输入归一化、配置规范化、设备记录模型。
- API 测试：配置读写权限、固定选项校验、超时生效、登录 session 元数据写入、旧 session 兼容、设备列表不泄露 hash/token。
- 静态结构测试：独立 `totpView`、设置分组、设备列表容器和新增 API 路由。
- 浏览器验收：390×844、900px、1280px；验证密码正文宽度、设置遮罩/焦点、6 格验证码输入、配置保存后刷新登录页、设备记录显示。
