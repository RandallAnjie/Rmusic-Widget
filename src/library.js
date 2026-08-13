import { resolveAuthenticatedUser } from './auth.js'

const initialized = new WeakSet()
const encoder = new TextEncoder()
const MAX_FAVORITES = 200
const MAX_RECENT = 30
const MAX_PLAYLISTS = 60
const MAX_PLAYLIST_TRACKS = 5000
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024
const MAX_LIBRARY_PLAYLIST_BYTES = 24 * 1024 * 1024
const MAX_IMPORT_BYTES = 25 * 1024 * 1024

const LIBRARY_SCHEMA = `
CREATE TABLE IF NOT EXISTS rmusic_favorites (
  user_id TEXT NOT NULL,
  track_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_key),
  FOREIGN KEY (user_id) REFERENCES rmusic_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rmusic_favorites_order_idx ON rmusic_favorites(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS rmusic_recent (
  user_id TEXT NOT NULL,
  track_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_key),
  FOREIGN KEY (user_id) REFERENCES rmusic_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rmusic_recent_order_idx ON rmusic_recent(user_id, played_at DESC);
CREATE TABLE IF NOT EXISTS rmusic_playlists (
  user_id TEXT NOT NULL,
  playlist_key TEXT NOT NULL,
  source TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  cached_at INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, playlist_key),
  FOREIGN KEY (user_id) REFERENCES rmusic_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rmusic_playlists_order_idx ON rmusic_playlists(user_id, saved_at DESC);
`

async function ensureLibrarySchema (db) {
  if (initialized.has(db)) return
  await db.exec(LIBRARY_SCHEMA)
  initialized.add(db)
}

function json (status, body, headers) {
  const out = new Headers(headers)
  out.set('content-type', 'application/json; charset=utf-8')
  out.set('cache-control', 'no-store')
  out.set('x-content-type-options', 'nosniff')
  return new Response(JSON.stringify(body), { status, headers: out })
}

function problem (status, title, detail, headers) {
  return json(status, { type: 'about:blank', title, status, detail }, headers)
}

function cleanString (value, maximum, fallback = '') {
  if (typeof value !== 'string') return fallback
  const clean = Array.from(value, (character) => {
    const point = character.codePointAt(0)
    return point < 32 || point === 127 ? '' : character
  }).join('').trim()
  return clean.slice(0, maximum) || fallback
}

function cleanSource (value) {
  const source = cleanString(value, 32).toLowerCase()
  return /^[a-z0-9_-]+$/.test(source) ? source : ''
}

function cleanId (value) {
  return cleanString(value == null ? '' : String(value), 512)
}

function cleanNumber (value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function cleanResourceUrl (value, request) {
  if (typeof value !== 'string' || !value) return ''
  try {
    const requestUrl = new URL(request.url)
    const parsed = new URL(value, requestUrl)
    if (parsed.host !== requestUrl.host || !parsed.pathname.startsWith('/api/proxy/v2/')) return ''
    return parsed.pathname + parsed.search
  } catch {
    return ''
  }
}

function cleanArtists (value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).map((artist) => {
    if (typeof artist === 'string') return { id: null, name: cleanString(artist, 180) }
    if (!artist || typeof artist !== 'object') return null
    const name = cleanString(artist.name, 180)
    return name ? { id: cleanId(artist.id) || null, name } : null
  }).filter(Boolean)
}

function cleanPlayback (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const qualities = Array.isArray(value.qualities)
    ? value.qualities.slice(0, 10).map((quality) => ({
        id: cleanString(quality?.id, 30),
        label: cleanString(quality?.label, 60),
        available: Boolean(quality?.available)
      })).filter((quality) => quality.id)
    : []
  return {
    available: value.available !== false,
    previewOnly: Boolean(value.previewOnly),
    requiresSubscription: Boolean(value.requiresSubscription),
    qualities
  }
}

