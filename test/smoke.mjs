import assert from 'node:assert/strict'
import fs from 'node:fs'
import worker from '../dist/_worker.js'

const calls = []
const fixture = [{
  id: 'track-1',
  title: 'Night Drive',
  author: 'RMusic',
  album: 'City Lights',
  duration_ms: 213000,
  url: 'https://music.example/api?server=netease&type=url&id=audio-1&auth=old',
  pic: '/api?server=netease&type=pic&id=cover-1&auth=old',
  lrc: 'https://music.example/api?server=netease&type=lrc&id=lyric-1',
  lrcpword: 'https://music.example/api?server=netease&type=lrcpword&id=word-1&auth=old'
}]
const traditionalFixture = [{ ...fixture[0], title: '晴天', author: '周杰倫' }]
const pollutedFixture = [{ ...fixture[0], title: 'Unsafe', author: 'Artist / DJ Foo' }]

const env = {
  MUSIC_API_TOKEN: 'server-only-secret',
  RATE_MAX: '1000',
  MUSIC_API: {
    async fetch (input, init) {
      const url = new URL(input)
      calls.push({ url, init })
      const type = url.searchParams.get('type')
      const server = url.searchParams.get('server')
      if (['search', 'playlist'].includes(type)) {
        if (type === 'search' && url.searchParams.get('id') === 'Night Drive') {
          if (server === 'netease') return Response.json(fixture)
          if (server === 'tencent') return Response.json([{ ...fixture[0], title: 'Night Drive (Live)', url: 'https://music.example/api?server=tencent&type=url&id=live-1' }])
          if (server === 'kugou') return Response.json([{ ...fixture[0], title: 'Drive', author: 'Night', url: 'https://music.example/api?server=kugou&type=url&id=loose-1' }])
          if (server === 'spotify') return Response.json({ error: true }, { status: 403 })
          return Response.json([])
        }
        if (url.searchParams.get('id') === '晴天 周杰伦') return Response.json(traditionalFixture)
        if (url.searchParams.get('id') === 'Unsafe Artist') return Response.json(pollutedFixture)
        return Response.json(fixture)
      }
      if (type === 'pic') {
        return new Response(null, { status: 302, headers: { location: 'https://img.example/cover.jpg' } })
      }
      if (type === 'url') {
        if (server === 'tencent') {
          return Response.json({ error: true, status: 403, message: 'vkey empty' }, { status: 403 })
        }
        return new Response('audio', {
          status: init.headers.range ? 206 : 200,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-4/5',
            'accept-ranges': 'bytes'
          }
        })
      }
      return new Response('[00:00.00]Night Drive', { headers: { 'content-type': 'text/plain' } })
    }
  }
}

const request = (path, init) => worker.fetch(new Request('https://rmusic.test' + path, init), env)

const home = await request('/')
assert.equal(home.status, 200)
const html = await home.text()
assert.match(html, /id="view-home"/)
assert.match(html, /id="view-library"/)
assert.match(html, /id="context-panel"/)
assert.doesNotMatch(html, /server-only-secret/)

