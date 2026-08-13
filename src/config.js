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
    proxySession: {
      // Dedicated HMAC key for the browser-only /api/proxy surface. Falling
      // back to MUSIC_API_TOKEN keeps existing deployments working, but a
      // separate random secret is recommended so either key can be rotated
      // independently.
      signingSecret: env.PROXY_SIGNING_SECRET || env.MUSIC_API_TOKEN || '',
      ttlSeconds: boundedNumber(env.PROXY_SESSION_TTL_SECONDS, 7_200, 300, 86_400),
      issueRate: {
        windowMs: boundedNumber(env.PROXY_SESSION_RATE_WINDOW_MS, 60_000, 1_000, 3_600_000),
        max: boundedNumber(env.PROXY_SESSION_RATE_MAX, 12, 1, 1_000)
      }
    },
    auth: {
      rate: {
        windowMs: boundedNumber(env.AUTH_RATE_WINDOW_MS, 60_000, 1_000, 3_600_000),
        max: boundedNumber(env.AUTH_RATE_MAX, 60, 5, 1_000)
      },
      registrationRate: {
        windowMs: boundedNumber(env.AUTH_REGISTRATION_RATE_WINDOW_MS, 3_600_000, 60_000, 86_400_000),
        max: boundedNumber(env.AUTH_REGISTRATION_RATE_MAX, 10, 1, 100)
      }
    },
    rate: {
      // The full-page app can load a visible grid of covers alongside
      // search, lyrics and audio requests. Keep the limit protective
      // against loops while leaving enough room for normal browsing.
      windowMs: toNumber(env.RATE_WINDOW_MS, 60_000),
      max: toNumber(env.RATE_MAX, 180)
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

const boundedNumber = (value, fallback, minimum, maximum) => {
  const number = toNumber(value, fallback)
  return Math.max(minimum, Math.min(maximum, number))
}

const stripTrailingSlash = (s) => (s.endsWith('/') ? s.slice(0, -1) : s)
