import assert from 'node:assert/strict'
import fs from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'
import worker from '../dist/_worker.js'
import { isNativeSessionRequest } from '../src/auth.js'
import { followStreamRedirects } from '../src/api-proxy.js'
import { FakeD1 } from './fake-d1.mjs'

const calls = []

async function tokenHash (value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Buffer.from(digest).toString('base64url')
}

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
  AUTH_DB: new FakeD1(),
  AUTH_ORIGIN: 'https://rmusic.test',
  AUTH_RP_ID: 'rmusic.test',
  AUTH_NATIVE_ORIGINS: 'https://rmusic.test',
  MUSIC_API_TOKEN: 'server-only-secret',
  PROXY_SIGNING_SECRET: 'independent-proxy-signing-secret',
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
            artwork: {
              url: `https://music.example/api/v2/artworks/${source}/album-cover?auth=old`,
              originalUrl: 'https://img.example/album.jpg'
            },
            stats: { trackCount: 12 },
            links: { self: `https://music.example/api/v2/albums/${source}/album-1` }
          }], { total: 1 }))
        }
        if (parts.length > 6) return Response.json(envelope([v2Track({ source })], { total: 1 }))
        return Response.json(envelope({
          id,
          source,
          name: 'Complete catalog resource',
          artwork: {
            url: `https://music.example/api/v2/artworks/${source}/catalog-cover?token=old`,
            originalUrl: 'https://img.example/catalog.jpg'
          },
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
assert.match(html, /id="account-modal"/)
assert.match(html, /id="registerPasskey"/)
assert.match(html, /id="loginPasskey"/)
assert.doesNotMatch(html, /server-only-secret/)
assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/)
assert.match(home.headers.get('permissions-policy'), /publickey-credentials-create=\(self\)/)

const appleAssociation = await request('/.well-known/apple-app-site-association')
assert.equal(appleAssociation.status, 200)
assert.equal(appleAssociation.headers.get('content-type'), 'application/json')
assert.match(appleAssociation.headers.get('cache-control'), /public/)
assert.match(appleAssociation.headers.get('cache-control'), /max-age=3600/)
assert.match(appleAssociation.headers.get('cache-control'), /s-maxage=86400/)
assert.equal(appleAssociation.headers.get('x-content-type-options'), 'nosniff')
assert.deepEqual(await appleAssociation.json(), {
  webcredentials: { apps: ['N9B2H32Q94.io.bigrandall.rmusic'] }
})
const associationEtag = appleAssociation.headers.get('etag')
assert.ok(associationEtag)
const unchangedAssociation = await request('/.well-known/apple-app-site-association', {
  headers: { 'if-none-match': associationEtag }
})
assert.equal(unchangedAssociation.status, 304)
const associationHead = await request('/.well-known/apple-app-site-association', { method: 'HEAD' })
assert.equal(associationHead.status, 200)
assert.equal(await associationHead.text(), '')
const associationWrite = await request('/.well-known/apple-app-site-association', { method: 'POST' })
assert.equal(associationWrite.status, 405)
assert.equal(associationWrite.headers.get('allow'), 'GET, HEAD')

const sourceHtml = fs.readFileSync(new URL('../src/widget/index.html', import.meta.url), 'utf8')
const clientSource = fs.readFileSync(new URL('../src/widget/client.js', import.meta.url), 'utf8')
const sourceCss = fs.readFileSync(new URL('../src/widget/index.css', import.meta.url), 'utf8')
const proxySource = fs.readFileSync(new URL('../src/api-proxy.js', import.meta.url), 'utf8')
const librarySource = fs.readFileSync(new URL('../src/library.js', import.meta.url), 'utf8')
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
assert.doesNotMatch(sourceHtml, /id="playlist-name"/)
assert.match(sourceHtml, /无需选择平台/)
assert.match(sourceHtml, /完整曲目会直接保存到账号/)
assert.match(clientSource, /const API = '\/api\/proxy\/v2'/)
assert.match(clientSource, /const PROXY_SESSION_ENDPOINT = '\/api\/proxy\/session'/)
assert.match(clientSource, /async function ensureProxySession/)
assert.match(clientSource, /'x-rmusic-client': 'widget-v2'/)
assert.match(clientSource, /credentials: 'same-origin'/)
assert.match(clientSource, /async function searchV2/)
assert.match(clientSource, /async function fetchPlaylistV2/)
assert.match(clientSource, /async function loadDiscovery/)
assert.match(clientSource, /async function loadCatalog/)
assert.match(clientSource, /mode: 'fast'/)
assert.match(clientSource, /view: 'compact'/)
assert.match(clientSource, /refresh: 'true'/)
assert.match(clientSource, /function migrateLegacyResourceUrl/)
assert.match(clientSource, /playlistCachePrefix: 'rmusic_playlist_cache_v1:'/)
assert.match(clientSource, /async function readPlaylistCache/)
assert.match(clientSource, /async function loadAccountLibrary/)
assert.doesNotMatch(clientSource, /writeJson\(STORAGE\.(?:favorites|recent|playlists)/)
assert.match(librarySource, /MAX_FAVORITES = 200/)
assert.match(librarySource, /MAX_RECENT = 30/)
assert.match(librarySource, /MAX_PLAYLISTS = 60/)
assert.match(clientSource, /startRegistration/)
assert.match(clientSource, /startAuthentication/)
assert.match(clientSource, /savePlaylistDefinition\(loaded\)/)
assert.doesNotMatch(clientSource, /playlistSave|playlist-save|shouldSave/)
assert.match(clientSource, /els\.refreshCollection\.addEventListener\('click'/)
assert.doesNotMatch(clientSource, /progressiveSearch|platformSearch|type=search|server=/)
assert.doesNotMatch(proxySource, /\/api\?server=|type=url|type=search/)
assert.doesNotMatch(proxySource, /resolveAudioFallback|AUDIO_FALLBACK_SOURCES|x-rmusic-fallback/i)
assert.match(proxySource, /followStreamRedirects\(upstream, request\)/)
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

const anonymousAccount = await request('/api/auth/session')
assert.equal(anonymousAccount.status, 200)
assert.equal(anonymousAccount.headers.get('set-cookie'), null)
assert.equal(anonymousAccount.headers.get('vary'), 'Cookie')
assert.deepEqual(await anonymousAccount.json(), { authenticated: false })
const anonymousLibrary = await request('/api/auth/library')
assert.equal(anonymousLibrary.status, 401)
assert.match(anonymousLibrary.headers.get('www-authenticate'), /^Passkey/)

const crossOriginRegistration = await request('/api/auth/register/options', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: 'https://attacker.example',
    'sec-fetch-site': 'cross-site',
    'cf-connecting-ip': '192.0.2.10'
  },
  body: '{}'
})
assert.equal(crossOriginRegistration.status, 403)

function authMutation (path, body) {
  return request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://rmusic.test',
      'sec-fetch-site': 'same-origin',
      'cf-connecting-ip': '192.0.2.20'
    },
    body: JSON.stringify(body)
  })
}

