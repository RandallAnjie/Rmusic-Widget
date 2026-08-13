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
    playback: {
      available: true,
      previewOnly: false,
      requiresSubscription: false,
      qualities: [{ id: 'high', label: '高品质', available: true }]
    },
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
      const headers = new Headers(init.headers)
      const authenticated =
        headers.get('authorization') === 'Bearer server-only-secret' ||
        headers.get('x-meting-token') === 'server-only-secret' ||
        url.searchParams.get('token') === 'server-only-secret'
      if (!authenticated) {
        return Response.json({
          type: 'about:blank',
          title: 'HTTPException',
          status: 401,
          detail: 'V2 API 需要 token',
          apiVersion: '2'
        }, {
          status: 401,
          headers: {
            'content-type': 'application/problem+json',
            'www-authenticate': 'Bearer realm="Meting API V2"',
            'cache-control': 'no-store'
          }
        })
      }

      if (url.pathname === '/api/v2/sources') {
        return Response.json(envelope([
          { id: 'netease', capabilities: ['search', 'playlist'], links: { self: 'https://music.example/api/v2/sources/netease' } }
        ], { total: 1 }))
      }
      if (url.pathname === '/api/v2/tracks') return searchResponse(url)
      if (url.pathname === '/api/v2/tracks/netease') {
        return Response.json(envelope([fixture], { requested: 1, total: 1, missing: [] }))
      }
      if (url.pathname === '/api/v2/discovery') {
        if (headers.get('if-none-match') === '"discovery-etag"') {
          return new Response(null, { status: 304, headers: { etag: '"discovery-etag"' } })
        }
        return Response.json(envelope({
          recommendations: [fixture],
          charts: [v2Track({ source: 'tencent', id: 'chart-1', audioId: 'chart-audio' })],
          newReleases: [v2Track({ id: 'fresh-1', audioId: 'fresh-audio' })]
        }, { generatedAt: '2026-08-12T00:00:00.000Z' }), {
          headers: { etag: '"discovery-etag"', 'x-cache-source': 'd1-v2-hit', age: '12' }
        })
      }
      if (url.pathname.startsWith('/api/v2/albums/') || url.pathname.startsWith('/api/v2/artists/')) {
        const parts = url.pathname.split('/')
        const source = parts[4]
        const id = parts[5]
        if (parts[6] === 'albums') {
          return Response.json(envelope([{
            id: 'album-1', source, type: 'album', name: 'Artist Album',
            releaseDate: '2025-06-01T00:00:00.000Z', albumType: 'album',
            artwork: { url: 'https://img.example/album.jpg' }, stats: { trackCount: 12 },
            links: { self: `https://music.example/api/v2/albums/${source}/album-1` }
          }], { total: 1 }))
        }
        if (parts.length > 6) return Response.json(envelope([v2Track({ source })], { total: 1 }))
        return Response.json(envelope({
          id,
          source,
          name: 'Complete catalog resource',
          links: {
            tracks: `https://music.example${url.pathname}/${url.pathname.includes('/artists/') ? 'top-tracks' : 'tracks'}`,
            ...(url.pathname.includes('/artists/') ? { albums: `https://music.example${url.pathname}/albums` } : {})
          },
          tracks: { items: [v2Track({ source })], total: 1, offset: 0, limit: 100, hasMore: false }
        }))
      }
      if (url.pathname.startsWith('/api/v2/playlists/')) {
        const parts = url.pathname.split('/')
        const source = parts[4]
        if (source === 'aggregate') return Response.json({ status: 400 }, { status: 400 })
        const autoDetect = parts[5] === 'auto-qq'
        const detectedTrackCount = autoDetect && source !== 'tencent' ? 0 : 1
        return Response.json(envelope({
          id: parts[5],
          source,
          name: autoDetect && source === 'tencent' ? 'Detected QQ Collection' : 'Midnight Drive Collection',
          cover: 'https://img.example/playlist.jpg',
          description: 'A city-pop playlist from the V2 resource.',
          creator: { id: 'creator-1', name: 'Randall', avatar: null, role: 'owner' },
          stats: { trackCount: detectedTrackCount, playCount: 42, followerCount: 3 },
          tracks: {
            items: detectedTrackCount ? [{ ...fixture, source, links: v2Track({ source }).links }] : [],
            total: detectedTrackCount,
            offset: 0,
            limit: 100,
            hasMore: false
          }
        }))
      }
      if (url.pathname.startsWith('/api/v2/artworks/')) {
        return new Response(null, { status: 302, headers: { location: 'https://img.example/cover.jpg' } })
      }
      if (url.pathname.startsWith('/api/v2/streams/')) {
        if (url.pathname.endsWith('/options')) {
          return Response.json(envelope({
            track: { id: 'audio-1', source: 'netease' },
            available: true,
            qualities: [{ id: 'high', label: '高品质', available: true }]
          }))
        }
        const source = url.pathname.split('/')[4]
        if (source === 'tencent') {
          return Response.json({ status: 403, detail: 'vkey empty', apiVersion: '2' }, { status: 403 })
        }
        if (url.pathname.endsWith('/flac-audio')) {
          const body = new TextEncoder().encode('fLaC-v2-audio')
          return new Response(body, {
            headers: {
              'content-type': 'audio/mpeg; charset=UTF-8',
              'content-length': String(body.byteLength),
              'accept-ranges': 'bytes',
              'x-meting-quality': 'auto'
            }
          })
        }
        const range = new Headers(init.headers).get('range')
        return new Response('audio', {
          status: range ? 206 : 200,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-4/5',
            'accept-ranges': 'bytes',
            'x-meting-quality': url.searchParams.get('quality') || 'auto',
            'x-meting-bitrate-kbps': '320'
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
assert.match(html, /id="artist-albums"/)
assert.match(html, /id="discovery-recommendations"/)
assert.match(html, /id="discovery-charts"/)
assert.match(html, /id="discovery-new-releases"/)
assert.match(html, /id="quality"/)
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
assert.doesNotMatch(sourceHtml, /id="playlist-save"/)
assert.doesNotMatch(sourceHtml, /id="playlist-name"|显示名称/)
assert.match(sourceHtml, /无需选择平台/)
assert.match(sourceHtml, /完整曲目会直接保存到本机/)
assert.match(clientSource, /const API = '\/api\/proxy\/v2'/)
assert.match(clientSource, /async function searchV2/)
assert.match(clientSource, /async function fetchPlaylistV2/)
assert.match(clientSource, /async function loadDiscovery/)
assert.match(clientSource, /async function loadCatalog/)
assert.match(clientSource, /mode: 'fast'/)
assert.match(clientSource, /view: 'compact'/)
assert.match(clientSource, /refresh: 'true'/)
assert.match(clientSource, /function migrateLegacyResourceUrl/)
assert.match(clientSource, /playlistCachePrefix: 'rmusic_playlist_cache_v1:'/)
assert.match(clientSource, /function readPlaylistCache/)
assert.match(clientSource, /function writePlaylistCache/)
assert.match(clientSource, /savePlaylistDefinition\(loaded\)/)
assert.doesNotMatch(clientSource, /playlistSave|playlist-save|shouldSave/)
assert.match(clientSource, /els\.refreshCollection\.addEventListener\('click'/)
assert.doesNotMatch(clientSource, /progressiveSearch|platformSearch|type=search|server=/)
assert.doesNotMatch(proxySource, /\/api\?server=|type=url|type=search/)
assert.doesNotMatch(proxySource, /resolveAudioFallback|AUDIO_FALLBACK_SOURCES|x-rmusic-fallback/i)
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

const directUnauthenticated = await request('/api/v2/sources')
assert.equal(directUnauthenticated.status, 401)
assert.match(directUnauthenticated.headers.get('www-authenticate'), /^Bearer/)
assert.equal((await directUnauthenticated.json()).apiVersion, '2')
assert.equal(new Headers(calls.at(-1).init.headers).has('authorization'), false)

const directBearer = await request('/api/v2/sources', {
  headers: { authorization: 'Bearer server-only-secret' }
})
assert.equal(directBearer.status, 200)
const directSource = (await directBearer.json()).data[0]
assert.equal(directSource.links.self, 'https://rmusic.test/api/v2/sources/netease')
assert.equal(new Headers(calls.at(-1).init.headers).get('authorization'), 'Bearer server-only-secret')

const directHeaderToken = await request('/api/v2/sources', {
  headers: { 'x-meting-token': 'server-only-secret' }
})
assert.equal(directHeaderToken.status, 200)

const directQueryToken = await request('/api/v2?token=server-only-secret')
assert.equal(directQueryToken.status, 200)
assert.equal(calls.at(-1).url.searchParams.get('token'), 'server-only-secret')

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
assert.equal(tencentTrack.links.stream, '/api/proxy/v2/streams/tencent/audio-1')

const aggregateSearch = await request('/api/proxy/v2/tracks?query=Night%20Drive&source=all&limit=80')
assert.equal(aggregateSearch.status, 200)
assert.equal(aggregateSearch.headers.get('x-rmusic-sources'), 'netease,tencent')
const aggregateTracks = (await aggregateSearch.json()).data
assert.equal(aggregateTracks[0].title, 'Night Drive')
assert.equal(aggregateTracks[1].title, 'Night Drive (Live)')

const batchTracks = await request('/api/proxy/v2/tracks/netease?ids=track-1')
assert.equal(batchTracks.status, 200)
assert.equal((await batchTracks.json()).data[0].links.stream, '/api/proxy/v2/streams/netease/audio-1')

const discovery = await request('/api/proxy/v2/discovery?source=netease%2Ctencent&limit=8')
assert.equal(discovery.status, 200)
assert.equal(discovery.headers.get('etag'), '"discovery-etag"')
assert.equal(discovery.headers.get('x-cache-source'), 'd1-v2-hit')
const discoveryData = (await discovery.json()).data
assert.equal(discoveryData.recommendations[0].links.stream, '/api/proxy/v2/streams/netease/audio-1')
assert.equal(discoveryData.charts[0].links.stream, '/api/proxy/v2/streams/tencent/chart-audio')
const unchangedDiscovery = await request('/api/proxy/v2/discovery?source=netease%2Ctencent&limit=8', {
  headers: { 'if-none-match': '"discovery-etag"' }
})
assert.equal(unchangedDiscovery.status, 304)
assert.equal(new Headers(calls.at(-1).init.headers).get('if-none-match'), '"discovery-etag"')

const album = await request('/api/proxy/v2/albums/netease/album-1')
assert.equal(album.status, 200)
const albumData = (await album.json()).data
assert.equal(albumData.links.tracks, '/api/proxy/v2/albums/netease/album-1/tracks')
assert.equal(albumData.tracks.items[0].links.stream, '/api/proxy/v2/streams/netease/audio-1')
const albumTracks = await request(albumData.links.tracks)
assert.equal(albumTracks.status, 200)

const artist = await request('/api/proxy/v2/artists/netease/artist-1')
assert.equal(artist.status, 200)
const artistData = (await artist.json()).data
assert.equal(artistData.links.albums, '/api/proxy/v2/artists/netease/artist-1/albums')
const artistAlbums = await request(artistData.links.albums)
assert.equal(artistAlbums.status, 200)
assert.equal((await artistAlbums.json()).data[0].links.self, '/api/proxy/v2/albums/netease/album-1')

const streamOptions = await request('/api/proxy/v2/streams/netease/audio-1/options')
assert.equal(streamOptions.status, 200)
assert.equal((await streamOptions.json()).data.qualities[0].id, 'high')

const playlist = await request('/api/proxy/v2/playlists/netease/3778678?offset=0&limit=100')
assert.equal(playlist.status, 200)
const playlistData = (await playlist.json()).data
assert.equal(playlistData.name, 'Midnight Drive Collection')
assert.equal(playlistData.creator.name, 'Randall')
assert.match(playlistData.description, /V2 resource/)
assert.equal(playlistData.cover, 'https://img.example/playlist.jpg')
assert.equal(playlistData.tracks.items[0].links.stream, '/api/proxy/v2/streams/netease/audio-1')

const autoPlaylistCallStart = calls.length
const autoPlaylist = await request('/api/proxy/v2/playlists/aggregate/auto-qq?offset=0&limit=100')
assert.equal(autoPlaylist.status, 200)
const autoPlaylistData = (await autoPlaylist.json()).data
assert.equal(autoPlaylistData.source, 'tencent')
assert.equal(autoPlaylistData.name, 'Detected QQ Collection')
assert.deepEqual(
  calls.slice(autoPlaylistCallStart).map(({ url }) => url.pathname),
  ['/api/v2/playlists/netease/auto-qq', '/api/v2/playlists/tencent/auto-qq']
)

const refreshedPlaylist = await request('/api/proxy/v2/playlists/netease/3778678?offset=0&limit=100&refresh=true')
assert.equal(refreshedPlaylist.status, 200)
assert.equal(calls.at(-1).url.searchParams.get('refresh'), 'true')

const lyrics = await request(track.links.wordLyrics)
assert.equal(lyrics.status, 200)
assert.match(await lyrics.text(), /Night Drive/)
assert.equal(calls.at(-1).url.searchParams.get('granularity'), 'word')

const audio = await request(track.links.stream + '?quality=high', { headers: { range: 'bytes=0-4' } })
assert.equal(audio.status, 206)
assert.equal(audio.headers.get('accept-ranges'), 'bytes')
assert.equal(audio.headers.get('x-meting-quality'), 'high')
assert.equal(new Headers(calls.at(-1).init.headers).get('range'), 'bytes=0-4')
assert.equal(calls.at(-1).url.searchParams.get('quality'), 'high')

const flac = await request('/api/proxy/v2/streams/netease/flac-audio?quality=auto')
assert.equal(flac.status, 200)
assert.equal(flac.headers.get('content-type'), 'audio/flac')
assert.equal(flac.headers.get('x-meting-codec'), 'flac')
assert.equal(flac.headers.get('content-length'), String('fLaC-v2-audio'.length))
assert.equal(await flac.text(), 'fLaC-v2-audio')

const failedCallStart = calls.length
const unavailable = await request('/api/proxy/v2/streams/tencent/blocked?quality=lossless')
assert.equal(unavailable.status, 403)
assert.equal(unavailable.headers.get('x-rmusic-fallback'), null)
assert.deepEqual(calls.slice(failedCallStart).map(({ url }) => url.pathname), ['/api/v2/streams/tencent/blocked'])
assert.equal(calls.at(-1).url.searchParams.get('quality'), 'lossless')
assert.equal(unavailable.headers.get('cache-control'), 'no-store')

console.log('smoke: V2 discovery, catalog, cache refresh, audio formats and no alternate-source fallback passed')
