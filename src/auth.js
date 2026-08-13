import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server'
import { clientIp } from './rate-limit.js'

const USER_COOKIE = '__Host-rmusic_user'
const RP_NAME = 'RMusic'
const CHALLENGE_TTL_MS = 5 * 60_000
const encoder = new TextEncoder()
const initialized = new WeakSet()

const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS rmusic_users (
  id TEXT PRIMARY KEY,
  user_handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS rmusic_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  aaguid TEXT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES rmusic_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rmusic_credentials_user_idx ON rmusic_credentials(user_id);
CREATE TABLE IF NOT EXISTS rmusic_auth_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  challenge TEXT NOT NULL,
  user_id TEXT,
  user_handle TEXT,
  display_name TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rmusic_auth_challenges_expiry_idx ON rmusic_auth_challenges(expires_at);
CREATE TABLE IF NOT EXISTS rmusic_user_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  user_agent TEXT,
  last_ip_hash TEXT,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES rmusic_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rmusic_user_sessions_user_idx ON rmusic_user_sessions(user_id);
CREATE INDEX IF NOT EXISTS rmusic_user_sessions_expiry_idx ON rmusic_user_sessions(expires_at);
`

function authConfig (request, env) {
  const url = new URL(request.url)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const publicOrigin = env.AUTH_ORIGIN || `${local ? 'http' : 'https'}://${url.host}`
  const nativeOrigins = String(env.AUTH_NATIVE_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return {
    db: env.AUTH_DB || null,
    rpID: env.AUTH_RP_ID || url.hostname,
    origin: publicOrigin,
    expectedOrigins: [publicOrigin, ...nativeOrigins],
    nativeOrigins,
    sessionTtlMs: boundedInteger(env.AUTH_SESSION_DAYS, 30, 1, 365) * 86_400_000
  }
}

function boundedInteger (value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10)
  const number = Number.isFinite(parsed) ? parsed : fallback
  return Math.max(minimum, Math.min(maximum, number))
}

async function ensureSchema (db) {
  if (initialized.has(db)) return
  await db.exec(AUTH_SCHEMA)
  initialized.add(db)
}

function json (status, body, extraHeaders) {
  const headers = new Headers(extraHeaders)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(JSON.stringify(body), { status, headers })
}

function problem (status, title, detail) {
  return json(status, { type: 'about:blank', title, status, detail })
}

function randomBytes (length = 32) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function base64UrlEncode (value) {
  const bytes = value instanceof Uint8Array ? value : encoder.encode(String(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode (value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function sha256 (value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)))
  return base64UrlEncode(new Uint8Array(digest))
}

function cookieValue (request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const separator = part.indexOf('=')
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }
  return ''
}

function requestToken (request) {
  const authorization = request.headers.get('authorization') || ''
  if (/^Bearer\s+rmu_/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim()
  return cookieValue(request, USER_COOKIE)
}

function normalizeDisplayName (value, fallback) {
  const normalized = stripControlCharacters(value)
  return normalized.slice(0, 40) || fallback
}

function normalizeDeviceName (value, fallback) {
  const normalized = stripControlCharacters(value)
  return normalized.slice(0, 50) || fallback
}

function stripControlCharacters (value) {
  if (typeof value !== 'string') return ''
  return Array.from(value, (character) => {
    const point = character.codePointAt(0)
    return point < 32 || point === 127 ? '' : character
  }).join('').trim()
}

function deviceNameFromRequest (request) {
  const agent = request.headers.get('user-agent') || ''
  if (/iphone|ipad|macintosh/i.test(agent)) return 'Apple 设备'
  if (/android/i.test(agent)) return 'Android 设备'
  if (/windows/i.test(agent)) return 'Windows 设备'
  if (/linux/i.test(agent)) return 'Linux 设备'
  return '设备密钥'
}

function publicUser (row) {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
    passkeyCount: Number(row.passkey_count || 0)
  }
}

function publicDevice (row) {
  return {
    id: row.id,
    name: row.name,
    deviceType: row.device_type,
    backedUp: Boolean(row.backed_up),
    transports: parseJsonArray(row.transports),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null
  }
}

function parseJsonArray (value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function parseBody (request) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) throw new AuthError(415, 'ExpectedJSON', '请求必须使用 application/json')
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid object')
    return body
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError(400, 'InvalidJSON', '请求 JSON 无效')
  }
}

