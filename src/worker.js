// Cloudflare / RandallFlare Workers entrypoint for rmusic-widget.
//
// Two surfaces:
//   GET /                  → serves the widget shell
//   GET /widget.css        → CSS (separate file = browser-cacheable)
//   GET /widget.js         → client-side JS (same)
//   GET /.well-known/apple-app-site-association
//                          → iOS passkey webcredentials association
//   GET /api/v2/…          → caller-authenticated Meting V2 passthrough
//   GET /api/proxy/v2/…    → REST proxy for the Meting API V2,
//                            injecting the master token server-side
//                            after signed-session or native Bearer verification, then
//                            rate-limiting per client IP and session.
//
// Why a worker at all (and not a static site that hits the Meting
// API directly)? Two reasons:
//   1. We want to keep the master HMAC token server-side. A static
//      page would have to embed it.
//   2. We want a single, configurable rate limit applied to every
//      visitor regardless of which Meting endpoint they hit.

import { buildConfig } from './config.js'
import { checkRate, clientIp } from './rate-limit.js'
import { passThroughApiV2, proxyApiV2 } from './api-proxy.js'
import {
  handleAuth,
  resolveAuthenticatedNativeSession,
  resolveAuthenticatedUser
} from './auth.js'
import { handleLibrary } from './library.js'
import {
  issueProxySession,
  privateProxyResponse,
  proxyForbidden,
  proxyUnauthorized,
  trustedSessionBootstrap,
  verifyProxySession
} from './proxy-session.js'

// Build-time string constants. build.mjs passes the contents of
// src/widget/{index.html,index.css,client.js} through esbuild's
// `define`, which literal-substitutes each identifier with the file's
// text before bundling. The references look unresolved when you read
// this file pre-build — that's expected, the worker only ever runs
// from the bundled dist/worker.js.
/* global __WIDGET_HTML__, __WIDGET_CSS__, __WIDGET_JS__, __WIDGET_ASSET_HASH__, __WIDGET_HTML_BR__, __WIDGET_HTML_GZIP__, __WIDGET_CSS_BR__, __WIDGET_CSS_GZIP__, __WIDGET_JS_BR__, __WIDGET_JS_GZIP__ */
const WIDGET_HTML = __WIDGET_HTML__
const WIDGET_CSS = __WIDGET_CSS__
const WIDGET_JS = __WIDGET_JS__
const WIDGET_ASSET_HASH = __WIDGET_ASSET_HASH__
const COMPRESSED_ASSETS = {
  html: { br: __WIDGET_HTML_BR__, gzip: __WIDGET_HTML_GZIP__ },
  css: { br: __WIDGET_CSS_BR__, gzip: __WIDGET_CSS_GZIP__ },
  js: { br: __WIDGET_JS_BR__, gzip: __WIDGET_JS_GZIP__ }
}
const decodedAssets = new Map()
const APPLE_APP_SITE_ASSOCIATION = JSON.stringify({
  webcredentials: {
    apps: ['N9B2H32Q94.io.bigrandall.rmusic']
  }
})
const APPLE_APP_SITE_ASSOCIATION_ETAG = '"rmusic-aasa-v1"'

const DIRECT_API_CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization, X-Meting-Token, Range',
  'access-control-expose-headers': 'Content-Range, WWW-Authenticate, ETag, Age, Server-Timing, X-Cache-Source, X-Meting-Quality, X-Meting-Codec, X-Meting-Bitrate-Kbps, X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RMusic-Api-Version, X-RMusic-Sources',
  'access-control-max-age': '86400'
}

function isDirectApiPath (pathname) {
  return pathname === '/api/v2' || pathname.startsWith('/api/v2/')
}

function isProxyPath (pathname) {
  return pathname === '/api/proxy' || pathname.startsWith('/api/proxy/')
}

function samePublicOrigin (request, originValue) {
  if (!originValue) return false
  try {
    const incoming = new URL(request.url)
    const origin = new URL(originValue)
    if (origin.host.toLowerCase() !== incoming.host.toLowerCase()) return false
    if (origin.protocol === 'https:') return true
    return origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  } catch {
    return false
  }
}