const registrationOptions = await authMutation('/api/auth/register/options', { displayName: 'Smoke User' })
assert.equal(registrationOptions.status, 200)
const registration = await registrationOptions.json()
assert.ok(registration.flowId)
assert.equal(registration.options.rp.id, 'rmusic.test')
assert.equal(registration.options.authenticatorSelection.residentKey, 'required')
assert.equal(registration.options.authenticatorSelection.userVerification, 'required')
assert.equal(registration.options.attestation, 'none')
assert.ok(registration.options.user.id)
assert.equal('password' in registration.options.user, false)

const invalidRegistration = await authMutation('/api/auth/register/verify', {
  flowId: registration.flowId,
  response: {}
})
assert.equal(invalidRegistration.status, 400)
assert.equal((await invalidRegistration.json()).title, 'PasskeyVerificationFailed')
const replayedRegistration = await authMutation('/api/auth/register/verify', {
  flowId: registration.flowId,
  response: {}
})
assert.equal(replayedRegistration.status, 400)
assert.equal((await replayedRegistration.json()).title, 'ChallengeExpired')

const loginOptions = await authMutation('/api/auth/login/options', {})
assert.equal(loginOptions.status, 200)
const login = await loginOptions.json()
assert.ok(login.flowId)
assert.equal(login.options.rpId, 'rmusic.test')
assert.equal(login.options.userVerification, 'required')
assert.equal(login.options.allowCredentials, undefined)

const nativeLoginOptions = await request('/api/auth/login/options', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: 'https://rmusic.test',
    'x-rmusic-client': 'ios-v1'
  },
  body: '{}'
})
assert.equal(nativeLoginOptions.status, 200, 'URLSession-style auth requests must pass the same-origin guard')

const nativeOriginConfig = { nativeOrigins: ['https://rmusic.test'] }
const nativeCeremony = new Request('https://rmusic.test/api/auth/login/verify', {
  method: 'POST',
  headers: { origin: 'https://rmusic.test', 'x-rmusic-client': 'ios-v1' }
})
assert.equal(isNativeSessionRequest(nativeCeremony, nativeOriginConfig, 'https://rmusic.test', 'bearer'), true)
const browserCeremony = new Request('https://rmusic.test/api/auth/login/verify', {
  method: 'POST',
  headers: {
    origin: 'https://rmusic.test',
    'x-rmusic-client': 'ios-v1',
    'sec-fetch-site': 'same-origin'
  }
})
assert.equal(
  isNativeSessionRequest(browserCeremony, nativeOriginConfig, 'https://rmusic.test', 'bearer'),
  false,
  'same-origin browser JavaScript must not turn a passkey result into an extractable bearer'
)
assert.equal(isNativeSessionRequest(nativeCeremony, nativeOriginConfig, 'https://rmusic.test', 'cookie'), false)
assert.equal(isNativeSessionRequest(nativeCeremony, nativeOriginConfig, 'https://attacker.example', 'bearer'), false)