function cleanTrack (value, request) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = cleanSource(value.source || value.server)
  const id = cleanId(value.id)
  if (!source || !id) return null
  const artists = cleanArtists(value.artists || value.artistItems)
  const albumValue = value.albumResource || value.album
  const album = albumValue && typeof albumValue === 'object'
    ? { id: cleanId(albumValue.id) || null, name: cleanString(albumValue.name, 300) }
    : cleanString(albumValue, 300)
  const track = {
    id,
    server: source,
    title: cleanString(value.title, 500, '未知歌曲'),
    author: cleanString(value.author, 500, artists.map((artist) => artist.name).join(' / ') || '未知艺人'),
    artists,
    album,
    url: cleanResourceUrl(value.url || value.links?.stream, request),
    pic: cleanResourceUrl(value.pic || value.artwork?.url || value.links?.artwork, request),
    lrc: cleanResourceUrl(value.lrc || value.links?.lyrics, request),
    lrcpword: cleanResourceUrl(value.lrcpword || value.links?.wordLyrics, request),
    duration_ms: cleanNumber(value.duration_ms ?? value.durationMs),
    playback: cleanPlayback(value.playback)
  }
  if (encoder.encode(JSON.stringify(track)).byteLength > 24 * 1024) return null
  return track
}

function trackKey (track) {
  return `${track.server}|${track.id}`
}

function cleanCreator (value, request) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const name = cleanString(value.name, 200)
  if (!name) return null
  return {
    id: cleanId(value.id) || null,
    name,
    avatar: cleanResourceUrl(value.avatar, request) || null,
    role: cleanString(value.role, 40) || null
  }
}

function cleanStats (value, trackCount) {
  const stats = value && typeof value === 'object' ? value : {}
  return {
    trackCount: cleanNumber(stats.trackCount) ?? trackCount,
    playCount: cleanNumber(stats.playCount),
    followerCount: cleanNumber(stats.followerCount)
  }
}

function cleanPlaylist (value, request, pathSource, pathId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = cleanSource(value.server || value.source)
  const id = cleanId(value.id)
  if (!source || !id || (pathSource && source !== pathSource) || (pathId && id !== pathId)) return null
  const rawTracks = Array.isArray(value.tracks) ? value.tracks : []
  if (rawTracks.length > MAX_PLAYLIST_TRACKS) return null
  const tracks = rawTracks.map((track) => cleanTrack(track, request)).filter(Boolean)
  const cachedAt = cleanNumber(value.cachedAt) || Date.now()
  const savedAt = cleanNumber(value.savedAt) || Date.now()
  const snapshot = {
    version: 2,
    server: source,
    id,
    name: cleanString(value.name, 500, `歌单 ${id}`),
    cover: cleanResourceUrl(value.cover, request),
    description: cleanString(value.description, 5000),
    creator: cleanCreator(value.creator, request),
    stats: cleanStats(value.stats, tracks.length),
    tracks,
    cachedAt,
    savedAt
  }
  const byteSize = encoder.encode(JSON.stringify(snapshot)).byteLength
  if (byteSize > MAX_PLAYLIST_BYTES) return null
  return { snapshot, byteSize, key: `${source}:${id}` }
}

async function parseBody (request, maximum = 1024 * 1024) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) throw new LibraryError(415, 'ExpectedJSON', '请求必须使用 application/json')
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > maximum) throw new LibraryError(413, 'PayloadTooLarge', '音乐库数据超过允许大小')
  let raw
  try { raw = await request.text() } catch { throw new LibraryError(400, 'InvalidJSON', '请求 JSON 无效') }
  if (encoder.encode(raw).byteLength > maximum) throw new LibraryError(413, 'PayloadTooLarge', '音乐库数据超过允许大小')
  try {
    const body = JSON.parse(raw)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid object')
    return body
  } catch {
    throw new LibraryError(400, 'InvalidJSON', '请求 JSON 无效')
  }
}

function parseStored (value) {
  try { return JSON.parse(value) } catch { return null }
}

function assertMutationOrigin (request, auth) {
  if (auth.session?.kind === 'native' && /^Bearer\s+rmu_/i.test(request.headers.get('authorization') || '')) return
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  if (origin !== auth.origin || (fetchSite && fetchSite !== 'same-origin')) {
    throw new LibraryError(403, 'Forbidden', '音乐库修改只能由同源 RMusic 页面或已授权手机客户端发起')
  }
}

