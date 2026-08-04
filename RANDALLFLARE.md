# RMusic on RandallFlare Workers

## 部署

1. 控制台连接 GitHub 仓库 `RandallAnjie/Rmusic-Widget`，分支 `main`。
2. Build command：`npm install && npm run build`
3. Output file：`dist/_worker.js`
4. 添加 service binding：`MUSIC_API` → Meting-API worker。
5. 添加环境变量：`MUSIC_API_TOKEN`，值与 Meting-API 的 `METING_TOKEN` 一致。

如果两个 worker 不在同一租户，可以不设置 `MUSIC_API`，改用：

```text
MUSIC_API_URL=https://music.rapi.rest
```

可选限流配置：

```text
RATE_WINDOW_MS=60000
RATE_MAX=180
```

## 验证

部署后打开根路径，应看到完整的 RMusic 应用：

- 左侧首页 / 搜索 / 音乐库导航
- 中央内容区和固定底部播放器
- 搜索歌曲后可连续播放整个结果列表
- 通过“添加歌单”输入平台与歌单 ID，可查看并保存在线歌单
- 右侧队列和逐字歌词面板可正常打开

也可以验证 deep link：

```text
/?q=Lemon&server=netease
/?type=playlist&server=tencent&id=9505357778&name=Test
```

## 常见问题

- `neither MUSIC_API service binding nor MUSIC_API_URL is configured`：绑定或 URL 均未设置。
- `MUSIC_API_TOKEN env binding is required`：缺少代理侧 master token。
- `429 rate limit exceeded`：提高 `RATE_MAX`，或检查页面是否发生请求循环。
- Meting-API 返回 401：两个 worker 的 token 不一致。
- 封面或音频 404：对应平台可能没有该资源、歌曲下架或需要有效会员 cookie。
- Tencent 返回 `vkey 全部 quality 都被拒`：通常是 QQ 音乐账号无对应权益、cookie 状态异常或 Worker 出口受地域限制。新版代理会严格匹配同曲后回退到网易云 / YouTube Music；响应头 `X-RMusic-Fallback` 表示实际采用的音源。仍返回 403 时应刷新 Tencent cookie、确认账号会员权益或调整 Meting-API 出口。

浏览器看到的所有资源 URL 都应以本站 `/api/proxy` 开头；如果 Network 面板出现带 Meting `auth` 的跨域 URL，说明 JSON 重写逻辑出现回归。