const directUnauthenticated = await request('/api/v2/sources')
assert.equal(directUnauthenticated.status, 401)
assert.equal(directUnauthenticated.headers.get('access-control-allow-origin'), '*')
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

const directTokenStream = await request('/api/v2/streams/netease/audio-1', {
  headers: { authorization: 'Bearer server-only-secret' }
})
assert.equal(directTokenStream.status, 200)

const unauthenticatedProxyCallStart = calls.length
const unauthenticatedProxy = await request('/api/proxy/v2/tracks?query=Night%20Drive&source=netease')
assert.equal(unauthenticatedProxy.status, 401)
assert.match(unauthenticatedProxy.headers.get('www-authenticate'), /^RMusicSession/)
assert.equal(unauthenticatedProxy.headers.get('cache-control'), 'no-store')
assert.equal(unauthenticatedProxy.headers.get('access-control-allow-origin'), null)
assert.equal(calls.length, unauthenticatedProxyCallStart, 'unauthenticated proxy requests must not reach Meting')

const crossOriginSession = await request('/api/proxy/session', {
  method: 'POST',
  headers: {
    origin: 'https://attacker.example',
    'sec-fetch-site': 'cross-site',
    'x-rmusic-client': 'widget-v2'
  }
})
assert.equal(crossOriginSession.status, 403)
assert.equal(crossOriginSession.headers.get('set-cookie'), null)
assert.equal(crossOriginSession.headers.get('access-control-allow-origin'), null)

const anonymousNativeSession = await request('/api/proxy/session', {
  method: 'POST',
  headers: {
    origin: 'https://rmusic.test',
    'cf-connecting-ip': '203.0.113.41',
    'x-rmusic-client': 'ios-v1'
  }
})
assert.equal(anonymousNativeSession.status, 201)
assert.equal((await anonymousNativeSession.json()).accountAuthenticated, false)
assert.match(anonymousNativeSession.headers.get('set-cookie'), /^__Host-rmusic_proxy=/)

const browserNativeImpersonation = await request('/api/proxy/session', {
  method: 'POST',
  headers: {
    origin: 'https://rmusic.test',
    'sec-fetch-site': 'same-origin',
    'x-rmusic-client': 'ios-v1'
  }
})
assert.equal(browserNativeImpersonation.status, 401)
assert.equal(browserNativeImpersonation.headers.get('set-cookie'), null)

const sessionResponse = await request('/api/proxy/session', {
  method: 'POST',
  headers: {
    origin: 'https://rmusic.test',
    'cf-connecting-ip': '203.0.113.42',
    'sec-fetch-site': 'same-origin',
    'x-rmusic-client': 'widget-v2'
  }
})
assert.equal(sessionResponse.status, 201)
assert.equal(sessionResponse.headers.get('cache-control'), 'no-store')
assert.equal(sessionResponse.headers.get('access-control-allow-origin'), 'https://rmusic.test')
assert.equal(sessionResponse.headers.get('access-control-allow-credentials'), 'true')
const setCookie = sessionResponse.headers.get('set-cookie')
assert.match(setCookie, /^__Host-rmusic_proxy=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/)
assert.match(setCookie, /HttpOnly/)
assert.match(setCookie, /Secure/)
assert.match(setCookie, /SameSite=Strict/)
assert.doesNotMatch(setCookie, /independent-proxy-signing-secret|server-only-secret/)
const sessionBody = await sessionResponse.json()
assert.equal(sessionBody.authenticated, true)
assert.equal(sessionBody.accountAuthenticated, false)
assert.ok(sessionBody.expiresAt > sessionBody.refreshAfter)
const proxyCookie = setCookie.split(';')[0]
let accountCookie = ''

function proxyRequest (path, init = {}) {
  const headers = new Headers(init.headers)
  headers.set('cookie', [proxyCookie, accountCookie].filter(Boolean).join('; '))
  headers.set('cf-connecting-ip', '203.0.113.99')
  headers.set('sec-fetch-site', 'same-origin')
  return request(path, { ...init, headers })
}

const anonymousStreamCallStart = calls.length
const anonymousStream = await proxyRequest('/api/proxy/v2/streams/netease/audio-1')
assert.equal(anonymousStream.status, 401)
assert.match(anonymousStream.headers.get('www-authenticate'), /^Passkey/)
assert.equal(calls.length, anonymousStreamCallStart, 'signed proxy session without an RMusic account must not reach an audio upstream')
const anonymousTrailingSlashStream = await proxyRequest('/api/proxy/v2/streams/netease/audio-1/')
assert.equal(anonymousTrailingSlashStream.status, 401)
assert.equal(calls.length, anonymousStreamCallStart, 'a trailing slash must not bypass playback authentication')

