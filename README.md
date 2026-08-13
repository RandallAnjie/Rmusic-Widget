# RMusic

RMusic 是一个部署在 Cloudflare Workers / RandallFlare Workers 上的完整网页音乐播放器。它保留了原版 widget 的多平台能力、连续播放、逐字歌词和 Media Session，并升级成类似 Spotify 的单页应用：

- 首页、搜索、音乐库和歌单详情四类视图
- 首页直接展示 V2 每日推荐、热门榜单和新歌速递
- 搜索结果或完整歌单作为连续播放队列
- 默认自动聚合多个音乐平台、去除同一录音的重复结果，也可指定单个平台搜索
- 聚合搜索采用快速首屏，慢平台在后台补全；列表只传播放器所需的精简字段
- 点击歌曲的歌手或专辑可继续浏览歌手发行目录、代表作和完整专辑
- 队列、随机播放、列表/单曲循环、进度和音量控制
- 标准 LRC + Enhanced LRC 逐字歌词
- 登录后播放；喜欢的歌曲、最近播放和带完整快照的已保存歌单跨设备同步
- 桌面端三栏布局；移动端单行播放器可展开为完整 Now Playing、歌词与队列页面
- 页面、列表、弹层和播放状态统一使用 `cubic-bezier()` 动效曲线
- 静态资源构建时压缩，并通过内容哈希、ETag 和 immutable 缓存降低重复加载
- 播放可选择自动、无损、高品质、标准或省流档位，并展示曲目可用性
- 音源失败时保留当前平台的原始错误，不进行跨平台备用或替换
- OS 锁屏 / 蓝牙耳机 / 系统媒体控件（Media Session）
- 无账号密码的 RMusic ID：使用 Face ID、Touch ID、Windows Hello 或设备 PIN 注册和登录
- 设备密钥、登录会话和显示名称管理；iOS 客户端可用 RMusic Bearer 安全访问同一代理与个人音乐库

播放需要先使用设备密钥登录 RMusic ID。喜欢的歌曲、最近播放和已保存歌单都按用户隔离保存在 `AUTH_DB` D1；在线歌单会从分享链接识别平台，仅输入 ID 时由 Worker 自动探测。保存歌单时会把元信息和完整曲目写入账号快照，之后打开不再自动请求平台；需要最新内容时在歌单页点击“更新歌单”。旧版本留在 `localStorage` 的音乐库会在账号云端为空时自动迁移一次，迁移成功后从本机移除。

## 安全模型

前端只访问同源 `/api/proxy/v2`：

1. 页面或 iOS App 先向 `POST /api/proxy/session` 建立短期会话。Worker 用 `PROXY_SIGNING_SECRET` 生成 HMAC 签名，将会话放进 `HttpOnly + Secure + SameSite=Strict` Cookie；签名密钥和 `MUSIC_API_TOKEN` 都不会进入客户端。iOS 未登录时可签发仅供浏览、搜索、封面和歌词使用的会话；登录后可用有效的原生 RMusic Bearer 签发账号绑定 Cookie，也可直接以该 Bearer 访问代理。
2. 会话默认两小时有效，绑定本站域名和客户端 IP 网段；Widget 在有效期中点自动续签。签名无效、过期、跨域或复制到其他网络的请求在到达 Meting 前返回 `401/403`。
3. `/api/proxy/v2` 不再开放通配 CORS，响应只允许私有缓存，并同时 `Vary: Cookie, Authorization`。其他网站无法用 fetch、图片或 audio 热链复用访客会话；携带浏览器跨站 Fetch Metadata / Origin 的 Bearer 请求也会被拒绝。
4. Worker 验证会话后，才通过 `Authorization: Bearer` 在服务端注入 `MUSIC_API_TOKEN`，并把 V2 track 的资源链接重写回本站代理。
5. 封面和歌词在代理会话建立后即可访问；音频流还必须存在有效 RMusic ID 会话，未登录返回 `401 AuthenticationRequired`，不会请求上游。原生签发的代理 Cookie 只保存受 HMAC 保护的数据库会话 ID，播放时仍会重新检查过期和注销状态，不保存 RMusic Bearer。
6. 音频 Range 通过代理返回；上游返回签名 CDN 跳转时由 Worker 手动跟随，每一跳只重建 `Accept` / `Range` 头，不会把 `MUSIC_API_TOKEN`、RMusic Bearer 或 Cookie 发给外部域名。上游错误状态保持不变，不跨平台寻找备用音源。
7. 限流同时按 IP 和签名会话计算，默认各 `180` 次/分钟；签发会话另有默认 `12` 次/分钟限制。