async function libraryOverview (auth) {
  const [favorites, recent, playlists] = await Promise.all([
    auth.db.prepare('SELECT payload FROM rmusic_favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(auth.userId, MAX_FAVORITES).all(),
    auth.db.prepare('SELECT payload FROM rmusic_recent WHERE user_id = ? ORDER BY played_at DESC LIMIT ?')
      .bind(auth.userId, MAX_RECENT).all(),
    auth.db.prepare('SELECT summary_json FROM rmusic_playlists WHERE user_id = ? ORDER BY saved_at DESC LIMIT ?')
      .bind(auth.userId, MAX_PLAYLISTS).all()
  ])
  const data = {
    favorites: (favorites.results || []).map((row) => parseStored(row.payload)).filter(Boolean),
    recent: (recent.results || []).map((row) => parseStored(row.payload)).filter(Boolean),
    playlists: (playlists.results || []).map((row) => parseStored(row.summary_json)).filter(Boolean)
  }
  return json(200, { ...data, empty: !data.favorites.length && !data.recent.length && !data.playlists.length })
}

async function putFavorite (request, auth) {
  const body = await parseBody(request)
  const track = cleanTrack(body.track, request)
  if (!track) throw new LibraryError(400, 'InvalidTrack', '歌曲数据无效')
  const now = Date.now()
  await auth.db.prepare(`
    INSERT INTO rmusic_favorites (user_id, track_key, payload, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, track_key) DO UPDATE SET payload = excluded.payload
  `).bind(auth.userId, trackKey(track), JSON.stringify(track), now).run()
  await auth.db.prepare(`
    DELETE FROM rmusic_favorites WHERE user_id = ? AND track_key NOT IN (
      SELECT track_key FROM rmusic_favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
    )
  `).bind(auth.userId, auth.userId, MAX_FAVORITES).run()
  return json(200, { favorite: true, track })
}

async function deleteFavorite (auth, source, id) {
  const result = await auth.db.prepare('DELETE FROM rmusic_favorites WHERE user_id = ? AND track_key = ?')
    .bind(auth.userId, `${source}|${id}`).run()
  return json(200, { favorite: false, removed: Number(result?.meta?.changes || 0) > 0 })
}

async function addRecent (request, auth) {
  const body = await parseBody(request)
  const track = cleanTrack(body.track, request)
  if (!track) throw new LibraryError(400, 'InvalidTrack', '歌曲数据无效')
  const now = Date.now()
  await auth.db.batch([
    auth.db.prepare(`
      INSERT INTO rmusic_recent (user_id, track_key, payload, played_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, track_key) DO UPDATE SET payload = excluded.payload, played_at = excluded.played_at
    `).bind(auth.userId, trackKey(track), JSON.stringify(track), now),
    auth.db.prepare(`
      DELETE FROM rmusic_recent WHERE user_id = ? AND track_key NOT IN (
        SELECT track_key FROM rmusic_recent WHERE user_id = ? ORDER BY played_at DESC LIMIT ?
      )
    `).bind(auth.userId, auth.userId, MAX_RECENT)
  ])
  return json(200, { recent: true, track, playedAt: now })
}

async function clearRecent (auth) {
  await auth.db.prepare('DELETE FROM rmusic_recent WHERE user_id = ?').bind(auth.userId).run()
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}

function playlistSummary (snapshot) {
  const { tracks, ...summary } = snapshot
  return { ...summary, trackCount: tracks.length }
}

async function putPlaylist (request, auth, source, id) {
  const body = await parseBody(request, MAX_PLAYLIST_BYTES + 128 * 1024)
  const cleaned = cleanPlaylist(body.playlist, request, source, id)
  if (!cleaned) throw new LibraryError(400, 'InvalidPlaylist', '歌单数据无效、曲目过多或快照超过 4 MiB')
  const current = await auth.db.prepare('SELECT byte_size FROM rmusic_playlists WHERE user_id = ? AND playlist_key = ?')
    .bind(auth.userId, cleaned.key).first()
  const total = await auth.db.prepare('SELECT COALESCE(SUM(byte_size), 0) AS total FROM rmusic_playlists WHERE user_id = ?')
    .bind(auth.userId).first()
  const projected = Number(total?.total || 0) - Number(current?.byte_size || 0) + cleaned.byteSize
  if (projected > MAX_LIBRARY_PLAYLIST_BYTES) throw new LibraryError(413, 'LibraryQuotaExceeded', '账号歌单快照已达到 24 MiB 上限，请先移除不需要的歌单')
  if (!current) {
    const count = await auth.db.prepare('SELECT COUNT(*) AS count FROM rmusic_playlists WHERE user_id = ?').bind(auth.userId).first()
    if (Number(count?.count || 0) >= MAX_PLAYLISTS) throw new LibraryError(409, 'PlaylistLimitReached', '每个账号最多保存 60 个歌单')
  }
  const now = Date.now()
  const summary = playlistSummary(cleaned.snapshot)
  await auth.db.prepare(`
    INSERT INTO rmusic_playlists
      (user_id, playlist_key, source, remote_id, summary_json, snapshot_json, byte_size, cached_at, saved_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, playlist_key) DO UPDATE SET
      source = excluded.source,
      remote_id = excluded.remote_id,
      summary_json = excluded.summary_json,
      snapshot_json = excluded.snapshot_json,
      byte_size = excluded.byte_size,
      cached_at = excluded.cached_at,
      updated_at = excluded.updated_at
  `).bind(
    auth.userId,
    cleaned.key,
    source,
    id,
    JSON.stringify(summary),
    JSON.stringify(cleaned.snapshot),
    cleaned.byteSize,
    cleaned.snapshot.cachedAt,
    cleaned.snapshot.savedAt,
    now
  ).run()
  return json(current ? 200 : 201, { saved: true, playlist: summary })
}

async function getPlaylist (auth, source, id) {
  const row = await auth.db.prepare('SELECT snapshot_json FROM rmusic_playlists WHERE user_id = ? AND playlist_key = ?')
    .bind(auth.userId, `${source}:${id}`).first()
  if (!row) throw new LibraryError(404, 'PlaylistNotFound', '账号中没有保存这个歌单')
  return json(200, { playlist: parseStored(row.snapshot_json) })
}

async function deletePlaylist (auth, source, id) {
  const result = await auth.db.prepare('DELETE FROM rmusic_playlists WHERE user_id = ? AND playlist_key = ?')
    .bind(auth.userId, `${source}:${id}`).run()
  return json(200, { saved: false, removed: Number(result?.meta?.changes || 0) > 0 })
}

async function runBatches (db, statements) {
  for (let index = 0; index < statements.length; index += 50) await db.batch(statements.slice(index, index + 50))
}

async function importLegacyLibrary (request, auth) {
  const body = await parseBody(request, MAX_IMPORT_BYTES)
  const counts = await auth.db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM rmusic_favorites WHERE user_id = ?) AS favorites,
      (SELECT COUNT(*) FROM rmusic_recent WHERE user_id = ?) AS recent,
      (SELECT COUNT(*) FROM rmusic_playlists WHERE user_id = ?) AS playlists
  `).bind(auth.userId, auth.userId, auth.userId).first()
  if (Number(counts?.favorites || 0) || Number(counts?.recent || 0) || Number(counts?.playlists || 0)) {
    return json(409, { imported: false, reason: 'library-not-empty' })
  }
  const now = Date.now()
  const favorites = (Array.isArray(body.favorites) ? body.favorites : []).slice(0, MAX_FAVORITES)
    .map((track) => cleanTrack(track, request)).filter(Boolean)
  const recent = (Array.isArray(body.recent) ? body.recent : []).slice(0, MAX_RECENT)
    .map((track) => cleanTrack(track, request)).filter(Boolean)
  const playlists = (Array.isArray(body.playlists) ? body.playlists : []).slice(0, MAX_PLAYLISTS)
    .map((playlist) => cleanPlaylist(playlist, request)).filter(Boolean)
  const playlistBytes = playlists.reduce((sum, playlist) => sum + playlist.byteSize, 0)
  if (playlistBytes > MAX_LIBRARY_PLAYLIST_BYTES) throw new LibraryError(413, 'LibraryQuotaExceeded', '本机歌单快照超过账号的 24 MiB 上限')
  const statements = []
  favorites.forEach((track, index) => statements.push(auth.db.prepare(`
    INSERT OR IGNORE INTO rmusic_favorites (user_id, track_key, payload, created_at) VALUES (?, ?, ?, ?)
  `).bind(auth.userId, trackKey(track), JSON.stringify(track), now - index)))
  recent.forEach((track, index) => statements.push(auth.db.prepare(`
    INSERT OR IGNORE INTO rmusic_recent (user_id, track_key, payload, played_at) VALUES (?, ?, ?, ?)
  `).bind(auth.userId, trackKey(track), JSON.stringify(track), now - index)))
  playlists.forEach(({ snapshot, byteSize, key }, index) => statements.push(auth.db.prepare(`
    INSERT OR IGNORE INTO rmusic_playlists
      (user_id, playlist_key, source, remote_id, summary_json, snapshot_json, byte_size, cached_at, saved_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    auth.userId,
    key,
    snapshot.server,
    snapshot.id,
    JSON.stringify(playlistSummary(snapshot)),
    JSON.stringify(snapshot),
    byteSize,
    snapshot.cachedAt,
    snapshot.savedAt || (now - index),
    now
  )))
  await runBatches(auth.db, statements)
  return json(201, { imported: true, counts: { favorites: favorites.length, recent: recent.length, playlists: playlists.length } })
}