const accountToken = 'rmu_smoke_account_token'
const nativeAccountToken = 'rmu_smoke_native_account_token'
const accountUserId = 'smoke-user-1'
const now = Date.now()
await env.AUTH_DB.batch([
  env.AUTH_DB.prepare(`
    INSERT INTO rmusic_users (id, user_handle, display_name, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(accountUserId, 'c21va2UtdXNlci1oYW5kbGU', 'Smoke Account', now, now, now),
  env.AUTH_DB.prepare(`
    INSERT INTO rmusic_user_sessions
      (id, token_hash, user_id, kind, created_at, expires_at, last_used_at, user_agent, last_ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind('smoke-session-1', await tokenHash(accountToken), accountUserId, 'web', now, now + 86_400_000, now, 'Smoke Browser', 'smoke-ip'),
  env.AUTH_DB.prepare(`
    INSERT INTO rmusic_user_sessions
      (id, token_hash, user_id, kind, created_at, expires_at, last_used_at, user_agent, last_ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind('smoke-native-session-1', await tokenHash(nativeAccountToken), accountUserId, 'native', now, now + 86_400_000, now, 'RMusic iOS', 'native-ip')
])
accountCookie = `__Host-rmusic_user=${accountToken}`

function libraryRequest (path, { method = 'GET', body, origin = 'https://rmusic.test' } = {}) {
  const headers = new Headers({ cookie: accountCookie, origin, 'sec-fetch-site': origin === 'https://rmusic.test' ? 'same-origin' : 'cross-site' })
  if (body !== undefined) headers.set('content-type', 'application/json')
  return request('/api/auth/library' + path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })
}

const accountStatus = await request('/api/auth/session', { headers: { cookie: accountCookie } })
const refreshedAccountCookie = accountStatus.headers.get('set-cookie')
assert.match(refreshedAccountCookie, /^__Host-rmusic_user=rmu_[A-Za-z0-9_-]+;/)
assert.match(refreshedAccountCookie, /Expires=[^;]+GMT/)
assert.match(refreshedAccountCookie, /Max-Age=\d+/)
assert.match(refreshedAccountCookie, /HttpOnly/)
assert.match(refreshedAccountCookie, /Secure/)
assert.match(refreshedAccountCookie, /SameSite=Lax/)
assert.doesNotMatch(refreshedAccountCookie, /SameSite=Strict/)
assert.equal((await accountStatus.json()).user.id, accountUserId)
const emptyLibrary = await libraryRequest('')
assert.equal(emptyLibrary.status, 200)
assert.equal((await emptyLibrary.json()).empty, true)

const storedTrack = {
  id: 'track-1',
  server: 'netease',
  title: 'Night Drive',
  author: 'RMusic',
  artists: [{ id: 'artist-1', name: 'RMusic' }],
  album: { id: 'album-1', name: 'City Lights' },
  url: '/api/proxy/v2/streams/netease/audio-1',
  pic: '/api/proxy/v2/artworks/netease/cover-1',
  lrc: '/api/proxy/v2/lyrics/netease/lyric-1',
  duration_ms: 213000
}
const crossOriginFavorite = await libraryRequest('/favorites', {
  method: 'PUT',
  body: { track: storedTrack },
  origin: 'https://attacker.example'
})
assert.equal(crossOriginFavorite.status, 403)

const favoriteWrite = await libraryRequest('/favorites', { method: 'PUT', body: { track: storedTrack } })
assert.equal(favoriteWrite.status, 200)
const recentWrite = await libraryRequest('/recent', { method: 'POST', body: { track: storedTrack } })
assert.equal(recentWrite.status, 200)
const playlistSnapshot = {
  version: 2,
  server: 'netease',
  id: '3778678',
  name: 'Smoke Playlist',
  cover: '/api/proxy/v2/artworks/netease/cover-1',
  description: 'Stored in the account library.',
  creator: { id: 'creator-1', name: 'Randall' },
  stats: { trackCount: 1 },
  tracks: [storedTrack],
  cachedAt: now,
  savedAt: now
}
const playlistWrite = await libraryRequest('/playlists/netease/3778678', { method: 'PUT', body: { playlist: playlistSnapshot } })
assert.equal(playlistWrite.status, 201)
const storedPlaylist = await libraryRequest('/playlists/netease/3778678')
assert.equal(storedPlaylist.status, 200)
assert.equal((await storedPlaylist.json()).playlist.tracks[0].url, '/api/proxy/v2/streams/netease/audio-1')
const populatedLibrary = await libraryRequest('')
const populatedData = await populatedLibrary.json()
assert.equal(populatedData.empty, false)
assert.equal(populatedData.favorites.length, 1)
assert.equal(populatedData.recent.length, 1)
assert.equal(populatedData.playlists.length, 1)

const secondAccountToken = 'rmu_smoke_second_account_token'
await env.AUTH_DB.batch([
  env.AUTH_DB.prepare(`
    INSERT INTO rmusic_users (id, user_handle, display_name, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('smoke-user-2', 'c21va2UtdXNlci0yLWhhbmRsZQ', 'Second Account', now, now, now),
  env.AUTH_DB.prepare(`
    INSERT INTO rmusic_user_sessions
      (id, token_hash, user_id, kind, created_at, expires_at, last_used_at, user_agent, last_ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind('smoke-session-2', await tokenHash(secondAccountToken), 'smoke-user-2', 'web', now, now + 86_400_000, now, 'Smoke Browser 2', 'smoke-ip-2')
])
accountCookie = `__Host-rmusic_user=${secondAccountToken}`
const isolatedLibrary = await libraryRequest('')
assert.equal(isolatedLibrary.status, 200)
assert.equal((await isolatedLibrary.json()).empty, true, 'D1 library rows must be isolated by user')
accountCookie = `__Host-rmusic_user=${accountToken}`

const refusedImport = await libraryRequest('/import', { method: 'POST', body: { favorites: [], recent: [], playlists: [] } })
assert.equal(refusedImport.status, 409)

const tamperedCookie = proxyCookie.slice(0, -1) + (proxyCookie.endsWith('A') ? 'B' : 'A')
const tamperedProxy = await request('/api/proxy/v2/sources', {
  headers: { cookie: tamperedCookie, 'cf-connecting-ip': '203.0.113.99', 'sec-fetch-site': 'same-origin' }
})
assert.equal(tamperedProxy.status, 401)

const copiedToAnotherNetwork = await request('/api/proxy/v2/sources', {
  headers: { cookie: proxyCookie, 'cf-connecting-ip': '198.51.100.10', 'sec-fetch-site': 'same-origin' }
})
assert.equal(copiedToAnotherNetwork.status, 401)

const crossSiteCookieReuse = await request('/api/proxy/v2/sources', {
  headers: { cookie: proxyCookie, 'cf-connecting-ip': '203.0.113.99', 'sec-fetch-site': 'cross-site' }
})
assert.equal(crossSiteCookieReuse.status, 401)

const webBearerProxy = await request('/api/proxy/v2/sources', {
  headers: { authorization: `Bearer ${accountToken}` }
})
assert.equal(webBearerProxy.status, 401, 'a web session token must not become native proxy authority')

const invalidNativeBootstrap = await request('/api/proxy/session', {
  method: 'POST',
  headers: {
    authorization: 'Bearer rmu_invalid_native_token',
    origin: 'https://rmusic.test',
    'x-rmusic-client': 'ios-v1',
    'cf-connecting-ip': '198.18.0.20'
  }
})
assert.equal(invalidNativeBootstrap.status, 401)
assert.equal(invalidNativeBootstrap.headers.get('set-cookie'), null)

const nativeBootstrap = await request('/api/proxy/session', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${nativeAccountToken}`,
    origin: 'https://rmusic.test',
    'x-rmusic-client': 'ios-v1',
    'cf-connecting-ip': '198.18.0.20'
  }
})
assert.equal(nativeBootstrap.status, 201)
assert.equal(nativeBootstrap.headers.get('access-control-allow-origin'), 'https://rmusic.test')
const nativeBootstrapBody = await nativeBootstrap.json()
assert.equal(nativeBootstrapBody.authenticated, true)
assert.equal(nativeBootstrapBody.accountAuthenticated, true)
const nativeProxyCookie = nativeBootstrap.headers.get('set-cookie').split(';')[0]
assert.doesNotMatch(nativeProxyCookie, /smoke-native-session|native_account_token/)

const nativeCookieSearch = await request('/api/proxy/v2/tracks?query=Night%20Drive&source=netease', {
  headers: { cookie: nativeProxyCookie, 'cf-connecting-ip': '198.18.0.44' }
})
assert.equal(nativeCookieSearch.status, 200)
assert.match(nativeCookieSearch.headers.get('vary'), /Authorization/i)
const nativeCookieAudio = await request('/api/proxy/v2/streams/netease/audio-1', {
  headers: { cookie: nativeProxyCookie, 'cf-connecting-ip': '198.18.0.44', range: 'bytes=0-4' }
})
assert.equal(nativeCookieAudio.status, 206, 'a native bootstrap cookie must retain account playback authority')

const movedNativeCookie = await request('/api/proxy/v2/sources', {
  headers: { cookie: nativeProxyCookie, 'cf-connecting-ip': '198.19.0.44' }
})
assert.equal(movedNativeCookie.status, 401)

const nativeBearerSearch = await request('/api/proxy/v2/tracks?query=Night%20Drive&source=netease', {
  headers: { authorization: `Bearer ${nativeAccountToken}`, 'cf-connecting-ip': '198.19.0.44' }
})
assert.equal(nativeBearerSearch.status, 200, 'native bearer must remain usable after an IP/network change')
assert.equal(new Headers(calls.at(-1).init.headers).get('authorization'), 'Bearer server-only-secret')
assert.match(nativeBearerSearch.headers.get('vary'), /Authorization/i)
assert.equal(nativeBearerSearch.headers.get('access-control-allow-origin'), null)

const nativeBearerAudio = await request('/api/proxy/v2/streams/netease/audio-1', {
  headers: { authorization: `Bearer ${nativeAccountToken}`, range: 'bytes=0-4' }
})
assert.equal(nativeBearerAudio.status, 206)
const nativeAccountStatus = await request('/api/auth/session', {
  headers: { authorization: `Bearer ${nativeAccountToken}` }
})
assert.equal(nativeAccountStatus.status, 200)
assert.equal((await nativeAccountStatus.json()).session.kind, 'native')
const nativeLibrary = await request('/api/auth/library', {
  headers: { authorization: `Bearer ${nativeAccountToken}` }
})
assert.equal(nativeLibrary.status, 200)

const crossSiteNativeBearer = await request('/api/proxy/v2/sources', {
  headers: {
    authorization: `Bearer ${nativeAccountToken}`,
    origin: 'https://attacker.example',
    'sec-fetch-site': 'cross-site'
  }
})
assert.equal(crossSiteNativeBearer.status, 401)

await env.AUTH_DB.prepare('UPDATE rmusic_user_sessions SET revoked_at = ? WHERE id = ?')
  .bind(Date.now(), 'smoke-native-session-1').run()
const revokedNativeCallStart = calls.length
const revokedNativeCookieAudio = await request('/api/proxy/v2/streams/netease/audio-1', {
  headers: { cookie: nativeProxyCookie, 'cf-connecting-ip': '198.18.0.44' }
})
assert.equal(revokedNativeCookieAudio.status, 401)
assert.match(revokedNativeCookieAudio.headers.get('www-authenticate'), /^Passkey/)
const revokedNativeBearer = await request('/api/proxy/v2/sources', {
  headers: { authorization: `Bearer ${nativeAccountToken}` }
})
assert.equal(revokedNativeBearer.status, 401)
assert.equal(calls.length, revokedNativeCallStart, 'revoked native auth must not reach Meting')

const search = await proxyRequest('/api/proxy/v2/tracks?query=Night%20Drive&source=netease')
assert.equal(search.status, 200)
assert.equal(search.headers.get('x-rmusic-api-version'), '2')
assert.match(search.headers.get('cache-control'), /^private,/)
assert.match(search.headers.get('vary'), /Cookie/i)
assert.equal(search.headers.get('access-control-allow-origin'), null)
const searchEnvelope = await search.json()
const [track] = searchEnvelope.data
assert.equal(track.album.name, 'City Lights')
assert.equal(track.durationMs, 213000)
assert.equal(track.source, 'netease')
assert.equal(track.links.stream, '/api/proxy/v2/streams/netease/audio-1')
assert.equal(track.links.artwork, '/api/proxy/v2/artworks/netease/cover-1')
assert.equal(track.links.lyrics, '/api/proxy/v2/lyrics/netease/lyric-1')
assert.equal(track.links.wordLyrics, '/api/proxy/v2/lyrics/netease/lyric-1?granularity=word')

const sources = await proxyRequest('/api/proxy/v2/sources')
assert.equal(sources.status, 200)
const [source] = (await sources.json()).data
assert.equal(source.id, 'netease')
assert.deepEqual(source.capabilities, ['search', 'playlist'])
assert.equal(source.links.self, '/api/proxy/v2/sources/netease')
assert.equal(source.links.stream, undefined)

const tencentSearch = await proxyRequest('/api/proxy/v2/tracks?query=Night%20Drive&source=tencent')
const [tencentTrack] = (await tencentSearch.json()).data
assert.equal(tencentTrack.links.stream, '/api/proxy/v2/streams/tencent/audio-1')

const aggregateSearch = await proxyRequest('/api/proxy/v2/tracks?query=Night%20Drive&source=all&limit=80')
assert.equal(aggregateSearch.status, 200)
assert.equal(aggregateSearch.headers.get('x-rmusic-sources'), 'netease,tencent')
const aggregateTracks = (await aggregateSearch.json()).data
assert.equal(aggregateTracks[0].title, 'Night Drive')
assert.equal(aggregateTracks[1].title, 'Night Drive (Live)')

const batchTracks = await proxyRequest('/api/proxy/v2/tracks/netease?ids=track-1')
assert.equal(batchTracks.status, 200)
assert.equal((await batchTracks.json()).data[0].links.stream, '/api/proxy/v2/streams/netease/audio-1')

const discovery = await proxyRequest('/api/proxy/v2/discovery?source=netease%2Ctencent&limit=8')
assert.equal(discovery.status, 200)
assert.equal(discovery.headers.get('etag'), '"discovery-etag"')
assert.equal(discovery.headers.get('x-cache-source'), 'd1-v2-hit')
const discoveryData = (await discovery.json()).data
assert.equal(discoveryData.recommendations[0].links.stream, '/api/proxy/v2/streams/netease/audio-1')
assert.equal(discoveryData.charts[0].links.stream, '/api/proxy/v2/streams/tencent/chart-audio')
const unchangedDiscovery = await proxyRequest('/api/proxy/v2/discovery?source=netease%2Ctencent&limit=8', {
  headers: { 'if-none-match': '"discovery-etag"' }
})
assert.equal(unchangedDiscovery.status, 304)
assert.equal(new Headers(calls.at(-1).init.headers).get('if-none-match'), '"discovery-etag"')

const album = await proxyRequest('/api/proxy/v2/albums/netease/album-1')
assert.equal(album.status, 200)
const albumData = (await album.json()).data
assert.equal(albumData.links.tracks, '/api/proxy/v2/albums/netease/album-1/tracks')
assert.equal(albumData.artwork.url, '/api/proxy/v2/artworks/netease/catalog-cover')
assert.equal(albumData.tracks.items[0].links.stream, '/api/proxy/v2/streams/netease/audio-1')
const albumTracks = await proxyRequest(albumData.links.tracks)
assert.equal(albumTracks.status, 200)

const artist = await proxyRequest('/api/proxy/v2/artists/netease/artist-1')
assert.equal(artist.status, 200)
const artistData = (await artist.json()).data
assert.equal(artistData.links.albums, '/api/proxy/v2/artists/netease/artist-1/albums')
const artistAlbums = await proxyRequest(artistData.links.albums)
assert.equal(artistAlbums.status, 200)
const artistAlbumData = (await artistAlbums.json()).data[0]
assert.equal(artistAlbumData.links.self, '/api/proxy/v2/albums/netease/album-1')
assert.equal(artistAlbumData.artwork.url, '/api/proxy/v2/artworks/netease/album-cover')

const streamOptions = await proxyRequest('/api/proxy/v2/streams/netease/audio-1/options')
assert.equal(streamOptions.status, 200)
assert.equal((await streamOptions.json()).data.qualities[0].id, 'high')

const playlist = await proxyRequest('/api/proxy/v2/playlists/netease/3778678?offset=0&limit=100')
assert.equal(playlist.status, 200)
const playlistData = (await playlist.json()).data
assert.equal(playlistData.name, 'Midnight Drive Collection')
assert.equal(playlistData.creator.name, 'Randall')
assert.match(playlistData.description, /V2 resource/)
assert.equal(playlistData.cover, 'https://img.example/playlist.jpg')
assert.equal(playlistData.tracks.items[0].links.stream, '/api/proxy/v2/streams/netease/audio-1')

const autoPlaylistCallStart = calls.length
const autoPlaylist = await proxyRequest('/api/proxy/v2/playlists/aggregate/auto-qq?offset=0&limit=100')
assert.equal(autoPlaylist.status, 200)
const autoPlaylistData = (await autoPlaylist.json()).data
assert.equal(autoPlaylistData.source, 'tencent')
assert.equal(autoPlaylistData.name, 'Detected QQ Collection')
assert.deepEqual(
  calls.slice(autoPlaylistCallStart).map(({ url }) => url.pathname),
  ['/api/v2/playlists/netease/auto-qq', '/api/v2/playlists/tencent/auto-qq']
)

const refreshedPlaylist = await proxyRequest('/api/proxy/v2/playlists/netease/3778678?offset=0&limit=100&refresh=true')
assert.equal(refreshedPlaylist.status, 200)
assert.equal(calls.at(-1).url.searchParams.get('refresh'), 'true')

const lyrics = await proxyRequest(track.links.wordLyrics)
assert.equal(lyrics.status, 200)
assert.match(await lyrics.text(), /Night Drive/)
assert.equal(calls.at(-1).url.searchParams.get('granularity'), 'word')

const audio = await proxyRequest(track.links.stream + '?quality=high', { headers: { range: 'bytes=0-4' } })
assert.equal(audio.status, 206)
assert.equal(audio.headers.get('accept-ranges'), 'bytes')
assert.equal(audio.headers.get('x-meting-quality'), 'high')
assert.equal(new Headers(calls.at(-1).init.headers).get('range'), 'bytes=0-4')
assert.equal(calls.at(-1).url.searchParams.get('quality'), 'high')

const flac = await proxyRequest('/api/proxy/v2/streams/netease/flac-audio?quality=auto')
assert.equal(flac.status, 200)
assert.equal(flac.headers.get('content-type'), 'audio/flac')
assert.equal(flac.headers.get('x-meting-codec'), 'flac')
assert.equal(flac.headers.get('content-length'), String('fLaC-v2-audio'.length))
assert.equal(await flac.text(), 'fLaC-v2-audio')

const redirectCalls = []
const redirectedAudio = await followStreamRedirects(
  new Response(null, { status: 302, headers: { location: 'https://audio.example/preview.mp3' } }),
  new Request('https://rmusic.test/audio', {
    headers: {
      authorization: 'Bearer must-not-leak',
      cookie: 'must-not-leak=1',
      range: 'bytes=0-4095'
    }
  }),
  async (url, init) => {
    redirectCalls.push({ url, init })
    if (redirectCalls.length === 1) {
      return new Response(null, { status: 307, headers: { location: 'https://media.example/final.mp3' } })
    }
    return new Response('redirected-audio', {
      status: 206,
      headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-4095/8192' }
    })
  }
)
assert.equal(redirectedAudio.status, 206)
assert.equal(await redirectedAudio.text(), 'redirected-audio')
assert.equal(redirectedAudio.headers.get('content-range'), 'bytes 0-4095/8192')
assert.equal(redirectCalls.length, 2)
assert.equal(redirectCalls[0].url, 'https://audio.example/preview.mp3')
assert.equal(redirectCalls[1].url, 'https://media.example/final.mp3')
for (const call of redirectCalls) {
  assert.equal(call.init.redirect, 'manual')
  const redirectedHeaders = new Headers(call.init.headers)
  assert.deepEqual([...redirectedHeaders.keys()].sort(), ['accept', 'range'])
  assert.equal(redirectedHeaders.get('range'), 'bytes=0-4095')
  assert.equal(redirectedHeaders.get('authorization'), null)
  assert.equal(redirectedHeaders.get('cookie'), null)
  assert.equal(redirectedHeaders.get('x-meting-token'), null)
  assert.equal(redirectedHeaders.get('if-none-match'), null)
}

for (const location of [
  'http://audio.example/preview.mp3',
  'https://user:password@audio.example/preview.mp3',
  'https://audio.example:8443/preview.mp3',
  'https://localhost/preview.mp3',
  'https://localhost./preview.mp3',
  'https://127.0.0.1/preview.mp3',
  'https://169.254.169.254/preview.mp3',
  'https://service.internal/preview.mp3'
]) {
  const unsafeRedirect = await followStreamRedirects(
    new Response(null, { status: 302, headers: { location } }),
    new Request('https://rmusic.test/audio'),
    async () => { throw new Error('unsafe redirect must not be fetched') }
  )
  assert.equal(unsafeRedirect.status, 502)
  assert.equal(unsafeRedirect.headers.get('cache-control'), 'no-store')
}

const missingRedirect = await followStreamRedirects(
  new Response(null, { status: 302 }),
  new Request('https://rmusic.test/audio')
)
assert.equal(missingRedirect.status, 502)

let redirectHop = 0
const redirectLoop = await followStreamRedirects(
  new Response(null, { status: 302, headers: { location: 'https://audio.example/0' } }),
  new Request('https://rmusic.test/audio'),
  async () => new Response(null, {
    status: 302,
    headers: { location: `https://audio.example/${++redirectHop}` }
  })
)
assert.equal(redirectHop, 4)
assert.equal(redirectLoop.status, 502)

const failedRedirect = await followStreamRedirects(
  new Response(null, { status: 302, headers: { location: 'https://audio.example/fail' } }),
  new Request('https://rmusic.test/audio'),
  async () => { throw new Error('private provider failure') }
)
assert.equal(failedRedirect.status, 502)
assert.doesNotMatch(await failedRedirect.text(), /private provider failure/)

const failedCallStart = calls.length
const unavailable = await proxyRequest('/api/proxy/v2/streams/tencent/blocked?quality=lossless')
assert.equal(unavailable.status, 403)
assert.equal(unavailable.headers.get('x-rmusic-fallback'), null)
assert.deepEqual(calls.slice(failedCallStart).map(({ url }) => url.pathname), ['/api/v2/streams/tencent/blocked'])
assert.equal(calls.at(-1).url.searchParams.get('quality'), 'lossless')
assert.equal(unavailable.headers.get('cache-control'), 'no-store')

console.log('smoke: AASA, browser/native proxy auth, V2 resources, cache refresh, audio formats and no alternate-source fallback passed')