这套机制把浏览和播放权限分开：公开页面可以搜索和查看目录，但只有已登录用户可以获取音频；同时阻止直接调用、跨站热链、Cookie 复制和大部分低成本滥用。若需要进一步抵御有意自动化，可在注册、登录或代理会话签发端点前启用 RandallFlare/Cloudflare WAF 或 Turnstile。

### RMusic ID 与设备密钥

用户系统完全不收集账号、密码、邮箱或手机号。注册时浏览器创建 WebAuthn 可发现凭据，私钥保留在设备安全硬件或系统密码管理器中；服务端 D1 只保存随机用户标识、公开密钥、签名计数器和设备名称。登录时不先输入用户名，由设备密钥返回不透明的 user handle，再由服务端校验 challenge、来源域名、RP ID、用户验证结果、签名和计数器。

网页会话使用 `__Host-rmusic_user` 的 `HttpOnly + Secure + SameSite=Lax` 不透明持久 Cookie，同时写入 `Expires` 和 `Max-Age` 并在有效会话检查时重新确认属性；D1 只保存 token 的 SHA-256。会话默认有效 30 天，可在账号中心查看并注销其他会话。所有网页修改操作仍要求严格同源，因此 `Lax` 不会放宽资料或音乐库写入权限。挑战五分钟过期且只可消费一次，注册端点另有限流。手机客户端可在 WebAuthn 验证后请求 `Bearer rmu_…` 会话；服务端只接受 `kind = native` 的有效 Bearer 作为原生账号和播放权限，并且必须先通过 `AUTH_NATIVE_ORIGINS` 明确允许验证来源。

### iOS 原生接入

已知原生 App ID 为 `N9B2H32Q94.io.bigrandall.rmusic`。Worker 在 `/.well-known/apple-app-site-association` 直接返回 `application/json`（不跳转）：

```json
{"webcredentials":{"apps":["N9B2H32Q94.io.bigrandall.rmusic"]}}
```

iOS target 需要 `webcredentials:music.bigrandall.io` Associated Domain。原生 `ASAuthorizationPlatformPublicKeyCredentialProvider` 使用 RP ID `music.bigrandall.io`，Apple 返回的 `clientDataJSON.origin` 为 `https://music.bigrandall.io`。部署时设置 `AUTH_ORIGIN=https://music.bigrandall.io`、`AUTH_RP_ID=music.bigrandall.io` 与 `AUTH_NATIVE_ORIGINS=https://music.bigrandall.io`。

Debug 构建使用 `webcredentials:music.bigrandall.io?mode=developer` 直接读取源站 AASA，便于在 Apple CDN 尚未刷新时进行真机开发；测试设备需开启“设置 → 开发者 → Associated Domains Development”。Release 构建始终使用不带查询参数的标准 entitlement，不会把开发模式带入 App Store 产物。

原生注册/登录仍使用 `/api/auth/*/options` 和 `/verify`，URLSession 请求带 `Origin: https://music.bigrandall.io` 与 `X-RMusic-Client: ios-v1`，在 verify JSON 中传 `"sessionMode":"bearer"`。Apple 原生 API 与网页都会签名同一 HTTPS origin；因此服务端除了校验 AASA 绑定后的 Passkey、origin 和客户端标识，还要求 Bearer verify 请求不含浏览器 `Sec-Fetch-Site` 头，避免同源网页 JavaScript 要求可导出会话。验证成功响应包含 `accessToken` 和 `tokenType: "Bearer"`；`accessToken` 应放在 Keychain，不写入 URL、日志或普通偏好。

获得 Bearer 后有两种等价路径：

- 每个 `/api/proxy/v2/*` 请求都发送 `Authorization: Bearer rmu_…`。Worker 验证 D1 会话后在上游改用 `MUSIC_API_TOKEN`，绝不向 Meting 透传 `rmu_…`。
- `POST /api/proxy/session`，发送 `Authorization: Bearer rmu_…` 和 `X-RMusic-Client: ios-v1`。返回 `201`、`__Host-rmusic_proxy` Cookie 及 `{ authenticated, accountAuthenticated, expiresAt, refreshAfter }`；URLSession 可复用 Cookie 请求目录和音频。Cookie 按 IP 网段绑定，手机切换 Wi-Fi/蜂窝网络后可用 Keychain 中的 Bearer 重新签发，或直接继续使用 Bearer。

