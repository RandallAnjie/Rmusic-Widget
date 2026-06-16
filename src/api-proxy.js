// One-stop proxy to the Meting-API worker. Three response shapes
// flow back through here, and each gets a slightly different post-
// processing pass:
//
//   1. JSON array of tracks (search / song / playlist responses)
//      → rewrite the embedded url/pic/lrc fields so the client only
//        ever sees this worker's host (rate limit applies, master
//        token stays here).
//   2. 302 redirect (pic) → preserve as-is so the <img> follows it
//      to the upstream cover CDN.
//   3. Audio stream + content-range (url) → stream-through with
//      Range header forwarded, body never buffered.
//   4. Plain text / other (lrc) → stream-through unchanged.
//
// Token injection is centralised: every upstream call adds
// `&token=<MUSIC_API_TOKEN>`. The widget doesn't know the token
// exists — it just calls /api/proxy and gets back whatever the
// Meting-API decided to serve.

const WIDGET_REWRITTEN_PATH = '/api/proxy'

export async function callUpstream (config, type, params, init = {}) {
  const usp = new URLSearchParams()
  // Carry the original server/type/id triple plus any other
  // pass-through params the caller wanted.
  if (params.server) usp.set('server', params.server)
  usp.set('type', type)
  if (params.id !== undefined) usp.set('id', params.id)
  if (params.auth) usp.set('auth', params.auth)
  if (params.r !== undefined) usp.set('r', params.r)
  if (config.musicApi.token) usp.set('token', config.musicApi.token)
  // Host part is arbitrary when going through the service binding —
  // bigrandall routes via the binding object, not DNS — so we use a
  // sentinel so any accidental escapees are obviously misrouted. The
  // URL fallback path uses the operator-supplied host.
  const url = config.musicApi.binding
    ? `https://music-api.internal/api?${usp}`
    : `${config.musicApi.url}/api?${usp}`
  if (config.musicApi.binding) {
    return config.musicApi.binding.fetch(url, init)
  }
  return fetch(url, init)
}

/**
 * Forward Range header and any browser-supplied request headers we
 * want to honour. Excludes hop-by-hop and host-specific headers that
 * bigrandall would otherwise reject or double up.
 *
 * `redirect: 'manual'` is important: the Meting-API answers /pic
 * with a 302 to the upstream cover CDN, and we want to pass that
 * 302 straight through to the visitor's <img> tag so the browser
 * fetches the image directly. Without `manual`, the worker's fetch
 * follows the redirect itself, then hands us whatever the CDN
 * happens to return (sometimes a 404 for stale ids, sometimes the
 * raw image bytes — neither is what the browser expects from a
 * `pic` response).
 */
function streamInit (request) {
  const headers = {}
  const range = request.headers.get('range')
  if (range) headers.range = range
  return { method: 'GET', headers, redirect: 'manual' }
}

/**
 * Build the public-facing URL the widget should hit. Emitted as a
 * scheme-and-host-less path so the browser resolves it against the
 * page's own origin. Side-steps the whole `x-forwarded-proto` /
 * `url.origin === http://...-internal-...` mess that bigrandall's
 * edge layer creates — whatever protocol the visitor came in on,
 * a relative URL stays on that protocol with no inference needed.
 * Only carries server/type/id — auth and token get re-minted server-
 * side on the next round-trip.
 */
function publicProxyUrl (server, type, id) {
  const usp = new URLSearchParams({ server, type, id: String(id) })
  return `${WIDGET_REWRITTEN_PATH}?${usp}`
}

/**
 * Rewrite the embedded url/pic/lrc in a search/song/playlist
 * response so the widget calls back into this worker rather than
 * hitting the Meting-API directly. The Meting-API embeds an `auth=`
 * HMAC that's only valid against its own METING_TOKEN — useless to
 * us — so we strip it and let our /api/proxy re-mint with the same
 * master token at call time.
 */
