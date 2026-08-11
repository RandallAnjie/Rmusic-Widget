/* RMusic full-page player.
 *
 * The browser only calls the same-origin /api/proxy surface. The
 * worker injects MUSIC_API_TOKEN server-side and rewrites every
 * resource URL, so playlists, covers, audio and lyrics never expose
 * the Meting master token to the page.
 */

(function () {
  'use strict'

  const $ = (id) => document.getElementById(id)
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector))
  const API = '/api/proxy'

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
    recentGrid: $('recent-grid'),
    favoritePreview: $('favorite-preview'),
    favoritePreviewSection: $('favorite-preview-section'),
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
    collectionLoading: $('collection-loading'),
    collectionTracks: $('collection-tracks'),
    playCollection: $('playCollection'),
    saveCollection: $('saveCollection'),
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
    playlistName: $('playlist-name'),
    playlistSave: $('playlist-save'),
    playlistFormError: $('playlist-form-error'),
    loadPlaylistButton: $('loadPlaylistButton')
  }

  const STORAGE = {
    favorites: 'rmusic_favorites_v2',
    recent: 'rmusic_recent_v2',
    playlists: 'rmusic_playlists_v2',
    modes: 'rmusic_playback_mode',
    volume: 'rmusic_volume_v2'
  }

  const state = {
    view: 'home',
    searchResults: [],
    collection: null,
    queue: [],
    queueIndex: -1,
    queueLabel: '',
    currentTrack: null,
    favorites: normalizeList(readJson(STORAGE.favorites, [])),
    recent: normalizeList(readJson(STORAGE.recent, [])),
    playlists: readJson(STORAGE.playlists, []),
    shuffle: 'off',
    repeat: 'off',
    openPanel: null,
    loadingAudio: false,
    consecutiveErrors: 0
  }

  let toastTimer = 0
  let pendingSkipTimer = 0
  let progressDragging = false
  let lrcData = []
  let lastLrcIndex = -1
  let searchRequestId = 0
  let collectionRequestId = 0
  let lyricsRequestId = 0

  function readJson (key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null')
      return parsed == null ? fallback : parsed
    } catch {
      return fallback
    }
  }

  function writeJson (key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
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

  function audioUrlWithHints (value, track) {
    if (!value || track.server !== 'tencent') return value
    try {
      const parsed = new URL(value, location.href)
      if (parsed.origin !== location.origin || parsed.pathname !== API) return value
      if (!parsed.searchParams.get('title') && track.title) parsed.searchParams.set('title', track.title.slice(0, 160))
      if (!parsed.searchParams.get('author') && track.author) parsed.searchParams.set('author', track.author.slice(0, 160))
      return parsed.pathname + '?' + parsed.searchParams.toString()
    } catch {
      return value
    }
  }

  function normalizeTrack (track, server) {
    const out = { ...track }
    out.server = track.server || server || 'netease'
    out.title = text(track.title, '未知歌曲')
    out.author = text(track.author, '未知艺人')
    out.album = text(track.album, '')
    out.url = audioUrlWithHints(text(track.url, ''), out)
    out.pic = text(track.pic, '')
    out.lrc = text(track.lrc, '')
    out.lrcpword = text(track.lrcpword, '')
    if (typeof track.duration_ms !== 'number') out.duration_ms = null
    return out
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
    return parsed?.message || body.slice(0, 180) || ('请求失败 (' + status + ')')
  }

  async function fetchTracks (type, id, server = 'aggregate') {
    const params = new URLSearchParams({ server, type, id: String(id) })
    const response = await fetch(API + '?' + params, { headers: { accept: 'application/json' } })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(apiErrorMessage(response.status, body))
    }
    return normalizeList(await response.json(), server)
  }

  /* ---------- Navigation ---------- */

  function showView (name) {
    const target = name === 'collection' ? 'collection' : ['home', 'search', 'library'].includes(name) ? name : 'home'
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
    if (target === 'search') setTimeout(() => els.query.focus(), 80)
  }

  $$('[data-nav]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.nav)))

  function setGreeting () {
    const hour = new Date().getHours()
    els.greeting.textContent = hour < 6 ? '夜深了，听点轻的' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  }

  /* ---------- Search ---------- */

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
    els.searchSummary.textContent = '正在聚合多个音乐平台，并按关键词相关度排序。'
    els.searchEmpty.hidden = true
    els.searchResultsWrap.hidden = true
    els.searchLoading.hidden = false
    const requestId = ++searchRequestId
    try {
      const results = await fetchTracks('search', query)
      if (requestId !== searchRequestId) return
      state.searchResults = results
      renderTrackRows(els.searchResults, state.searchResults, '搜索：' + query)
      els.searchCount.textContent = state.searchResults.length + ' 首歌曲'
      els.searchSummary.textContent = state.searchResults.length
        ? '聚合搜索 · 已按相关度排序 · 点击任意歌曲开始连续播放'
        : '没有找到结果，试试更短或更具体的关键词。'
      els.searchResultsWrap.hidden = state.searchResults.length === 0
      els.searchEmpty.hidden = state.searchResults.length !== 0
      if (state.searchResults.length === 0) {
        els.searchEmpty.querySelector('h2').textContent = '没有找到匹配歌曲'
        els.searchEmpty.querySelector('p').textContent = '换个关键词，或者同时输入歌曲名和歌手名。'
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
    const author = document.createElement('span')
    author.className = 'track-author'
    author.textContent = track.author
    copy.append(title, author)
    main.appendChild(copy)
    main.addEventListener('dblclick', () => playFromList(list, index, contextLabel))

    const album = document.createElement('span')
    album.className = 'track-album'
    album.textContent = [track.album, sourceName(track.server)].filter(Boolean).join(' · ') || 'RMusic'

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

  function renderCards (container, tracks) {
    container.innerHTML = ''
    if (!tracks.length) {
      const empty = document.createElement('div')
      empty.className = 'library-empty'
      empty.textContent = '播放一些歌曲后，这里会自动出现。'
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
      button.addEventListener('click', (event) => { event.stopPropagation(); playFromList(tracks, index, '最近播放') })
      cover.appendChild(button)
      const title = document.createElement('strong')
      title.textContent = track.title
      const author = document.createElement('span')
      author.textContent = track.author
      card.append(cover, title, author)
      card.addEventListener('click', () => playFromList(tracks, index, '最近播放'))
      card.addEventListener('keydown', (event) => { if (event.key === 'Enter') playFromList(tracks, index, '最近播放') })
      container.appendChild(card)
    })
  }

  /* ---------- Favorites, recent and library ---------- */

  function isFavorite (track) {
    const key = trackKey(track)
    return state.favorites.some((item) => trackKey(item) === key)
  }

  function toggleFavorite (track) {
    const key = trackKey(track)
    const index = state.favorites.findIndex((item) => trackKey(item) === key)
    if (index >= 0) {
      state.favorites.splice(index, 1)
      toast('已从喜欢的歌曲中移除')
    } else {
      state.favorites.unshift(normalizeTrack(track, track.server))
      state.favorites = state.favorites.slice(0, 200)
      toast('已添加到喜欢的歌曲')
    }
    writeJson(STORAGE.favorites, state.favorites)
    renderHome()
    renderLibrary()
    syncFavoriteButtons()
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
    writeJson(STORAGE.recent, state.recent)
    renderHome()
  }

  function renderHome () {
    renderCards(els.recentGrid, state.recent)
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
  els.clearRecent.addEventListener('click', () => {
    state.recent = []
    writeJson(STORAGE.recent, state.recent)
    renderHome()
    renderLibrary()
    toast('最近播放已清空')
  })

  /* ---------- Playlists ---------- */

  function playlistKey (playlist) { return playlist.server + ':' + playlist.id }

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
      name: els.playlistName.value.trim() || '歌单 ' + parsed.id
    }
    if (!playlist.id) return
    els.loadPlaylistButton.disabled = true
    els.loadPlaylistButton.textContent = '载入中…'
    els.playlistFormError.hidden = true
    try {
      const shouldSave = els.playlistSave.checked
      closePlaylistModal()
      const loaded = await loadPlaylist(playlist)
      if (loaded && shouldSave) {
        savePlaylistDefinition(loaded)
        renderLibrary()
        syncCollectionSaveButton()
        toast('歌单已保存到音乐库')
      }
      els.playlistForm.reset()
      els.playlistSave.checked = true
    } catch (error) {
      els.playlistModal.hidden = false
      els.playlistFormError.textContent = error.message
      els.playlistFormError.hidden = false
    } finally {
      els.loadPlaylistButton.disabled = false
      els.loadPlaylistButton.textContent = '载入歌单'
    }
  })

  function savePlaylistDefinition (playlist) {
    const value = { server: playlist.server, id: String(playlist.id), name: playlist.name || ('歌单 ' + playlist.id), savedAt: Date.now() }
    state.playlists = [value, ...state.playlists.filter((item) => playlistKey(item) !== playlistKey(value))].slice(0, 60)
    writeJson(STORAGE.playlists, state.playlists)
    renderSavedPlaylists()
  }

  function removePlaylistDefinition (playlist) {
    state.playlists = state.playlists.filter((item) => playlistKey(item) !== playlistKey(playlist))
    writeJson(STORAGE.playlists, state.playlists)
    renderSavedPlaylists()
    renderLibrary()
    syncCollectionSaveButton()
    toast('歌单已从音乐库移除')
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
      side.title = playlist.name + ' · ' + playlist.server
      side.addEventListener('click', () => loadPlaylist(playlist).catch((error) => toast(error.message, 'error')))
      els.sidebarPlaylists.appendChild(side)

      const card = document.createElement('article')
      card.className = 'playlist-card'
      card.tabIndex = 0
      card.style.setProperty('--item-index', String(Math.min(playlistIndex, 10)))
      const art = document.createElement('div')
      art.className = 'playlist-art'
      art.textContent = initials(playlist.name)
      const copy = document.createElement('div')
      copy.className = 'playlist-copy'
      const name = document.createElement('strong')
      name.textContent = playlist.name
      const meta = document.createElement('span')
      meta.textContent = sourceName(playlist.server) + ' · 在线歌单'
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
    const labels = { aggregate: '聚合', netease: '网易云', tencent: 'QQ 音乐', ytmusic: 'YouTube Music', kugou: '酷狗', kuwo: '酷我', baidu: '百度', spotify: 'Spotify', apple: 'Apple Music' }
    return labels[server] || server
  }

  async function loadPlaylist (playlist) {
    const requestId = ++collectionRequestId
    const collection = { ...playlist, tracks: [] }
    state.collection = collection
    showView('collection')
    renderCollectionHeader()
    els.collectionLoading.hidden = false
    els.collectionTracks.innerHTML = ''
    try {
      const tracks = await fetchTracks('playlist', playlist.id, playlist.server)
      if (requestId !== collectionRequestId) return false
      collection.tracks = tracks
      if (collection.server === 'aggregate' && tracks[0]?.server) collection.server = tracks[0].server
      renderCollectionHeader()
      renderTrackRows(els.collectionTracks, tracks, playlist.name)
      if (!tracks.length) toast('歌单没有返回曲目', 'error')
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
    els.collectionKind.textContent = sourceName(collection.server) + ' 歌单'
    els.collectionTitle.textContent = collection.name || ('歌单 ' + collection.id)
    els.collectionDescription.textContent = '来自 ' + sourceName(collection.server) + ' · 在线获取最新曲目'
    els.collectionCount.textContent = collection.tracks.length ? collection.tracks.length + ' 首歌曲' : '正在载入曲目'
    els.collectionCover.innerHTML = ''
    if (collection.tracks[0]?.pic) {
      const image = document.createElement('img')
      image.decoding = 'async'
      image.src = collection.tracks[0].pic
      image.alt = ''
      image.addEventListener('error', () => { image.remove(); els.collectionCover.textContent = initials(collection.name) })
      els.collectionCover.appendChild(image)
    } else {
      els.collectionCover.textContent = initials(collection.name)
    }
    syncCollectionSaveButton()
  }

  function syncCollectionSaveButton () {
    const collection = state.collection
    const saved = !!collection && state.playlists.some((item) => playlistKey(item) === playlistKey(collection))
    els.saveCollection.classList.toggle('saved', saved)
    els.saveCollection.title = saved ? '从音乐库移除' : '保存到音乐库'
  }

  els.playCollection.addEventListener('click', () => {
    if (state.collection?.tracks.length) playFromList(state.collection.tracks, 0, state.collection.name)
  })
  els.saveCollection.addEventListener('click', () => {
    if (!state.collection) return
    const saved = state.playlists.some((item) => playlistKey(item) === playlistKey(state.collection))
    if (saved) removePlaylistDefinition(state.collection)
    else {
      savePlaylistDefinition(state.collection)
      renderLibrary()
      syncCollectionSaveButton()
      toast('歌单已保存到音乐库')
    }
  })

  /* ---------- Queue and playback ---------- */

  function playFromList (tracks, index, label) {
    if (!tracks.length || !tracks[index]) return
    state.queue = tracks.slice()
    state.queueIndex = index
    state.queueLabel = label || '播放队列'
    playQueueIndex(index)
  }

  function playQueueIndex (index) {
    const track = state.queue[index]
    if (!track) return
    track.url = audioUrlWithHints(track.url, track)
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
    els.audio.src = track.url
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
    const hasQueue = state.queue.length > 0
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
      if (state.queue.length) playQueueIndex(Math.max(0, state.queueIndex))
      else showView('search')
      return
    }
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
    set('play', () => els.audio.play().catch(() => {}))
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
        const response = await fetch(url)
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
      if (!els.playlistModal.hidden) closePlaylistModal()
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

  function boot () {
    const modes = readJson(STORAGE.modes, {})
    if (modes.shuffle === 'on') state.shuffle = 'on'
    if (['off', 'all', 'single'].includes(modes.loop)) state.repeat = modes.loop

    setGreeting()
    renderModes()
    renderHome()
    renderLibrary()
    renderQueue()
    updateTransportEnabled()
    updatePlayIcon()
    setupMediaSession()
    els.lrcList.innerHTML = '<li class="lyrics-placeholder">播放歌曲后，这里会显示同步歌词。</li>'

    const url = new URL(location.href)
    const type = url.searchParams.get('type')
    const id = url.searchParams.get('id')
    const server = url.searchParams.get('server') || 'aggregate'
    if (type === 'playlist' && id) {
      const playlist = { server, id, name: url.searchParams.get('name') || ('歌单 ' + id) }
      loadPlaylist(playlist).catch((error) => toast(error.message, 'error'))
    } else if (url.searchParams.get('q')) {
      runSearch(url.searchParams.get('q'))
    } else {
      showView('home')
    }
  }

  boot()
})()
