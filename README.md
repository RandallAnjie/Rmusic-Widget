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
- 喜欢的歌曲、最近播放，以及带完整本机快照的已保存歌单
- 桌面端三栏布局；移动端单行播放器可展开为完整 Now Playing、歌词与队列页面
- 页面、列表、弹层和播放状态统一使用 `cubic-bezier()` 动效曲线
- 静态资源构建时压缩，并通过内容哈希、ETag 和 immutable 缓存降低重复加载
- 播放可选择自动、无损、高品质、标准或省流档位，并展示曲目可用性
- 音源失败时保留当前平台的原始错误，不进行跨平台备用或替换
- OS 锁屏 / 蓝牙耳机 / 系统媒体控件（Media Session）

所有收藏数据只保存在浏览器 `localStorage`。在线歌单会从分享链接识别平台；仅输入 ID 时由 Worker 自动探测。保存歌单时会把元信息和完整曲目写入本机快照，之后打开不再自动请求平台；需要最新内容时在歌单页点击“更新歌单”。

## 安全模型

前端只访问同源 `/api/proxy/v2`：

1. 页面先向 `POST /api/proxy/session` 建立短期会话。Worker 用 `PROXY_SIGNING_SECRET` 生成 HMAC 签名，将会话放进 `HttpOnly + Secure + SameSite=Strict` Cookie；签名密钥和 `MUSIC_API_TOKEN` 都不会进入前端。
2. 会话默认两小时有效，绑定本站域名和客户端 IP 网段；Widget 在有效期中点自动续签。签名无效、过期、跨域或复制到其他网络的请求在到达 Meting 前返回 `401/403`。
3. `/api/proxy/v2` 不再开放通配 CORS，响应只允许浏览器私有缓存。其他网站无法用 fetch、图片或 audio 热链复用访客会话。
4. Worker 验证会话后，才通过 `Authorization: Bearer` 在服务端注入 `MUSIC_API_TOKEN`，并把 V2 track 的资源链接重写回本站代理。
5. 音频 Range、封面和歌词均通过代理返回；上游错误状态保持不变，不跨平台寻找备用音源。
6. 限流同时按 IP 和签名会话计算，默认各 `180` 次/分钟；签发会话另有默认 `12` 次/分钟限制。

这套机制能阻止直接调用、跨站热链、Cookie 复制和大部分低成本滥用。由于网页本身是公开服务，任何不要求用户登录的方案都无法从密码学上区分“真实页面”和完整模拟浏览器的机器人；若需要抵御有意自动化，应在签发端点前再启用 RandallFlare/Cloudflare WAF 或 Turnstile。

站点同时暴露与 Meting 一致的 `/api/v2/*` REST 路径，方便以
`music.bigrandall.io` 作为 API 域名。该路径不会注入服务端密钥，调用者仍必须在
每次请求中发送 `Authorization: Bearer <METING_TOKEN>`、`X-Meting-Token` 或兼容的
`?token=`；上游返回的资源链接会改写为 `https://music.bigrandall.io/api/v2/*`。

## 路由

| Path | 用途 |
|------|------|
| `GET /` | RMusic 单页应用 |
| `GET /widget.css` | 浏览器缓存的应用样式 |
| `GET /widget.js` | 浏览器缓存的应用控制器 |
| `GET /api/v2/*` | 严格 token 鉴权的同源 Meting V2 API |
| `POST /api/proxy/session` | 同源 Widget 自动签发短期代理会话；不需要用户操作 |
| `GET /api/proxy/v2/tracks?query=…&source=all` | V2 聚合或单平台搜索 |
| `GET /api/proxy/v2/tracks/{source}?ids={id1},{id2}` | V2 批量歌曲元数据，最多 50 首 |
| `GET /api/proxy/v2/albums/{source}/{id}` | V2 完整专辑元数据及分页曲目 |
| `GET /api/proxy/v2/artists/{source}/{id}` | V2 歌手元数据及代表曲目 |
| `GET /api/proxy/v2/artists/{source}/{id}/albums` | V2 歌手发行目录 |
| `GET /api/proxy/v2/playlists/{source}/{id}` | V2 歌单详情、创建人、介绍、封面和分页曲目 |
| `GET /api/proxy/v2/discovery` | 推荐、榜单和新歌首页数据 |
| `GET /api/proxy/v2/streams/{source}/{id}` | V2 音频流代理，支持 `quality` |
| `GET /api/proxy/v2/streams/{source}/{id}/options` | 可用性、订阅要求和音质档位 |
| `GET /api/proxy/v2/artworks/{source}/{id}` | V2 封面代理 |
| `GET /api/proxy/v2/lyrics/{source}/{id}` | V2 歌词；`granularity=word` 为逐字歌词 |

