INSERT INTO app_meta (key, value)
VALUES ('branding_login:v1', '{"title":"正在打开我的笔记","description":"输入密码后即可进入应用，并在本地解锁你的加密笔记。"}')
ON CONFLICT(key) DO NOTHING;

INSERT INTO app_meta (key, value)
VALUES ('session_idle_timeout_seconds:v1', '1800')
ON CONFLICT(key) DO NOTHING;