function rewriteTrackList (tracks, server) {
  return tracks.map((t) => {
    // Use the Meting-API's url to extract the per-resource id. The
    // shape is `<host>/api?server=...&type=url&id=<X>&auth=...` —
    // we only need <X>.
    const urlId = pickIdFromUrl(t.url)
    const picId = pickIdFromUrl(t.pic)
    const lrcId = pickIdFromUrl(t.lrc)
    // lrcpword is the optional word-level lyric URL Meting-API
    // started emitting alongside lrc. We rewrite it the same way
    // so the widget hits our /api/proxy?type=lrcpword path; sources
    // without word-level data fall back to plain LRC server-side.
    const lrcpwordId = pickIdFromUrl(t.lrcpword)
    const out = {
      title: t.title,
      author: t.author,
      url: urlId ? publicProxyUrl(server, 'url', urlId) : t.url,
      pic: picId ? publicProxyUrl(server, 'pic', picId) : t.pic,
      lrc: lrcId ? publicProxyUrl(server, 'lrc', lrcId) : t.lrc
    }
    if (lrcpwordId) {
      out.lrcpword = publicProxyUrl(server, 'lrcpword', lrcpwordId)
    } else if (t.lrcpword) {
      out.lrcpword = t.lrcpword
    }
    return out
  })
}

function pickIdFromUrl (u) {
  if (typeof u !== 'string' || !u) return null
  try {
    const parsed = new URL(u)
    return parsed.searchParams.get('id')
  } catch {
    return null
  }
}

/**
 * Main entry called by the worker for /api/proxy?server=X&type=Y&id=Z.
 * Handles auth-bearing types (url/pic/lrc) and metadata types
 * (search/song/album/artist/playlist) the same way: forward, decorate.
 */
export async function proxyApi (request, config, params) {
  const { server, type, id, r } = params
  const upstream = await callUpstream(
    config,
    type,
    { server, id, r },
    streamInit(request)
  )

  // Audio path: stream-through with the original status (200 / 206 /
  // 4xx) preserved, and only the headers a player actually needs
  // copied over. Body is the upstream ReadableStream, no buffering.
  if (type === 'url') {
    const out = new Headers()
    copyHeader(upstream.headers, out, 'content-type')
    copyHeader(upstream.headers, out, 'content-length')
    copyHeader(upstream.headers, out, 'content-range')
    copyHeader(upstream.headers, out, 'accept-ranges')
    if (!out.has('accept-ranges')) out.set('accept-ranges', 'bytes')
    if (!out.has('content-type')) out.set('content-type', 'audio/mpeg')
    // Short cache so a viral row is deduped at the CDN layer but not
    // long enough to outlast any upstream signed-URL expiry.
    out.set('cache-control', 'public, max-age=300')
    return new Response(upstream.body, { status: upstream.status, headers: out })
  }

  // Pic path: Meting-API answers 302 to a CDN image. Pass the
  // redirect through; <img> follows it client-side.
  if (type === 'pic') {
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
      return new Response(null, {
        status: upstream.status,
        headers: {
          location: upstream.headers.get('location'),
          'cache-control': 'public, max-age=3600'
        }
      })
    }
    return passThrough(upstream)
  }

  // Lrc path: text/plain, stream-through.
  if (type === 'lrc' || type === 'lrcpword') {
    const out = new Headers()
    copyHeader(upstream.headers, out, 'content-type')
    if (!out.has('content-type')) out.set('content-type', 'text/plain; charset=utf-8')
    out.set('cache-control', 'public, max-age=300')
    return new Response(upstream.body, { status: upstream.status, headers: out })
  }

  // Metadata path (search/song/album/artist/playlist): parse the
  // JSON, rewrite the embedded url/pic/lrc to point back at this
  // worker, return the rewritten body.
  if (upstream.status >= 400) return passThrough(upstream)
  let payload
  try {
    payload = await upstream.json()
  } catch {
    // Upstream said 200 but returned something we can't parse —
    // proxy it through so the client sees the raw error rather than
    // a fabricated empty list.
    return passThrough(upstream)
  }
  const rewritten = Array.isArray(payload)
    ? rewriteTrackList(payload, server)
    : payload
  return new Response(JSON.stringify(rewritten), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': type === 'search' ? 'public, max-age=60' : 'public, max-age=300'
    }
  })
}

function copyHeader (src, dst, name) {
  const v = src.get(name)
  if (v) dst.set(name, v)
}

function passThrough (upstream) {
  // Strip headers that wouldn't survive a body swap or that pollute
  // the response in the worker context.
  const out = new Headers()
  for (const [k, v] of upstream.headers) {
    const lk = k.toLowerCase()
    if (lk === 'content-encoding' || lk === 'transfer-encoding') continue
    out.set(k, v)
  }
  return new Response(upstream.body, { status: upstream.status, headers: out })
}
