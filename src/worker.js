// Cloudflare / RandallFlare Workers entrypoint for rmusic-widget.
//
// Two surfaces:
//   GET /                  → serves the widget shell
//   GET /widget.css        → CSS (separate file = browser-cacheable)
//   GET /widget.js         → client-side JS (same)
//   GET /api/proxy?…       → forwards to the Meting-API binding,
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
import { proxyApi } from './api-proxy.js'

// Build-time string constants. build.mjs passes the contents of
// src/widget/{index.html,index.css,client.js} through esbuild's
// `define`, which literal-substitutes each identifier with the file's
// text before bundling. The references look unresolved when you read
// this file pre-build — that's expected, the worker only ever runs
// from the bundled dist/worker.js.
/* global __WIDGET_HTML__, __WIDGET_CSS__, __WIDGET_JS__ */
const WIDGET_HTML = __WIDGET_HTML__
const WIDGET_CSS = __WIDGET_CSS__
const WIDGET_JS = __WIDGET_JS__

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Range',
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
    // The widget HTML references /widget.css and /widget.js. Both
    // shipped as separate files so the browser caches them across
    // navigations, instead of inlining them into every shell render.
    return new Response(WIDGET_HTML, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300'
      }
    })
  }
  if (url.pathname === '/widget.css') {
    return new Response(WIDGET_CSS, {
      headers: {
        'content-type': 'text/css; charset=utf-8',
        'cache-control': 'public, max-age=3600'
      }
    })
  }
  if (url.pathname === '/widget.js') {
    return new Response(WIDGET_JS, {
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=3600'
      }
    })
  }

  if (url.pathname === '/api/proxy') {
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
    if (!config.musicApi.token) {
      return plain(
        500,
        'rmusic-widget: MUSIC_API_TOKEN env binding is required (master token used ' +
          'to sign search/song/playlist responses upstream).\n'
      )
    }

    const params = {
      server: url.searchParams.get('server') || 'ytmusic',
      type: url.searchParams.get('type') || 'search',
      id: url.searchParams.get('id') ?? '',
      r: url.searchParams.get('r') ?? undefined
    }
    // Rewriting needs the externally-visible origin, not what the
    // worker sees on the inside of the bigrandall edge. The edge
    // terminates TLS and forwards to the worker over plain HTTP, so
    // request.url's protocol comes through as `http:` even when the
    // visitor loaded the widget over HTTPS. If we used url.origin
    // verbatim the embedded url/pic/lrc would all be `http://...`
    // and a mixed-content-aware browser would block the audio.
    //
    // x-forwarded-proto is what bigrandall (and CF / nginx /
    // caddy / etc.) sets. Fall through to url.protocol only for
    // strictly-local development.
    const forwardedProto = request.headers.get('x-forwarded-proto')
    const proto = forwardedProto || url.protocol.slice(0, -1)
    const baseOrigin = `${proto}://${url.host}`
    const response = await proxyApi(request, config, params, baseOrigin)
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