Bearer 和 Cookie 都只是 RMusic Worker 的访问凭据；`MUSIC_API_TOKEN` 始终只存在 Worker 环境中。

个人音乐库同样使用该会话鉴权。收藏和最近播放只保存播放器所需的精简歌曲字段；歌单保存元信息与完整曲目快照。所有查询和修改都带 `user_id` 条件，账号退出时页面立即停止播放并清空内存中的队列、当前歌曲和个人音乐库。每个账号最多保存 200 首收藏、30 条最近播放、60 个歌单；单个歌单最多 5000 首/4 MiB，歌单快照合计最多 24 MiB。

站点同时暴露与 Meting 一致的 `/api/v2/*` REST 路径，方便以
`music.bigrandall.io` 作为 API 域名。该路径不会注入服务端密钥，调用者仍必须在
每次请求中发送 `Authorization: Bearer <METING_TOKEN>`、`X-Meting-Token` 或兼容的
`?token=`；上游返回的资源链接会改写为 `https://music.bigrandall.io/api/v2/*`。

## 路由

| Path | 用途 |
|------|------|
| `GET /` | RMusic 单页应用 |
| `GET /.well-known/apple-app-site-association` | iOS Passkey `webcredentials` 关联，App ID `N9B2H32Q94.io.bigrandall.rmusic` |
| `GET /widget.css` | 浏览器缓存的应用样式 |
| `GET /widget.js` | 浏览器缓存的应用控制器 |
| `GET /api/v2/*` | 严格 token 鉴权的同源 Meting V2 API |
| `POST /api/proxy/session` | 同源 Widget / iOS 签发短期浏览会话，或由有效 iOS RMusic Bearer 签发账号绑定会话 |
| `GET /api/proxy/v2/tracks?query=…&source=all` | V2 聚合或单平台搜索 |
| `GET /api/proxy/v2/tracks/{source}?ids={id1},{id2}` | V2 批量歌曲元数据，最多 50 首 |
| `GET /api/proxy/v2/albums/{source}/{id}` | V2 完整专辑元数据及分页曲目 |
| `GET /api/proxy/v2/artists/{source}/{id}` | V2 歌手元数据及代表曲目 |
| `GET /api/proxy/v2/artists/{source}/{id}/albums` | V2 歌手发行目录 |
| `GET /api/proxy/v2/playlists/{source}/{id}` | V2 歌单详情、创建人、介绍、封面和分页曲目 |
| `GET /api/proxy/v2/discovery` | 推荐、榜单和新歌首页数据 |
| `GET /api/proxy/v2/streams/{source}/{id}` | V2 音频流代理，支持 `quality`；必须登录 RMusic ID |
| `GET /api/proxy/v2/streams/{source}/{id}/options` | 可用性、订阅要求和音质档位 |
| `GET /api/proxy/v2/artworks/{source}/{id}` | V2 封面代理 |
| `GET /api/proxy/v2/lyrics/{source}/{id}` | V2 歌词；`granularity=word` 为逐字歌词 |
| `GET /api/auth/session` | 当前 RMusic ID 会话状态 |
| `POST /api/auth/register/options` / `verify` | 创建账号及注册首个设备密钥 |
| `POST /api/auth/login/options` / `verify` | 无用户名设备密钥登录 |
| `GET /api/auth/devices` | 当前账号的设备密钥列表 |
| `POST /api/auth/devices/options` / `verify` | 为当前账号添加设备密钥 |
| `DELETE /api/auth/devices/{id}` | 移除设备密钥；不能移除最后一个 |
| `GET /api/auth/sessions` | 当前账号的活跃网页/手机客户端会话 |
| `DELETE /api/auth/sessions/{id}` | 注销指定会话 |
| `PATCH /api/auth/profile` / `POST /api/auth/logout` | 修改显示名称 / 退出登录 |
| `GET /api/auth/library` | 当前账号的收藏、最近播放和已保存歌单摘要 |
| `PUT /api/auth/library/favorites` | 收藏歌曲；请求体为 `{ "track": Track }` |
| `DELETE /api/auth/library/favorites/{source}/{id}` | 取消收藏 |
| `POST /api/auth/library/recent` / `DELETE /api/auth/library/recent` | 写入一条播放记录 / 清空播放记录 |
| `GET /api/auth/library/playlists/{source}/{id}` | 读取一个账号歌单完整快照 |
| `PUT /api/auth/library/playlists/{source}/{id}` | 保存或更新歌单；请求体为 `{ "playlist": PlaylistSnapshot }` |
| `DELETE /api/auth/library/playlists/{source}/{id}` | 移除已保存歌单 |
| `POST /api/auth/library/import` | 仅当账号云端为空时，一次性迁移旧本机音乐库 |

