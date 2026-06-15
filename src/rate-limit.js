// Sliding-window rate limit, per-IP, per-isolate. Each entry is the
// list of timestamps the IP has hit us within the last `windowMs`.
// On every request we drop expired timestamps and reject if the
// surviving count is at or above `max`.
//
// Per-isolate state means a determined attacker spread across
// multiple isolates can multiply their effective limit. That's fine
// for the threat model here (casual abuse, accidental loops in a
// custom dashboard) — for adversarial limits the operator should
// front the worker with a CDN-level rule.
//
// Memory: bounded by MAX_BUCKETS to survive an IP-spray flood. When
// we hit the cap we evict the oldest bucket; that's exactly the time
// to throw work away (and it makes adversarial fingerprints unstable).

const buckets = new Map()
const MAX_BUCKETS = 5000

export function checkRate (ip, { windowMs, max }) {
  if (!ip) ip = '<unknown>'
  const now = Date.now()
  let times = buckets.get(ip)
  if (!times) {
    if (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value
      buckets.delete(oldest)
    }
    times = []
    buckets.set(ip, times)
  }
  const cutoff = now - windowMs
  while (times.length && times[0] < cutoff) times.shift()
  if (times.length >= max) {
    const retryAfterMs = Math.max(1000, times[0] + windowMs - now)
    return { allowed: false, retryAfterMs, remaining: 0, limit: max }
  }
  times.push(now)
  return { allowed: true, retryAfterMs: 0, remaining: max - times.length, limit: max }
}

export function clientIp (request) {
  // bigrandall / workerd surface the client IP under a few headers
  // depending on which edge layer terminated the connection. Walk
  // the usual suspects in priority order.
  return (
    request.headers.get('rf-connecting-ip') ||
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    ''
  )
}
