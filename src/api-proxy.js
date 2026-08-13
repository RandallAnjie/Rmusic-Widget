// Same-origin REST proxy for Meting API V2.
//
// The browser only sees /api/proxy/v2 resources. This worker forwards every
// request to Meting /api/v2 with the master token in an Authorization header,
// then rewrites track links back to this origin. No V1 query-style endpoint or
// Meting signature ever leaks into the page.

const PUBLIC_ROOT = '/api/proxy/v2'
const UPSTREAM_ROOT = '/api/v2'
const PLAYLIST_DISCOVERY_SOURCES = ['netease', 'tencent', 'kugou', 'soda', 'baidu', 'kuwo', 'ytmusic', 'spotify', 'apple']
const DIRECT_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'x-meting-token',
  'range',
  'if-none-match',
  'if-modified-since'
]

function upstreamUrl (config, resourcePath, searchParams = new URLSearchParams()) {
  const suffix = searchParams.toString()
  const path = `${UPSTREAM_ROOT}${resourcePath}${suffix ? `?${suffix}` : ''}`
  return config.musicApi.binding
    ? `https://music-api.internal${path}`
    : `${config.musicApi.url}${path}`
}

function upstreamInit (config, request, extra = {}) {
  const headers = new Headers(extra.headers)
  headers.set('accept', extra.accept || 'application/json')
  headers.set('authorization', `Bearer ${config.musicApi.token}`)
  const range = request?.headers?.get('range')
  if (range) headers.set('range', range)
  for (const name of ['if-none-match', 'if-modified-since']) {
    const value = request?.headers?.get(name)
    if (value) headers.set(name, value)
  }
  return {
    method: 'GET',
    redirect: 'manual',
    ...extra,
    headers
  }
}

export function callUpstreamV2 (config, request, resourcePath, searchParams, extra = {}) {
  const url = upstreamUrl(config, resourcePath, searchParams)
  const init = upstreamInit(config, request, extra)
  return config.musicApi.binding
    ? config.musicApi.binding.fetch(url, init)
    : fetch(url, init)
}

function directApiUrl (request, config) {
  const incoming = new URL(request.url)
  if (config.musicApi.binding) {
    // RandallFlare may hand the Worker an internal http: URL even when the
    // visitor used HTTPS. Force the public scheme so Meting emits usable
    // same-origin links in its REST envelope.
    return `https://${incoming.host}${incoming.pathname}${incoming.search}`
  }
  return `${config.musicApi.url}${incoming.pathname}${incoming.search}`
}

function directInit (request) {
  const headers = new Headers()
  for (const name of DIRECT_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  return {
    method: request.method,
    headers,
    redirect: 'manual'
  }
}

function rewriteDirectApiLinks (value, publicOrigin) {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteDirectApiLinks(item, publicOrigin))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteDirectApiLinks(item, publicOrigin)])
    )
  }
  if (typeof value !== 'string' || !value.includes('/api/v2')) return value
  try {
    const url = new URL(value)
    const rootIndex = url.pathname.lastIndexOf('/api/v2')
    if (rootIndex < 0) return value
    url.searchParams.delete('token')
    url.searchParams.delete('auth')
    return `${publicOrigin}${url.pathname.slice(rootIndex)}${url.search}`
  } catch {
    return value
  }
}

async function directResponse (upstream, publicOrigin, headOnly) {
  const contentType = upstream.headers.get('content-type') || ''
  if (!headOnly && /(?:application\/json|application\/problem\+json)/i.test(contentType)) {
    const raw = await upstream.text()
    try {
      const payload = rewriteDirectApiLinks(JSON.parse(raw), publicOrigin)
      const headers = new Headers(upstream.headers)
      headers.delete('content-encoding')
      headers.delete('content-length')
      headers.delete('transfer-encoding')
      return new Response(JSON.stringify(payload), { status: upstream.status, headers })
    } catch {
      const headers = new Headers(upstream.headers)
      headers.delete('content-encoding')
      headers.delete('content-length')
      headers.delete('transfer-encoding')
      return new Response(raw, { status: upstream.status, headers })
    }
  }
  return passThrough(upstream, headOnly)
}

/**
 * Same-origin public V2 surface for music.bigrandall.io.
 *
 * Unlike the widget-only /api/proxy/v2 route, this path never injects the
 * server-side MUSIC_API_TOKEN. Authentication remains the caller's
 * responsibility and is enforced by Meting itself.
 */
export async function passThroughApiV2 (request, config) {
  const incoming = new URL(request.url)
  const url = directApiUrl(request, config)
  const init = directInit(request)
  const upstream = config.musicApi.binding
    ? await config.musicApi.binding.fetch(url, init)
    : await fetch(url, init)
  return directResponse(upstream, `https://${incoming.host}`, request.method === 'HEAD')
}