export async function handleLibrary (request, env) {
  try {
    const auth = await resolveAuthenticatedUser(request, env)
    if (!auth.available) return problem(503, 'AuthUnavailable', '用户系统尚未绑定 AUTH_DB')
    if (!auth.userId) {
      return problem(401, 'AuthenticationRequired', '请先使用设备密钥登录', {
        'www-authenticate': 'Passkey realm="RMusic"'
      })
    }
    await ensureLibrarySchema(auth.db)
    const url = new URL(request.url)
    const path = url.pathname
    if (request.method !== 'GET') assertMutationOrigin(request, auth)
    if (path === '/api/auth/library' && request.method === 'GET') return await libraryOverview(auth)
    if (path === '/api/auth/library/import' && request.method === 'POST') return await importLegacyLibrary(request, auth)
    if (path === '/api/auth/library/favorites' && request.method === 'PUT') return await putFavorite(request, auth)
    const favoriteMatch = path.match(/^\/api\/auth\/library\/favorites\/([^/]+)\/([^/]+)$/)
    if (favoriteMatch && request.method === 'DELETE') {
      const source = cleanSource(decodeURIComponent(favoriteMatch[1]))
      const id = cleanId(decodeURIComponent(favoriteMatch[2]))
      if (!source || !id) throw new LibraryError(400, 'InvalidTrack', '歌曲标识无效')
      return await deleteFavorite(auth, source, id)
    }
    if (path === '/api/auth/library/recent' && request.method === 'POST') return await addRecent(request, auth)
    if (path === '/api/auth/library/recent' && request.method === 'DELETE') return await clearRecent(auth)
    const playlistMatch = path.match(/^\/api\/auth\/library\/playlists\/([^/]+)\/([^/]+)$/)
    if (playlistMatch) {
      const source = cleanSource(decodeURIComponent(playlistMatch[1]))
      const id = cleanId(decodeURIComponent(playlistMatch[2]))
      if (!source || !id) throw new LibraryError(400, 'InvalidPlaylist', '歌单标识无效')
      if (request.method === 'GET') return await getPlaylist(auth, source, id)
      if (request.method === 'PUT') return await putPlaylist(request, auth, source, id)
      if (request.method === 'DELETE') return await deletePlaylist(auth, source, id)
    }
    return problem(404, 'NotFound', `音乐库接口不存在: ${path}`)
  } catch (error) {
    if (error instanceof LibraryError) return problem(error.status, error.title, error.message)
    try { console.error('[rmusic-library]', error?.message || error) } catch {}
    return problem(500, 'LibraryError', '账号音乐库暂时不可用')
  }
}

class LibraryError extends Error {
  constructor (status, title, message) {
    super(message)
    this.status = status
    this.title = title
  }
}