function appleAppSiteAssociationResponse (request) {
  const headers = new Headers({
    'content-type': 'application/json',
    'cache-control': 'public, max-age=3600, s-maxage=86400',
    etag: APPLE_APP_SITE_ASSOCIATION_ETAG,
    'x-content-type-options': 'nosniff'
  })
  if (request.headers.get('if-none-match') === APPLE_APP_SITE_ASSOCIATION_ETAG) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(request.method === 'HEAD' ? null : APPLE_APP_SITE_ASSOCIATION, { headers })
}

function hasRMusicBearer (request) {
  return /^Bearer\s+rmu_[A-Za-z0-9_-]+$/i.test(request.headers.get('authorization') || '')
}

async function resolveNativeBearerUser (request, env) {
  if (!hasRMusicBearer(request)) return null
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  // URLSession does not add browser Fetch Metadata or Origin headers. If
  // either is present, retain the widget's same-origin browser boundary.
  if (origin && !samePublicOrigin(request, origin)) return null
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return null
  const account = await resolveAuthenticatedUser(request, env)
  return account.userId && account.session?.kind === 'native' ? account : null
}

function withCors (request, response) {
  const url = new URL(request.url)
  const headers = new Headers(response.headers)
  if (isDirectApiPath(url.pathname)) {
    for (const [key, value] of Object.entries(DIRECT_API_CORS_HEADERS)) headers.set(key, value)
  } else if (isProxyPath(url.pathname)) {
    // The token-injecting proxy is deliberately not a public CORS API.
    // Same-origin requests do not need CORS, but reflecting the exact trusted
    // origin keeps browser diagnostics clear without ever emitting `*`.
    const origin = request.headers.get('origin')
    if (samePublicOrigin(request, origin)) {
      headers.set('access-control-allow-origin', origin)
      headers.set('access-control-allow-credentials', 'true')
      headers.append('vary', 'Origin')
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

function optionsResponse (request) {
  const pathname = new URL(request.url).pathname
  if (isDirectApiPath(pathname)) return new Response(null, { status: 204, headers: DIRECT_API_CORS_HEADERS })
  if (isProxyPath(pathname)) {
    const origin = request.headers.get('origin')
    if (!samePublicOrigin(request, origin)) return new Response(null, { status: 204 })
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
        'access-control-allow-headers': 'Content-Type, Range, X-RMusic-Client',
        'access-control-max-age': '600',
        vary: 'Origin'
      }
    })
  }
  return new Response(null, { status: 204 })
}

function plain (status, body) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  })
}

function playbackAuthRequired () {
  return new Response(JSON.stringify({
    type: 'about:blank',
    title: 'AuthenticationRequired',
    status: 401,
    detail: '请先使用设备密钥登录后再播放音乐'
  }), {
    status: 401,
    headers: {
      'content-type': 'application/problem+json; charset=utf-8',
      'cache-control': 'no-store',
      'www-authenticate': 'Passkey realm="RMusic"'
    }
  })
}

function decodeAsset (key, base64) {
  if (decodedAssets.has(key)) return decodedAssets.get(key)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  decodedAssets.set(key, bytes)
  return bytes
}

