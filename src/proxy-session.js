// Signed, short-lived sessions for the token-injecting proxy.
//
// The HMAC secret never leaves the Worker. The browser receives only an
// HttpOnly, Secure, SameSite=Strict cookie, so other sites cannot reuse a
// visitor's proxy authority through fetch(), <img> or <audio> hotlinks. A
// verified native RMusic Bearer may issue the same cookie for URLSession.

import { clientIp } from './rate-limit.js'

const COOKIE_NAME = '__Host-rmusic_proxy'
const SESSION_VERSION = 1
const encoder = new TextEncoder()
const importedKeys = new Map()

function base64UrlEncode (value) {
  const bytes = value instanceof Uint8Array ? value : encoder.encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecodeText (value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function safeEqual (left, right) {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

async function signingKey (secret) {
  let key = importedKeys.get(secret)
  if (!key) {
    key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    importedKeys.set(secret, key)
  }
  return key
}

async function signatureFor (secret, payload) {
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload))
  return base64UrlEncode(new Uint8Array(signature))
}

function cookieValue (request) {
  const cookie = request.headers.get('cookie') || ''
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === COOKIE_NAME) return part.slice(separator + 1).trim()
  }
  return ''
}

function audience (request) {
  return new URL(request.url).host.toLowerCase()
}

function randomSessionId () {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

function clientNetwork (request) {
  const value = clientIp(request).trim().toLowerCase()
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/)
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0/24`
  // IPv6 privacy addresses can rotate their host portion while a tab is
  // open. Keeping the first four written groups approximates a /64 without
  // exposing the address itself in the signed cookie.
  if (value.includes(':')) return `${value.split(':').slice(0, 4).join(':')}::/64`
  return value || '<unknown>'
}

async function clientFingerprint (request) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(clientNetwork(request)))
  return base64UrlEncode(new Uint8Array(digest).slice(0, 16))
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

export function trustedSessionBootstrap (request) {
  if (request.method !== 'POST') return false
  const client = request.headers.get('x-rmusic-client')
  if (client !== 'widget-v2' && client !== 'ios-v1') return false
  const fetchSite = request.headers.get('sec-fetch-site')
  if (client === 'widget-v2' && fetchSite && fetchSite !== 'same-origin') return false
  // URLSession does not send browser Fetch Metadata. Requiring its absence for
  // iOS prevents page JavaScript from impersonating the native bootstrap.
  if (client === 'ios-v1' && fetchSite) return false
  return samePublicOrigin(request, request.headers.get('origin'))
}

export async function issueProxySession (request, config, accountSessionId = '') {
  const now = Math.floor(Date.now() / 1000)
  const ttl = config.proxySession.ttlSeconds
  const claims = {
    v: SESSION_VERSION,
    aud: audience(request),
    ip: await clientFingerprint(request),
    sid: randomSessionId(),
    iat: now,
    exp: now + ttl
  }
  // A native RMusic bearer can bootstrap the same short-lived HttpOnly
  // proxy cookie used by the widget. The database session identifier is not
  // itself a credential and is covered by the proxy HMAC; it lets playback
  // re-check revocation without putting either bearer token in the cookie.
  if (accountSessionId) claims.rsid = String(accountSessionId)
  const payload = base64UrlEncode(JSON.stringify(claims))
  const signature = await signatureFor(config.proxySession.signingSecret, `rmusic-proxy-session:${payload}`)
  const token = `${payload}.${signature}`
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'set-cookie': `${COOKIE_NAME}=${token}; Path=/; Max-Age=${ttl}; HttpOnly; Secure; SameSite=Strict`
  })
  return new Response(JSON.stringify({
    authenticated: true,
    accountAuthenticated: Boolean(accountSessionId),
    expiresAt: (now + ttl) * 1000,
    refreshAfter: (now + Math.floor(ttl / 2)) * 1000
  }), { status: 201, headers })
}

export async function verifyProxySession (request, config) {
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') return null
  const token = cookieValue(request)
  if (!token || token.length > 2048) return null
  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null
  const encodedPayload = token.slice(0, separator)
  const suppliedSignature = token.slice(separator + 1)
  try {
    const expectedSignature = await signatureFor(
      config.proxySession.signingSecret,
      `rmusic-proxy-session:${encodedPayload}`
    )
    if (!safeEqual(suppliedSignature, expectedSignature)) return null
    const payload = JSON.parse(base64UrlDecodeText(encodedPayload))
    const now = Math.floor(Date.now() / 1000)
    if (payload.v !== SESSION_VERSION) return null
    if (payload.aud !== audience(request)) return null
    if (payload.ip !== await clientFingerprint(request)) return null
    if (typeof payload.sid !== 'string' || payload.sid.length < 12) return null
    if (!Number.isFinite(payload.iat) || payload.iat > now + 60) return null
    if (!Number.isFinite(payload.exp) || payload.exp <= now) return null
    if (payload.rsid !== undefined && (typeof payload.rsid !== 'string' || payload.rsid.length < 8 || payload.rsid.length > 128)) return null
    return payload
  } catch {
    return null
  }
}

export function proxyUnauthorized () {
  return Response.json({
    type: 'about:blank',
    title: 'ProxySessionRequired',
    status: 401,
    detail: '请先建立 RMusic 短期代理会话，或提供有效的手机客户端 Bearer',
    apiVersion: '2'
  }, {
    status: 401,
    headers: {
      'content-type': 'application/problem+json; charset=utf-8',
      'cache-control': 'no-store',
      'www-authenticate': 'RMusicSession realm="RMusic Widget", Bearer realm="RMusic Native"'
    }
  })
}

export function proxyForbidden () {
  return Response.json({
    type: 'about:blank',
    title: 'Forbidden',
    status: 403,
    detail: '代理会话只能由同源 RMusic 页面或已授权手机客户端签发',
    apiVersion: '2'
  }, {
    status: 403,
    headers: {
      'content-type': 'application/problem+json; charset=utf-8',
      'cache-control': 'no-store'
    }
  })
}

export function privateProxyResponse (response) {
  const headers = new Headers(response.headers)
  const existing = headers.get('cache-control') || ''
  if (response.ok) {
    const maxAge = existing.match(/max-age=(\d+)/i)?.[1] || '0'
    headers.set('cache-control', `private, max-age=${maxAge}`)
  } else {
    headers.set('cache-control', 'no-store')
  }
  headers.append('vary', 'Cookie')
  headers.append('vary', 'Authorization')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

export { COOKIE_NAME as PROXY_SESSION_COOKIE }
