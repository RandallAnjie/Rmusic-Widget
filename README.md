# RMusic

RMusic 是一个部署在 Cloudflare Workers / RandallFlare Workers 上的完整网页音乐播放器。它保留了原版 widget 的多平台搜索、连续播放、逐字歌词和 Media Session 能力，并升级成类似 Spotify 的单页应用：

- 首页、搜索、音乐库和歌单详情四类视图
- 搜索结果或完整歌单作为连续播放队列
- 队列、随机播放、列表/单曲循环、进度和音量控制
- 标准 LRC + Enhanced LRC 逐字歌词
- 喜欢的歌曲、最近播放和保存的在线歌单
- 桌面端三栏布局，移动端底部导航和紧凑播放器
- OS 锁屏 / 蓝牙耳机 / 系统媒体控件（Media Session）

所有收藏数据只保存在浏览器 `localStorage`。在线歌单仅保存平台、歌单 ID 与名称，打开时实时请求最新曲目。

## 安全模型

前端只访问同源 `/api/proxy`：

1. Worker 在服务端注入 `MUSIC_API_TOKEN`；浏览器永远看不到 master token。
2. Meting-API 返回的 `url` / `pic` / `lrc` / `lrcpword` 会重写成本站代理 URL。
3. 音频 Range、封面和歌词均通过代理返回；上游错误状态保持不变。
4. 每 IP、每 isolate 有滑动窗口限流，默认 `180` 次/分钟。

## 路由

| Path | 用途 |
|------|------|
| `GET /` | RMusic 单页应用 |
| `GET /widget.css` | 浏览器缓存的应用样式 |
| `GET /widget.js` | 浏览器缓存的应用控制器 |
| `GET /api/proxy?server=…&type=…&id=…` | Meting-API 安全代理 |

根路径支持轻量 deep link：

```text
/?q=Lemon&server=netease
/?type=playlist&server=tencent&id=9505357778&name=My%20Playlist
```

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

构建会把 HTML、CSS、JS 内联进单个 `dist/_worker.js`，同时把内容 hash 写入静态资源 URL，避免部署后 HTML 与旧缓存资源不匹配。

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

- 音源选择
- 音量、随机与循环模式
- 最近播放（最多 30 首）
- 喜欢的歌曲（最多 200 首）
- 保存的在线歌单（最多 60 个）

更换域名或清除浏览器站点数据会清空这些本地收藏。
