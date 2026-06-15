# rmusic-widget on RandallFlare Workers

跟 Meting-API 的 worker 流程一样：仓库连进控制台、build、配 env 就完事。

## 部署步骤

1. 控制台 *connect a GitHub repo* → 选 `RandallAnjie/rmusic-widget`，分支 `main`，用 Deploy Key
2. **Build config**
   - build command: `npm install && npm run build`
   - output file: `dist/worker.js`
   - 不需要 `nodejs_compat`（这个 worker 没用 `node:` 任何东西）
3. **Service binding**
   - 在 worker 的 *Bindings* 面板里加：
     - **Service binding**: 名字 `MUSIC_API`, 指向 `meting-api` worker
   - 这一步是核心，配了之后 `env.MUSIC_API.fetch(…)` 直接在 bigrandall plane 内部调用 Meting-API，不出公网，也不需要在 env 里写 URL
4. **Env bindings**
   - `MUSIC_API_TOKEN` → 跟 Meting-API 的 `METING_TOKEN` 同值
   - 可选：`RATE_MAX`、`RATE_WINDOW_MS`、`LOG_LEVEL`

## 不用 service binding 时

如果 Meting-API 在另一个 bigrandall 租户或者外部 worker：

- 跳过 `MUSIC_API` 那一行
- 加 env `MUSIC_API_URL` = `https://music.rapi.rest`（或者你的 Meting-API 部署地址）
- 其他不变

worker 在 `src/api-proxy.js:callUpstream` 里检查 `config.musicApi.binding`，绑定有就走 `.fetch()`，没有就 fallback 到 `fetch(MUSIC_API_URL + path)`。

## 验证

部署完打开 `https://<your-worker-host>/`：

- 看见旋转唱片 + 右上角 ⌕ 按钮 + 「RMusic widget」左下角标 → 静态资源 OK
- 点 ⌕ 展开搜索面板，默认 server = YouTube Music
- 随便搜个词，按回车
- 出结果点一条 → 唱片转起来 + LRC 滚 + 背景换成封面 → 全链路 OK

如果搜索失败，看 worker log tail（或者直接看响应 body 的 4xx/5xx）：

- `rmusic-widget: neither MUSIC_API service binding nor MUSIC_API_URL is configured` → 绑定 / URL 漏了
- `rmusic-widget: MUSIC_API_TOKEN env binding is required` → token 漏了
- `429 rate limit exceeded` → `RATE_MAX` 太低，或者你确实手很快
- Meting-API 返回的 401（body 里 `tkn=… recv=… exp=…`）→ 你这边 `MUSIC_API_TOKEN` 跟 Meting-API 的 `METING_TOKEN` 不一致

## 一些设计选择，免得日后看代码犯迷糊

- 搜索 / 切歌 UI 收在右上角面板里，不破坏唱片 + LRC 的主画面（user 的明确要求）
- token **不**通过 query 或 cookie 透到浏览器。worker 在 `api-proxy.js:callUpstream` 里给每个上游请求 `usp.set('token', config.musicApi.token)`，浏览器永远只看见自己 origin 的 URL，看不到上游 auth
- search/song/playlist 响应的 JSON 里 `url`/`pic`/`lrc` 在 worker 这边重写过，去掉了 Meting-API 的 `&auth=` 参数（那是 Meting-API 的 HMAC，对我们无意义），改成指向自己 `/api/proxy` 的 URL。客户端只跟自己 origin 打交道
- 限流是 per-isolate 滑动窗口。bigrandall 把流量分到多个 isolate 上时一个用户的实际配额是 `RATE_MAX × isolate 数`，对普通用户够用，对手脚有点活泛的对手不够用 —— 那种场景该上 CDN-层规则