function assertSameOrigin (request, config) {
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  if (origin !== config.origin || (fetchSite && fetchSite !== 'same-origin')) {
    throw new AuthError(403, 'Forbidden', '认证操作只能由同源 RMusic 页面发起')
  }
}

async function getUserById (db, userId) {
  return db.prepare(`
    SELECT u.*, COUNT(c.id) AS passkey_count
    FROM rmusic_users u
    LEFT JOIN rmusic_credentials c ON c.user_id = u.id
    WHERE u.id = ?
    GROUP BY u.id
  `).bind(userId).first()
}

async function currentSession (request, db) {
  const token = requestToken(request)
  if (!token || token.length > 512) return null
  const tokenHash = await sha256(token)
  const now = Date.now()
  const row = await db.prepare(`
    SELECT s.*, u.display_name, u.created_at AS user_created_at, u.last_login_at,
      (SELECT COUNT(*) FROM rmusic_credentials c WHERE c.user_id = u.id) AS passkey_count
    FROM rmusic_user_sessions s
    JOIN rmusic_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
  `).bind(tokenHash, now).first()
  if (!row) return null
  if (now - Number(row.last_used_at || 0) > 5 * 60_000) {
    await db.prepare('UPDATE rmusic_user_sessions SET last_used_at = ?, last_ip_hash = ? WHERE id = ?')
      .bind(now, await sha256(clientIp(request) || '<unknown>'), row.id).run()
  }
  return { row, token, tokenHash }
}

async function requireSession (request, db) {
  const session = await currentSession(request, db)
  if (!session) throw new AuthError(401, 'AuthenticationRequired', '请先使用设备密钥登录')
  return session
}

export async function resolveAuthenticatedUser (request, env) {
  const config = authConfig(request, env)
  if (!config.db) return { available: false, db: null, userId: null, session: null, origin: config.origin }
  await ensureSchema(config.db)
  const session = await currentSession(request, config.db)
  return {
    available: true,
    db: config.db,
    userId: session?.row?.user_id || null,
    session: session?.row || null,
    origin: config.origin
  }
}

async function storeChallenge (db, challenge) {
  await db.prepare(`
    INSERT INTO rmusic_auth_challenges
      (id, kind, challenge, user_id, user_handle, display_name, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    challenge.id,
    challenge.kind,
    challenge.challenge,
    challenge.userId || null,
    challenge.userHandle || null,
    challenge.displayName || null,
    challenge.expiresAt,
    challenge.createdAt
  ).run()
}

async function consumeChallenge (db, id, expectedKind) {
  const row = await db.prepare('SELECT * FROM rmusic_auth_challenges WHERE id = ?').bind(id).first()
  await db.prepare('DELETE FROM rmusic_auth_challenges WHERE id = ?').bind(id).run()
  if (!row || row.kind !== expectedKind || Number(row.expires_at) <= Date.now()) {
    throw new AuthError(400, 'ChallengeExpired', '设备密钥请求已过期，请重新开始')
  }
  return row
}

async function registrationOptions (request, config, kind) {
  assertSameOrigin(request, config)
  const body = await parseBody(request)
  const now = Date.now()
  const flowId = crypto.randomUUID()
  let userId
  let userHandle
  let displayName
  let excludeCredentials = []

  if (kind === 'register') {
    userId = crypto.randomUUID()
    userHandle = base64UrlEncode(randomBytes())
    displayName = normalizeDisplayName(body.displayName, `RMusic 用户 ${userId.slice(0, 4).toUpperCase()}`)
  } else {
    const session = await requireSession(request, config.db)
    const user = await getUserById(config.db, session.row.user_id)
    if (!user) throw new AuthError(401, 'AuthenticationRequired', '用户不存在或会话已失效')
    userId = user.id
    userHandle = user.user_handle
    displayName = user.display_name
    const credentials = await config.db.prepare('SELECT id, transports FROM rmusic_credentials WHERE user_id = ?').bind(userId).all()
    excludeCredentials = (credentials.results || []).map((credential) => ({
      id: credential.id,
      transports: parseJsonArray(credential.transports)
    }))
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: config.rpID,
    userID: base64UrlDecode(userHandle),
    userName: displayName,
    userDisplayName: displayName,
    timeout: CHALLENGE_TTL_MS,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required'
    }
  })
  await storeChallenge(config.db, {
    id: flowId,
    kind,
    challenge: options.challenge,
    userId,
    userHandle,
    displayName,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS
  })
  return json(200, { flowId, options })
}

async function verifyRegistration (request, config, kind) {
  assertSameOrigin(request, config)
  const body = await parseBody(request)
  if (typeof body.flowId !== 'string' || !body.response) throw new AuthError(400, 'InvalidRequest', '缺少设备密钥注册结果')
  const challenge = await consumeChallenge(config.db, body.flowId, kind)
  if (kind === 'add-device') {
    const session = await requireSession(request, config.db)
    if (session.row.user_id !== challenge.user_id) throw new AuthError(403, 'Forbidden', '设备密钥请求不属于当前用户')
  }
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.expectedOrigins,
      expectedRPID: config.rpID,
      requireUserVerification: true
    })
  } catch {
    throw new AuthError(400, 'PasskeyVerificationFailed', '设备密钥注册结果无效，请重新开始')
  }
  if (!verification.verified || !verification.registrationInfo) throw new AuthError(400, 'PasskeyVerificationFailed', '设备密钥验证失败')
  const info = verification.registrationInfo
  const now = Date.now()
  const credential = info.credential
  const deviceName = normalizeDeviceName(body.deviceName, deviceNameFromRequest(request))
  try {
    if (kind === 'register') {
      await config.db.batch([
        config.db.prepare(`
          INSERT INTO rmusic_users (id, user_handle, display_name, created_at, updated_at, last_login_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(challenge.user_id, challenge.user_handle, challenge.display_name, now, now, now),
        credentialInsert(config.db, credential, challenge.user_id, info, deviceName, now)
      ])
    } else {
      await credentialInsert(config.db, credential, challenge.user_id, info, deviceName, now).run()
    }
  } catch (error) {
    if (/unique|constraint/i.test(error?.message || '')) throw new AuthError(409, 'PasskeyAlreadyRegistered', '这个设备密钥已经注册')
    throw error
  }
  const user = await getUserById(config.db, challenge.user_id)
  if (kind === 'add-device') return json(201, { verified: true, user: publicUser(user), device: publicDevice(await credentialById(config.db, credential.id)) })
  return createSessionResponse(request, config, user, info.origin, body.sessionMode)
}

