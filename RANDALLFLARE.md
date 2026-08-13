# RMusic on RandallFlare Workers

## 部署

1. 控制台连接 GitHub 仓库 `RandallAnjie/Rmusic-Widget`，分支 `main`。
2. Build command：`npm install && npm run build`
3. Output file：`dist/_worker.js`
4. 添加 service binding：`MUSIC_API` → Meting-API worker。
5. 添加环境变量：`MUSIC_API_TOKEN`，值与 Meting-API 的 `METING_TOKEN` 一致。
6. 添加 secret：`PROXY_SIGNING_SECRET`，使用独立的 32 字节以上随机值。
7. 创建 D1 数据库并以 `AUTH_DB` 绑定到 Pages 项目，用于 RMusic ID 和设备密钥。

如果两个 worker 不在同一租户，可以不设置 `MUSIC_API`，改用：

```text
MUSIC_API_URL=https://music.rapi.rest
```

可选限流配置：

```text
RATE_WINDOW_MS=60000
RATE_MAX=180
PROXY_SESSION_TTL_SECONDS=7200
PROXY_SESSION_RATE_WINDOW_MS=60000
PROXY_SESSION_RATE_MAX=12
AUTH_SESSION_DAYS=30
AUTH_RATE_MAX=60
AUTH_REGISTRATION_RATE_MAX=10
```

## 验证

部署后打开根路径，应看到完整的 RMusic 应用：

- 左侧首页 / 搜索 / 音乐库导航
- 中央内容区和固定底部播放器
- 搜索会自动聚合各平台、按相关度排序，并可连续播放整个结果列表
- 搜索页可切换到任一单独平台；切换后会用当前关键词立即重搜
- 所有数据请求均走 `/api/proxy/v2`，上游只调用 Meting `/api/v2`
- 页面会自动调用 `POST /api/proxy/session`，取得 HMAC 签名的 HttpOnly 短期会话；直接访问代理应返回 `401`
- `/api/proxy/v2` 不返回 `Access-Control-Allow-Origin: *`，成功响应使用 `private` 缓存，并同时按 IP 与会话限流
- `music.bigrandall.io/api/v2/*` 可作为完整 V2 API 使用；必须由调用者发送 token，服务端不会为该路径注入密钥
- 通过“添加歌单”粘贴分享链接或输入歌单 ID，无需选择平台；来源由链接或 V2 自动识别
- 添加成功后，名称、封面、介绍、创建人和完整曲目固定写入浏览器 `localStorage`；再次打开直接使用快照，仅点击“更新歌单”时请求 V2 并覆盖缓存
- 桌面端右侧队列和逐字歌词面板可正常打开
- 手机点击底部歌曲信息可展开完整 Now Playing 页面，并切换歌词与队列
- `widget.css` / `widget.js` 的 hash URL 返回 `immutable` 缓存，支持 Brotli/Gzip
- 顶部或手机底部“账号”可直接使用 Face ID、Touch ID、Windows Hello 或设备 PIN 创建与登录 RMusic ID
- 刷新页面后仍保持登录；账号中心可添加/移除设备密钥并注销其他会话

也可以验证 deep link：

```text
/?q=Lemon
/?type=playlist&server=tencent&id=9505357778
```

## 常见问题

- `neither MUSIC_API service binding nor MUSIC_API_URL is configured`：绑定或 URL 均未设置。
- `MUSIC_API_TOKEN env binding is required`：缺少代理侧 master token。
- `PROXY_SIGNING_SECRET env binding is required`：缺少会话签名密钥；设置独立随机 secret 后重新部署。
- `AuthUnavailable`：用户系统缺少 `AUTH_DB` D1 binding。
- `ProxySessionRequired`：请求没有有效的本站短期会话；刷新 RMusic 页面会自动重新签发。
- `429 rate limit exceeded`：提高 `RATE_MAX`，或检查页面是否发生请求循环。
- Meting-API 返回 401：两个 worker 的 token 不一致。
- 聚合搜索结果偏少：查看 `X-RMusic-Sources`，确认哪些平台本次成功响应；单个平台失败不会中断其他结果。
- 封面或音频 404：对应平台可能没有该资源、歌曲下架或需要有效会员 cookie。
- Tencent 返回 `vkey 全部 quality 都被拒`：通常是 QQ 音乐账号无对应权益、cookie 状态异常或 Worker 出口受地域限制。代理会保留原平台错误，不会切换到其他平台；应刷新 Tencent cookie、确认账号会员权益或调整 Meting-API 出口。

浏览器看到的所有资源 URL 都应以本站 `/api/proxy/v2` 开头；如果 Network 面板出现带 Meting `auth` 的跨域 URL，说明 V2 links 重写逻辑出现回归。
