// Same-origin REST proxy for Meting API V2.
//
// The browser only sees /api/proxy/v2 resources. This worker forwards every
// request to Meting /api/v2 with the master token in an Authorization header,
// then rewrites track links back to this origin. No V1 query-style endpoint or
// Meting signature ever leaks into the page.

const PUBLIC_ROOT = '/api/proxy/v2'
const UPSTREAM_ROOT = '/api/v2'
const PLAYLIST_DISCOVERY_SOURCES = ['netease', 'tencent', 'kugou', 'soda', 'baidu', 'kuwo', 'ytmusic', 'spotify', 'apple']
const AUDIO_FALLBACK_SOURCES = ['netease', 'ytmusic']
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

function artistText (track) {
  return Array.isArray(track?.artists)
    ? track.artists.map((artist) => artist?.name || artist).filter(Boolean).join(' / ')
    : ''
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
  const author = artistText(track)
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
      stream: publicResourceUrl('streams', stream.source, stream.id, source === 'tencent'
        ? { title: track.title, author }
        : {}),
      artwork: publicResourceUrl('artworks', artwork.source, artwork.id),
      lyrics: publicResourceUrl('lyrics', lyrics.source, lyrics.id),
      wordLyrics: publicResourceUrl('lyrics', lyrics.source, lyrics.id, { granularity: 'word' })
    }
  }
}

function rewritePayload (payload) {
  if (!payload || typeof payload !== 'object') return payload
  let data = payload.data
  if (Array.isArray(payload.data)) {
    data = payload.data.map((item) => item?.links?.stream
      ? rewriteTrack(item)
      : (item?.links ? { ...item, links: rewriteLinks(item.links) } : item))
  } else if (payload.data?.tracks?.items) {
    data = {
      ...payload.data,
      links: rewriteLinks(payload.data.links),
      tracks: {
        ...payload.data.tracks,
        items: payload.data.tracks.items.map(rewriteTrack)
      }
    }
  } else if (payload.data?.source && payload.data?.id && payload.data?.links?.stream) {
    data = rewriteTrack(payload.data)
  } else if (payload.data?.links) {
    data = { ...payload.data, links: rewriteLinks(payload.data.links) }
  }
  return { ...payload, data, links: rewriteLinks(payload.links) }
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

async function metadataResponse (upstream) {
  if (!upstream.ok) return passThrough(upstream)
  const raw = await upstream.text()
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    const headers = new Headers(upstream.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    headers.delete('transfer-encoding')
    return new Response(raw, { status: upstream.status, headers })
  }
  const rewritten = rewritePayload(payload)
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': upstream.headers.get('cache-control') || 'public, max-age=45',
    'x-rmusic-api-version': '2'
  })
  const sources = sourceHeader(rewritten)
  if (sources) headers.set('x-rmusic-sources', sources)
  return new Response(JSON.stringify(rewritten), { status: upstream.status, headers })
}

function copyHeader (source, target, name) {
  const value = source.get(name)
  if (value) target.set(name, value)
}

function mediaResponse (upstream, kind, fallback = null) {
  if (kind === 'stream') {
    const headers = new Headers()
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      copyHeader(upstream.headers, headers, name)
    }
    if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes')
    if (!headers.has('content-type')) headers.set('content-type', 'audio/mpeg')
    headers.set('cache-control', upstream.ok ? 'public, max-age=300' : 'no-store')
    headers.set('x-rmusic-api-version', '2')
    if (fallback) {
      headers.set('x-rmusic-fallback', fallback.source)
      headers.set('x-rmusic-original-server', fallback.originalSource)
    }
    return new Response(upstream.body, { status: upstream.status, headers })
  }
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

function normaliseText (value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function editDistance (left, right, limit = 2) {
  const a = Array.from(left)
  const b = Array.from(right)
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = b.map((_, index) => index + 1)
  previous.unshift(0)
  for (let row = 1; row <= a.length; row++) {
    const current = [row]
    let rowMinimum = row
    for (let column = 1; column <= b.length; column++) {
      const value = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      )
      current.push(value)
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > limit) return limit + 1
    previous = current
  }
  return previous[b.length]
}

function authorMatchScore (candidate, wanted) {
  if (!wanted) return 0
  if (candidate === wanted) return 6
  if (candidate && editDistance(candidate, wanted, 2) <= 2) return 4
  if (
    candidate &&
    Math.abs(candidate.length - wanted.length) <= 2 &&
    (candidate.includes(wanted) || wanted.includes(candidate))
  ) return 3
  return -4
}

function fallbackScore (track, title, author) {
  const wantedTitle = normaliseText(title)
  const wantedAuthor = normaliseText(author)
  const candidateTitle = normaliseText(track?.title)
  const candidateAuthor = normaliseText(artistText(track))
  if (!wantedTitle || !candidateTitle) return -Infinity
  let score = candidateTitle === wantedTitle
    ? 8
    : (candidateTitle.includes(wantedTitle) || wantedTitle.includes(candidateTitle) ? 3 : -Infinity)
  if (score === -Infinity) return score
  score += authorMatchScore(candidateAuthor, wantedAuthor)
  return score
}

async function resolveAudioFallback (request, config, title, author) {
  const query = [title, author].filter(Boolean).join(' ').trim()
  if (!query) return null
  for (const source of AUDIO_FALLBACK_SOURCES) {
    try {
      const params = new URLSearchParams({ query, source, limit: '10' })
      const search = await callUpstreamV2(config, request, '/tracks', params)
      if (!search.ok) continue
      const payload = await search.json()
      const ranked = (payload?.data || [])
        .map((track) => ({ track, score: fallbackScore(track, title, author) }))
        .sort((left, right) => right.score - left.score)
      const match = ranked[0]
      if (!match || match.score < 8 || !match.track?.id) continue
      const stream = resourceIdentity(
        match.track?.links?.stream,
        'streams',
        match.track.source || source,
        match.track.id
      )
      const audio = await callUpstreamV2(
        config,
        request,
        `/streams/${encodePath(stream.source)}/${encodePath(stream.id)}`,
        new URLSearchParams(),
        { accept: '*/*' }
      )
      if (audio.ok) return { upstream: audio, source: stream.source }
    } catch {}
  }
  return null
}

async function proxyStream (request, config, source, id, searchParams) {
  let upstream = await callUpstreamV2(
    config,
    request,
    `/streams/${encodePath(source)}/${encodePath(id)}`,
    new URLSearchParams(),
    { accept: '*/*' }
  )
  let fallback = null
  if (source === 'tencent' && (upstream.status === 403 || upstream.status === 404)) {
    const recovered = await resolveAudioFallback(
      request,
      config,
      searchParams.get('title') || '',
      searchParams.get('author') || ''
    )
    if (recovered) {
      upstream = recovered.upstream
      fallback = { source: recovered.source, originalSource: source }
    }
  }
  return mediaResponse(upstream, 'stream', fallback)
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
      return metadataResponse(upstream)
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
    const path = parts.length === 3
      ? `/tracks/${encodePath(parts[1])}/${encodePath(parts[2])}`
      : '/tracks'
    return metadataResponse(await callUpstreamV2(config, request, path, url.searchParams))
  }
  if (resource === 'albums' || resource === 'artists') {
    if (parts.length !== 3) return notFound(url.pathname)
    return metadataResponse(await callUpstreamV2(
      config,
      request,
      `/${resource}/${encodePath(parts[1])}/${encodePath(parts[2])}`,
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
  if (resource === 'streams' && parts.length === 3) {
    return proxyStream(request, config, parts[1], parts[2], url.searchParams)
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
