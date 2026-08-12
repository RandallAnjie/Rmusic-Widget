import assert from 'node:assert/strict'
import fs from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'
import worker from '../dist/_worker.js'

const calls = []

function v2Track (overrides = {}) {
  const source = overrides.source || 'netease'
  const id = overrides.id || 'track-1'
  const title = overrides.title || 'Night Drive'
  const artist = overrides.artist || 'RMusic'
  return {
    id,
    source,
    title,
    artists: [{ id: null, name: artist }],
    album: { id: null, name: 'City Lights' },
    durationMs: 213000,
    artwork: {
      url: `https://music.example/api/v2/artworks/${source}/cover-1`,
      originalUrl: 'https://img.example/raw.jpg'
    },
    links: {
      self: `https://music.example/api/v2/tracks/${source}/${id}`,
      stream: `https://music.example/api/v2/streams/${source}/${overrides.audioId || 'audio-1'}?auth=old`,
      artwork: `https://music.example/api/v2/artworks/${source}/cover-1?auth=old`,
      lyrics: `https://music.example/api/v2/lyrics/${source}/lyric-1`,
      wordLyrics: `https://music.example/api/v2/lyrics/${source}/lyric-1?granularity=word&auth=old`
    },
    relevance: overrides.relevance || 1000
  }
}

const fixture = v2Track()
const traditionalFixture = v2Track({ title: '晴天', artist: '周杰倫' })
const pollutedFixture = v2Track({ title: 'Unsafe', artist: 'Artist / DJ Foo' })

function envelope (data, meta = {}) {
  return { data, meta: { apiVersion: '2', ...meta } }
}

function searchResponse (url) {
  const query = url.searchParams.get('query')
  const source = url.searchParams.get('source') || 'all'
  if (query === 'Night Drive') {
    if (source === 'all') {
      return Response.json(envelope([
        fixture,
        v2Track({ source: 'tencent', id: 'live-1', audioId: 'live-audio', title: 'Night Drive (Live)', relevance: 800 })
      ], {
        query,
        source: 'all',
        sources: [
          { source: 'netease', status: 'fulfilled', count: 1 },
          { source: 'tencent', status: 'fulfilled', count: 1 },
          { source: 'spotify', status: 'rejected', count: 0, httpStatus: 503 }
        ]
      }))
    }
    return Response.json(envelope([{ ...fixture, source, links: v2Track({ source }).links }], {
      query,
      source: [source],
      sources: [{ source, status: 'fulfilled', count: 1 }]
    }))
  }
  if (query === '晴天 周杰伦') return Response.json(envelope([traditionalFixture]))
  if (query === 'Unsafe Artist') return Response.json(envelope([pollutedFixture]))
  return Response.json(envelope([fixture], {
    query,
    sources: [{ source: source === 'all' ? 'netease' : source, status: 'fulfilled', count: 1 }]
  }))
}