const sourceHtml = fs.readFileSync(new URL('../src/widget/index.html', import.meta.url), 'utf8')
const clientSource = fs.readFileSync(new URL('../src/widget/client.js', import.meta.url), 'utf8')
const sourceCss = fs.readFileSync(new URL('../src/widget/index.css', import.meta.url), 'utf8')
const htmlIds = [...sourceHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
assert.equal(new Set(htmlIds).size, htmlIds.length, 'HTML must not contain duplicate IDs')
const referencedIds = [...clientSource.matchAll(/(?<!\$)\$\('([^']+)'\)/g)].map((match) => match[1])
for (const id of referencedIds) assert.ok(htmlIds.includes(id), `client references missing #${id}`)
assert.match(sourceCss, /@media \(max-width: 900px\)/)
assert.match(sourceCss, /@media \(max-width: 780px\)/)
assert.match(sourceCss, /env\(safe-area-inset-bottom\)/)
assert.match(sourceCss, /@keyframes mobile-player-enter/)
assert.doesNotMatch(sourceHtml, /id="server"/)
assert.doesNotMatch(sourceHtml, /id="playlist-server"/)
const motionDeclarations = sourceCss.match(/\b(?:animation|transition)\s*:[^;]+;/g) || []
for (const declaration of motionDeclarations) {
  assert.match(declaration, /var\(--curve-|cubic-bezier\(|:\s*none/, `motion must use a cubic-bezier curve: ${declaration}`)
  assert.doesNotMatch(declaration, /\b(?:ease|ease-in|ease-out|ease-in-out|linear)\b/, `motion must not use a timing keyword: ${declaration}`)
}

const css = await request('/widget.css')
assert.match(css.headers.get('content-type'), /text\/css/)
assert.match(await css.text(), /\.app-shell/)

const js = await request('/widget.js')
assert.match(js.headers.get('content-type'), /javascript/)
assert.match(await js.text(), /rmusic_favorites_v2/)

const search = await request('/api/proxy?server=netease&type=search&id=night')
assert.equal(search.status, 200)
const [track] = await search.json()
assert.equal(track.album, 'City Lights')
assert.equal(track.duration_ms, 213000)
assert.equal(track.server, 'netease')
assert.equal(track.url, '/api/proxy?server=netease&type=url&id=audio-1')
assert.equal(track.pic, '/api/proxy?server=netease&type=pic&id=cover-1')
assert.equal(track.lrc, '/api/proxy?server=netease&type=lrc&id=lyric-1')
assert.equal(track.lrcpword, '/api/proxy?server=netease&type=lrcpword&id=word-1')
assert.equal(calls.at(-1).url.searchParams.get('token'), 'server-only-secret')

const tencentSearch = await request('/api/proxy?server=tencent&type=search&id=night')
const [tencentTrack] = await tencentSearch.json()
assert.equal(tencentTrack.url, '/api/proxy?server=tencent&type=url&id=audio-1&title=Night+Drive&author=RMusic')

const aggregateCallStart = calls.length
const aggregateSearch = await request('/api/proxy?type=search&id=Night%20Drive')
assert.equal(aggregateSearch.status, 200)
assert.match(aggregateSearch.headers.get('x-rmusic-sources'), /tencent/)
assert.match(aggregateSearch.headers.get('x-rmusic-sources'), /netease/)
assert.doesNotMatch(aggregateSearch.headers.get('x-rmusic-sources'), /spotify/)
const aggregateTracks = await aggregateSearch.json()
assert.equal(aggregateTracks[0].title, 'Night Drive')
assert.equal(aggregateTracks[0].server, 'netease')
assert.equal(aggregateTracks[1].title, 'Night Drive (Live)')
const aggregateCalls = calls.slice(aggregateCallStart)
assert.ok(aggregateCalls.length >= 8)
assert.ok(aggregateCalls.every(({ url }) => url.searchParams.get('token') === 'server-only-secret'))

const aggregatePlaylist = await request('/api/proxy?server=aggregate&type=playlist&id=3778678')
assert.equal(aggregatePlaylist.status, 200)
assert.equal(aggregatePlaylist.headers.get('x-rmusic-sources'), 'netease')
assert.equal((await aggregatePlaylist.json())[0].server, 'netease')

const lyrics = await request(track.lrcpword)
assert.equal(lyrics.status, 200)
assert.match(await lyrics.text(), /Night Drive/)
assert.equal(calls.at(-1).url.searchParams.get('type'), 'lrcpword')
assert.equal(calls.at(-1).url.searchParams.get('token'), 'server-only-secret')

const audio = await request(track.url, { headers: { range: 'bytes=0-4' } })
assert.equal(audio.status, 206)
assert.equal(audio.headers.get('accept-ranges'), 'bytes')
assert.equal(calls.at(-1).init.headers.range, 'bytes=0-4')

const recoveryCallStart = calls.length
const recovered = await request('/api/proxy?server=tencent&type=url&id=blocked&title=Night+Drive&author=RMusic', { headers: { range: 'bytes=0-4' } })
assert.equal(recovered.status, 206)
assert.equal(recovered.headers.get('x-rmusic-fallback'), 'netease')
assert.equal(recovered.headers.get('x-rmusic-original-server'), 'tencent')
assert.match(recovered.headers.get('access-control-expose-headers'), /X-RMusic-Fallback/i)
assert.equal(await recovered.text(), 'audio')
const recoveryCalls = calls.slice(recoveryCallStart).map(({ url }) => [
  url.searchParams.get('server'),
  url.searchParams.get('type'),
  url.searchParams.get('id')
])
assert.deepEqual(recoveryCalls, [
  ['tencent', 'url', 'blocked'],
  ['netease', 'search', 'Night Drive RMusic'],
  ['netease', 'url', 'audio-1']
])
assert.ok(calls.slice(recoveryCallStart).every(({ url }) => url.searchParams.get('token') === 'server-only-secret'))

const traditionalRecovery = await request('/api/proxy?server=tencent&type=url&id=blocked&title=%E6%99%B4%E5%A4%A9&author=%E5%91%A8%E6%9D%B0%E4%BC%A6')
assert.equal(traditionalRecovery.status, 200)
assert.equal(traditionalRecovery.headers.get('x-rmusic-fallback'), 'netease')

const pollutedRecovery = await request('/api/proxy?server=tencent&type=url&id=blocked&title=Unsafe&author=Artist')
assert.equal(pollutedRecovery.status, 403)
assert.equal(pollutedRecovery.headers.get('x-rmusic-fallback'), null)

const unrecoverable = await request('/api/proxy?server=tencent&type=url&id=blocked-without-metadata')
assert.equal(unrecoverable.status, 403)
assert.equal(unrecoverable.headers.get('cache-control'), 'no-store')

console.log('smoke: app shell, metadata rewrite, lyrics, audio proxy and Tencent fallback passed')
