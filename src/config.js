// Worker config builder. Pure function over the env binding, mirrors
// the shape buildConfig produces in the Meting-API worker so the two
// projects stay easy to read side by side.
//
// The big design choice: support BOTH the service binding (env.MUSIC_API
// is a Fetcher) AND the URL fallback (env.MUSIC_API_URL is a public
// host). Operators can wire `binding = "MUSIC_API"; service = "meting-api"`
// in their bigrandall worker config and skip the URL knob entirely;
// or, for tenants who keep the two workers in different projects,
// just point at the public host.

export function buildConfig (env) {
  env = env || {}
  return {
    musicApi: {
      // Service binding to the Meting-API worker. When present, all
      // upstream calls go through .fetch() and never leave the
      // bigrandall plane. The host part of the URL is ignored by the
      // binding — only the path + query matters.
      binding: env.MUSIC_API || null,
      // Public-host fallback. Used only when the binding is absent.
      // Set to e.g. "https://music.rapi.rest" for cross-project
      // access.
      url: stripTrailingSlash(env.MUSIC_API_URL || ''),
      // Master HMAC secret the Meting-API checks against. The worker
      // injects it on every upstream call so the widget visitors
      // never see it (it would defeat the purpose of having a secret
      // at all).
      token: env.MUSIC_API_TOKEN || ''
    },
    rate: {
      // Sliding window per client IP. Defaults are tuned for a
      // single human browsing the widget: a typical "open page,
      // search a track, play, browse some more" session takes well
      // under 60 requests/min even with auto-loaded search previews.
      windowMs: toNumber(env.RATE_WINDOW_MS, 60_000),
      max: toNumber(env.RATE_MAX, 60)
    },
    log: {
      level: env.LOG_LEVEL || 'info'
    }
  }
}

const toNumber = (v, d) => {
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? d : n
}

const stripTrailingSlash = (s) => (s.endsWith('/') ? s.slice(0, -1) : s)