function encodePath (value) {
  return encodeURIComponent(String(value))
}

function resourceIdentity (value, expectedResource, fallbackSource, fallbackId) {
  if (typeof value === 'string' && value) {
    try {
      const url = new URL(value, 'https://music-api.internal')
      const parts = url.pathname.split('/').filter(Boolean)
      const index = parts.lastIndexOf(expectedResource)
      if (index >= 0 && parts[index + 1] && parts[index + 2]) {
        return {
          source: decodeURIComponent(parts[index + 1]),
          id: decodeURIComponent(parts[index + 2])
        }
      }
    } catch {}
  }
  return { source: fallbackSource, id: fallbackId }
}

function publicResourceUrl (resource, source, id, query = {}) {
  if (!source || !id) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const suffix = params.toString()
  return `${PUBLIC_ROOT}/${resource}/${encodePath(source)}/${encodePath(id)}${suffix ? `?${suffix}` : ''}`
}

function rewriteApiLink (value) {
  if (typeof value !== 'string' || !value) return value
  try {
    const url = new URL(value, 'https://music-api.internal')
    const rootIndex = url.pathname.lastIndexOf('/api/v2')
    if (rootIndex < 0) return value
    const params = new URLSearchParams(url.search)
    params.delete('auth')
    params.delete('token')
    const suffix = params.toString()
    return `${PUBLIC_ROOT}${url.pathname.slice(rootIndex + '/api/v2'.length)}${suffix ? `?${suffix}` : ''}`
  } catch {
    return value
  }
}

function rewriteLinks (links) {
  if (!links || typeof links !== 'object') return links
  return Object.fromEntries(
    Object.entries(links).map(([key, value]) => [key, rewriteApiLink(value)])
  )
}

function rewriteTrack (track) {
  if (!track || typeof track !== 'object') return track
  const source = track.source
  const id = track.id
  const stream = resourceIdentity(track?.links?.stream, 'streams', source, id)
  const artwork = resourceIdentity(track?.links?.artwork, 'artworks', source, id)
  const lyrics = resourceIdentity(track?.links?.lyrics, 'lyrics', source, id)
  return {
    ...track,
    artwork: track.artwork
      ? {
          ...track.artwork,
          url: publicResourceUrl('artworks', artwork.source, artwork.id)
        }
      : track.artwork,
    links: {
      ...track.links,
      self: publicResourceUrl('tracks', source, id),
      stream: publicResourceUrl('streams', stream.source, stream.id),
      artwork: publicResourceUrl('artworks', artwork.source, artwork.id),
      lyrics: publicResourceUrl('lyrics', lyrics.source, lyrics.id),
      wordLyrics: publicResourceUrl('lyrics', lyrics.source, lyrics.id, { granularity: 'word' })
    }
  }
}

function rewriteData (value) {
  if (Array.isArray(value)) return value.map(rewriteData)
  if (!value || typeof value !== 'object') return value
  if (value.source && value.id && value.links?.stream) return rewriteTrack(value)
  const output = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, rewriteData(item)])
  )
  if (value.links) output.links = rewriteLinks(value.links)
  return output
}

function rewritePayload (payload) {
  if (!payload || typeof payload !== 'object') return payload
  return { ...payload, data: rewriteData(payload.data), links: rewriteLinks(payload.links) }
}

function sourceHeader (payload) {
  if (Array.isArray(payload?.meta?.sources)) {
    return payload.meta.sources
      .filter((item) => item?.status === 'fulfilled' && Number(item?.count || 0) > 0)
      .map((item) => item.source)
      .filter(Boolean)
      .join(',')
  }
  if (payload?.data?.source) return String(payload.data.source)
  return ''
}

function metadataPayloadResponse (upstream, payload) {
  const rewritten = rewritePayload(payload)
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': upstream.headers.get('cache-control') || 'public, max-age=45',
    'x-rmusic-api-version': '2'
  })
  for (const name of ['etag', 'age', 'x-cache-source', 'server-timing']) copyHeader(upstream.headers, headers, name)
  const sources = sourceHeader(rewritten)
  if (sources) headers.set('x-rmusic-sources', sources)
  return new Response(JSON.stringify(rewritten), { status: upstream.status, headers })
}