根路径支持轻量 deep link：

```text
/?q=Lemon
/?q=Lemon&server=netease
/?type=playlist&server=tencent&id=9505357778
```

### 聚合与单平台搜索

搜索页默认选中“聚合”，通过 `/api/proxy/v2/tracks?query=…&source=all` 让 Meting V2 并发查询平台、容忍单源失败，按相关度统一排序并去除同一录音的重复结果。去重不会生成备用音源，也不会在播放失败时切换平台。

平台栏可切换为 QQ 音乐、网易云、酷狗、汽水音乐、YouTube Music、酷我、百度、Apple Music 或 Spotify。单平台模式只请求所选平台，切换平台会用当前关键词立即重新搜索，选项保存在浏览器本地。也支持 `/?q=关键词&server=soda` 这类 deep link。导入歌单只需链接或 ID，无需选择平台：分享链接按域名识别，纯 ID 由 V2 自动探测来源；名称、封面、介绍、创建人和完整曲目会保存到当前 RMusic ID 的 D1 快照。Spotify 当前需要应用所有者保持 Premium；汽水音乐需要服务端存在有效登录账号。

聚合模式传 `source=all&mode=fast&view=compact`，单平台模式传具体 `source` 和 `view=compact`。快速模式先显示首屏预算内完成的平台，若 `meta.complete=false`，页面会自动再次读取后台补全后的同一缓存；用户不需要重复搜索。相关度计算、ISRC 优先去重、平台状态和分页都以 V2 的 `meta` 为准，Widget 不再维护另一套聚合排序实现，最多请求 80 首。

V2 返回歌手/专辑资源 ID 时，结果列表中的歌手和专辑会成为目录入口。歌手页面继续读取 `/artists/{source}/{id}/albums` 展示发行目录，专辑卡片可进入完整曲目列表；这些请求和首页、歌单列表一样使用精简视图降低传输及解析开销。

代理根据 V2 `meta.sources` 返回 `X-RMusic-Sources`，列出本次成功参与的音源。歌曲保留实际 `source`，播放、封面、歌词、收藏和最近播放继续使用对应平台资源。

### 播放音质与错误边界

播放器可以选择 `auto`、`lossless`、`high`、`standard` 或 `low`，代理会把选择原样传给 Meting V2，并透传实际音质、编码和码率响应头。为兼容手机与 Safari，代理还会流式检查首个音频块，纠正上游误标的 FLAC、MP3、AAC、MP4、Ogg、WebM 或 WAV 媒体类型，不会为此缓冲整首歌曲。曲目卡片会根据 V2 `playback` 显示试听、会员、最高可用音质或暂不可播状态。QQ 音乐等平台因会员、cookie 或地域限制返回 `403/404` 时，代理直接保留该状态且使用 `Cache-Control: no-store`；不会搜索或播放其他平台版本。

首页通过单个 `/api/proxy/v2/discovery?view=compact` 请求获取推荐、榜单和新歌。结果会在浏览器缓存 10 分钟，服务端先使用 isolate 热缓存再使用 D1 持久缓存；点击首页“刷新”会发送 `refresh=true` 主动重建服务端缓存。代理会透传 `Server-Timing`，便于区分各音乐平台的实际耗时。

## 环境变量与绑定