根路径支持轻量 deep link：

```text
/?q=Lemon
/?q=Lemon&server=netease
/?type=playlist&server=tencent&id=9505357778
```

### 聚合与单平台搜索

搜索页默认选中“聚合”，通过 `/api/proxy/v2/tracks?query=…&source=all` 让 Meting V2 并发查询平台、容忍单源失败，按相关度统一排序并去除同一录音的重复结果。去重不会生成备用音源，也不会在播放失败时切换平台。

平台栏可切换为 QQ 音乐、网易云、酷狗、汽水音乐、YouTube Music、酷我、百度、Apple Music 或 Spotify。单平台模式只请求所选平台，切换平台会用当前关键词立即重新搜索，选项保存在浏览器本地。也支持 `/?q=关键词&server=soda` 这类 deep link。导入歌单只需链接或 ID，无需选择平台：分享链接按域名识别，纯 ID 由 V2 自动探测来源；名称、封面、介绍、创建人和完整曲目会直接保存到浏览器本地。Spotify 当前需要应用所有者保持 Premium；汽水音乐需要服务端存在有效登录账号。

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
| `PROXY_SIGNING_SECRET` | 推荐 | 至少 32 字节的随机代理会话 HMAC 密钥；未设置时兼容性回退到 `MUSIC_API_TOKEN` |
| `PROXY_SESSION_TTL_SECONDS` | 否 | 代理会话有效期，默认 `7200`，范围 300–86400 秒 |
| `PROXY_SESSION_RATE_WINDOW_MS` | 否 | 会话签发限流窗口，默认 `60000` |
| `PROXY_SESSION_RATE_MAX` | 否 | 单 IP 每窗口最多签发次数，默认 `12` |
| `RATE_WINDOW_MS` | 否 | 限流窗口，默认 `60000` |
| `RATE_MAX` | 否 | 每个窗口的单 IP、单会话请求上限，默认 `180` |
| `LOG_LEVEL` | 否 | `trace` / `debug` / `info` / `warn` / `error` |

`MUSIC_API` 与 `MUSIC_API_URL` 至少设置一个；两者同时存在时优先走 service binding。

## 在 RandallFlare 部署

1. 控制台连接 `RandallAnjie/Rmusic-Widget` 的 `main` 分支。
2. Build command：`npm install && npm run build`
3. Output file：`dist/_worker.js`
4. 绑定 `MUSIC_API` 到 Meting-API worker。
5. 设置 `MUSIC_API_TOKEN`。
6. 生成独立随机密钥并作为 secret 设置到 `PROXY_SIGNING_SECRET`；轮换此值会立即使旧代理会话失效。

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
├── api-proxy.js       token 注入、资源流转发与 JSON URL 重写
└── widget/
    ├── index.html     完整应用结构
    ├── index.css      桌面/移动响应式设计系统
    └── client.js      搜索、歌单、音乐库、队列、播放和歌词控制器
build.mjs              esbuild 打包与资源 hash
```

## 浏览器数据

以下内容保存在当前域名的 `localStorage`：

- 音量、随机与循环模式
- 最近播放（最多 30 首）
- 喜欢的歌曲（最多 200 首）
- 保存的在线歌单（最多 60 个）
- 每个已保存歌单的元信息、完整曲目和缓存更新时间
- 首页发现内容（10 分钟）和播放音质偏好

歌单快照采用精简曲目结构以节省空间。浏览器的 `localStorage` 配额通常有限；空间不足时页面会保留歌单定义并提示缓存失败。更换域名或清除浏览器站点数据会清空这些本地收藏。
