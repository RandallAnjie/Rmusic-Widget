// Cloudflare / RandallFlare Workers entrypoint for rmusic-widget.
//
// Two surfaces:
//   GET /                  → serves the widget shell
//   GET /widget.css        → CSS (separate file = browser-cacheable)
//   GET /widget.js         → client-side JS (same)
//   GET /api/v2/…          → caller-authenticated Meting V2 passthrough
//   GET /api/proxy/v2/…    → REST proxy for the Meting API V2,
//                            injecting the master token server-side
//                            and rate-limiting per client IP.
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

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization, X-Meting-Token, Range',
  'access-control-expose-headers': 'Content-Range, WWW-Authenticate, X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RMusic-Api-Version, X-RMusic-Fallback, X-RMusic-Original-Server, X-RMusic-Sources',
  'access-control-max-age': '86400'
}

function withCors (response) {
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

function plain (status, body) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
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

async function route (request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return plain(405, 'method not allowed\n')
  }

  const url = new URL(request.url)
  const config = buildConfig(env)

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

  const directApiV2 = url.pathname === '/api/v2' || url.pathname.startsWith('/api/v2/')
  const widgetApiV2 = url.pathname === '/api/proxy/v2' || url.pathname.startsWith('/api/proxy/v2/')
  if (directApiV2 || widgetApiV2) {
    // Apply the per-IP rate limit before doing any upstream work.
    // 429 is cheap; an upstream call to Meting-API + audio bytes is
    // expensive and counts against the operator's egress budget.
    const ip = clientIp(request)
    const decision = checkRate(ip, config.rate)
    if (!decision.allowed) {
      return new Response('rate limit exceeded\n', {
        status: 429,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'retry-after': String(Math.ceil(decision.retryAfterMs / 1000)),
          'x-ratelimit-limit': String(decision.limit),
          'x-ratelimit-remaining': '0'
        }
      })
    }

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
    const response = directApiV2
      ? await passThroughApiV2(request, config)
      : await proxyApiV2(request, config)
    // Stamp the rate-limit headers on success too, so a polite
    // client can pace itself rather than wait for a 429.
    const out = new Headers(response.headers)
    out.set('x-ratelimit-limit', String(decision.limit))
    out.set('x-ratelimit-remaining', String(decision.remaining))
    return new Response(response.body, {
      status: response.status,
      headers: out
    })
  }

  return plain(404, 'not found\n')
}

export default {
  async fetch (request, env) {
    try {
      const response = await route(request, env)
      return withCors(response)
    } catch (err) {
      const message = err && err.message ? err.message : String(err)
      try { console.error('[rmusic-widget] ' + message, err && err.stack) } catch {}
      return withCors(plain(500, 'internal error: ' + message + '\n'))
    }
  }
}