function staticResponse (request, kind, value, contentType, cacheControl, etag) {
  const headers = new Headers({
    'content-type': contentType,
    'cache-control': cacheControl,
    etag,
    vary: 'Accept-Encoding'
  })
  if (kind === 'html') {
    headers.set('content-security-policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; manifest-src 'self'")
    headers.set('permissions-policy', 'publickey-credentials-create=(self), publickey-credentials-get=(self), microphone=(), camera=(), geolocation=()')
    headers.set('referrer-policy', 'no-referrer')
    headers.set('x-content-type-options', 'nosniff')
    headers.set('x-frame-options', 'DENY')
  }
  const candidates = request.headers.get('accept-encoding') || ''
  let body = value
  if (/\bbr\b/.test(candidates)) {
    headers.set('content-encoding', 'br')
    body = decodeAsset(`${kind}:br`, COMPRESSED_ASSETS[kind].br)
  } else if (/\bgzip\b/.test(candidates)) {
    headers.set('content-encoding', 'gzip')
    body = decodeAsset(`${kind}:gzip`, COMPRESSED_ASSETS[kind].gzip)
  }
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(request.method === 'HEAD' ? null : body, {
    headers,
    // Cloudflare should preserve the pre-compressed bytes instead of
    // attempting a second content-encoding pass.
    encodeBody: 'manual'
  })
}

async function route (request, env, context) {
  const url = new URL(request.url)
  const config = buildConfig(env)

  if (request.method === 'OPTIONS') return optionsResponse(request)

  if (url.pathname === '/.well-known/apple-app-site-association') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed\n', {
        status: 405,
        headers: { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }
      })
    }
    return appleAppSiteAssociationResponse(request)
  }

  if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    const ip = clientIp(request)
    const decision = checkRate(`auth:${ip}`, config.auth.rate)
    if (!decision.allowed) return rateLimitResponse(decision)
    if (url.pathname === '/api/auth/register/options' && request.method === 'POST') {
      const registrationDecision = checkRate(`auth-register:${ip}`, config.auth.registrationRate)
      if (!registrationDecision.allowed) return rateLimitResponse(registrationDecision)
    }
    if (url.pathname === '/api/auth/library' || url.pathname.startsWith('/api/auth/library/')) {
      return handleLibrary(request, env)
    }
    return handleAuth(request, env, context)
  }

  if (url.pathname === '/api/proxy/session') {
    if (request.method !== 'POST') return plain(405, 'method not allowed\n')
    if (!config.proxySession.signingSecret) {
      return plain(500, 'rmusic-widget: PROXY_SIGNING_SECRET env binding is required.\n')
    }
    const decision = checkRate(`proxy-session:${clientIp(request)}`, config.proxySession.issueRate)
    if (!decision.allowed) return rateLimitResponse(decision)
    const nativeClient = request.headers.get('x-rmusic-client') === 'ios-v1'
    // Prefer an explicitly supplied native credential over the anonymous iOS
    // bootstrap. The real app sends Origin on this request too; checking the
    // trusted bootstrap first would silently discard the account binding and
    // leave AVFoundation with an anonymous, playback-ineligible cookie.
    if (nativeClient && request.headers.has('authorization')) {
      const account = await resolveNativeBearerUser(request, env)
      if (!account) return proxyUnauthorized()
      return issueProxySession(request, config, account.session.id)
    }
    if (trustedSessionBootstrap(request)) return issueProxySession(request, config)
    if (!nativeClient) return proxyForbidden()
    return proxyUnauthorized()
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return plain(405, 'method not allowed\n')
  }

  if (url.pathname === '/' || url.pathname === '') {
    // HTML carries the source of truth for which asset hash is
    // current. Short cache so a redeploy's new asset URLs (the
    // `?v=…` hash baked in by build.mjs) reach the visitor's
    // browser quickly. The CSS / JS themselves can then be cached
    // moderately long — their URL is uniquely tied to their bytes
    // via the hash query param, so a content change always shows
    // up at a fresh URL.
    return staticResponse(
      request,
      'html',
      WIDGET_HTML,
      'text/html; charset=utf-8',
      'public, max-age=0, must-revalidate, s-maxage=60',
      `W/"${WIDGET_ASSET_HASH}-html"`
    )
  }
  if (url.pathname === '/widget.css') {
    const immutable = url.searchParams.get('v') === WIDGET_ASSET_HASH
    return staticResponse(
      request,
      'css',
      WIDGET_CSS,
      'text/css; charset=utf-8',
      immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300, must-revalidate',
      `W/"${WIDGET_ASSET_HASH}-css"`
    )
  }
  if (url.pathname === '/widget.js') {
    const immutable = url.searchParams.get('v') === WIDGET_ASSET_HASH
    return staticResponse(
      request,
      'js',
      WIDGET_JS,
      'text/javascript; charset=utf-8',
      immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300, must-revalidate',
      `W/"${WIDGET_ASSET_HASH}-js"`
    )
  }

  const directApiV2 = isDirectApiPath(url.pathname)
  const widgetApiV2 = url.pathname === '/api/proxy/v2' || url.pathname.startsWith('/api/proxy/v2/')
  if (directApiV2 || widgetApiV2) {
    let session = null
    let nativeAccount = null
    if (widgetApiV2) {
      if (!config.proxySession.signingSecret) {
        return plain(500, 'rmusic-widget: PROXY_SIGNING_SECRET env binding is required.\n')
      }
      session = await verifyProxySession(request, config)
      if (!session) nativeAccount = await resolveNativeBearerUser(request, env)
      if (!session && !nativeAccount) return proxyUnauthorized()
      const streamMatch = url.pathname.match(/^\/api\/proxy\/v2\/streams\/[^/]+\/[^/]+\/?$/)
      if (streamMatch) {
        let account = nativeAccount
        if (!account?.userId && session?.rsid) {
          account = await resolveAuthenticatedNativeSession(request, env, session.rsid)
        }
        if (!account?.userId) account = await resolveAuthenticatedUser(request, env)
        if (!account.userId) return playbackAuthRequired()
      }
    }

    // Apply both per-IP and per-session limits before doing upstream work.
    // 429 is cheap; an upstream call to Meting-API + audio bytes is
    // expensive and counts against the operator's egress budget.
    const ip = clientIp(request)
    const ipDecision = checkRate(`ip:${ip}`, config.rate)
    if (!ipDecision.allowed) return rateLimitResponse(ipDecision)
    const sessionIdentity = session?.sid || nativeAccount?.session?.id
    const sessionDecision = sessionIdentity ? checkRate(`session:${sessionIdentity}`, config.rate) : null
    if (sessionDecision && !sessionDecision.allowed) return rateLimitResponse(sessionDecision)
    const remaining = sessionDecision
      ? Math.min(ipDecision.remaining, sessionDecision.remaining)
      : ipDecision.remaining

    if (!config.musicApi.binding && !config.musicApi.url) {
      return plain(
        500,
        'rmusic-widget: neither MUSIC_API service binding nor MUSIC_API_URL is configured. ' +
          'Set one of them in the worker env binding tab.\n'
      )
    }
    if (widgetApiV2 && !config.musicApi.token) {
      return plain(
        500,
        'rmusic-widget: MUSIC_API_TOKEN env binding is required (master token used ' +
          'to authorize Meting V2 requests upstream).\n'
      )
    }

    // Rewriting emits relative paths (`/api/proxy/v2/...`) so the
    // browser resolves them against whatever origin the page itself
    // loaded from. No `url.origin` to guess — sidesteps the
    // bigrandall edge's HTTP-to-worker forwarding that makes
    // request.url's protocol look like plain `http:` even on HTTPS
    // visitors (which used to be a mixed-content trap when the
    // rewritten audio src ended up `http://…`).
    let response = directApiV2
      ? await passThroughApiV2(request, config)
      : await proxyApiV2(request, config)
    if (widgetApiV2) response = privateProxyResponse(response)
    // Stamp the rate-limit headers on success too, so a polite
    // client can pace itself rather than wait for a 429.
    const out = new Headers(response.headers)
    out.set('x-ratelimit-limit', String(ipDecision.limit))
    out.set('x-ratelimit-remaining', String(remaining))
    return new Response(response.body, {
      status: response.status,
      headers: out
    })
  }

  return plain(404, 'not found\n')
}

function rateLimitResponse (decision) {
  return new Response('rate limit exceeded\n', {
    status: 429,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(Math.ceil(decision.retryAfterMs / 1000)),
      'x-ratelimit-limit': String(decision.limit),
      'x-ratelimit-remaining': '0'
    }
  })
}

export default {
  async fetch (request, env, context) {
    try {
      const response = await route(request, env, context)
      return withCors(request, response)
    } catch (err) {
      const message = err && err.message ? err.message : String(err)
      try { console.error('[rmusic-widget] ' + message, err && err.stack) } catch {}
      return withCors(request, plain(500, 'internal error: ' + message + '\n'))
    }
  }
}
