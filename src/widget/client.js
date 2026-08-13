import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration
} from '@simplewebauthn/browser'

/* RMusic full-page player.
 *
 * The browser only calls the same-origin /api/proxy/v2 REST surface. The
 * worker injects MUSIC_API_TOKEN server-side and rewrites every
 * resource URL, so playlists, covers, audio and lyrics never expose
 * the Meting master token to the page.
 */

(function () {
  'use strict'

  const $ = (id) => document.getElementById(id)
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector))
  const API = '/api/proxy/v2'
  const PROXY_SESSION_ENDPOINT = '/api/proxy/session'
  const SEARCH_PLATFORM_IDS = ['aggregate', 'tencent', 'netease', 'kugou', 'soda', 'ytmusic', 'kuwo', 'baidu', 'apple', 'spotify']
  const SEARCH_REQUEST_TIMEOUT_MS = 12000

  const els = {
    app: $('app'),
    audio: $('audio'),
    player: $('player'),
    ambient: $('ambient'),
    searchForm: $('global-search'),
    query: $('query'),
    clearSearch: $('clearSearch'),
    greeting: $('greeting'),
    toast: $('toast'),
    homeNowCard: $('home-now-card'),
    homeNowCover: $('home-now-cover'),
    homeNowFallback: $('home-now-fallback'),
    homeNowKicker: $('home-now-kicker'),
    homeNowTitle: $('home-now-title'),
    homeNowAuthor: $('home-now-author'),
    homeNowProgress: $('home-now-progress'),
    homeNowAction: $('home-now-action'),
    homeNowActionIcon: $('home-now-action-icon'),
    homeNowActionLabel: $('home-now-action-label'),
    discoverySection: $('discovery-section'),
    discoveryStatus: $('discovery-status'),
    discoveryRecommendations: $('discovery-recommendations'),
    discoveryCharts: $('discovery-charts'),
    discoveryNewReleases: $('discovery-new-releases'),
    refreshDiscovery: $('refreshDiscovery'),
    playCharts: $('playCharts'),
    playNewReleases: $('playNewReleases'),
    recentGrid: $('recent-grid'),
    favoritePreview: $('favorite-preview'),
    favoritePreviewSection: $('favorite-preview-section'),
    searchEyebrow: $('search-eyebrow'),
    searchSourcePicker: $('search-source-picker'),
    searchTitle: $('search-title'),
    searchSummary: $('search-summary'),
    searchEmpty: $('search-empty'),
    searchLoading: $('search-loading'),
    searchResultsWrap: $('search-results-wrap'),
    searchResults: $('search-results'),
    searchCount: $('search-count'),
    playSearchResults: $('playSearchResults'),
    savedPlaylists: $('saved-playlists'),
    sidebarPlaylists: $('sidebar-playlists'),
    playlistCount: $('playlist-count'),
    favoriteCount: $('favorite-count'),
    favoriteTracks: $('favorite-tracks'),
    recentTracks: $('recent-tracks'),
    clearRecent: $('clearRecent'),
    collectionCover: $('collection-cover'),
    collectionKind: $('collection-kind'),
    collectionTitle: $('collection-title'),
    collectionDescription: $('collection-description'),
    collectionCount: $('collection-count'),
    collectionCacheStatus: $('collection-cache-status'),
    collectionLoading: $('collection-loading'),
    collectionTracks: $('collection-tracks'),
    playCollection: $('playCollection'),
    saveCollection: $('saveCollection'),
    refreshCollection: $('refreshCollection'),
    artistAlbumsSection: $('artist-albums-section'),
    artistAlbums: $('artist-albums'),
    artistAlbumsCount: $('artist-albums-count'),
    contextPanel: $('context-panel'),
    closePanel: $('closePanel'),
    mobileNowBackdrop: $('mobile-now-backdrop'),
    mobileNowCover: $('mobile-now-cover'),
    mobileNowFallback: $('mobile-now-fallback'),
    mobileNowTitle: $('mobile-now-title'),
    mobileNowAuthor: $('mobile-now-author'),
    mobileNowLike: $('mobile-now-like'),
    queueNow: $('queue-now'),
    queueCurrent: $('queue-current'),
    queueList: $('queue-list'),
    clearQueue: $('clearQueue'),
    lyricsTitle: $('lyrics-title'),
    lrcWrap: $('lrc-container'),
    lrcList: $('lrc-list'),
    nowCover: $('now-cover'),
    nowCoverFallback: $('now-cover-fallback'),
    nowTitle: $('now-title'),
    nowAuthor: $('now-author'),
    nowLike: $('now-like'),
    playerTrack: $('player-track'),
    shuffleBtn: $('shuffleBtn'),
    prevBtn: $('prevBtn'),
    playBtn: $('playBtn'),
    playIcon: $('playIcon'),
    nextBtn: $('nextBtn'),
    loopBtn: $('loopBtn'),
    repeatBadge: $('repeatBadge'),
    currTime: $('curr-time'),
    duration: $('duration'),
    quality: $('quality'),
    progressBar: $('progress-bar'),
    progressFill: $('progress-fill'),
    progressBuffered: $('progress-buffered'),
    progressThumb: $('progress-thumb'),
    mobileShuffleBtn: $('mobileShuffleBtn'),
    mobilePrevBtn: $('mobilePrevBtn'),
    mobilePlayBtn: $('mobilePlayBtn'),
    mobilePlayIcon: $('mobilePlayIcon'),
    mobileNextBtn: $('mobileNextBtn'),
    mobileLoopBtn: $('mobileLoopBtn'),
    mobileRepeatBadge: $('mobileRepeatBadge'),
    mobileCurrTime: $('mobile-curr-time'),
    mobileDuration: $('mobile-duration'),
    mobileProgressBar: $('mobile-progress-bar'),
    mobileProgressFill: $('mobile-progress-fill'),
    mobileProgressBuffered: $('mobile-progress-buffered'),
    mobileProgressThumb: $('mobile-progress-thumb'),
    volume: $('volume'),
    playlistModal: $('playlist-modal'),
    closePlaylistModal: $('closePlaylistModal'),
    playlistForm: $('playlist-form'),
    playlistId: $('playlist-id'),
    playlistFormError: $('playlist-form-error'),
    loadPlaylistButton: $('loadPlaylistButton'),
    openAccount: $('openAccount'),
    mobileAccount: $('mobileAccount'),
    accountAvatar: $('accountAvatar'),
    accountTriggerLabel: $('accountTriggerLabel'),
    accountModal: $('account-modal'),
    closeAccountModal: $('closeAccountModal'),
    accountLoading: $('accountLoading'),
    accountError: $('accountError'),
    accountAnonymous: $('accountAnonymous'),
    accountProfile: $('accountProfile'),
    registrationDisplayName: $('registrationDisplayName'),
    registerPasskey: $('registerPasskey'),
    loginPasskey: $('loginPasskey'),
    profileAvatar: $('profileAvatar'),
    profileName: $('profileName'),
    profileId: $('profileId'),
    profileNameForm: $('profileNameForm'),
    profileDisplayName: $('profileDisplayName'),
    addPasskey: $('addPasskey'),
    passkeyList: $('passkeyList'),
    sessionList: $('sessionList'),
    logoutAccount: $('logoutAccount')
  }

  const STORAGE = {
    favorites: 'rmusic_favorites_v2',
    recent: 'rmusic_recent_v2',
    playlists: 'rmusic_playlists_v2',
    modes: 'rmusic_playback_mode',
    volume: 'rmusic_volume_v2',
    searchServer: 'rmusic_search_server_v1',
    quality: 'rmusic_quality_v1',
    discovery: 'rmusic_discovery_v2',
    playlistCachePrefix: 'rmusic_playlist_cache_v1:'
  }

  const state = {
    view: 'home',
    searchResults: [],
    searchServer: SEARCH_PLATFORM_IDS.includes(readStorage(STORAGE.searchServer)) ? readStorage(STORAGE.searchServer) : 'aggregate',
    collection: null,
    queue: [],
    queueIndex: -1,
    queueLabel: '',
    currentTrack: null,
    favorites: [],
    recent: [],
    discovery: readDiscoverySnapshot(),
    discoveryLoading: false,
    playlists: [],
    libraryUserId: null,
    libraryLoading: false,
    shuffle: 'off',
    repeat: 'off',
    openPanel: null,
    loadingAudio: false,
    consecutiveErrors: 0,
    account: {
      available: true,
      authenticated: false,
      user: null,
      session: null,
      devices: [],
      sessions: []
    },
    quality: ['auto', 'lossless', 'high', 'standard', 'low'].includes(readStorage(STORAGE.quality))
      ? readStorage(STORAGE.quality)
      : 'auto'
  }

  let toastTimer = 0
  let pendingSkipTimer = 0
  let progressDragging = false
  let lrcData = []
  let lastLrcIndex = -1
  let searchRequestId = 0
  let activeSearchControllers = []
  let collectionRequestId = 0
  let lyricsRequestId = 0
  let proxySessionPromise = null
  let proxySessionRefreshAt = 0
  let proxySessionRefreshTimer = 0

  function readJson (key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null')
      return parsed == null ? fallback : parsed
    } catch {
      return fallback
    }
  }

  function writeJson (key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
      return true
    } catch {
      return false
    }
  }

  function removeStorage (key) {
    try { localStorage.removeItem(key) } catch {}
  }

  function readStorage (key, fallback = '') {
    try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
  }

  function text (value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback
  }

  function trackKey (track) {
    if (!track) return ''
    if (track.id) return [track.server || '', String(track.id)].join('|')
    return [track.server || '', track.id || '', track.url || '', track.title || '', track.author || ''].join('|')
  }

  function streamUrl (value) {
    if (!value) return value
    try {
      const parsed = new URL(value, location.href)
      if (parsed.origin !== location.origin || !parsed.pathname.startsWith(API + '/streams/')) return value
      parsed.searchParams.set('quality', state.quality)
      return parsed.pathname + '?' + parsed.searchParams.toString()
    } catch {
      return value
    }
  }

  function migrateLegacyResourceUrl (value, fallbackServer) {
    if (!value) return ''
    try {
      const parsed = new URL(value, location.href)
      if (parsed.pathname !== '/api/proxy' && !parsed.pathname.endsWith('/api')) return value
      const legacyType = parsed.searchParams.get('type')
      const id = parsed.searchParams.get('id')
      const server = parsed.searchParams.get('server') || fallbackServer
      const resource = legacyType === 'url'
        ? 'streams'
        : legacyType === 'pic'
          ? 'artworks'
          : (legacyType === 'lrc' || legacyType === 'lrcpword' ? 'lyrics' : '')
      if (!resource || !id || !server) return value
      const suffix = legacyType === 'lrcpword' ? '?granularity=word' : ''
      return API + '/' + resource + '/' + encodeURIComponent(server) + '/' + encodeURIComponent(id) + suffix
    } catch {
      return value
    }
  }

  function normalizeTrack (track, server) {
    const out = { ...track }
    out.server = track.source || track.server || server || 'netease'
    out.title = text(track.title, '未知歌曲')
    out.artistItems = Array.isArray(track.artists)
      ? track.artists.map((artist) => typeof artist === 'string'
        ? { id: null, name: artist }
        : { id: artist?.id == null ? null : String(artist.id), name: text(artist?.name) }).filter((artist) => artist.name)
      : []
    out.author = text(
      out.artistItems.length
        ? out.artistItems.map((artist) => artist.name).join(' / ')
        : track.author,
      '未知艺人'
    )
    out.albumResource = track.album && typeof track.album === 'object'
      ? {
          id: track.album.id == null ? null : String(track.album.id),
          name: text(track.album.name)
        }
      : { id: null, name: text(track.album) }
    out.album = text(track.album?.name || track.album, '')
    out.url = migrateLegacyResourceUrl(text(track.links?.stream || track.url, ''), out.server)
    out.pic = migrateLegacyResourceUrl(text(track.artwork?.url || track.links?.artwork || track.pic, ''), out.server)
    out.lrc = migrateLegacyResourceUrl(text(track.links?.lyrics || track.lrc, ''), out.server)
    out.lrcpword = migrateLegacyResourceUrl(text(track.links?.wordLyrics || track.lrcpword, ''), out.server)
    out.duration_ms = typeof track.durationMs === 'number'
      ? track.durationMs
      : (typeof track.duration_ms === 'number' ? track.duration_ms : null)
    out.playback = track.playback && typeof track.playback === 'object' ? track.playback : null
    return out
  }

  function readDiscoverySnapshot () {
    const snapshot = readJson(STORAGE.discovery, null)
    if (!snapshot || !Number.isFinite(snapshot.cachedAt)) {
      return { recommendations: [], charts: [], newReleases: [], cachedAt: 0 }
    }
    return {
      recommendations: normalizeList(snapshot.recommendations),
      charts: normalizeList(snapshot.charts),
      newReleases: normalizeList(snapshot.newReleases),
      cachedAt: snapshot.cachedAt
    }
  }

  function normalizeList (list, server) {
    if (!Array.isArray(list)) return []
    return list.filter((item) => item && typeof item === 'object').map((item) => normalizeTrack(item, server))
  }

  function iconUse (svg, id) {
    const use = svg && svg.querySelector('use')
    if (use) use.setAttribute('href', '#' + id)
  }

  function createCover (track, className, eager = false) {
    const wrap = document.createElement('div')
    wrap.className = className
    const fallback = document.createElement('span')
    fallback.className = 'cover-fallback'
    fallback.textContent = initials(track.title)
    wrap.appendChild(fallback)
    if (track.pic) {
      const img = document.createElement('img')
      img.alt = ''
      img.loading = eager ? 'eager' : 'lazy'
      img.decoding = 'async'
      img.src = track.pic
      img.addEventListener('load', () => { fallback.hidden = true })
      img.addEventListener('error', () => { img.remove(); fallback.hidden = false })
      wrap.appendChild(img)
    }
    return wrap
  }

  function initials (value) {
    const source = text(value, 'RM').replace(/[^\p{L}\p{N}]+/gu, '')
    return source.slice(0, 2).toUpperCase() || 'RM'
  }

  function formatTime (seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
    const minutes = Math.floor(seconds / 60)
    const rest = Math.floor(seconds % 60)
    return minutes + ':' + String(rest).padStart(2, '0')
  }

  function durationLabel (track) {
    return track.duration_ms ? formatTime(track.duration_ms / 1000) : '—'
  }

  function toast (message, kind) {
    clearTimeout(toastTimer)
    els.toast.textContent = message
    els.toast.classList.toggle('error', kind === 'error')
    els.toast.hidden = false
    toastTimer = setTimeout(() => { els.toast.hidden = true }, 3200)
  }

  function apiErrorMessage (status, body) {
    if (status === 429) return '请求太频繁，请稍后再试'
    let parsed = null
    try { parsed = JSON.parse(body) } catch {}
    return parsed?.detail || parsed?.message || body.slice(0, 180) || ('请求失败 (' + status + ')')
  }

  function scheduleProxySessionRefresh () {
    clearTimeout(proxySessionRefreshTimer)
    const delay = Math.max(30_000, proxySessionRefreshAt - Date.now())
    proxySessionRefreshTimer = setTimeout(() => {
      ensureProxySession(true).catch(() => {})
    }, Math.min(delay, 2_147_000_000))
  }

  async function ensureProxySession (force = false) {
    if (!force && proxySessionRefreshAt > Date.now()) return
    if (proxySessionPromise) return proxySessionPromise
    proxySessionPromise = (async () => {
      const response = await fetch(PROXY_SESSION_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'x-rmusic-client': 'widget-v2'
        }
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(apiErrorMessage(response.status, body))
      }
      const session = await response.json()
      proxySessionRefreshAt = Number(session.refreshAfter) || (Date.now() + 30 * 60_000)
      scheduleProxySessionRefresh()
    })()
    try {
      await proxySessionPromise
    } finally {
      proxySessionPromise = null
    }
  }

  async function proxyFetch (input, init = {}, retry = true) {
    await ensureProxySession()
    let response = await fetch(input, { ...init, credentials: 'same-origin' })
    if (response.status === 401 && retry) {
      proxySessionRefreshAt = 0
      await ensureProxySession(true)
      response = await fetch(input, { ...init, credentials: 'same-origin' })
    }
    return response
  }

  /* ---------- RMusic account / Passkeys ---------- */

  async function authFetch (path, options = {}) {
    const init = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' }
    }
    if (Object.hasOwn(options, 'body')) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }
    const response = await fetch('/api/auth' + path, init)
    const raw = await response.text().catch(() => '')
    let body = null
    try { body = raw ? JSON.parse(raw) : null } catch {}
    if (!response.ok) {
      const error = new Error(body?.detail || body?.message || raw || ('账号请求失败 (' + response.status + ')'))
      error.status = response.status
      error.title = body?.title || ''
      throw error
    }
    return body
  }

  function clearPersonalLibrary () {
    const accountCollectionVisible = state.collection && savedPlaylistFor(state.collection)
    state.favorites = []
    state.recent = []
    state.playlists = []
    state.libraryUserId = null
    if (accountCollectionVisible) {
      state.collection = null
      if (state.view === 'collection') showView('home')
    }
    renderHome()
    renderLibrary()
    syncFavoriteButtons()
    syncCollectionSaveButton()
  }

  function clearArtwork (image, fallback) {
    image.hidden = true
    image.removeAttribute('src')
    fallback.hidden = false
    fallback.textContent = 'RM'
  }

  function resetNowPlaying () {
    lyricsRequestId += 1
    lrcData = []
    lastLrcIndex = -1
    els.nowTitle.textContent = '选择一首歌'
    els.nowAuthor.textContent = '从搜索或歌单开始'
    els.mobileNowTitle.textContent = '选择一首歌'
    els.mobileNowAuthor.textContent = '从搜索或歌单开始'
    els.lyricsTitle.textContent = '还没有播放歌曲'
    els.lrcList.innerHTML = '<li class="lyrics-placeholder">播放歌曲后，这里会显示同步歌词。</li>'
    els.lrcList.style.transform = ''
    els.homeNowKicker.textContent = 'READY TO PLAY'
    els.homeNowTitle.textContent = '下一首，由你决定'
    els.homeNowAuthor.textContent = '搜索歌曲或载入一个歌单'
    els.homeNowProgress.style.width = '0%'
    els.homeNowCard.classList.remove('has-track', 'is-playing')
    clearArtwork(els.nowCover, els.nowCoverFallback)
    clearArtwork(els.mobileNowCover, els.mobileNowFallback)
    clearArtwork(els.homeNowCover, els.homeNowFallback)
    els.ambient.style.backgroundImage = ''
    els.ambient.style.opacity = '.78'
    els.mobileNowBackdrop.style.backgroundImage = ''
    els.nowLike.disabled = true
    els.mobileNowLike.disabled = true
    els.currTime.textContent = '0:00'
    els.duration.textContent = '0:00'
    els.mobileCurrTime.textContent = '0:00'
    els.mobileDuration.textContent = '0:00'
    ;[els.progressBar, els.mobileProgressBar].forEach((bar) => {
      bar.setAttribute('aria-valuenow', '0')
      bar.setAttribute('aria-valuetext', '0:00 / 0:00')
    })
    setProgressVisual(0)
    ;[els.progressBuffered, els.mobileProgressBuffered].forEach((buffered) => { buffered.style.width = '0%' })
    els.player.classList.remove('is-playing', 'track-changed')
    els.contextPanel.classList.remove('is-playing')
    setMediaPlaybackState('none')
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = null } catch {}
    }
    updatePlayIcon()
    syncFavoriteButtons()
  }

  function stopAccountPlayback () {
    clearTimeout(pendingSkipTimer)
    els.audio.pause()
    els.audio.removeAttribute('src')
    els.audio.load()
    state.loadingAudio = false
    state.consecutiveErrors = 0
    state.queue = []
    state.queueIndex = -1
    state.currentTrack = null
    state.queueLabel = '播放队列'
    resetNowPlaying()
    renderQueue()
    updateTransportEnabled()
  }

  function legacyLibraryPayload () {
    const favorites = normalizeList(readJson(STORAGE.favorites, []))
    const recent = normalizeList(readJson(STORAGE.recent, []))
    const definitions = readJson(STORAGE.playlists, [])
    const playlists = Array.isArray(definitions)
      ? definitions.slice(0, 60).map((playlist) => {
          const cached = readJson(STORAGE.playlistCachePrefix + playlistKey(playlist), null)
          return cached && Array.isArray(cached.tracks)
            ? { ...playlist, ...cached }
            : { ...playlist, tracks: [], cachedAt: playlist.cachedAt || Date.now() }
        })
      : []
    return {
      favorites: favorites.map(compactCachedTrack),
      recent: recent.map(compactCachedTrack),
      playlists,
      hasData: favorites.length > 0 || recent.length > 0 || playlists.length > 0
    }
  }

  function clearLegacyLibrary (payload) {
    removeStorage(STORAGE.favorites)
    removeStorage(STORAGE.recent)
    removeStorage(STORAGE.playlists)
    payload.playlists.forEach((playlist) => removeStorage(STORAGE.playlistCachePrefix + playlistKey(playlist)))
  }

  async function loadAccountLibrary (allowMigration = true) {
    const userId = state.account.user?.id
    if (!state.account.authenticated || !userId) {
      clearPersonalLibrary()
      return null
    }
    if (state.libraryLoading) return null
    state.libraryLoading = true
    try {
      let library = await authFetch('/library')
      if (allowMigration && library?.empty) {
        const legacy = legacyLibraryPayload()
        if (legacy.hasData) {
          try {
            const result = await authFetch('/library/import', {
              method: 'POST',
              body: { favorites: legacy.favorites, recent: legacy.recent, playlists: legacy.playlists }
            })
            if (result?.imported) {
              clearLegacyLibrary(legacy)
              toast(`已把本机音乐库迁移到账号 · ${result.counts.favorites} 首收藏 / ${result.counts.playlists} 个歌单`)
              library = await authFetch('/library')
            }
          } catch (error) {
            if (error.status !== 409) toast('本机音乐库迁移失败：' + error.message, 'error')
          }
        }
      }
      if (state.account.user?.id !== userId) return null
      state.favorites = normalizeList(library?.favorites)
      state.recent = normalizeList(library?.recent)
      state.playlists = Array.isArray(library?.playlists) ? library.playlists : []
      state.libraryUserId = userId
      renderHome()
      renderLibrary()
      syncFavoriteButtons()
      syncCollectionSaveButton()
      return library
    } finally {
      state.libraryLoading = false
    }
  }

  function requireAccount (purpose = '播放音乐') {
    if (state.account.authenticated && state.account.user) return true
    toast(purpose + '需要先登录 RMusic 账号')
    openAccountModal().then(() => setAccountError('请使用设备密钥登录后继续。')).catch(() => {})
    return false
  }

  function accountInitials (name) {
    return initials(name || 'RM')
  }

  function accountDate (timestamp) {
    if (!Number.isFinite(Number(timestamp))) return '未知时间'
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(Number(timestamp)))
    } catch {
      return new Date(Number(timestamp)).toLocaleString()
    }
  }

  function sessionDeviceName (session) {
    if (session.kind === 'native') return 'RMusic 手机客户端'
    const agent = session.userAgent || ''
    if (/iphone|ipad/i.test(agent)) return 'Safari · Apple 移动设备'
    if (/android/i.test(agent)) return '浏览器 · Android 设备'
    if (/macintosh/i.test(agent)) return '浏览器 · Mac'
    if (/windows/i.test(agent)) return '浏览器 · Windows'
    if (/linux/i.test(agent)) return '浏览器 · Linux'
    return 'RMusic 网页'
  }

  function deviceName () {
    const platform = navigator.userAgentData?.platform || navigator.platform || ''
    if (/iphone|ipad|mac/i.test(platform)) return 'Apple 设备'
    if (/android/i.test(platform) || /android/i.test(navigator.userAgent)) return 'Android 设备'
    if (/win/i.test(platform)) return 'Windows 设备'
    if (/linux/i.test(platform)) return 'Linux 设备'
    return '当前设备'
  }

  function accountIcon (symbol) {
    const wrap = document.createElement('span')
    wrap.className = 'account-list-icon'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'icon')
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', '#' + symbol)
    svg.appendChild(use)
    wrap.appendChild(svg)
    return wrap
  }

  function setAccountError (message = '') {
    els.accountError.textContent = message
    els.accountError.hidden = !message
  }

  function setAccountBusy (busy, message = '正在验证设备密钥…') {
    els.accountLoading.querySelector('p').textContent = message
    els.accountLoading.hidden = !busy
    els.accountAnonymous.hidden = busy || state.account.authenticated
    els.accountProfile.hidden = busy || !state.account.authenticated
    ;[els.registerPasskey, els.loginPasskey, els.addPasskey, els.logoutAccount].forEach((button) => { button.disabled = busy })
  }

  function updateAccountTrigger () {
    const user = state.account.user
    const signedIn = state.account.authenticated && user
    els.openAccount.classList.toggle('signed-in', Boolean(signedIn))
    els.accountTriggerLabel.textContent = signedIn ? user.displayName : '登录'
    els.accountAvatar.textContent = ''
    if (signedIn) {
      els.accountAvatar.textContent = accountInitials(user.displayName)
      els.mobileAccount.setAttribute('aria-label', '账号：' + user.displayName)
    } else {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('class', 'icon')
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
      use.setAttribute('href', '#i-user')
      svg.appendChild(use)
      els.accountAvatar.appendChild(svg)
      els.mobileAccount.setAttribute('aria-label', '打开账号')
    }
  }

  function renderPasskeys () {
    els.passkeyList.textContent = ''
    if (!state.account.devices.length) {
      const empty = document.createElement('p')
      empty.className = 'account-list-empty'
      empty.textContent = '暂时没有可管理的设备密钥。'
      els.passkeyList.appendChild(empty)
      return
    }
    const fragment = document.createDocumentFragment()
    state.account.devices.forEach((device) => {
      const row = document.createElement('div')
      row.className = 'account-list-row'
      row.appendChild(accountIcon('i-key'))
      const copy = document.createElement('div')
      copy.className = 'account-list-copy'
      const name = document.createElement('strong')
      name.textContent = device.name || '设备密钥'
      const meta = document.createElement('span')
      const backup = device.backedUp ? '可同步' : '仅此设备'
      meta.textContent = backup + ' · ' + (device.lastUsedAt ? '使用于 ' + accountDate(device.lastUsedAt) : '创建于 ' + accountDate(device.createdAt))
      copy.append(name, meta)
      row.appendChild(copy)
      const remove = document.createElement('button')
      remove.className = 'account-list-action'
      remove.type = 'button'
      remove.textContent = state.account.devices.length <= 1 ? '需保留' : '移除'
      remove.disabled = state.account.devices.length <= 1
      remove.addEventListener('click', () => removePasskey(device))
      row.appendChild(remove)
      fragment.appendChild(row)
    })
    els.passkeyList.appendChild(fragment)
  }

  function renderSessions () {
    els.sessionList.textContent = ''
    if (!state.account.sessions.length) {
      const empty = document.createElement('p')
      empty.className = 'account-list-empty'
      empty.textContent = '暂时没有活跃会话。'
      els.sessionList.appendChild(empty)
      return
    }
    const fragment = document.createDocumentFragment()
    state.account.sessions.forEach((session) => {
      const row = document.createElement('div')
      row.className = 'account-list-row'
      row.appendChild(accountIcon('i-user'))
      const copy = document.createElement('div')
      copy.className = 'account-list-copy'
      const name = document.createElement('strong')
      name.textContent = sessionDeviceName(session)
      const meta = document.createElement('span')
      meta.textContent = '最近活动 ' + accountDate(session.lastUsedAt) + ' · ' + accountDate(session.expiresAt) + ' 到期'
      copy.append(name, meta)
      row.appendChild(copy)
      if (session.current) {
        const current = document.createElement('span')
        current.className = 'account-current'
        current.textContent = '当前设备'
        row.appendChild(current)
      } else {
        const revoke = document.createElement('button')
        revoke.className = 'account-list-action'
        revoke.type = 'button'
        revoke.textContent = '退出'
        revoke.addEventListener('click', () => revokeAccountSession(session))
        row.appendChild(revoke)
      }
      fragment.appendChild(row)
    })
    els.sessionList.appendChild(fragment)
  }

  function renderAccount () {
    updateAccountTrigger()
    updateTransportEnabled()
    els.accountAnonymous.hidden = state.account.authenticated
    els.accountProfile.hidden = !state.account.authenticated
    if (!state.account.authenticated || !state.account.user) return
    const user = state.account.user
    els.profileAvatar.textContent = accountInitials(user.displayName)
    els.profileName.textContent = user.displayName
    els.profileId.textContent = 'RMusic ID · ' + user.id.slice(0, 8).toUpperCase()
    els.profileDisplayName.value = user.displayName
    renderPasskeys()
    renderSessions()
  }

  async function refreshAccount (details = false) {
    const wasAuthenticated = state.account.authenticated
    try {
      const status = await authFetch('/session')
      state.account.available = true
      state.account.authenticated = Boolean(status?.authenticated)
      state.account.user = status?.user || null
      state.account.session = status?.session || null
      if (state.account.authenticated && details) {
        const [devices, sessions] = await Promise.all([
          authFetch('/devices'),
          authFetch('/sessions')
        ])
        state.account.devices = devices?.devices || []
        state.account.sessions = sessions?.sessions || []
      } else if (!state.account.authenticated) {
        state.account.devices = []
        state.account.sessions = []
      }
      if (state.account.authenticated && (state.libraryUserId !== state.account.user?.id || details)) {
        await loadAccountLibrary(true)
      } else if (!state.account.authenticated) {
        if (wasAuthenticated) stopAccountPlayback()
        clearPersonalLibrary()
      }
      renderAccount()
      return status
    } catch (error) {
      if (error.status === 401) {
        state.account.authenticated = false
        state.account.user = null
        if (wasAuthenticated) stopAccountPlayback()
        clearPersonalLibrary()
        renderAccount()
        return null
      }
      state.account.available = false
      throw error
    }
  }

  function passkeyErrorMessage (error) {
    if (error?.name === 'NotAllowedError') return '设备密钥操作已取消，或验证等待超时。'
    if (error?.name === 'InvalidStateError') return '这个设备密钥已经注册，请换一个设备或直接登录。'
    if (error?.name === 'SecurityError') return '当前域名或安全环境不允许使用设备密钥。'
    return error?.message || '设备密钥操作失败，请重试。'
  }

  function requirePasskeySupport () {
    if (!window.isSecureContext || !browserSupportsWebAuthn()) {
      throw new Error('当前浏览器不支持设备密钥，请使用最新版 Safari、Chrome 或 Edge。')
    }
  }

  async function runPasskeyAction (message, action) {
    setAccountError()
    setAccountBusy(true, message)
    try {
      requirePasskeySupport()
      await action()
    } catch (error) {
      setAccountError(passkeyErrorMessage(error))
    } finally {
      setAccountBusy(false)
      renderAccount()
    }
  }

  async function registerAccount () {
    await runPasskeyAction('正在创建设备密钥…', async () => {
      const begin = await authFetch('/register/options', {
        method: 'POST',
        body: { displayName: els.registrationDisplayName.value }
      })
      const response = await startRegistration({ optionsJSON: begin.options })
      const result = await authFetch('/register/verify', {
        method: 'POST',
        body: { flowId: begin.flowId, response, deviceName: deviceName() }
      })
      state.account.authenticated = true
      state.account.user = result.user
      state.account.session = result.session
      await refreshAccount(true)
      toast('RMusic 账号创建成功')
    })
  }

  async function loginAccount () {
    await runPasskeyAction('正在等待设备密钥…', async () => {
      const begin = await authFetch('/login/options', { method: 'POST', body: {} })
      const response = await startAuthentication({ optionsJSON: begin.options })
      const result = await authFetch('/login/verify', {
        method: 'POST',
        body: { flowId: begin.flowId, response }
      })
      state.account.authenticated = true
      state.account.user = result.user
      state.account.session = result.session
      await refreshAccount(true)
      toast('已使用设备密钥登录')
    })
  }

  async function addAccountPasskey () {
    await runPasskeyAction('正在添加设备密钥…', async () => {
      const begin = await authFetch('/devices/options', { method: 'POST', body: {} })
      const response = await startRegistration({ optionsJSON: begin.options })
      await authFetch('/devices/verify', {
        method: 'POST',
        body: { flowId: begin.flowId, response, deviceName: deviceName() }
      })
      await refreshAccount(true)
      toast('新的设备密钥已添加')
    })
  }

  async function removePasskey (device) {
    if (!window.confirm('确认移除“' + (device.name || '这个设备密钥') + '”？移除后该设备可能无法再次登录。')) return
    setAccountError()
    try {
      await authFetch('/devices/' + encodeURIComponent(device.id), { method: 'DELETE' })
      await refreshAccount(true)
      toast('设备密钥已移除')
    } catch (error) {
      setAccountError(error.message)
    }
  }

  async function revokeAccountSession (session) {
    setAccountError()
    try {
      await authFetch('/sessions/' + encodeURIComponent(session.id), { method: 'DELETE' })
      await refreshAccount(true)
      toast('登录会话已退出')
    } catch (error) {
      setAccountError(error.message)
    }
  }

  async function logoutAccount () {
    setAccountError()
    setAccountBusy(true, '正在安全退出…')
    try {
      await authFetch('/logout', { method: 'POST', body: {} })
      state.account.authenticated = false
      state.account.user = null
      state.account.session = null
      state.account.devices = []
      state.account.sessions = []
      stopAccountPlayback()
      clearPersonalLibrary()
      renderAccount()
      toast('已退出 RMusic 账号')
    } catch (error) {
      setAccountError(error.message)
    } finally {
      setAccountBusy(false)
      renderAccount()
    }
  }

  async function openAccountModal () {
    els.accountModal.hidden = false
    setAccountError()
    setAccountBusy(true, '正在读取账号状态…')
    try {
      await refreshAccount(true)
    } catch (error) {
      setAccountError(error.message)
    } finally {
      setAccountBusy(false)
      renderAccount()
    }
  }

  function closeAccountModal () {
    els.accountModal.hidden = true
    setAccountError()
  }

  els.openAccount.addEventListener('click', openAccountModal)
  els.mobileAccount.addEventListener('click', openAccountModal)
  els.closeAccountModal.addEventListener('click', closeAccountModal)
  els.accountModal.addEventListener('click', (event) => { if (event.target === els.accountModal) closeAccountModal() })
  els.registerPasskey.addEventListener('click', registerAccount)
  els.loginPasskey.addEventListener('click', loginAccount)
  els.addPasskey.addEventListener('click', addAccountPasskey)
  els.logoutAccount.addEventListener('click', logoutAccount)
  els.profileNameForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    setAccountError()
    try {
      const result = await authFetch('/profile', {
        method: 'PATCH',
        body: { displayName: els.profileDisplayName.value }
      })
      state.account.user = result.user
      renderAccount()
      toast('显示名称已更新')
    } catch (error) {
      setAccountError(error.message)
    }
  })

  async function fetchV2 (path, params, signal) {
    const query = params ? new URLSearchParams(params).toString() : ''
    const response = await proxyFetch(API + path + (query ? '?' + query : ''), {
      headers: { accept: 'application/json' },
      signal
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(apiErrorMessage(response.status, body))
    }
    return response.json()
  }

  function cancelActiveSearch () {
    activeSearchControllers.forEach((controller) => controller.abort())
    activeSearchControllers = []
  }

  async function searchV2 (query, server) {
    cancelActiveSearch()
    const controller = new AbortController()
    activeSearchControllers = [controller]
    const timer = setTimeout(() => controller.abort(), SEARCH_REQUEST_TIMEOUT_MS)
    try {
      const payload = await fetchV2('/tracks', {
        query,
        source: server === 'aggregate' ? 'all' : server,
        limit: '80',
        view: 'compact',
        ...(server === 'aggregate' ? { mode: 'fast' } : {})
      }, controller.signal)
      return {
        tracks: normalizeList(payload?.data, server),
        meta: payload?.meta || {}
      }
    } finally {
      clearTimeout(timer)
      if (activeSearchControllers[0] === controller) activeSearchControllers = []
    }
  }

  /* ---------- Navigation ---------- */

  function showView (name) {
    const target = name === 'collection' ? 'collection' : ['home', 'search', 'library'].includes(name) ? name : 'home'
    const previous = state.view
    state.view = target
    $$('.view').forEach((view) => {
      const active = view.dataset.view === target
      view.hidden = !active
      view.classList.toggle('active', active)
    })
    $$('[data-nav]').forEach((button) => button.classList.toggle('active', button.dataset.nav === target))
    const scroll = document.querySelector('.content-scroll')
    if (scroll) scroll.scrollTop = 0
    if (target === 'home') renderHome()
    if (target === 'library') renderLibrary()
    if (target === 'search' && previous !== 'search') setTimeout(() => els.query.focus(), 80)
  }

  $$('[data-nav]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.nav)))

  function setGreeting () {
    const hour = new Date().getHours()
    els.greeting.textContent = hour < 6 ? '夜深了，听点轻的' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  }

  /* ---------- Search ---------- */

  function syncSearchSourcePicker () {
    $$('[data-search-server]', els.searchSourcePicker).forEach((button) => {
      const active = button.dataset.searchServer === state.searchServer
      button.classList.toggle('active', active)
      button.setAttribute('aria-checked', String(active))
      button.tabIndex = active ? 0 : -1
      if (active) button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }

  function updateSearchPrompt () {
    const aggregate = state.searchServer === 'aggregate'
    els.searchEyebrow.textContent = aggregate ? '跨平台检索' : '单平台检索 · ' + sourceName(state.searchServer)
    if (!els.query.value.trim() && !state.searchResults.length) {
      els.searchSummary.textContent = aggregate
        ? '搜索会自动聚合多个音乐平台，并按关键词相关度排序。'
        : '搜索结果将只来自 ' + sourceName(state.searchServer) + '。'
    }
  }

  function selectSearchServer (server, rerun = true) {
    if (!SEARCH_PLATFORM_IDS.includes(server) || server === state.searchServer) return
    cancelActiveSearch()
    searchRequestId += 1
    state.searchServer = server
    try { localStorage.setItem(STORAGE.searchServer, server) } catch {}
    state.searchResults = []
    els.searchResults.innerHTML = ''
    els.searchResultsWrap.hidden = true
    syncSearchSourcePicker()
    updateSearchPrompt()
    if (rerun && els.query.value.trim()) runSearch()
  }

  function renderSearchState (query, results, meta = {}, server = state.searchServer) {
    state.searchResults = results
    const aggregate = server === 'aggregate'
    const sourceResults = Array.isArray(meta.sources) ? meta.sources : []
    const completed = sourceResults.filter((item) => item.status === 'fulfilled').length
    const total = sourceResults.length
    renderTrackRows(els.searchResults, results, (aggregate ? '聚合搜索：' : sourceName(server) + '：') + query)
    els.searchCount.textContent = results.length + ' 首歌曲'
    if (!aggregate) {
      els.searchSummary.textContent = results.length
        ? `${sourceName(server)} · ${results.length} 首结果 · 已按相关度排序`
        : `${sourceName(server)}没有找到结果，试试其他关键词或切换平台。`
    } else {
      els.searchSummary.textContent = results.length
        ? `${meta.complete === false ? '先显示快速结果，其他平台后台补全' : '聚合完成'} · ${completed || total} 个平台已响应 · ${results.length} 首结果 · 已按相关度排序`
        : '没有找到结果，试试更短或更具体的关键词。'
    }
    els.searchResultsWrap.hidden = results.length === 0
    els.searchEmpty.hidden = results.length !== 0
    if (results.length) els.searchLoading.hidden = true
    if (results.length === 0) {
      els.searchEmpty.querySelector('h2').textContent = '没有找到匹配歌曲'
      els.searchEmpty.querySelector('p').textContent = aggregate
        ? '换个关键词，或者同时输入歌曲名和歌手名。'
        : '换个关键词，或者切换到聚合搜索和其他平台。'
    }
  }

  async function runSearch (rawQuery) {
    const query = text(rawQuery || els.query.value)
    if (!query) {
      showView('search')
      toast('请输入歌曲、歌手或关键词')
      return
    }
    els.query.value = query
    els.clearSearch.hidden = false
    showView('search')
    els.searchTitle.textContent = '“' + query + '”'
    const searchServer = state.searchServer
    const aggregate = searchServer === 'aggregate'
    els.searchEyebrow.textContent = aggregate ? '跨平台检索' : '单平台检索 · ' + sourceName(searchServer)
    els.searchSummary.textContent = aggregate
      ? '正在聚合多个音乐平台，并按关键词相关度排序。'
      : '正在搜索 ' + sourceName(searchServer) + '。'
    els.searchEmpty.hidden = true
    els.searchResultsWrap.hidden = true
    els.searchLoading.hidden = false
    const requestId = ++searchRequestId
    try {
      const result = await searchV2(query, searchServer)
      if (requestId !== searchRequestId) return
      renderSearchState(query, result.tracks, result.meta, searchServer)
      if (aggregate && result.meta?.complete === false) {
        setTimeout(async () => {
          if (requestId !== searchRequestId || state.searchServer !== searchServer || els.query.value.trim() !== query) return
          try {
            const enriched = await searchV2(query, searchServer)
            if (requestId !== searchRequestId) return
            renderSearchState(query, enriched.tracks, enriched.meta, searchServer)
          } catch {}
        }, 1800)
      }
    } catch (error) {
      if (requestId !== searchRequestId) return
      state.searchResults = []
      els.searchEmpty.hidden = false
      els.searchResultsWrap.hidden = true
      els.searchEmpty.querySelector('h2').textContent = '搜索暂时不可用'
      els.searchEmpty.querySelector('p').textContent = error.message
      toast(error.message, 'error')
    } finally {
      if (requestId === searchRequestId) els.searchLoading.hidden = true
    }
  }

  els.searchForm.addEventListener('submit', (event) => {
    event.preventDefault()
    runSearch()
  })
  $$('[data-search-server]', els.searchSourcePicker).forEach((button) => {
    button.addEventListener('click', () => selectSearchServer(button.dataset.searchServer))
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const buttons = $$('[data-search-server]', els.searchSourcePicker)
      const current = buttons.indexOf(button)
      const target = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
      event.preventDefault()
      buttons[target].focus()
      selectSearchServer(buttons[target].dataset.searchServer)
    })
  })
  els.query.addEventListener('input', () => { els.clearSearch.hidden = !els.query.value })
  els.clearSearch.addEventListener('click', () => {
    els.query.value = ''
    els.clearSearch.hidden = true
    els.query.focus()
  })
  $$('[data-discover]').forEach((button) => button.addEventListener('click', () => runSearch(button.dataset.discover)))
  els.playSearchResults.addEventListener('click', () => playFromList(state.searchResults, 0, '搜索结果'))

  /* ---------- Track rendering ---------- */

  function renderTrackRows (container, tracks, contextLabel) {
    container.innerHTML = ''
    if (!tracks.length) {
      const empty = document.createElement('div')
      empty.className = 'library-empty'
      empty.textContent = '这里还没有歌曲。'
      container.appendChild(empty)
      return
    }
    const fragment = document.createDocumentFragment()
    tracks.forEach((track, index) => fragment.appendChild(createTrackRow(track, index, tracks, contextLabel)))
    container.appendChild(fragment)
    syncCurrentRows()
    syncFavoriteButtons()
  }

  function playbackLabel (track) {
    const playback = track?.playback
    if (!playback) return ''
    if (playback.available === false) return '暂不可播'
    if (playback.previewOnly) return '试听'
    const quality = Array.isArray(playback.qualities)
      ? playback.qualities.find((item) => item?.available !== false)
      : null
    if (quality?.label) return quality.label
    if (playback.requiresSubscription) return '会员'
    return ''
  }

  function createTrackRow (track, index, list, contextLabel) {
    const row = document.createElement('div')
    row.className = 'track-row'
    row.dataset.trackKey = trackKey(track)
    row.style.setProperty('--item-index', String(Math.min(index, 12)))

    const number = document.createElement('div')
    number.className = 'track-number'
    const ordinal = document.createElement('span')
    ordinal.textContent = String(index + 1)
    const play = document.createElement('button')
    play.type = 'button'
    play.className = 'row-play'
    play.setAttribute('aria-label', '播放 ' + track.title)
    play.innerHTML = '<svg class="icon"><use href="#i-play"></use></svg>'
    play.addEventListener('click', () => playFromList(list, index, contextLabel))
    number.append(ordinal, play)

    const main = document.createElement('div')
    main.className = 'track-main'
    main.appendChild(createCover(track, 'row-cover'))
    const copy = document.createElement('div')
    copy.className = 'track-copy'
    const title = document.createElement('span')
    title.className = 'track-title'
    title.textContent = track.title
    const primaryArtist = track.artistItems?.find((item) => item.id)
    const author = document.createElement(primaryArtist ? 'button' : 'span')
    author.className = 'track-author'
    author.textContent = track.author
    if (primaryArtist) {
      author.type = 'button'
      author.classList.add('catalog-link')
      author.title = '查看 ' + primaryArtist.name
      author.addEventListener('click', (event) => {
        event.stopPropagation()
        loadCatalog('artists', track.server, primaryArtist.id).catch((error) => toast(error.message, 'error'))
      })
    }
    copy.append(title, author)
    main.appendChild(copy)
    main.addEventListener('dblclick', () => playFromList(list, index, contextLabel))

    const albumTarget = track.albumResource?.id
    const album = document.createElement(albumTarget ? 'button' : 'span')
    album.className = 'track-album'
    album.textContent = [track.album, sourceName(track.server), playbackLabel(track)].filter(Boolean).join(' · ') || 'RMusic'
    if (albumTarget) {
      album.type = 'button'
      album.classList.add('catalog-link')
      album.title = '查看专辑 ' + track.album
      album.addEventListener('click', () => {
        loadCatalog('albums', track.server, albumTarget).catch((error) => toast(error.message, 'error'))
      })
    }

    const like = document.createElement('button')
    like.type = 'button'
    like.className = 'icon-button row-action favorite-action'
    like.dataset.trackKey = trackKey(track)
    like.setAttribute('aria-label', '喜欢 ' + track.title)
    like.innerHTML = '<svg class="icon"><use href="#i-heart"></use></svg>'
    like.addEventListener('click', () => toggleFavorite(track))

    const duration = document.createElement('span')
    duration.className = 'track-duration'
    duration.textContent = durationLabel(track)

    row.append(number, main, album, like, duration)
    return row
  }

  function renderCards (container, tracks, contextLabel = '最近播放', emptyMessage = '播放一些歌曲后，这里会自动出现。') {
    container.innerHTML = ''
    if (!tracks.length) {
      const empty = document.createElement('div')
      empty.className = 'library-empty'
      empty.textContent = emptyMessage
      container.appendChild(empty)
      return
    }
    tracks.slice(0, 8).forEach((track, index) => {
      const card = document.createElement('article')
      card.className = 'music-card'
      card.tabIndex = 0
      card.style.setProperty('--item-index', String(index))
      const cover = createCover(track, 'card-cover')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'card-play'
      button.setAttribute('aria-label', '播放 ' + track.title)
      button.innerHTML = '<svg class="icon"><use href="#i-play"></use></svg>'
      button.addEventListener('click', (event) => { event.stopPropagation(); playFromList(tracks, index, contextLabel) })
      cover.appendChild(button)
      const badge = document.createElement('span')
      badge.className = 'card-badge'
      badge.textContent = [sourceName(track.server), playbackLabel(track)].filter(Boolean).join(' · ')
      cover.appendChild(badge)
      const title = document.createElement('strong')
      title.textContent = track.title
      const author = document.createElement('span')
      author.textContent = track.author
      card.append(cover, title, author)
      card.addEventListener('click', () => playFromList(tracks, index, contextLabel))
      card.addEventListener('keydown', (event) => { if (event.key === 'Enter') playFromList(tracks, index, contextLabel) })
      container.appendChild(card)
    })
  }

  function renderDiscovery () {
    const discovery = state.discovery
    const waiting = state.discoveryLoading ? '正在获取最新内容…' : '暂时没有可展示的内容。'
    renderCards(els.discoveryRecommendations, discovery.recommendations, '为你推荐', waiting)
    renderCards(els.discoveryCharts, discovery.charts, '热门榜单', waiting)
    renderCards(els.discoveryNewReleases, discovery.newReleases, '新歌速递', waiting)
    els.playCharts.disabled = discovery.charts.length === 0
    els.playNewReleases.disabled = discovery.newReleases.length === 0
    if (discovery.cachedAt) {
      const updated = new Date(discovery.cachedAt).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
      els.discoveryStatus.textContent = `目录推荐 · 更新于 ${updated}`
    } else {
      els.discoveryStatus.textContent = state.discoveryLoading ? '正在整理今日推荐…' : '推荐服务暂时不可用'
    }
  }

  async function loadDiscovery (refresh = false) {
    if (state.discoveryLoading) return
    const hasFreshCache = state.discovery.cachedAt > Date.now() - 10 * 60 * 1000 &&
      (state.discovery.recommendations.length || state.discovery.charts.length || state.discovery.newReleases.length)
    if (!refresh && hasFreshCache) {
      renderDiscovery()
      return
    }
    state.discoveryLoading = true
    els.refreshDiscovery.disabled = true
    els.refreshDiscovery.classList.add('refreshing')
    renderDiscovery()
    try {
      const payload = await fetchV2('/discovery', {
        source: 'netease,tencent',
        limit: '8',
        view: 'compact',
        ...(refresh ? { refresh: 'true' } : {})
      })
      const data = payload?.data || {}
      state.discovery = {
        recommendations: normalizeList(data.recommendations),
        charts: normalizeList(data.charts),
        newReleases: normalizeList(data.newReleases),
        cachedAt: Date.now()
      }
      writeJson(STORAGE.discovery, {
        ...state.discovery,
        recommendations: state.discovery.recommendations.map(compactCachedTrack),
        charts: state.discovery.charts.map(compactCachedTrack),
        newReleases: state.discovery.newReleases.map(compactCachedTrack)
      })
    } catch (error) {
      if (!state.discovery.cachedAt) els.discoveryStatus.textContent = error.message
      if (refresh) toast('推荐刷新失败：' + error.message, 'error')
    } finally {
      state.discoveryLoading = false
      els.refreshDiscovery.disabled = false
      els.refreshDiscovery.classList.remove('refreshing')
      renderDiscovery()
    }
  }

  els.refreshDiscovery.addEventListener('click', () => loadDiscovery(true))
  els.playCharts.addEventListener('click', () => playFromList(state.discovery.charts, 0, '热门榜单'))
  els.playNewReleases.addEventListener('click', () => playFromList(state.discovery.newReleases, 0, '新歌速递'))

  /* ---------- Favorites, recent and library ---------- */

  function isFavorite (track) {
    const key = trackKey(track)
    return state.favorites.some((item) => trackKey(item) === key)
  }

  async function toggleFavorite (track) {
    if (!requireAccount('收藏歌曲')) return
    const key = trackKey(track)
    const index = state.favorites.findIndex((item) => trackKey(item) === key)
    const previous = state.favorites.slice()
    const removing = index >= 0
    if (index >= 0) {
      state.favorites.splice(index, 1)
      toast('已从喜欢的歌曲中移除')
    } else {
      state.favorites.unshift(normalizeTrack(track, track.server))
      state.favorites = state.favorites.slice(0, 200)
      toast('已添加到喜欢的歌曲')
    }
    renderHome()
    renderLibrary()
    syncFavoriteButtons()
    try {
      if (removing) {
        await authFetch('/library/favorites/' + encodeURIComponent(track.server) + '/' + encodeURIComponent(track.id), { method: 'DELETE' })
      } else {
        await authFetch('/library/favorites', { method: 'PUT', body: { track: compactCachedTrack(track) } })
      }
    } catch (error) {
      state.favorites = previous
      renderHome()
      renderLibrary()
      syncFavoriteButtons()
      toast('收藏同步失败：' + error.message, 'error')
    }
  }

  function syncFavoriteButtons () {
    $$('.favorite-action').forEach((button) => {
      const liked = state.favorites.some((item) => trackKey(item) === button.dataset.trackKey)
      button.classList.toggle('liked', liked)
      button.title = liked ? '取消喜欢' : '添加到喜欢'
    })
    const currentLiked = state.currentTrack && isFavorite(state.currentTrack)
    ;[els.nowLike, els.mobileNowLike].forEach((button) => {
      button.classList.toggle('liked', !!currentLiked)
      button.title = currentLiked ? '取消喜欢' : '添加到喜欢'
    })
  }

  function addRecent (track) {
    const key = trackKey(track)
    state.recent = [normalizeTrack(track, track.server), ...state.recent.filter((item) => trackKey(item) !== key)].slice(0, 30)
    renderHome()
    renderLibrary()
    authFetch('/library/recent', {
      method: 'POST',
      body: { track: compactCachedTrack(track) }
    }).catch((error) => {
      if (error.status === 401) refreshAccount(false).catch(() => {})
      else toast('播放记录同步失败：' + error.message, 'error')
    })
  }

  function renderHome () {
    renderDiscovery()
    renderCards(els.recentGrid, state.recent, '最近播放')
    els.favoritePreviewSection.hidden = state.favorites.length === 0
    renderTrackRows(els.favoritePreview, state.favorites.slice(0, 5), '喜欢的歌曲')
  }

  function renderLibrary () {
    renderSavedPlaylists()
    els.playlistCount.textContent = state.playlists.length ? state.playlists.length + ' 个歌单' : '还没有保存歌单'
    els.favoriteCount.textContent = state.favorites.length + ' 首歌曲'
    renderTrackRows(els.favoriteTracks, state.favorites, '喜欢的歌曲')
    renderTrackRows(els.recentTracks, state.recent, '最近播放')
  }

  els.nowLike.addEventListener('click', () => { if (state.currentTrack) toggleFavorite(state.currentTrack) })
  els.mobileNowLike.addEventListener('click', () => { if (state.currentTrack) toggleFavorite(state.currentTrack) })
  els.clearRecent.addEventListener('click', async () => {
    if (!requireAccount('清空播放记录')) return
    const previous = state.recent.slice()
    state.recent = []
    renderHome()
    renderLibrary()
    try {
      await authFetch('/library/recent', { method: 'DELETE' })
      toast('最近播放已清空')
    } catch (error) {
      state.recent = previous
      renderHome()
      renderLibrary()
      toast('清空失败：' + error.message, 'error')
    }
  })

  /* ---------- Playlists ---------- */

  function playlistKey (playlist) { return (playlist.server || 'aggregate') + ':' + playlist.id }

  function compactCachedTrack (track) {
    const normalized = normalizeTrack(track)
    return {
      id: normalized.id || '',
      server: normalized.server,
      title: normalized.title,
      author: normalized.author,
      artists: normalized.artistItems,
      album: normalized.albumResource?.id ? normalized.albumResource : normalized.album,
      url: normalized.url,
      pic: normalized.pic,
      lrc: normalized.lrc,
      lrcpword: normalized.lrcpword,
      duration_ms: normalized.duration_ms,
      playback: normalized.playback
    }
  }

  function playlistSnapshot (playlist, cachedAt = Date.now()) {
    return {
      version: 2,
      server: playlist.server || 'aggregate',
      id: String(playlist.id),
      name: playlist.name || ('歌单 ' + playlist.id),
      cover: playlist.cover || '',
      description: playlist.description || '',
      creator: playlist.creator || null,
      stats: playlist.stats || null,
      tracks: Array.isArray(playlist.tracks) ? playlist.tracks.map(compactCachedTrack) : [],
      cachedAt,
      savedAt: playlist.savedAt || Date.now()
    }
  }

  async function readPlaylistCache (playlist) {
    if (!state.account.authenticated) return null
    try {
      const payload = await authFetch('/library/playlists/' + encodeURIComponent(playlist.server) + '/' + encodeURIComponent(playlist.id))
      const snapshot = payload?.playlist
      if (!snapshot || String(snapshot.id) !== String(playlist.id) || !Array.isArray(snapshot.tracks)) return null
      return {
        ...playlist,
        ...snapshot,
        tracks: normalizeList(snapshot.tracks, snapshot.server || playlist.server),
        fromCache: true
      }
    } catch (error) {
      if (error.status === 404) return null
      throw error
    }
  }

  function savedPlaylistFor (playlist) {
    return state.playlists.find((item) => playlistKey(item) === playlistKey(playlist)) || null
  }

  function parsePlaylistInput (rawValue) {
    const raw = rawValue.trim()
    const inferred = { server: 'aggregate', id: raw }
    if (!raw) return inferred
    if (/^(?:PL|OLAK5uy_)/i.test(raw)) return { server: 'ytmusic', id: raw }
    if (/^pl\./i.test(raw)) return { server: 'apple', id: raw }
    if (!/^https?:\/\//i.test(raw)) return inferred
    try {
      const url = new URL(raw)
      const host = url.hostname.toLowerCase()
      if (host.includes('music.163.com') || host.endsWith('163cn.tv')) inferred.server = 'netease'
      else if (host.includes('y.qq.com')) inferred.server = 'tencent'
      else if (host.includes('kugou.com')) inferred.server = 'kugou'
      else if (host.includes('music.douyin.com') || host.includes('qishui.com')) inferred.server = 'soda'
      else if (host.includes('kuwo.cn')) inferred.server = 'kuwo'
      else if (host.includes('music.baidu.com')) inferred.server = 'baidu'
      else if (host.includes('youtube.com') || host === 'youtu.be') inferred.server = 'ytmusic'
      else if (host.includes('spotify.com')) inferred.server = 'spotify'
      else if (host.includes('music.apple.com')) inferred.server = 'apple'
      const pathParts = url.pathname.split('/').filter(Boolean)
      const hashQuery = url.hash.includes('?') ? new URLSearchParams(url.hash.slice(url.hash.indexOf('?') + 1)) : null
      inferred.id =
        url.searchParams.get('id') ||
        url.searchParams.get('list') ||
        url.searchParams.get('playlistId') ||
        url.searchParams.get('global_collection_id') ||
        hashQuery?.get('id') ||
        hashQuery?.get('list') ||
        pathParts.at(-1) ||
        raw
      return inferred
    } catch {
      return inferred
    }
  }

  function openPlaylistModal () {
    if (!requireAccount('保存歌单')) return
    els.playlistModal.hidden = false
    els.playlistFormError.hidden = true
    setTimeout(() => els.playlistId.focus(), 40)
  }

  function closePlaylistModal () {
    els.playlistModal.hidden = true
    els.playlistFormError.hidden = true
  }

  $('openPlaylistModal').addEventListener('click', openPlaylistModal)
  $('heroPlaylistButton').addEventListener('click', openPlaylistModal)
  $('libraryAddPlaylist').addEventListener('click', openPlaylistModal)
  els.closePlaylistModal.addEventListener('click', closePlaylistModal)
  els.playlistModal.addEventListener('click', (event) => { if (event.target === els.playlistModal) closePlaylistModal() })

  els.playlistForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const parsed = parsePlaylistInput(els.playlistId.value)
    const playlist = {
      server: parsed.server,
      id: parsed.id,
      name: '歌单 ' + parsed.id
    }
    if (!playlist.id) return
    els.loadPlaylistButton.disabled = true
    els.loadPlaylistButton.textContent = '识别并保存中…'
    els.playlistFormError.hidden = true
    try {
      closePlaylistModal()
      const loaded = await loadPlaylist(playlist)
      if (loaded) {
        const stored = await savePlaylistDefinition(loaded)
        renderLibrary()
        syncCollectionSaveButton()
        renderCollectionHeader()
        toast(stored.cached ? '歌单和完整曲目已保存到账号' : '歌单保存失败', stored.cached ? undefined : 'error')
      }
      els.playlistForm.reset()
    } catch (error) {
      els.playlistModal.hidden = false
      els.playlistFormError.textContent = error.message
      els.playlistFormError.hidden = false
    } finally {
      els.loadPlaylistButton.disabled = false
      els.loadPlaylistButton.textContent = '识别并保存'
    }
  })

  async function savePlaylistDefinition (playlist, previousPlaylist = null) {
    if (!requireAccount('保存歌单')) return { saved: false, cached: false }
    const cachedAt = Date.now()
    const snapshot = playlistSnapshot({ ...playlist, savedAt: savedPlaylistFor(previousPlaylist || playlist)?.savedAt || Date.now() }, cachedAt)
    const result = await authFetch(
      '/library/playlists/' + encodeURIComponent(snapshot.server) + '/' + encodeURIComponent(snapshot.id),
      { method: 'PUT', body: { playlist: snapshot } }
    )
    const value = result.playlist || {
      server: playlist.server,
      id: String(playlist.id),
      name: playlist.name || ('歌单 ' + playlist.id),
      cover: playlist.cover || '',
      description: playlist.description || '',
      creator: playlist.creator || null,
      stats: playlist.stats || null,
      cachedAt,
      savedAt: Date.now(),
      trackCount: snapshot.tracks.length
    }
    const replacedKeys = new Set([playlistKey(value)])
    if (previousPlaylist) replacedKeys.add(playlistKey(previousPlaylist))
    const candidates = [value, ...state.playlists.filter((item) => !replacedKeys.has(playlistKey(item)))]
    state.playlists = candidates.slice(0, 60)
    if (previousPlaylist && playlistKey(previousPlaylist) !== playlistKey(value)) {
      await authFetch('/library/playlists/' + encodeURIComponent(previousPlaylist.server) + '/' + encodeURIComponent(previousPlaylist.id), { method: 'DELETE' })
    }
    playlist.cachedAt = value.cachedAt
    playlist.fromCache = true
    renderSavedPlaylists()
    return { saved: true, cached: true }
  }

  async function removePlaylistDefinition (playlist) {
    if (!requireAccount('移除歌单')) return
    try {
      await authFetch('/library/playlists/' + encodeURIComponent(playlist.server) + '/' + encodeURIComponent(playlist.id), { method: 'DELETE' })
      state.playlists = state.playlists.filter((item) => playlistKey(item) !== playlistKey(playlist))
      if (state.collection && playlistKey(state.collection) === playlistKey(playlist)) {
        state.collection.cachedAt = null
        state.collection.fromCache = false
      }
      renderSavedPlaylists()
      renderLibrary()
      syncCollectionSaveButton()
      renderCollectionHeader()
      toast('歌单已从账号音乐库移除')
    } catch (error) {
      toast('移除歌单失败：' + error.message, 'error')
    }
  }

  function renderSavedPlaylists () {
    els.savedPlaylists.innerHTML = ''
    els.sidebarPlaylists.innerHTML = ''
    if (!state.playlists.length) {
      const sidebarEmpty = document.createElement('div')
      sidebarEmpty.className = 'sidebar-empty'
      sidebarEmpty.textContent = '点击 +，粘贴歌单链接或输入 ID。'
      els.sidebarPlaylists.appendChild(sidebarEmpty)
      const empty = document.createElement('div')
      empty.className = 'library-empty'
      empty.textContent = '还没有歌单。点击“添加歌单”，把网易云、QQ 音乐等平台的歌单放进来。'
      els.savedPlaylists.appendChild(empty)
      return
    }
    state.playlists.forEach((playlist, playlistIndex) => {
      const side = document.createElement('button')
      side.type = 'button'
      side.className = 'sidebar-playlist'
      side.textContent = playlist.name
      side.title = playlist.name + ' · ' + playlist.server + (playlist.cachedAt ? ' · 已保存到账号' : '')
      side.addEventListener('click', () => loadPlaylist(playlist).catch((error) => toast(error.message, 'error')))
      els.sidebarPlaylists.appendChild(side)

      const card = document.createElement('article')
      card.className = 'playlist-card'
      card.tabIndex = 0
      card.style.setProperty('--item-index', String(Math.min(playlistIndex, 10)))
      const art = document.createElement('div')
      art.className = 'playlist-art'
      art.textContent = initials(playlist.name)
      if (playlist.cover) {
        const image = document.createElement('img')
        image.loading = 'lazy'
        image.decoding = 'async'
        image.src = playlist.cover
        image.alt = ''
        image.addEventListener('error', () => image.remove())
        art.appendChild(image)
      }
      const copy = document.createElement('div')
      copy.className = 'playlist-copy'
      const name = document.createElement('strong')
      name.textContent = playlist.name
      const meta = document.createElement('span')
      const cachedCount = playlist.cachedAt && (playlist.stats?.trackCount || playlist.trackCount)
        ? (playlist.stats?.trackCount || playlist.trackCount) + ' 首 · 账号云端'
        : (playlist.cachedAt ? '账号云端' : '')
      meta.textContent = [sourceName(playlist.server), playlist.creator?.name, cachedCount].filter(Boolean).join(' · ') || '在线歌单'
      copy.append(name, meta)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'icon-button playlist-remove'
      remove.title = '移除歌单'
      remove.innerHTML = '<svg class="icon"><use href="#i-close"></use></svg>'
      remove.addEventListener('click', (event) => { event.stopPropagation(); removePlaylistDefinition(playlist) })
      card.append(art, copy, remove)
      card.addEventListener('click', () => loadPlaylist(playlist).catch((error) => toast(error.message, 'error')))
      card.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadPlaylist(playlist).catch((error) => toast(error.message, 'error')) })
      els.savedPlaylists.appendChild(card)
    })
  }

  function sourceName (server) {
    const labels = { aggregate: '聚合', netease: '网易云', tencent: 'QQ 音乐', ytmusic: 'YouTube Music', kugou: '酷狗', soda: '汽水音乐', kuwo: '酷我', baidu: '百度', spotify: 'Spotify', apple: 'Apple Music' }
    return labels[server] || server
  }

  async function loadCatalog (resource, source, id) {
    if (!['albums', 'artists'].includes(resource) || !source || !id) return false
    const requestId = ++collectionRequestId
    const collection = {
      id: String(id),
      server: source,
      resourceType: resource === 'albums' ? 'album' : 'artist',
      name: resource === 'albums' ? '正在载入专辑' : '正在载入歌手',
      tracks: []
    }
    state.collection = collection
    showView('collection')
    renderCollectionHeader()
    els.collectionLoading.hidden = false
    els.collectionTracks.innerHTML = ''
    try {
      let offset = 0
      const limit = resource === 'albums' ? 100 : 50
      let metadata = null
      const tracks = []
      for (let page = 0; page < 100; page += 1) {
        const payload = await fetchV2(
          '/' + resource + '/' + encodeURIComponent(source) + '/' + encodeURIComponent(String(id)),
          { offset: String(offset), limit: String(limit), view: 'compact' }
        )
        const data = payload?.data
        if (!data || typeof data !== 'object') throw new Error('目录返回格式异常')
        metadata ||= data
        const pageTracks = normalizeList(data.tracks?.items, source)
        tracks.push(...pageTracks)
        if (!data.tracks?.hasMore || !pageTracks.length) break
        offset += pageTracks.length
      }
      if (requestId !== collectionRequestId) return false
      collection.name = metadata?.name || collection.name
      collection.cover = metadata?.artwork?.url || metadata?.artwork?.originalUrl || ''
      collection.description = metadata?.description || ''
      collection.artists = metadata?.artists || []
      collection.genres = metadata?.genres || []
      collection.label = metadata?.label || ''
      collection.releaseDate = metadata?.releaseDate || ''
      collection.stats = metadata?.stats || { trackCount: tracks.length }
      collection.sourceUrl = metadata?.links?.source || null
      collection.tracks = tracks
      if (resource === 'artists' && metadata?.links?.albums) {
        try {
          const albumPayload = await fetchV2(
            '/artists/' + encodeURIComponent(source) + '/' + encodeURIComponent(String(id)) + '/albums',
            { offset: '0', limit: '20' }
          )
          collection.albums = Array.isArray(albumPayload?.data) ? albumPayload.data : []
          collection.albumCount = Number(albumPayload?.meta?.total || collection.albums.length)
        } catch {
          collection.albums = []
        }
      }
      renderCollectionHeader()
      renderTrackRows(els.collectionTracks, tracks, collection.name)
      if (!tracks.length) toast('目录没有返回曲目', 'error')
      return collection
    } catch (error) {
      if (requestId !== collectionRequestId) return false
      const empty = document.createElement('div')
      empty.className = 'library-empty'
      empty.textContent = error.message
      els.collectionTracks.appendChild(empty)
      throw error
    } finally {
      if (requestId === collectionRequestId) els.collectionLoading.hidden = true
    }
  }

  function renderArtistAlbums () {
    const collection = state.collection
    const albums = collection?.resourceType === 'artist' && Array.isArray(collection.albums)
      ? collection.albums
      : []
    els.artistAlbumsSection.hidden = albums.length === 0
    els.artistAlbums.innerHTML = ''
    els.artistAlbumsCount.textContent = albums.length
      ? `${collection.albumCount || albums.length} 张专辑/单曲`
      : ''
    albums.forEach((album, index) => {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'album-card'
      card.style.setProperty('--item-index', String(Math.min(index, 12)))
      const cover = document.createElement('span')
      cover.className = 'album-card-cover'
      cover.textContent = initials(album.name)
      const artwork = album.artwork?.url || album.artwork?.originalUrl
      if (artwork) {
        const image = document.createElement('img')
        image.loading = 'lazy'
        image.decoding = 'async'
        image.src = artwork
        image.alt = ''
        image.addEventListener('error', () => image.remove())
        cover.appendChild(image)
      }
      const name = document.createElement('strong')
      name.textContent = album.name || '未命名专辑'
      const detail = document.createElement('span')
      detail.textContent = [
        album.releaseDate ? String(album.releaseDate).slice(0, 4) : '',
        album.albumType,
        album.stats?.trackCount ? album.stats.trackCount + ' 首' : ''
      ].filter(Boolean).join(' · ')
      card.append(cover, name, detail)
      card.addEventListener('click', () => {
        loadCatalog('albums', collection.server, album.id).catch((error) => toast(error.message, 'error'))
      })
      els.artistAlbums.appendChild(card)
    })
  }

  async function fetchPlaylistV2 (playlist, refresh = false) {
    let source = playlist.server || 'aggregate'
    let offset = 0
    const limit = 100
    const tracks = []
    let metadata = null
    for (let page = 0; page < 100; page += 1) {
      const path = '/playlists/' + encodeURIComponent(source) + '/' + encodeURIComponent(String(playlist.id))
      const payload = await fetchV2(path, {
        offset: String(offset),
        limit: String(limit),
        view: 'compact',
        ...(refresh ? { refresh: 'true' } : {})
      })
      const data = payload?.data
      if (!data || typeof data !== 'object') throw new Error('歌单返回格式异常')
      if (!metadata) {
        metadata = data
        if (source === 'aggregate' && data.source) source = data.source
      }
      const pageTracks = normalizeList(data.tracks?.items, data.source || source)
      tracks.push(...pageTracks)
      if (!data.tracks?.hasMore || !pageTracks.length) break
      offset += pageTracks.length
    }
    return { metadata: metadata || {}, tracks }
  }

  function applyPlaylistResult (collection, result) {
    collection.resourceType = 'playlist'
    collection.tracks = result.tracks
    collection.server = result.metadata.source || collection.server
    collection.name = result.metadata.name || collection.name
    collection.cover = result.metadata.cover || ''
    collection.description = result.metadata.description || ''
    collection.creator = result.metadata.creator || null
    collection.stats = result.metadata.stats || null
    collection.fromCache = false
    return collection
  }

  async function loadPlaylist (playlist) {
    const requestId = ++collectionRequestId
    const savedDefinition = savedPlaylistFor(playlist)
    const cached = savedDefinition ? await readPlaylistCache(savedDefinition) : null
    if (cached) {
      state.collection = cached
      showView('collection')
      els.collectionLoading.hidden = true
      renderCollectionHeader()
      renderTrackRows(els.collectionTracks, cached.tracks, cached.name)
      return cached
    }

    const collection = { ...(savedDefinition || playlist), resourceType: 'playlist', tracks: [] }
    state.collection = collection
    showView('collection')
    renderCollectionHeader()
    els.collectionLoading.hidden = false
    els.collectionTracks.innerHTML = ''
    try {
      const result = await fetchPlaylistV2(playlist)
      if (requestId !== collectionRequestId) return false
      applyPlaylistResult(collection, result)
      if (savedDefinition) await savePlaylistDefinition(collection, savedDefinition)
      renderCollectionHeader()
      renderTrackRows(els.collectionTracks, collection.tracks, collection.name)
      if (!collection.tracks.length) toast('歌单没有返回曲目', 'error')
      return collection
    } catch (error) {
      if (requestId !== collectionRequestId) return false
      const empty = document.createElement('div')
      empty.className = 'library-empty'
      empty.textContent = error.message
      els.collectionTracks.appendChild(empty)
      throw error
    } finally {
      if (requestId === collectionRequestId) els.collectionLoading.hidden = true
    }
  }

  function renderCollectionHeader () {
    const collection = state.collection
    if (!collection) return
    const resourceLabel = collection.resourceType === 'album'
      ? '专辑'
      : (collection.resourceType === 'artist' ? '歌手' : '歌单')
    els.collectionKind.textContent = sourceName(collection.server) + ' ' + resourceLabel
    els.collectionTitle.textContent = collection.name || (resourceLabel + ' ' + collection.id)
    const creator = collection.creator?.name ? '创建人：' + collection.creator.name : ''
    const catalogDetails = [
      collection.releaseDate ? String(collection.releaseDate).slice(0, 10) : '',
      collection.label,
      ...(Array.isArray(collection.genres) ? collection.genres.slice(0, 2) : [])
    ].filter(Boolean).join(' · ')
    els.collectionDescription.textContent = collection.description || creator || catalogDetails || ('来自 ' + sourceName(collection.server) + ' · 在线获取最新曲目')
    const total = collection.stats?.trackCount || collection.tracks.length
    els.collectionCount.textContent = total ? total + ' 首歌曲' : '正在载入曲目'
    if (collection.cachedAt) {
      const updated = new Date(collection.cachedAt).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
      els.collectionCacheStatus.textContent = '· 账号云端 · 更新于 ' + updated
      els.collectionCacheStatus.hidden = false
    } else {
      els.collectionCacheStatus.textContent = ''
      els.collectionCacheStatus.hidden = true
    }
    els.collectionCover.innerHTML = ''
    const cover = collection.cover || collection.tracks[0]?.pic
    if (cover) {
      const image = document.createElement('img')
      image.decoding = 'async'
      image.src = cover
      image.alt = ''
      image.addEventListener('error', () => { image.remove(); els.collectionCover.textContent = initials(collection.name) })
      els.collectionCover.appendChild(image)
    } else {
      els.collectionCover.textContent = initials(collection.name)
    }
    renderArtistAlbums()
    syncCollectionSaveButton()
  }

  function syncCollectionSaveButton () {
    const collection = state.collection
    const isPlaylist = !collection?.resourceType || collection.resourceType === 'playlist'
    els.saveCollection.hidden = !isPlaylist
    els.refreshCollection.hidden = !isPlaylist
    if (!isPlaylist) return
    const saved = !!collection && state.playlists.some((item) => playlistKey(item) === playlistKey(collection))
    els.saveCollection.classList.toggle('saved', saved)
    els.saveCollection.title = saved ? '从音乐库移除' : '保存到音乐库'
    els.refreshCollection.hidden = !saved
    els.refreshCollection.disabled = !saved || els.refreshCollection.classList.contains('refreshing')
  }

  els.playCollection.addEventListener('click', () => {
    if (state.collection?.tracks.length) playFromList(state.collection.tracks, 0, state.collection.name)
  })
  els.saveCollection.addEventListener('click', async () => {
    if (!state.collection) return
    const saved = state.playlists.some((item) => playlistKey(item) === playlistKey(state.collection))
    if (saved) await removePlaylistDefinition(state.collection)
    else {
      try {
        const stored = await savePlaylistDefinition(state.collection)
        renderLibrary()
        syncCollectionSaveButton()
        renderCollectionHeader()
        toast(stored.cached ? '歌单和完整曲目已保存到账号' : '歌单保存失败', stored.cached ? undefined : 'error')
      } catch (error) {
        toast('歌单保存失败：' + error.message, 'error')
      }
    }
  })

  els.refreshCollection.addEventListener('click', async () => {
    const previous = state.collection
    const savedDefinition = previous && savedPlaylistFor(previous)
    if (!previous || !savedDefinition || els.refreshCollection.disabled) return
    const requestId = ++collectionRequestId
    els.refreshCollection.disabled = true
    els.refreshCollection.classList.add('refreshing')
    els.refreshCollection.querySelector('span').textContent = '更新中…'
    try {
      const result = await fetchPlaylistV2(previous, true)
      if (requestId !== collectionRequestId) return
      const refreshed = applyPlaylistResult({ ...previous }, result)
      state.collection = refreshed
      const stored = await savePlaylistDefinition(refreshed, savedDefinition)
      renderCollectionHeader()
      renderTrackRows(els.collectionTracks, refreshed.tracks, refreshed.name)
      toast(stored.cached
        ? `歌单已更新到账号 · ${refreshed.tracks.length} 首`
        : '歌单已更新，但云端保存失败', stored.cached ? undefined : 'error')
    } catch (error) {
      if (requestId === collectionRequestId) toast('更新失败，继续使用账号中的版本：' + error.message, 'error')
    } finally {
      if (requestId === collectionRequestId) {
        els.refreshCollection.classList.remove('refreshing')
        els.refreshCollection.querySelector('span').textContent = '更新歌单'
        syncCollectionSaveButton()
      }
    }
  })

  /* ---------- Queue and playback ---------- */

  function playFromList (tracks, index, label) {
    if (!tracks.length || !tracks[index]) return
    if (!requireAccount('播放音乐')) return
    state.queue = tracks.slice()
    state.queueIndex = index
    state.queueLabel = label || '播放队列'
    playQueueIndex(index)
  }

  function playQueueIndex (index) {
    const track = state.queue[index]
    if (!track) return
    if (!requireAccount('播放音乐')) return
    clearTimeout(pendingSkipTimer)
    state.queueIndex = index
    state.currentTrack = track
    updateNowPlaying(track)
    renderQueue()
    syncCurrentRows()
    updateTransportEnabled()
    setLoading(true)

    if (!track.url) {
      setLoading(false)
      state.consecutiveErrors += 1
      if (state.consecutiveErrors >= 3) {
        state.consecutiveErrors = 0
        toast('连续多首歌曲没有可用地址，请稍后重试', 'error')
      } else {
        toast('当前歌曲没有可用地址，正在跳到下一首', 'error')
        pendingSkipTimer = setTimeout(() => advance(1), 850)
      }
      return
    }

    // Keep audio.src + play() synchronous. iOS can suspend a
    // background tab in the await gap between tracks.
    els.audio.src = streamUrl(track.url)
    const promise = els.audio.play()
    if (promise && typeof promise.catch === 'function') promise.catch(() => setLoading(false))

    addRecent(track)
    loadLyrics(track)
  }

  function setArtwork (image, fallback, track) {
    fallback.textContent = initials(track.title)
    fallback.hidden = false
    if (!track.pic) {
      image.hidden = true
      image.removeAttribute('src')
      return
    }
    const expected = new URL(track.pic, location.href).href
    image.hidden = false
    image.decoding = 'async'
    image.src = track.pic
    image.onload = () => { if (image.src === expected) fallback.hidden = true }
    image.onerror = () => {
      if (image.src !== expected) return
      image.hidden = true
      fallback.hidden = false
    }
  }

  function updateNowPlaying (track) {
    els.nowTitle.textContent = track.title
    els.nowAuthor.textContent = track.author
    els.lyricsTitle.textContent = track.title
    els.nowLike.disabled = false
    els.mobileNowTitle.textContent = track.title
    els.mobileNowAuthor.textContent = track.author
    els.mobileNowLike.disabled = false
    els.homeNowKicker.textContent = 'NOW PLAYING · ' + sourceName(track.server).toUpperCase()
    els.homeNowTitle.textContent = track.title
    els.homeNowAuthor.textContent = track.author
    els.homeNowCard.classList.add('has-track')
    setArtwork(els.nowCover, els.nowCoverFallback, track)
    setArtwork(els.mobileNowCover, els.mobileNowFallback, track)
    setArtwork(els.homeNowCover, els.homeNowFallback, track)
    if (track.pic) {
      els.ambient.style.backgroundImage = "url('" + track.pic.replace(/'/g, '%27') + "')"
      els.ambient.style.opacity = '.42'
      els.mobileNowBackdrop.style.backgroundImage = els.ambient.style.backgroundImage
    } else {
      els.ambient.style.backgroundImage = ''
      els.ambient.style.opacity = '.78'
      els.mobileNowBackdrop.style.backgroundImage = ''
    }
    syncFavoriteButtons()
    updateMediaSession(track)
    els.player.classList.remove('track-changed')
    requestAnimationFrame(() => els.player.classList.add('track-changed'))
  }

  function updateTransportEnabled () {
    const hasQueue = state.queue.length > 0 && state.account.authenticated
    ;[els.prevBtn, els.nextBtn, els.playBtn, els.mobilePrevBtn, els.mobileNextBtn, els.mobilePlayBtn].forEach((button) => {
      button.disabled = !hasQueue
    })
  }

  function setLoading (loading) {
    state.loadingAudio = !!loading
    ;[els.playBtn, els.mobilePlayBtn].forEach((button) => button.classList.toggle('loading', state.loadingAudio))
    if (!state.loadingAudio) updatePlayIcon()
  }

  function updatePlayIcon () {
    const paused = els.audio.paused
    iconUse(els.playIcon, paused ? 'i-play' : 'i-pause')
    iconUse(els.mobilePlayIcon, paused ? 'i-play' : 'i-pause')
    iconUse(els.homeNowActionIcon, state.currentTrack ? (paused ? 'i-play' : 'i-pause') : 'i-search')
    els.homeNowAction.classList.toggle('playback', !!state.currentTrack)
    els.homeNowActionLabel.textContent = state.currentTrack ? (paused ? '继续播放' : '暂停') : '去搜索'
    ;[els.playBtn, els.mobilePlayBtn].forEach((button) => {
      button.classList.toggle('paused', paused)
      button.title = paused ? '播放' : '暂停'
      button.setAttribute('aria-label', paused ? '播放' : '暂停')
    })
  }

  function togglePlay () {
    if (!state.currentTrack) {
      if (!state.queue.length) { showView('search'); return }
      if (!requireAccount('播放音乐')) return
      playQueueIndex(Math.max(0, state.queueIndex))
      return
    }
    if (!requireAccount('播放音乐')) return
    if (els.audio.paused) els.audio.play().catch(() => {})
    else els.audio.pause()
  }

  function nextIndex (direction) {
    if (!state.queue.length) return -1
    if (state.shuffle === 'on' && state.queue.length > 1) {
      let next = state.queueIndex
      while (next === state.queueIndex) next = Math.floor(Math.random() * state.queue.length)
      return next
    }
    const candidate = state.queueIndex + direction
    if (candidate >= 0 && candidate < state.queue.length) return candidate
    if (state.repeat === 'all') return candidate < 0 ? state.queue.length - 1 : 0
    return -1
  }

  function advance (direction) {
    const index = nextIndex(direction)
    if (index >= 0) playQueueIndex(index)
  }

  els.playBtn.addEventListener('click', togglePlay)
  els.mobilePlayBtn.addEventListener('click', togglePlay)
  els.homeNowAction.addEventListener('click', togglePlay)
  els.prevBtn.addEventListener('click', () => advance(-1))
  els.mobilePrevBtn.addEventListener('click', () => advance(-1))
  els.nextBtn.addEventListener('click', () => advance(1))
  els.mobileNextBtn.addEventListener('click', () => advance(1))
  function toggleShuffle () {
    state.shuffle = state.shuffle === 'on' ? 'off' : 'on'
    renderModes()
  }
  function toggleLoop () {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'single' : 'off'
    renderModes()
  }
  els.shuffleBtn.addEventListener('click', toggleShuffle)
  els.mobileShuffleBtn.addEventListener('click', toggleShuffle)
  els.loopBtn.addEventListener('click', toggleLoop)
  els.mobileLoopBtn.addEventListener('click', toggleLoop)

  function renderModes () {
    els.shuffleBtn.dataset.mode = state.shuffle
    els.mobileShuffleBtn.dataset.mode = state.shuffle
    els.loopBtn.dataset.mode = state.repeat
    els.mobileLoopBtn.dataset.mode = state.repeat
    els.repeatBadge.textContent = state.repeat === 'single' ? '1' : ''
    els.mobileRepeatBadge.textContent = state.repeat === 'single' ? '1' : ''
    els.shuffleBtn.title = state.shuffle === 'on' ? '关闭随机播放' : '随机播放'
    els.loopBtn.title = state.repeat === 'off' ? '开启列表循环' : state.repeat === 'all' ? '切换单曲循环' : '关闭循环'
    writeJson(STORAGE.modes, { shuffle: state.shuffle, loop: state.repeat })
  }

  function syncCurrentRows () {
    const key = trackKey(state.currentTrack)
    $$('.track-row').forEach((row) => row.classList.toggle('playing', !!key && row.dataset.trackKey === key))
  }

  function renderQueue () {
    els.queueCurrent.innerHTML = ''
    els.queueList.innerHTML = ''
    if (!state.currentTrack) {
      els.queueNow.hidden = true
      const empty = document.createElement('div')
      empty.className = 'queue-empty'
      empty.textContent = '播放搜索结果或歌单后，接下来要播放的歌曲会显示在这里。'
      els.queueList.appendChild(empty)
      return
    }
    els.queueNow.hidden = false
    const current = document.createElement('div')
    current.className = 'queue-current-card'
    current.appendChild(createCover(state.currentTrack, 'row-cover', true))
    current.appendChild(createTrackCopy(state.currentTrack))
    els.queueCurrent.appendChild(current)

    const upcoming = state.queue.map((track, index) => ({ track, index })).filter((entry) => entry.index !== state.queueIndex)
    if (!upcoming.length) {
      const empty = document.createElement('div')
      empty.className = 'queue-empty'
      empty.textContent = '队列里没有其他歌曲。'
      els.queueList.appendChild(empty)
      return
    }
    upcoming.forEach(({ track, index }, order) => {
      const row = document.createElement('div')
      row.className = 'queue-row'
      row.style.setProperty('--item-index', String(Math.min(order, 10)))
      row.appendChild(createCover(track, 'row-cover'))
      row.appendChild(createTrackCopy(track))
      row.addEventListener('click', () => playQueueIndex(index))
      els.queueList.appendChild(row)
    })
  }

  function createTrackCopy (track) {
    const copy = document.createElement('div')
    copy.className = 'track-copy'
    const title = document.createElement('span')
    title.className = 'track-title'
    title.textContent = track.title
    const author = document.createElement('span')
    author.className = 'track-author'
    author.textContent = track.author
    copy.append(title, author)
    return copy
  }

  els.clearQueue.addEventListener('click', () => {
    if (state.currentTrack) {
      state.queue = [state.currentTrack]
      state.queueIndex = 0
    } else {
      state.queue = []
      state.queueIndex = -1
    }
    renderQueue()
    updateTransportEnabled()
    toast('播放队列已清理')
  })

  /* ---------- Side panel ---------- */

  function usesMobilePlayer () {
    return window.matchMedia('(max-width: 780px), (max-width: 920px) and (max-height: 520px)').matches
  }

  function openPanel (name, forceOpen = false) {
    const shouldClose = !forceOpen && state.openPanel === name && !els.contextPanel.hidden
    state.openPanel = shouldClose ? null : name
    els.contextPanel.hidden = !state.openPanel
    els.app.classList.toggle('panel-open', !!state.openPanel)
    document.body.classList.toggle('now-playing-open', !!state.openPanel && usesMobilePlayer())
    els.playerTrack.setAttribute('aria-expanded', String(!!state.openPanel))
    $$('.panel-trigger').forEach((button) => button.classList.toggle('active', button.dataset.panel === state.openPanel))
    if (state.openPanel) setPanelPage(state.openPanel)
  }

  function setPanelPage (name) {
    state.openPanel = name
    $$('[data-panel-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.panelTab === name))
    $$('[data-panel-page]').forEach((page) => {
      const active = page.dataset.panelPage === name
      page.hidden = !active
      page.classList.toggle('active', active)
    })
    if (name === 'lyrics') requestAnimationFrame(positionLyrics)
  }

  $$('.panel-trigger').forEach((button) => button.addEventListener('click', () => openPanel(button.dataset.panel)))
  $$('[data-panel-tab]').forEach((button) => button.addEventListener('click', () => setPanelPage(button.dataset.panelTab)))
  els.closePanel.addEventListener('click', () => openPanel(state.openPanel))
  els.playerTrack.addEventListener('click', (event) => {
    if (event.target.closest('button')) return
    openPanel(state.openPanel || 'lyrics', true)
  })
  els.playerTrack.addEventListener('keydown', (event) => {
    if (event.target !== els.playerTrack || !['Enter', ' '].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    openPanel(state.openPanel || 'lyrics', true)
  })

  /* ---------- Audio events and progress ---------- */

  els.audio.addEventListener('play', () => {
    els.player.classList.add('is-playing')
    els.contextPanel.classList.add('is-playing')
    els.homeNowCard.classList.add('is-playing')
    setLoading(state.loadingAudio)
    updatePlayIcon()
    setMediaPlaybackState('playing')
  })
  els.audio.addEventListener('pause', () => {
    els.player.classList.remove('is-playing')
    els.contextPanel.classList.remove('is-playing')
    els.homeNowCard.classList.remove('is-playing')
    updatePlayIcon()
    setMediaPlaybackState('paused')
  })
  els.audio.addEventListener('loadstart', () => setLoading(true))
  els.audio.addEventListener('waiting', () => setLoading(true))
  els.audio.addEventListener('canplay', () => setLoading(false))
  els.audio.addEventListener('playing', () => { setLoading(false); state.consecutiveErrors = 0 })
  els.audio.addEventListener('ended', () => {
    if (state.repeat === 'single') { els.audio.currentTime = 0; els.audio.play().catch(() => {}); return }
    const index = nextIndex(1)
    if (index >= 0) playQueueIndex(index)
  })
  els.audio.addEventListener('error', () => {
    els.player.classList.remove('is-playing')
    setLoading(false)
    setMediaPlaybackState('none')
    if (!els.audio.src) return
    state.consecutiveErrors += 1
    if (state.repeat === 'single') {
      toast('当前歌曲加载失败，请选择其他歌曲', 'error')
      return
    }
    if (state.consecutiveErrors >= 3) {
      state.consecutiveErrors = 0
      toast('连续多首歌曲不可播放，请稍后重试', 'error')
      return
    }
    toast('当前歌曲不可播放，正在跳到下一首', 'error')
    clearTimeout(pendingSkipTimer)
    pendingSkipTimer = setTimeout(() => advance(1), 850)
  })

  function updateProgress () {
    const current = els.audio.currentTime || 0
    const duration = els.audio.duration || 0
    els.currTime.textContent = formatTime(current)
    els.duration.textContent = formatTime(duration)
    els.mobileCurrTime.textContent = formatTime(current)
    els.mobileDuration.textContent = formatTime(duration)
    const percent = duration > 0 ? Math.min(100, (current / duration) * 100) : 0
    ;[els.progressBar, els.mobileProgressBar].forEach((bar) => {
      bar.setAttribute('aria-valuenow', String(Math.round(percent)))
      bar.setAttribute('aria-valuetext', formatTime(current) + ' / ' + formatTime(duration))
    })
    els.homeNowProgress.style.width = percent + '%'
    if (!progressDragging) {
      setProgressVisual(percent)
    }
  }

  function setProgressVisual (percent) {
    ;[els.progressFill, els.mobileProgressFill].forEach((fill) => { fill.style.width = percent + '%' })
    ;[els.progressThumb, els.mobileProgressThumb].forEach((thumb) => { thumb.style.left = percent + '%' })
  }

  function updateBuffered () {
    const duration = els.audio.duration || 0
    if (duration <= 0 || !els.audio.buffered.length) {
      ;[els.progressBuffered, els.mobileProgressBuffered].forEach((buffered) => { buffered.style.width = '0%' })
      return
    }
    const end = els.audio.buffered.end(els.audio.buffered.length - 1)
    const width = Math.min(100, (end / duration) * 100) + '%'
    ;[els.progressBuffered, els.mobileProgressBuffered].forEach((buffered) => { buffered.style.width = width })
  }

  function percentFromPointer (event, bar) {
    const rect = bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  }

  function seekPercent (percent) {
    const duration = els.audio.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    els.audio.currentTime = duration * percent
    setProgressVisual(percent * 100)
    els.homeNowProgress.style.width = (percent * 100) + '%'
    els.currTime.textContent = formatTime(duration * percent)
    els.mobileCurrTime.textContent = formatTime(duration * percent)
  }

  function bindProgressBar (bar) {
    bar.addEventListener('pointerdown', (event) => {
      if (!state.currentTrack) return
      progressDragging = true
      bar.classList.add('dragging')
      bar.setPointerCapture(event.pointerId)
      seekPercent(percentFromPointer(event, bar))
    })
    bar.addEventListener('pointermove', (event) => { if (progressDragging) seekPercent(percentFromPointer(event, bar)) })
    bar.addEventListener('pointerup', (event) => {
      progressDragging = false
      bar.classList.remove('dragging')
      try { bar.releasePointerCapture(event.pointerId) } catch {}
    })
    bar.addEventListener('pointercancel', () => { progressDragging = false; bar.classList.remove('dragging') })
    bar.addEventListener('keydown', (event) => {
      const duration = els.audio.duration
      if (!Number.isFinite(duration) || duration <= 0) return
      let target = null
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = Math.max(0, els.audio.currentTime - 5)
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = Math.min(duration, els.audio.currentTime + 5)
      if (event.key === 'Home') target = 0
      if (event.key === 'End') target = duration
      if (target == null) return
      event.preventDefault()
      event.stopPropagation()
      seekPercent(target / duration)
      updateProgress()
    })
  }

  bindProgressBar(els.progressBar)
  bindProgressBar(els.mobileProgressBar)

  els.audio.addEventListener('timeupdate', () => {
    updateProgress()
    setActiveLyrics()
  })
  els.audio.addEventListener('durationchange', () => { updateProgress(); updateMediaPosition() })
  els.audio.addEventListener('progress', updateBuffered)
  els.player.addEventListener('animationend', (event) => {
    if (event.animationName === 'cover-swap') els.player.classList.remove('track-changed')
  })

  const savedVolume = Number.parseFloat(readStorage(STORAGE.volume, '0.8'))
  els.volume.value = String(Number.isFinite(savedVolume) ? Math.min(1, Math.max(0, savedVolume)) : 0.8)
  els.audio.volume = Number(els.volume.value)
  els.volume.addEventListener('input', () => {
    els.audio.volume = Number(els.volume.value)
    try { localStorage.setItem(STORAGE.volume, els.volume.value) } catch {}
  })
  els.quality.value = state.quality
  els.quality.addEventListener('change', () => {
    state.quality = els.quality.value
    try { localStorage.setItem(STORAGE.quality, state.quality) } catch {}
    if (!state.currentTrack?.url) {
      toast('播放音质已切换为' + els.quality.selectedOptions[0].textContent)
      return
    }
    const resumeAt = Number.isFinite(els.audio.currentTime) ? els.audio.currentTime : 0
    const shouldResume = !els.audio.paused
    els.audio.src = streamUrl(state.currentTrack.url)
    els.audio.addEventListener('loadedmetadata', () => {
      if (resumeAt > 0 && Number.isFinite(els.audio.duration)) {
        els.audio.currentTime = Math.min(resumeAt, Math.max(0, els.audio.duration - 0.25))
      }
      if (shouldResume) els.audio.play().catch(() => {})
    }, { once: true })
    toast('正在切换到' + els.quality.selectedOptions[0].textContent)
  })

  /* ---------- Media Session ---------- */

  function updateMediaSession (track) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
    const metadata = { title: track.title, artist: track.author, album: track.album || state.queueLabel || 'RMusic' }
    if (track.pic) {
      const artwork = new URL(track.pic, location.href).href
      metadata.artwork = [{ src: artwork, sizes: '300x300', type: 'image/jpeg' }, { src: artwork, sizes: '512x512', type: 'image/jpeg' }]
    }
    try { navigator.mediaSession.metadata = new MediaMetadata(metadata) } catch {}
    updateMediaPosition()
  }

  function setMediaPlaybackState (value) {
    if (!('mediaSession' in navigator)) return
    try { navigator.mediaSession.playbackState = value } catch {}
  }

  function updateMediaPosition () {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return
    const duration = els.audio.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    try {
      navigator.mediaSession.setPositionState({ duration, playbackRate: els.audio.playbackRate || 1, position: Math.min(duration, Math.max(0, els.audio.currentTime || 0)) })
    } catch {}
  }

  function setupMediaSession () {
    if (!('mediaSession' in navigator)) return
    const set = (name, handler) => { try { navigator.mediaSession.setActionHandler(name, handler) } catch {} }
    set('play', () => { if (requireAccount('播放音乐')) els.audio.play().catch(() => {}) })
    set('pause', () => els.audio.pause())
    set('previoustrack', () => advance(-1))
    set('nexttrack', () => advance(1))
    set('seekto', (detail) => {
      if (typeof detail.seekTime !== 'number') return
      if (detail.fastSeek && typeof els.audio.fastSeek === 'function') els.audio.fastSeek(detail.seekTime)
      else els.audio.currentTime = detail.seekTime
    })
    set('seekbackward', (detail) => { els.audio.currentTime = Math.max(0, els.audio.currentTime - (detail.seekOffset || 10)) })
    set('seekforward', (detail) => { els.audio.currentTime = Math.min(els.audio.duration || Infinity, els.audio.currentTime + (detail.seekOffset || 10)) })
  }

  /* ---------- Lyrics ---------- */

  async function loadLyrics (track) {
    const requestId = ++lyricsRequestId
    lrcData = []
    lastLrcIndex = -1
    els.lrcList.innerHTML = '<li class="lyrics-placeholder">正在寻找歌词…</li>'
    const urls = [track.lrcpword, track.lrc].filter(Boolean)
    for (const url of urls) {
      try {
        const response = await proxyFetch(url)
        if (!response.ok) continue
        const data = parseLrc(await response.text())
        if (requestId !== lyricsRequestId) return
        if (data.length) {
          lrcData = data
          renderLyrics()
          return
        }
      } catch {}
    }
    if (requestId !== lyricsRequestId) return
    els.lrcList.innerHTML = '<li class="lyrics-placeholder">这首歌暂时没有歌词。<br>音乐仍会继续播放。</li>'
  }

  function lrcStampToSeconds (minutes, seconds, fraction) {
    const fractionSeconds = fraction ? Number.parseInt(fraction, 10) / Math.pow(10, fraction.length) : 0
    return Number.parseInt(minutes, 10) * 60 + Number.parseInt(seconds, 10) + fractionSeconds
  }

  function parseLrc (source) {
    if (!source) return []
    const lines = []
    source.split(/\r?\n/).forEach((rawLine) => {
      const headPattern = /\[(\d+):(\d+)(?:\.(\d+))?\]/g
      const heads = []
      let match
      let bodyStart = 0
      while ((match = headPattern.exec(rawLine)) !== null && match.index === bodyStart) {
        heads.push(lrcStampToSeconds(match[1], match[2], match[3]))
        bodyStart = headPattern.lastIndex
      }
      if (!heads.length) return
      const body = rawLine.slice(bodyStart)
      const wordPattern = /<(\d+):(\d+)(?:\.(\d+))?>([^<]*)/g
      const words = []
      let wordMatch
      while ((wordMatch = wordPattern.exec(body)) !== null) {
        if (wordMatch[4] !== '') words.push({ time: lrcStampToSeconds(wordMatch[1], wordMatch[2], wordMatch[3]), text: wordMatch[4] })
      }
      heads.forEach((time) => {
        const finalWords = words.length ? words.slice() : [{ time, text: body.replace(wordPattern, '').trim() }]
        lines.push({ time, words: finalWords, wordLevel: finalWords.length > 1 })
      })
    })
    lines.sort((a, b) => a.time - b.time)
    const groups = []
    lines.forEach((line) => {
      const last = groups[groups.length - 1]
      if (last && Math.abs(last.time - line.time) <= 0.05) last.subs.push(line)
      else groups.push({ time: line.time, subs: [line] })
    })
    return groups
  }

  function primarySub (group) {
    return group.subs.find((sub) => sub.wordLevel) || group.subs[0]
  }

  function renderLyrics () {
    els.lrcList.innerHTML = ''
    const fragment = document.createDocumentFragment()
    lrcData.forEach((group) => {
      const row = document.createElement('li')
      row.dataset.time = String(group.time)
      const primary = primarySub(group)
      group.subs.forEach((sub) => {
        const line = document.createElement('div')
        line.className = 'lrc-sub' + (sub === primary ? '' : ' lrc-sub-secondary')
        const words = sub.words.length ? sub.words : [{ time: sub.time, text: '♪' }]
        words.forEach((word) => {
          const span = document.createElement('span')
          span.className = 'word'
          span.dataset.time = String(word.time)
          span.textContent = word.text || '♪'
          line.appendChild(span)
        })
        row.appendChild(line)
      })
      row.addEventListener('click', () => {
        els.audio.currentTime = group.time
        if (els.audio.paused) els.audio.play().catch(() => {})
      })
      fragment.appendChild(row)
    })
    els.lrcList.appendChild(fragment)
    requestAnimationFrame(positionLyrics)
  }

  function findLrcIndex () {
    const current = els.audio.currentTime || 0
    if (lastLrcIndex >= 0 && lastLrcIndex < lrcData.length) {
      let index = lastLrcIndex
      while (index + 1 < lrcData.length && current >= lrcData[index + 1].time) index += 1
      while (index >= 0 && current < lrcData[index].time) index -= 1
      return index
    }
    let low = 0
    let high = lrcData.length - 1
    let match = -1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (lrcData[middle].time <= current) {
        match = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return match
  }

  function setActiveLyrics () {
    if (!lrcData.length) return
    const index = findLrcIndex()
    if (index < 0) return
    if (index !== lastLrcIndex) {
      const old = els.lrcList.children[lastLrcIndex]
      if (old) old.classList.remove('active')
      const active = els.lrcList.children[index]
      if (active) active.classList.add('active')
      lastLrcIndex = index
      positionLyrics()
    }
    const group = lrcData[index]
    const row = els.lrcList.children[index]
    const primary = primarySub(group)
    if (!row || !primary || primary.words.length < 2) return
    const line = row.children[group.subs.indexOf(primary)]
    if (!line) return
    const current = (els.audio.currentTime || 0) + 0.18
    let wordIndex = -1
    primary.words.forEach((word, indexValue) => { if (word.time <= current) wordIndex = indexValue })
    Array.from(line.children).forEach((span, indexValue) => {
      span.classList.toggle('word-passed', indexValue < wordIndex)
      span.classList.toggle('word-current', indexValue === wordIndex)
    })
  }

  function positionLyrics () {
    if (lastLrcIndex < 0 || els.contextPanel.hidden || state.openPanel !== 'lyrics') return
    const row = els.lrcList.children[lastLrcIndex]
    if (!row || !els.lrcWrap.clientHeight) return
    const offset = els.lrcWrap.clientHeight / 2 - row.offsetTop - row.offsetHeight / 2
    els.lrcList.style.transform = 'translateY(' + offset + 'px)'
  }

  els.lrcWrap.addEventListener('wheel', (event) => {
    if (!lrcData.length) return
    event.preventDefault()
    const direction = event.deltaY > 0 ? 1 : -1
    const index = Math.max(0, Math.min(lrcData.length - 1, findLrcIndex() + direction))
    els.audio.currentTime = lrcData[index].time
    if (els.audio.paused) els.audio.play().catch(() => {})
  }, { passive: false })

  /* ---------- Keyboard ---------- */

  document.addEventListener('keydown', (event) => {
    const editing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName)
    if (event.key === 'Escape') {
      if (!els.accountModal.hidden) closeAccountModal()
      else if (!els.playlistModal.hidden) closePlaylistModal()
      else if (state.openPanel) openPanel(state.openPanel)
      return
    }
    if (editing) return
    if (event.key === '/') {
      event.preventDefault()
      els.query.focus()
    } else if (event.code === 'Space') {
      event.preventDefault()
      togglePlay()
    } else if (event.key === 'ArrowRight') {
      els.audio.currentTime = Math.min(els.audio.duration || Infinity, els.audio.currentTime + 5)
    } else if (event.key === 'ArrowLeft') {
      els.audio.currentTime = Math.max(0, els.audio.currentTime - 5)
    }
  })

  /* ---------- Boot ---------- */

  async function boot () {
    const modes = readJson(STORAGE.modes, {})
    if (modes.shuffle === 'on') state.shuffle = 'on'
    if (['off', 'all', 'single'].includes(modes.loop)) state.repeat = modes.loop

    setGreeting()
    renderModes()
    renderQueue()
    updateTransportEnabled()
    updatePlayIcon()
    setupMediaSession()
    els.lrcList.innerHTML = '<li class="lyrics-placeholder">播放歌曲后，这里会显示同步歌词。</li>'

    try {
      await ensureProxySession()
    } catch (error) {
      toast('安全会话建立失败：' + error.message, 'error')
    }
    renderHome()
    renderLibrary()
    await refreshAccount(false).catch(() => {
      state.account.available = false
      renderAccount()
    })

    const url = new URL(location.href)
    const type = url.searchParams.get('type')
    const id = url.searchParams.get('id')
    const requestedServer = url.searchParams.get('server')
    const server = requestedServer || 'aggregate'
    if (url.searchParams.get('q') && requestedServer && SEARCH_PLATFORM_IDS.includes(requestedServer)) {
      state.searchServer = requestedServer
      try { localStorage.setItem(STORAGE.searchServer, requestedServer) } catch {}
    }
    syncSearchSourcePicker()
    updateSearchPrompt()
    loadDiscovery().catch(() => {})
    if (type === 'playlist' && id) {
      const playlist = { server, id, name: url.searchParams.get('name') || ('歌单 ' + id) }
      loadPlaylist(playlist).catch((error) => toast(error.message, 'error'))
    } else if (url.searchParams.get('q')) {
      runSearch(url.searchParams.get('q'))
    } else {
      showView('home')
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      ensureProxySession().catch(() => {})
      refreshAccount(false)
        .then(() => { if (state.account.authenticated) return loadAccountLibrary(false) })
        .catch(() => {})
    }
  })

  boot().catch((error) => toast(error.message, 'error'))
})()