async function metadataResponse (upstream) {
  if (!upstream.ok) return passThrough(upstream)
  const raw = await upstream.text()
  try {
    return metadataPayloadResponse(upstream, JSON.parse(raw))
  } catch {
    const headers = new Headers(upstream.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    headers.delete('transfer-encoding')
    return new Response(raw, { status: upstream.status, headers })
  }
}

function copyHeader (source, target, name) {
  const value = source.get(name)
  if (value) target.set(name, value)
}

function byteSignature (bytes, offset, signature) {
  if (!(bytes instanceof Uint8Array) || bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

function detectAudioFormat (bytes) {
  if (byteSignature(bytes, 0, [0x66, 0x4c, 0x61, 0x43])) return { contentType: 'audio/flac', codec: 'flac' }
  if (byteSignature(bytes, 0, [0x4f, 0x67, 0x67, 0x53])) return { contentType: 'audio/ogg', codec: 'ogg' }
  if (byteSignature(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && byteSignature(bytes, 8, [0x57, 0x41, 0x56, 0x45])) {
    return { contentType: 'audio/wav', codec: 'wav' }
  }
  if (byteSignature(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return { contentType: 'audio/webm', codec: 'webm' }
  if (byteSignature(bytes, 4, [0x66, 0x74, 0x79, 0x70])) return { contentType: 'audio/mp4', codec: 'm4a' }
  if (byteSignature(bytes, 0, [0x49, 0x44, 0x33])) return { contentType: 'audio/mpeg', codec: 'mp3' }
  if (bytes instanceof Uint8Array && bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0) {
    return (bytes[1] & 0x06) === 0
      ? { contentType: 'audio/aac', codec: 'aac' }
      : { contentType: 'audio/mpeg', codec: 'mp3' }
  }
  return null
}

function prependStreamChunk (reader, firstChunk, firstDone) {
  let pending = true
  return new ReadableStream({
    async pull (controller) {
      if (pending) {
        pending = false
        if (firstChunk?.byteLength) controller.enqueue(firstChunk)
        if (firstDone) controller.close()
        return
      }
      const next = await reader.read()
      if (next.done) controller.close()
      else controller.enqueue(next.value)
    },
    cancel (reason) {
      return reader.cancel(reason)
    }
  })
}

async function streamResponse (upstream) {
  const headers = new Headers()
  for (const name of [
    'content-type', 'content-length', 'content-range', 'accept-ranges',
    'x-meting-quality', 'x-meting-quality-requested', 'x-meting-codec', 'x-meting-bitrate-kbps'
  ]) {
    copyHeader(upstream.headers, headers, name)
  }

  let body = upstream.body
  const contentRange = headers.get('content-range') || ''
  const startsAtBeginning = !contentRange || /^bytes\s+0-/i.test(contentRange)
  if (upstream.ok && body && startsAtBeginning) {
    const reader = body.getReader()
    const first = await reader.read()
    const detected = detectAudioFormat(first.value)
    if (detected) {
      headers.set('content-type', detected.contentType)
      if (!headers.has('x-meting-codec')) headers.set('x-meting-codec', detected.codec)
    }
    body = prependStreamChunk(reader, first.value, first.done)
  }

  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes')
  if (!headers.has('content-type')) headers.set('content-type', 'audio/mpeg')
  headers.set('cache-control', upstream.ok ? 'public, max-age=300' : 'no-store')
  headers.set('x-rmusic-api-version', '2')
  return new Response(body, { status: upstream.status, headers })
}

function mediaResponse (upstream, kind) {
  if (kind === 'lyrics') {
    const headers = new Headers({
      'content-type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
      'cache-control': upstream.ok ? 'public, max-age=300' : 'no-store',
      'x-rmusic-api-version': '2'
    })
    return new Response(upstream.body, { status: upstream.status, headers })
  }
  const response = passThrough(upstream)
  const headers = new Headers(response.headers)
  headers.set('x-rmusic-api-version', '2')
  return new Response(response.body, { status: response.status, headers })
}

async function proxyStream (request, config, source, id, searchParams) {
  const params = new URLSearchParams()
  for (const name of ['quality', 'br']) {
    const value = searchParams.get(name)
    if (value) params.set(name, value)
  }
  const upstream = await callUpstreamV2(
    config,
    request,
    `/streams/${encodePath(source)}/${encodePath(id)}`,
    params,
    { accept: '*/*' }
  )
  return streamResponse(upstream)
}

async function discoverPlaylist (request, config, id, searchParams) {
  for (const source of PLAYLIST_DISCOVERY_SOURCES) {
    try {
      const upstream = await callUpstreamV2(
        config,
        request,
        `/playlists/${encodePath(source)}/${encodePath(id)}`,
        searchParams
      )
      if (!upstream.ok) continue
      const payload = await upstream.json()
      const data = payload?.data
      const items = Array.isArray(data?.tracks?.items) ? data.tracks.items.length : 0
      const total = Math.max(
        Number(data?.tracks?.total || 0),
        Number(data?.stats?.trackCount || 0),
        items
      )
      // Numeric IDs can exist on several providers. Some upstreams return a
      // placeholder 200 response for an unknown ID, so accepting the first
      // successful status can silently select the wrong platform. A detected
      // playlist must contain at least one real track; share links already
      // carry an explicit source and do not use this discovery route.
      if (!data?.source || !data?.id || total <= 0) continue
      return metadataPayloadResponse(upstream, payload)
    } catch {}
  }
  return Response.json({
    type: 'about:blank',
    title: 'PlaylistNotFound',
    status: 404,
    detail: `未能在支持的平台找到歌单 ${id}`,
    apiVersion: '2'
  }, {
    status: 404,
    headers: { 'content-type': 'application/problem+json; charset=utf-8' }
  })
}

function pathParts (pathname) {
  return pathname
    .slice(PUBLIC_ROOT.length)
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try { return decodeURIComponent(part) } catch { return part }
    })
}

export async function proxyApiV2 (request, config) {
  const url = new URL(request.url)
  const parts = pathParts(url.pathname)
  const resource = parts[0] || ''

  if (!parts.length) {
    return metadataResponse(await callUpstreamV2(config, request, '', url.searchParams))
  }
  if (resource === 'sources' && parts.length <= 2) {
    return metadataResponse(await callUpstreamV2(
      config,
      request,
      parts.length === 2 ? `/sources/${encodePath(parts[1])}` : '/sources',
      url.searchParams
    ))
  }
  if (resource === 'tracks') {
    if (![1, 2, 3].includes(parts.length)) return notFound(url.pathname)
    const path = parts.length === 3
      ? `/tracks/${encodePath(parts[1])}/${encodePath(parts[2])}`
      : (parts.length === 2 ? `/tracks/${encodePath(parts[1])}` : '/tracks')
    return metadataResponse(await callUpstreamV2(config, request, path, url.searchParams))
  }
  if (resource === 'albums' || resource === 'artists') {
    const children = resource === 'albums' ? ['tracks'] : ['top-tracks', 'albums']
    if (parts.length !== 3 && !(parts.length === 4 && children.includes(parts[3]))) return notFound(url.pathname)
    return metadataResponse(await callUpstreamV2(
      config,
      request,
      `/${resource}/${encodePath(parts[1])}/${encodePath(parts[2])}${parts.length === 4 ? `/${parts[3]}` : ''}`,
      url.searchParams
    ))
  }
  if (resource === 'playlists') {
    if (parts.length !== 3 && !(parts.length === 4 && parts[3] === 'tracks')) return notFound(url.pathname)
    if (parts[1] === 'aggregate') return discoverPlaylist(request, config, parts[2], url.searchParams)
    const suffix = parts[3] === 'tracks' ? '/tracks' : ''
    return metadataResponse(await callUpstreamV2(
      config,
      request,
      `/playlists/${encodePath(parts[1])}/${encodePath(parts[2])}${suffix}`,
      url.searchParams
    ))
  }
  if (resource === 'streams' && parts.length === 4 && parts[3] === 'options') {
    return metadataResponse(await callUpstreamV2(
      config,
      request,
      `/streams/${encodePath(parts[1])}/${encodePath(parts[2])}/options`,
      url.searchParams
    ))
  }
  if (resource === 'streams' && parts.length === 3) {
    return proxyStream(request, config, parts[1], parts[2], url.searchParams)
  }
  if (['charts', 'new-releases', 'recommendations', 'discovery'].includes(resource) && parts.length === 1) {
    return metadataResponse(await callUpstreamV2(config, request, `/${resource}`, url.searchParams))
  }
  if (resource === 'artworks' && parts.length === 3) {
    const upstream = await callUpstreamV2(
      config,
      request,
      `/artworks/${encodePath(parts[1])}/${encodePath(parts[2])}`,
      new URLSearchParams(),
      { accept: 'image/*' }
    )
    return mediaResponse(upstream, 'artwork')
  }
  if (resource === 'lyrics' && parts.length === 3) {
    const params = new URLSearchParams()
    if (url.searchParams.get('granularity') === 'word') params.set('granularity', 'word')
    const upstream = await callUpstreamV2(
      config,
      request,
      `/lyrics/${encodePath(parts[1])}/${encodePath(parts[2])}`,
      params,
      { accept: 'text/plain' }
    )
    return mediaResponse(upstream, 'lyrics')
  }
  return notFound(url.pathname)
}

function notFound (pathname) {
  return Response.json({
    type: 'about:blank',
    title: 'NotFound',
    status: 404,
    detail: `V2 代理资源不存在: ${pathname}`,
    apiVersion: '2'
  }, {
    status: 404,
    headers: { 'content-type': 'application/problem+json; charset=utf-8' }
  })
}

function passThrough (upstream, headOnly = false) {
  const headers = new Headers()
  for (const [key, value] of upstream.headers) {
    const name = key.toLowerCase()
    if (name === 'content-encoding' || name === 'transfer-encoding') continue
    headers.set(key, value)
  }
  return new Response(headOnly ? null : upstream.body, { status: upstream.status, headers })
}