function credentialInsert (db, credential, userId, info, name, now) {
  return db.prepare(`
    INSERT INTO rmusic_credentials
      (id, user_id, public_key, counter, transports, device_type, backed_up, aaguid, name, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    credential.id,
    userId,
    base64UrlEncode(credential.publicKey),
    credential.counter,
    JSON.stringify(credential.transports || []),
    info.credentialDeviceType,
    info.credentialBackedUp ? 1 : 0,
    info.aaguid || null,
    name,
    now,
    now
  )
}

async function credentialById (db, id) {
  return db.prepare('SELECT * FROM rmusic_credentials WHERE id = ?').bind(id).first()
}

async function authenticationOptions (request, config) {
  assertSameOrigin(request, config)
  await parseBody(request)
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    timeout: CHALLENGE_TTL_MS,
    userVerification: 'required'
  })
  const now = Date.now()
  const flowId = crypto.randomUUID()
  await storeChallenge(config.db, {
    id: flowId,
    kind: 'login',
    challenge: options.challenge,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS
  })
  return json(200, { flowId, options })
}

async function verifyAuthentication (request, config) {
  assertSameOrigin(request, config)
  const body = await parseBody(request)
  if (typeof body.flowId !== 'string' || !body.response?.id) throw new AuthError(400, 'InvalidRequest', '缺少设备密钥登录结果')
  const challenge = await consumeChallenge(config.db, body.flowId, 'login')
  const row = await config.db.prepare(`
    SELECT c.*, u.user_handle, u.display_name, u.created_at AS user_created_at, u.last_login_at,
      (SELECT COUNT(*) FROM rmusic_credentials x WHERE x.user_id = u.id) AS passkey_count
    FROM rmusic_credentials c
    JOIN rmusic_users u ON u.id = c.user_id
    WHERE c.id = ?
  `).bind(body.response.id).first()
  if (!row) throw new AuthError(400, 'PasskeyNotRegistered', '本站没有找到这个设备密钥')
  if (!body.response.response?.userHandle || body.response.response.userHandle !== row.user_handle) {
    throw new AuthError(400, 'UserHandleMismatch', '设备密钥用户标识不匹配')
  }
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.expectedOrigins,
      expectedRPID: config.rpID,
      credential: {
        id: row.id,
        publicKey: base64UrlDecode(row.public_key),
        counter: Number(row.counter || 0),
        transports: parseJsonArray(row.transports)
      },
      requireUserVerification: true
    })
  } catch {
    throw new AuthError(400, 'PasskeyVerificationFailed', '设备密钥登录结果无效，请重新开始')
  }
  if (!verification.verified) throw new AuthError(400, 'PasskeyVerificationFailed', '设备密钥验证失败')
  const now = Date.now()
  await config.db.batch([
    config.db.prepare(`
      UPDATE rmusic_credentials
      SET counter = ?, backed_up = ?, device_type = ?, last_used_at = ?
      WHERE id = ?
    `).bind(
      verification.authenticationInfo.newCounter,
      verification.authenticationInfo.credentialBackedUp ? 1 : 0,
      verification.authenticationInfo.credentialDeviceType,
      now,
      row.id
    ),
    config.db.prepare('UPDATE rmusic_users SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .bind(now, now, row.user_id)
  ])
  const user = await getUserById(config.db, row.user_id)
  return createSessionResponse(request, config, user, verification.authenticationInfo.origin, body.sessionMode)
}

async function createSessionResponse (request, config, user, verifiedOrigin, requestedMode) {
  const now = Date.now()
  const expiresAt = now + config.sessionTtlMs
  const token = `rmu_${base64UrlEncode(randomBytes())}`
  const native = requestedMode === 'bearer' && config.nativeOrigins.includes(verifiedOrigin)
  const sessionId = crypto.randomUUID()
  await config.db.prepare(`
    INSERT INTO rmusic_user_sessions
      (id, token_hash, user_id, kind, created_at, expires_at, last_used_at, user_agent, last_ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sessionId,
    await sha256(token),
    user.id,
    native ? 'native' : 'web',
    now,
    expiresAt,
    now,
    (request.headers.get('user-agent') || '').slice(0, 240),
    await sha256(clientIp(request) || '<unknown>')
  ).run()
  const body = {
    authenticated: true,
    user: publicUser(user),
    session: { id: sessionId, kind: native ? 'native' : 'web', expiresAt },
    ...(native ? { accessToken: token, tokenType: 'Bearer' } : {})
  }
  if (native) return json(200, body)
  const maxAge = Math.floor(config.sessionTtlMs / 1000)
  return json(200, body, {
    'set-cookie': `${USER_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`
  })
}

async function sessionStatus (request, config) {
  const session = await currentSession(request, config.db)
  if (!session) return json(200, { authenticated: false })
  return json(200, {
    authenticated: true,
    user: publicUser({
      id: session.row.user_id,
      display_name: session.row.display_name,
      created_at: session.row.user_created_at,
      last_login_at: session.row.last_login_at,
      passkey_count: session.row.passkey_count
    }),
    session: { id: session.row.id, kind: session.row.kind, expiresAt: session.row.expires_at }
  })
}

async function updateProfile (request, config) {
  assertSameOrigin(request, config)
  const session = await requireSession(request, config.db)
  const body = await parseBody(request)
  const displayName = normalizeDisplayName(body.displayName, '')
  if (!displayName) throw new AuthError(400, 'InvalidDisplayName', '请输入 1–40 个字符的称呼')
  const now = Date.now()
  await config.db.prepare('UPDATE rmusic_users SET display_name = ?, updated_at = ? WHERE id = ?')
    .bind(displayName, now, session.row.user_id).run()
  return json(200, { user: publicUser(await getUserById(config.db, session.row.user_id)) })
}

async function listDevices (request, config) {
  const session = await requireSession(request, config.db)
  const result = await config.db.prepare('SELECT * FROM rmusic_credentials WHERE user_id = ? ORDER BY created_at ASC')
    .bind(session.row.user_id).all()
  return json(200, { devices: (result.results || []).map(publicDevice) })
}

async function removeDevice (request, config, credentialId) {
  assertSameOrigin(request, config)
  const session = await requireSession(request, config.db)
  const count = await config.db.prepare('SELECT COUNT(*) AS count FROM rmusic_credentials WHERE user_id = ?')
    .bind(session.row.user_id).first()
  if (Number(count?.count || 0) <= 1) throw new AuthError(409, 'LastPasskey', '至少需要保留一个设备密钥')
  const result = await config.db.prepare('DELETE FROM rmusic_credentials WHERE id = ? AND user_id = ?')
    .bind(credentialId, session.row.user_id).run()
  if (!Number(result?.meta?.changes || 0)) throw new AuthError(404, 'DeviceNotFound', '设备密钥不存在')
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}

async function listSessions (request, config) {
  const session = await requireSession(request, config.db)
  const now = Date.now()
  const result = await config.db.prepare(`
    SELECT id, kind, created_at, expires_at, last_used_at, user_agent
    FROM rmusic_user_sessions
    WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
    ORDER BY last_used_at DESC
  `).bind(session.row.user_id, now).all()
  return json(200, {
    sessions: (result.results || []).map((row) => ({
      id: row.id,
      kind: row.kind,
      current: row.id === session.row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      userAgent: row.user_agent || ''
    }))
  })
}

async function revokeSession (request, config, sessionId) {
  assertSameOrigin(request, config)
  const session = await requireSession(request, config.db)
  const now = Date.now()
  const result = await config.db.prepare(`
    UPDATE rmusic_user_sessions SET revoked_at = ?
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL
  `).bind(now, sessionId, session.row.user_id).run()
  if (!Number(result?.meta?.changes || 0)) throw new AuthError(404, 'SessionNotFound', '登录会话不存在')
  const headers = sessionId === session.row.id
    ? { 'set-cookie': `${USER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` }
    : undefined
  return json(200, { revoked: true, current: sessionId === session.row.id }, headers)
}

async function logout (request, config) {
  assertSameOrigin(request, config)
  const token = requestToken(request)
  if (token) {
    await config.db.prepare('UPDATE rmusic_user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(Date.now(), await sha256(token)).run()
  }
  return json(200, { authenticated: false }, {
    'set-cookie': `${USER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
  })
}

function pruneAuthRows (db) {
  const now = Date.now()
  return db.batch([
    db.prepare('DELETE FROM rmusic_auth_challenges WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM rmusic_user_sessions WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)')
      .bind(now, now - 30 * 86_400_000)
  ]).catch(() => {})
}

export async function handleAuth (request, env, context) {
  const config = authConfig(request, env)
  if (!config.db) return problem(503, 'AuthUnavailable', '用户系统尚未绑定 AUTH_DB')
  try {
    await ensureSchema(config.db)
    if (Math.random() < 0.02) context?.waitUntil?.(pruneAuthRows(config.db))
    const url = new URL(request.url)
    const path = url.pathname
    if (path === '/api/auth/session' && request.method === 'GET') return await sessionStatus(request, config)
    if (path === '/api/auth/register/options' && request.method === 'POST') return await registrationOptions(request, config, 'register')
    if (path === '/api/auth/register/verify' && request.method === 'POST') return await verifyRegistration(request, config, 'register')
    if (path === '/api/auth/login/options' && request.method === 'POST') return await authenticationOptions(request, config)
    if (path === '/api/auth/login/verify' && request.method === 'POST') return await verifyAuthentication(request, config)
    if (path === '/api/auth/logout' && request.method === 'POST') return await logout(request, config)
    if (path === '/api/auth/profile' && request.method === 'PATCH') return await updateProfile(request, config)
    if (path === '/api/auth/devices' && request.method === 'GET') return await listDevices(request, config)
    if (path === '/api/auth/devices/options' && request.method === 'POST') return await registrationOptions(request, config, 'add-device')
    if (path === '/api/auth/devices/verify' && request.method === 'POST') return await verifyRegistration(request, config, 'add-device')
    const deviceMatch = path.match(/^\/api\/auth\/devices\/([^/]+)$/)
    if (deviceMatch && request.method === 'DELETE') return await removeDevice(request, config, decodeURIComponent(deviceMatch[1]))
    if (path === '/api/auth/sessions' && request.method === 'GET') return await listSessions(request, config)
    const sessionMatch = path.match(/^\/api\/auth\/sessions\/([^/]+)$/)
    if (sessionMatch && request.method === 'DELETE') return await revokeSession(request, config, decodeURIComponent(sessionMatch[1]))
    return problem(404, 'NotFound', `用户接口不存在: ${path}`)
  } catch (error) {
    if (error instanceof AuthError) return problem(error.status, error.title, error.message)
    try { console.error('[rmusic-auth]', error?.message || error) } catch {}
    return problem(500, 'AuthenticationError', '用户认证暂时不可用')
  }
}

class AuthError extends Error {
  constructor (status, title, message) {
    super(message)
    this.status = status
    this.title = title
  }
}