| 名字 | 必填 | 说明 |
|------|------|------|
| `MUSIC_API` | 优先 | 指向 Meting-API worker 的 RandallFlare service binding |
| `MUSIC_API_URL` | fallback | 未使用 service binding 时的公网地址，如 `https://music.rapi.rest` |
| `MUSIC_API_TOKEN` | 是 | 与 Meting-API 的 `METING_TOKEN` 相同，仅由 Worker 使用 |
| `AUTH_DB` | 是（用户系统） | 保存 RMusic ID、公开密钥、一次性 challenge 和哈希会话的 D1 binding |
| `PROXY_SIGNING_SECRET` | 推荐 | 至少 32 字节的随机代理会话 HMAC 密钥；未设置时兼容性回退到 `MUSIC_API_TOKEN` |
| `PROXY_SESSION_TTL_SECONDS` | 否 | 代理会话有效期，默认 `7200`，范围 300–86400 秒 |
| `PROXY_SESSION_RATE_WINDOW_MS` | 否 | 会话签发限流窗口，默认 `60000` |
| `PROXY_SESSION_RATE_MAX` | 否 | 单 IP 每窗口最多签发次数，默认 `12` |
| `RATE_WINDOW_MS` | 否 | 限流窗口，默认 `60000` |
| `RATE_MAX` | 否 | 每个窗口的单 IP、单会话请求上限，默认 `180` |
| `AUTH_SESSION_DAYS` | 否 | RMusic ID 会话有效天数，默认 `30`，范围 1–365 |
| `AUTH_ORIGIN` | 否 | WebAuthn 预期网页来源；默认由当前请求的 HTTPS origin 推导 |
| `AUTH_RP_ID` | 否 | WebAuthn RP ID；默认当前 hostname |
| `AUTH_NATIVE_ORIGINS` | iOS 是 | 允许签发手机客户端 Bearer 会话的 WebAuthn origins，iOS 设为 `https://music.bigrandall.io`，多值用逗号分隔 |
| `AUTH_RATE_MAX` | 否 | 单 IP 每分钟用户接口上限，默认 `60` |
| `AUTH_REGISTRATION_RATE_MAX` | 否 | 单 IP 每小时创建账号请求上限，默认 `10` |
| `LOG_LEVEL` | 否 | `trace` / `debug` / `info` / `warn` / `error` |

`MUSIC_API` 与 `MUSIC_API_URL` 至少设置一个；两者同时存在时优先走 service binding。

## 在 RandallFlare 部署

1. 控制台连接 `RandallAnjie/Rmusic-Widget` 的 `main` 分支。
2. Build command：`npm install && npm run build`
3. Output file：`dist/_worker.js`
4. 绑定 `MUSIC_API` 到 Meting-API worker。
5. 设置 `MUSIC_API_TOKEN`。
6. 生成独立随机密钥并作为 secret 设置到 `PROXY_SIGNING_SECRET`；轮换此值会立即使旧代理会话失效。
7. 创建专用 D1 数据库，并以 `AUTH_DB` 绑定到项目。认证和个人音乐库表会在首次请求时幂等创建；也可依次执行 `migrations/0001_rmusic_auth.sql`、`migrations/0002_account_library.sql`。
8. 若启用 iOS，设置 `AUTH_ORIGIN=https://music.bigrandall.io`、`AUTH_RP_ID=music.bigrandall.io` 和 `AUTH_NATIVE_ORIGINS=https://music.bigrandall.io`；并在部署后直接检查 AASA URL 返回 `200 application/json`。

项目未使用 Node 内置模块，不需要 `nodejs_compat`。

## 本地开发

```bash
npm install
npm run build
npm run lint
```

构建会压缩 HTML、CSS、JS 并内联进单个 `dist/_worker.js`，同时生成 Brotli/Gzip 版本，把内容 hash 写入静态资源 URL。带 hash 的 CSS/JS 使用一年 immutable 缓存，HTML 使用短 CDN 缓存和 ETag 验证。

## 文件结构

```text
src/
├── worker.js          Worker 入口、静态资源路由、CORS 与错误处理
├── config.js          环境变量与 service binding 配置
├── rate-limit.js      per-IP 滑动窗口限流
├── proxy-session.js   HMAC 会话签发、校验、IP 绑定与私有缓存策略
├── auth.js            WebAuthn 注册/登录、设备密钥与用户会话管理
├── library.js         D1 收藏、最近播放、歌单快照及配额隔离
├── api-proxy.js       token 注入、资源流转发与 JSON URL 重写
└── widget/
    ├── index.html     完整应用结构
    ├── index.css      桌面/移动响应式设计系统
    └── client.js      搜索、歌单、音乐库、队列、播放和歌词控制器
build.mjs              esbuild 打包与资源 hash
```

## 数据保存位置

当前域名的 `localStorage` 只保存非账号偏好：音量、随机/循环模式、搜索平台、播放音质和最多缓存 10 分钟的首页发现内容。喜欢的歌曲、最近播放、已保存歌单及完整歌单快照保存在 `AUTH_DB`，登录同一 RMusic ID 后可跨设备读取。

升级时，页面仅在 D1 音乐库完全为空的情况下读取旧版 `localStorage` 收藏、最近播放和歌单快照；导入成功后删除这些旧键，避免长期保存两份个人数据。账号退出或会话过期时，页面会停止音频并清空当前页面内存中的个人数据。
