# RMusic

RMusic 是一个部署在 Cloudflare Workers / RandallFlare Workers 上的完整网页音乐播放器。它保留了原版 widget 的多平台能力、连续播放、逐字歌词和 Media Session，并升级成类似 Spotify 的单页应用：

- 首页、搜索、音乐库和歌单详情四类视图
- 搜索结果或完整歌单作为连续播放队列
- 默认自动聚合多个音乐平台，也可指定单个平台搜索
- 队列、随机播放、列表/单曲循环、进度和音量控制
- 标准 LRC + Enhanced LRC 逐字歌词
- 喜欢的歌曲、最近播放，以及带完整本机快照的已保存歌单
- 桌面端三栏布局；移动端单行播放器可展开为完整 Now Playing、歌词与队列页面
- 页面、列表、弹层和播放状态统一使用 `cubic-bezier()` 动效曲线
- 静态资源构建时压缩，并通过内容哈希、ETag 和 immutable 缓存降低重复加载
- Tencent vkey 拒绝时按歌曲名与歌手自动回退网易云 / YouTube Music
- OS 锁屏 / 蓝牙耳机 / 系统媒体控件（Media Session）

所有收藏数据只保存在浏览器 `localStorage`。在线歌单会从分享链接识别平台；仅输入 ID 时由 Worker 自动探测。保存歌单时会把元信息和完整曲目写入本机快照，之后打开不再自动请求平台；需要最新内容时在歌单页点击“更新歌单”。

## 安全模型

前端只访问同源 `/api/proxy/v2`：

1. Worker 通过 `Authorization: Bearer` 在服务端注入 `MUSIC_API_TOKEN`；浏览器永远看不到 master token。
2. Widget 只调用 Meting `/api/v2`，V2 track 的 `links.stream` / `artwork` / `lyrics` / `wordLyrics` 会重写成本站 REST 代理 URL。
3. 音频 Range、封面和歌词均通过代理返回；上游错误状态保持不变，只有 Tencent `403/404` 音频会进行严格同曲回退。
4. 聚合与单平台搜索统一由 Meting V2 完成，前端直接消费相关度排序后的 `{ data, meta, links }` 响应。
5. 每 IP、每 isolate 有滑动窗口限流，默认 `180` 次/分钟。

## 路由

| Path | 用途 |
|------|------|
| `GET /` | RMusic 单页应用 |
| `GET /widget.css` | 浏览器缓存的应用样式 |
| `GET /widget.js` | 浏览器缓存的应用控制器 |
| `GET /api/proxy/v2/tracks?query=…&source=all` | V2 聚合或单平台搜索 |
| `GET /api/proxy/v2/playlists/{source}/{id}` | V2 歌单详情、创建人、介绍、封面和分页曲目 |
| `GET /api/proxy/v2/streams/{source}/{id}` | V2 音频流代理 |
| `GET /api/proxy/v2/artworks/{source}/{id}` | V2 封面代理 |
| `GET /api/proxy/v2/lyrics/{source}/{id}` | V2 歌词；`granularity=word` 为逐字歌词 |

根路径支持轻量 deep link：

```text
/?q=Lemon
/?q=Lemon&server=netease
/?type=playlist&server=tencent&id=9505357778&name=My%20Playlist
```

### 聚合与单平台搜索

搜索页默认选中“聚合”，通过 `/api/proxy/v2/tracks?query=…&source=all` 让 Meting V2 并发查询平台、容忍单源失败，并按相关度统一排序。

平台栏可切换为 QQ 音乐、网易云、酷狗、汽水音乐、YouTube Music、酷我、百度、Apple Music 或 Spotify。单平台模式只请求所选平台，切换平台会用当前关键词立即重新搜索，选项保存在浏览器本地。也支持 `/?q=关键词&server=soda` 这类 deep link。Spotify 当前需要应用所有者保持 Premium；汽水音乐需要服务端存在有效登录账号。

聚合模式传 `source=all`，单平台模式传具体 `source`。相关度计算、平台状态和分页都以 V2 的 `meta` 为准，Widget 不再维护另一套聚合排序实现，最多请求 80 首。

代理根据 V2 `meta.sources` 返回 `X-RMusic-Sources`，列出本次成功参与的音源。歌曲保留实际 `source`，播放、封面、歌词、收藏和最近播放继续使用对应平台资源。

### Tencent 音频回退

QQ 音乐可能因为会员权益、cookie 状态或 Worker 出口地域限制拒绝全部 vkey。RMusic 为生成的 Tencent 音频 URL 附加非敏感的歌曲名和歌手提示；遇到 `403/404` 时，代理依次搜索网易云和 YouTube Music，只有标题精确匹配（或标题部分匹配且歌手匹配）才返回替代音频。歌手比较允许很小的简繁体字形差异，但不会接受仅仅包含原歌手名字的混合改编结果。

成功回退的响应包含 `X-RMusic-Fallback` 和 `X-RMusic-Original-Server`。无法可靠匹配时仍返回原始 Tencent 错误，避免播放错误的同名歌曲。失败响应使用 `Cache-Control: no-store`，刷新 cookie 后不会继续命中旧 403。

## 环境变量与绑定

| 名字 | 必填 | 说明 |
|------|------|------|
| `MUSIC_API` | 优先 | 指向 Meting-API worker 的 RandallFlare service binding |
| `MUSIC_API_URL` | fallback | 未使用 service binding 时的公网地址，如 `https://music.rapi.rest` |
| `MUSIC_API_TOKEN` | 是 | 与 Meting-API 的 `METING_TOKEN` 相同，仅由 Worker 使用 |
| `RATE_WINDOW_MS` | 否 | 限流窗口，默认 `60000` |
| `RATE_MAX` | 否 | 每个窗口的单 IP 请求上限，默认 `180` |
| `LOG_LEVEL` | 否 | `trace` / `debug` / `info` / `warn` / `error` |

`MUSIC_API` 与 `MUSIC_API_URL` 至少设置一个；两者同时存在时优先走 service binding。

## 在 RandallFlare 部署

1. 控制台连接 `RandallAnjie/Rmusic-Widget` 的 `main` 分支。
2. Build command：`npm install && npm run build`
3. Output file：`dist/_worker.js`
4. 绑定 `MUSIC_API` 到 Meting-API worker。
5. 设置 `MUSIC_API_TOKEN`。

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

歌单快照采用精简曲目结构以节省空间。浏览器的 `localStorage` 配额通常有限；空间不足时页面会保留歌单定义并提示缓存失败。更换域名或清除浏览器站点数据会清空这些本地收藏。