const env = {
  MUSIC_API_TOKEN: 'server-only-secret',
  RATE_MAX: '1000',
  MUSIC_API: {
    async fetch (input, init) {
      const url = new URL(input)
      calls.push({ url, init })
      assert.match(url.pathname, /^\/api\/v2(?:\/|$)/)
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer server-only-secret')
      assert.equal(url.searchParams.has('token'), false)

      if (url.pathname === '/api/v2/sources') {
        return Response.json(envelope([
          { id: 'netease', capabilities: ['search', 'playlist'], links: { self: 'https://music.example/api/v2/sources/netease' } }
        ], { total: 1 }))
      }
      if (url.pathname === '/api/v2/tracks') return searchResponse(url)
      if (url.pathname.startsWith('/api/v2/playlists/')) {
        const parts = url.pathname.split('/')
        const source = parts[4]
        if (source === 'aggregate') return Response.json({ status: 400 }, { status: 400 })
        return Response.json(envelope({
          id: parts[5],
          source,
          name: 'Midnight Drive Collection',
          cover: 'https://img.example/playlist.jpg',
          description: 'A city-pop playlist from the V2 resource.',
          creator: { id: 'creator-1', name: 'Randall', avatar: null, role: 'owner' },
          stats: { trackCount: 1, playCount: 42, followerCount: 3 },
          tracks: { items: [{ ...fixture, source, links: v2Track({ source }).links }], total: 1, offset: 0, limit: 100, hasMore: false }
        }))
      }
      if (url.pathname.startsWith('/api/v2/artworks/')) {
        return new Response(null, { status: 302, headers: { location: 'https://img.example/cover.jpg' } })
      }
      if (url.pathname.startsWith('/api/v2/streams/')) {
        const source = url.pathname.split('/')[4]
        if (source === 'tencent') {
          return Response.json({ status: 403, detail: 'vkey empty', apiVersion: '2' }, { status: 403 })
        }
        const range = new Headers(init.headers).get('range')
        return new Response('audio', {
          status: range ? 206 : 200,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-4/5',
            'accept-ranges': 'bytes'
          }
        })
      }
      if (url.pathname.startsWith('/api/v2/lyrics/')) {
        return new Response('[00:00.00]Night Drive', { headers: { 'content-type': 'text/plain' } })
      }
      if (url.pathname === '/api/v2' || url.pathname === '/api/v2/') {
        return Response.json(envelope({ name: 'Meting REST API', version: '2' }))
      }
      return Response.json({ status: 404, detail: 'not found' }, { status: 404 })
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
assert.match(html, /id="mobile-now-cover"/)
assert.match(html, /id="home-now-card"/)
assert.match(html, /id="refreshCollection"/)
assert.match(html, /id="collection-cache-status"/)
assert.doesNotMatch(html, /server-only-secret/)

const sourceHtml = fs.readFileSync(new URL('../src/widget/index.html', import.meta.url), 'utf8')
const clientSource = fs.readFileSync(new URL('../src/widget/client.js', import.meta.url), 'utf8')
const sourceCss = fs.readFileSync(new URL('../src/widget/index.css', import.meta.url), 'utf8')
const proxySource = fs.readFileSync(new URL('../src/api-proxy.js', import.meta.url), 'utf8')
const htmlIds = [...sourceHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
assert.equal(new Set(htmlIds).size, htmlIds.length, 'HTML must not contain duplicate IDs')
const referencedIds = [...clientSource.matchAll(/(?<!\$)\$\('([^']+)'\)/g)].map((match) => match[1])
for (const id of referencedIds) assert.ok(htmlIds.includes(id), `client references missing #${id}`)
assert.match(sourceCss, /@media \(max-width: 900px\)/)
assert.match(sourceCss, /@media \(max-width: 780px\)/)
assert.match(sourceCss, /env\(safe-area-inset-bottom\)/)
assert.match(sourceCss, /@keyframes mobile-player-enter/)
assert.match(sourceCss, /\.mobile-now-stage/)
assert.match(sourceCss, /\.home-now-card/)
assert.doesNotMatch(sourceHtml, /id="server"/)
assert.doesNotMatch(sourceHtml, /id="playlist-server"/)
assert.doesNotMatch(sourceHtml, /id="playlist-name"|显示名称/)
assert.match(clientSource, /const API = '\/api\/proxy\/v2'/)
assert.match(clientSource, /async function searchV2/)
assert.match(clientSource, /async function fetchPlaylistV2/)
assert.match(clientSource, /function migrateLegacyResourceUrl/)
assert.match(clientSource, /playlistCachePrefix: 'rmusic_playlist_cache_v1:'/)
assert.match(clientSource, /function readPlaylistCache/)
assert.match(clientSource, /function writePlaylistCache/)
assert.match(clientSource, /els\.refreshCollection\.addEventListener\('click'/)
assert.doesNotMatch(clientSource, /progressiveSearch|platformSearch|type=search|server=/)
assert.doesNotMatch(proxySource, /\/api\?server=|type=url|type=search/)
assert.match(sourceHtml, /role="radiogroup" aria-label="选择搜索平台"/)
for (const server of ['aggregate', 'tencent', 'netease', 'kugou', 'soda', 'ytmusic', 'kuwo', 'baidu', 'apple', 'spotify']) {
  assert.match(sourceHtml, new RegExp(`data-search-server="${server}"`), `search picker missing ${server}`)
}
const motionDeclarations = sourceCss.match(/\b(?:animation|transition)\s*:[^;]+;/g) || []
for (const declaration of motionDeclarations) {
  assert.match(declaration, /var\(--curve-|cubic-bezier\(|:\s*none/, `motion must use a cubic-bezier curve: ${declaration}`)
  assert.doesNotMatch(declaration, /\b(?:ease|ease-in|ease-out|ease-in-out|linear)\b/, `motion must not use a timing keyword: ${declaration}`)
}

const css = await request('/widget.css')
assert.match(css.headers.get('content-type'), /text\/css/)
assert.match(await css.text(), /\.app-shell/)

const assetHash = html.match(/widget\.css\?v=([a-f0-9]+)/)?.[1]
assert.ok(assetHash)
const compressedCss = await request(`/widget.css?v=${assetHash}`, { headers: { 'accept-encoding': 'br' } })
assert.equal(compressedCss.headers.get('content-encoding'), 'br')
assert.match(compressedCss.headers.get('cache-control'), /max-age=31536000/)
assert.match(compressedCss.headers.get('cache-control'), /immutable/)
const cssEtag = compressedCss.headers.get('etag')
assert.ok(cssEtag)
assert.match(brotliDecompressSync(Buffer.from(await compressedCss.arrayBuffer())).toString(), /\.app-shell/)
const freshCss = await request(`/widget.css?v=${assetHash}`, { headers: { 'if-none-match': cssEtag } })
assert.equal(freshCss.status, 304)

const js = await request('/widget.js')
assert.match(js.headers.get('content-type'), /javascript/)
assert.match(await js.text(), /rmusic_favorites_v2/)

const search = await request('/api/proxy/v2/tracks?query=Night%20Drive&source=netease')
assert.equal(search.status, 200)
assert.equal(search.headers.get('x-rmusic-api-version'), '2')
const searchEnvelope = await search.json()
const [track] = searchEnvelope.data
assert.equal(track.album.name, 'City Lights')
assert.equal(track.durationMs, 213000)
assert.equal(track.source, 'netease')
assert.equal(track.links.stream, '/api/proxy/v2/streams/netease/audio-1')
assert.equal(track.links.artwork, '/api/proxy/v2/artworks/netease/cover-1')
assert.equal(track.links.lyrics, '/api/proxy/v2/lyrics/netease/lyric-1')
assert.equal(track.links.wordLyrics, '/api/proxy/v2/lyrics/netease/lyric-1?granularity=word')

const sources = await request('/api/proxy/v2/sources')
assert.equal(sources.status, 200)
const [source] = (await sources.json()).data
assert.equal(source.id, 'netease')
assert.deepEqual(source.capabilities, ['search', 'playlist'])
assert.equal(source.links.self, '/api/proxy/v2/sources/netease')
assert.equal(source.links.stream, undefined)

const tencentSearch = await request('/api/proxy/v2/tracks?query=Night%20Drive&source=tencent')
const [tencentTrack] = (await tencentSearch.json()).data
assert.equal(tencentTrack.links.stream, '/api/proxy/v2/streams/tencent/audio-1?title=Night+Drive&author=RMusic')

const aggregateSearch = await request('/api/proxy/v2/tracks?query=Night%20Drive&source=all&limit=80')
assert.equal(aggregateSearch.status, 200)
assert.equal(aggregateSearch.headers.get('x-rmusic-sources'), 'netease,tencent')
const aggregateTracks = (await aggregateSearch.json()).data
assert.equal(aggregateTracks[0].title, 'Night Drive')
assert.equal(aggregateTracks[1].title, 'Night Drive (Live)')

const playlist = await request('/api/proxy/v2/playlists/netease/3778678?offset=0&limit=100')
assert.equal(playlist.status, 200)
const playlistData = (await playlist.json()).data
assert.equal(playlistData.name, 'Midnight Drive Collection')
assert.equal(playlistData.creator.name, 'Randall')
assert.match(playlistData.description, /V2 resource/)
assert.equal(playlistData.cover, 'https://img.example/playlist.jpg')
assert.equal(playlistData.tracks.items[0].links.stream, '/api/proxy/v2/streams/netease/audio-1')

const lyrics = await request(track.links.wordLyrics)
assert.equal(lyrics.status, 200)
assert.match(await lyrics.text(), /Night Drive/)
assert.equal(calls.at(-1).url.searchParams.get('granularity'), 'word')

const audio = await request(track.links.stream, { headers: { range: 'bytes=0-4' } })
assert.equal(audio.status, 206)
assert.equal(audio.headers.get('accept-ranges'), 'bytes')
assert.equal(new Headers(calls.at(-1).init.headers).get('range'), 'bytes=0-4')

const recoveryCallStart = calls.length
const recovered = await request('/api/proxy/v2/streams/tencent/blocked?title=Night+Drive&author=RMusic', { headers: { range: 'bytes=0-4' } })
assert.equal(recovered.status, 206)
assert.equal(recovered.headers.get('x-rmusic-fallback'), 'netease')
assert.equal(recovered.headers.get('x-rmusic-original-server'), 'tencent')
assert.match(recovered.headers.get('access-control-expose-headers'), /X-RMusic-Fallback/i)
assert.equal(await recovered.text(), 'audio')
const recoveryPaths = calls.slice(recoveryCallStart).map(({ url }) => url.pathname)
assert.deepEqual(recoveryPaths, [
  '/api/v2/streams/tencent/blocked',
  '/api/v2/tracks',
  '/api/v2/streams/netease/audio-1'
])

const traditionalRecovery = await request('/api/proxy/v2/streams/tencent/blocked?title=%E6%99%B4%E5%A4%A9&author=%E5%91%A8%E6%9D%B0%E4%BC%A6')
assert.equal(traditionalRecovery.status, 200)
assert.equal(traditionalRecovery.headers.get('x-rmusic-fallback'), 'netease')

const pollutedRecovery = await request('/api/proxy/v2/streams/tencent/blocked?title=Unsafe&author=Artist')
assert.equal(pollutedRecovery.status, 403)
assert.equal(pollutedRecovery.headers.get('x-rmusic-fallback'), null)

const unrecoverable = await request('/api/proxy/v2/streams/tencent/blocked-without-metadata')
assert.equal(unrecoverable.status, 403)
assert.equal(unrecoverable.headers.get('cache-control'), 'no-store')

console.log('smoke: V2 REST search, playlist metadata, lyrics, media proxy and fallback passed')
