# rmusic-widget

一个独立的网页播放器小组件，复刻了 [startpage/demo/music_player](https://github.com/RandallAnjie/startpage/tree/master/demo/music_player) 的视觉风格（旋转唱片、滚动 LRC、模糊封面背景），但把硬编码的单曲换成了对接 [Meting-API](https://github.com/RandallAnjie/Meting-API) 的搜索 + 切歌界面。

整个组件以 [Cloudflare Workers / RandallFlare Workers](https://workers.cloudflare.com) 形式跑：

- 前端（HTML/CSS/JS）由 worker 直接 serve，没有静态站点托管依赖
- 搜索 / 播放 / 歌词全部走同源 `/api/proxy`，避免 token 泄漏给浏览器
- 通过 bigrandall **服务绑定**（service binding）对接 Meting-API worker，operator 不需要在 env 里写完整 URL

## 路由

| Path | 用途 |
|------|------|
| `GET /` | widget HTML |
| `GET /widget.css` | 样式 |
| `GET /widget.js` | 前端控制脚本 |
| `GET /api/proxy?server=…&type=…&id=…` | 转发到 Meting-API。type=search/song/playlist/album/artist 返回 JSON（embedded url/pic/lrc 已重写回本 worker）；type=url 流式音频（Range 透传）；type=pic 302；type=lrc 文本 |

## env binding

| 名字 | 必填 | 说明 |
|------|------|------|
| `MUSIC_API` | 优先 | bigrandall 服务绑定，指向 Meting-API worker。设了之后所有上游调用走绑定，不走公网 |
| `MUSIC_API_URL` | fallback | 当没有绑定时使用的公网地址，例如 `https://music.rapi.rest`。绑定和 URL 至少配一个 |
| `MUSIC_API_TOKEN` | 是 | Meting-API 那边的 `METING_TOKEN`，worker 用它给 search/song/playlist 响应签名。**永远不会泄露到客户端**：注入只在 worker 端发生，浏览器 Network 面板里看不到这个值 |
| `RATE_WINDOW_MS` | 否 | 限流时间窗，默认 60000（60 秒） |
| `RATE_MAX` | 否 | 时间窗内每 IP 最大请求数，默认 60 |
| `LOG_LEVEL` | 否 | trace / debug / info / warn / error，默认 info |

## 在 bigrandall 上部署

1. 控制台 *connect a GitHub repo*，指向 `RandallAnjie/rmusic-widget` 分支 `main`
2. Build config:
   - build command: `npm install && npm run build`
   - output file: `dist/worker.js`
   - compatibility flag: 无（没用 node 内置）
3. Env / service bindings:
   - **service binding** `MUSIC_API` → 已经在跑的 Meting-API worker
   - `MUSIC_API_TOKEN` → 跟 Meting-API 那边 `METING_TOKEN` 一样的值
   - 可选 `RATE_MAX=120` / `RATE_WINDOW_MS=60000` 调限流
4. 部署完打开 `https://<your-worker-host>/` 应该能直接搜歌播放

## 本地构建

```bash
npm install
npm run build        # → dist/worker.js
npm run lint         # oxlint
```

本地跑可以用 `wrangler dev dist/worker.js` 或 `miniflare dist/worker.js`，把 `MUSIC_API_URL` 指向 `https://music.rapi.rest`、`MUSIC_API_TOKEN` 指向你的 token。

## 文件结构

```
src/
├── worker.js          worker 入口（路由分派、CORS、错误兜底）
├── config.js          env → 结构化配置
├── rate-limit.js      滑动窗口 per-IP
├── api-proxy.js       /api/proxy 处理（token 注入 + JSON 重写 + Range 透传）
└── widget/
    ├── index.html
    ├── index.css      （build 时把 disc / pointer PNG base64 内联）
    ├── client.js      前端控制器（搜索 / 播放 / LRC）
    ├── disc.png
    └── pointer.png
build.mjs              esbuild 包装：bundle worker、内联 widget 资源
```

## 不做的事

- 不内置歌单管理 / 收藏功能。要这些自己 fork 加
- 不缓存歌词到 localStorage。每次切歌都重新拉 LRC（worker 那一侧已经 cache 了）
- 不支持移动端非常窄的屏幕上面板自适应到全屏。常规手机能用
