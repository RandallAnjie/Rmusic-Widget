/* RMusic widget — client-side controller.
 *
 * Layout in this revision:
 *   - top-right ⌕ button toggles the search panel
 *   - LRC fills the middle, scrolls with playback, and is also a
 *     seek surface (click a line / drag vertically)
 *   - bottom-center control bar carries the transport buttons,
 *     progress bar, shuffle and loop toggles, and the now-playing
 *     meta
 *
 * No more spinning disc, no more sub-section in the search panel
 * for playback modes — shuffle/loop live with the rest of the
 * transport at the bottom.
 *
 * Network: only same-origin /api/proxy. Worker injects the master
 * token and rate-limits.
 */

(function () {
  'use strict'

  const $ = (id) => document.getElementById(id)

  const els = {
    audio:    $('audio'),
    bg:       $('bg'),
    lrcWrap:  $('lrc-container'),
    lrcList:  $('lrc-list'),
    searchToggle: $('searchToggle'),
    panel:    $('search-panel'),
    server:   $('server'),
    query:    $('query'),
    searchBtn: $('searchBtn'),
    results:  $('results'),
    status:   $('search-status'),
    // bottom bar
    nowTitle: $('now-title'),
    nowAuthor: $('now-author'),
    currTime: $('curr-time'),
    duration: $('duration'),
    progressBar: $('progress-bar'),
    progressFill: $('progress-fill'),
    progressBuffered: $('progress-buffered'),
    progressThumb: $('progress-thumb'),
    playBtn:  $('playBtn'),
    playIcon: $('playIcon'),
    prevBtn:  $('prevBtn'),
    nextBtn:  $('nextBtn'),
    shuffleBtn: $('shuffleBtn'),
    loopBtn:  $('loopBtn')
  }

  const API = '/api/proxy'

  let currentResults = []
  let currentIndex = -1
  let lrcData = []

  /* ---------- Playback modes (shuffle + loop) ----------
   *
   * Same semantics as before; only UI placement changed.
   *   shuffleMode: 'off' | 'on'
   *   loopMode:    'off' | 'all' | 'single'
   */
  const STORAGE_KEY = 'rmusic_playback_mode'
  let shuffleMode = 'off'
  let loopMode = 'off'

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (saved.shuffle === 'on' || saved.shuffle === 'off') shuffleMode = saved.shuffle
    if (saved.loop === 'off' || saved.loop === 'all' || saved.loop === 'single') loopMode = saved.loop
  } catch { /* private mode / quota */ }

  function persistMode () {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ shuffle: shuffleMode, loop: loopMode })) } catch {}
  }

  function renderModes () {
    // Null-guard every children-of-element lookup so a stale HTML
    // shape doesn't crash the whole bootstrap. Iteration on this
    // widget has rotated icon containers (`.mode-icon` → `.ctrl-
    // icon`) at least once; CDN cache vs browser cache races have
    // produced visitors with mismatched HTML / JS pairs that
    // crashed at the first .querySelector(...).textContent.
    if (els.shuffleBtn) {
      els.shuffleBtn.dataset.mode = shuffleMode
      const shuffleIcon = els.shuffleBtn.querySelector('.ctrl-icon')
      if (shuffleIcon) shuffleIcon.textContent = shuffleMode === 'on' ? '⇄' : '→'
    }
    if (els.loopBtn) {
      els.loopBtn.dataset.mode = loopMode
      const icons = { off: '✗', all: '↻', single: '↺' }
      const loopIcon = els.loopBtn.querySelector('.ctrl-icon')
      if (loopIcon) loopIcon.textContent = icons[loopMode] || '✗'
    }
  }

  els.shuffleBtn.addEventListener('click', () => {
    shuffleMode = shuffleMode === 'on' ? 'off' : 'on'
    persistMode(); renderModes()
  })
  els.loopBtn.addEventListener('click', () => {
    const cycle = { off: 'all', all: 'single', single: 'off' }
    loopMode = cycle[loopMode] || 'off'
    persistMode(); renderModes()
  })
  renderModes()

  /* ---------- Search panel toggle ---------- */

  function togglePanel (show) {
    const willShow = typeof show === 'boolean' ? show : els.panel.hasAttribute('hidden')
    if (willShow) {
      els.panel.removeAttribute('hidden')
      els.searchToggle.classList.add('active')
      setTimeout(() => els.query.focus(), 0)
    } else {
      els.panel.setAttribute('hidden', '')
      els.searchToggle.classList.remove('active')
    }
  }
  els.searchToggle.addEventListener('click', () => togglePanel())
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.panel.hasAttribute('hidden')) togglePanel(false)
  })

  /* ---------- Search ---------- */

  function setStatus (text, kind) {
    if (!text) {
      els.status.setAttribute('hidden', '')
      els.status.textContent = ''
      els.status.classList.remove('error')
      return
    }
    els.status.removeAttribute('hidden')
    els.status.textContent = text
    els.status.classList.toggle('error', kind === 'error')
  }

  async function search () {
    const query = els.query.value.trim()
    if (!query) { setStatus('请输入关键词'); return }
    const server = els.server.value || 'netease'
    setStatus('搜索中…')
    els.results.innerHTML = ''
    try {
      const usp = new URLSearchParams({ server, type: 'search', id: query })
      const res = await fetch(API + '?' + usp.toString(), { headers: { accept: 'application/json' } })
      if (res.status === 429) {
        setStatus('搜索太频繁,稍等再试 (' + (res.headers.get('retry-after') || '?') + 's)', 'error')
        return
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        setStatus('上游错误 ' + res.status + (txt ? ': ' + txt.slice(0, 200) : ''), 'error')
        return
      }
      const data = await res.json()
      currentResults = Array.isArray(data) ? data : []
      renderResults(currentResults)
      setStatus(currentResults.length === 0 ? '无结果' : '共 ' + currentResults.length + ' 条')
      updateTransportEnabled()
    } catch (e) {
      setStatus('请求失败: ' + (e && e.message ? e.message : e), 'error')
    }
  }

  function renderResults (list) {
    els.results.innerHTML = ''
    const frag = document.createDocumentFragment()
    list.forEach((t, i) => {
      const li = document.createElement('li')
      li.dataset.index = String(i)
      const t1 = document.createElement('div')
      t1.className = 'row-title'
      t1.textContent = t.title || '(无标题)'
      const t2 = document.createElement('div')
      t2.className = 'row-author'
      t2.textContent = t.author || ''
      li.appendChild(t1)
      li.appendChild(t2)
      li.addEventListener('click', () => playIndex(i))
      frag.appendChild(li)
    })
    els.results.appendChild(frag)
  }

  els.searchBtn.addEventListener('click', search)
  els.query.addEventListener('keydown', (e) => { if (e.key === 'Enter') search() })

  /* ---------- Playback ---------- */

  function playIndex (i) {
    const track = currentResults[i]
    if (!track) return
    // Cancel any auto-skip that was pending from a previous error —
    // if the listener (or a real .ended event) picked a new track,
    // the skip is no longer relevant.
    clearTimeout(pendingSkipTimer)
    currentIndex = i
    Array.from(els.results.children).forEach((li, idx) => {
      li.classList.toggle('playing', idx === i)
    })
    showNowPlaying(track)
    setBackdrop(track.pic)
    setLoading(true)
    // CRITICAL: set audio.src + play() SYNCHRONOUSLY in the same task
    // as the caller (especially the `ended` event handler). iOS Safari
    // suspends a background tab the moment its audio element goes
    // idle, and any awaited promise between `ended` and the new
    // playback start breaks the chain — the next track silently
    // fails to load and the listener sees the player freeze on lock
    // screen. The pre-fix flow did `await loadLrc(...)` first, which
    // pushed the audio.src assignment out by however long the lyric
    // fetch took (~hundreds of ms to several seconds, easily long
    // enough for iOS to declare the tab idle).
    //
    // Order:
    //   1. audio.src / play()   — sync, keeps the media session alive
    //   2. loadLrc(…)           — async, runs in parallel; missing
    //                             lyric is non-fatal anyway
    els.audio.src = track.url
    const playPromise = els.audio.play()
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // Browsers can refuse autoplay (first interaction not yet
        // performed) — the user can hit the play button to unblock.
        setLoading(false)
      })
    }
    updateTransportEnabled()
    // Prefer the word-level URL when the search row exposed one. The
    // server falls back to plain LRC on sources without word timing,
    // so this URL always returns something parseLrc can render.
    loadLrc(track.lrcpword || track.lrc).catch(() => {})
  }

  function showNowPlaying (track) {
    els.nowTitle.textContent = track.title || ''
    els.nowAuthor.textContent = track.author || ''
    updateMediaSession(track)
  }

  /* ---------- OS Media Session ----------
   *
   * Powers the macOS Now Playing widget, Windows media flyout,
   * Android notification, AirPods + bluetooth headset buttons,
   * iOS lock-screen artwork, etc. Without this the OS gets nothing
   * and renders whatever fallback it has (often the page favicon
   * + an unhelpful URL fragment). With this we get full title +
   * artist + cover artwork + a working seek bar, plus the
   * transport buttons on whatever surface the OS chose to expose.
   *
   * Feature-detected because non-secure contexts and old browsers
   * lack the API; falling through is harmless. Each setActionHandler
   * call is try/caught individually because some browsers (notably
   * Safari < 16.4) throw on actions they don't support, and a single
   * unsupported action shouldn't take out the rest.
   */
  function updateMediaSession (track) {
    if (!('mediaSession' in navigator)) return
    const meta = {
      title: track.title || 'RMusic',
      artist: track.author || '',
      album: 'RMusic'
    }
    if (track.pic) {
      // OS UIs prefer absolute URLs since they render the artwork
      // in a context outside the page's URL base. The browser
      // happily follows our 302 to the upstream cover CDN.
      const absolute = new URL(track.pic, location.href).href
      meta.artwork = [
        { src: absolute, sizes: '300x300', type: 'image/jpeg' },
        { src: absolute, sizes: '500x500', type: 'image/jpeg' }
      ]
    }
    try { navigator.mediaSession.metadata = new MediaMetadata(meta) } catch {}
    updateMediaPosition()
  }

  function updateMediaPosition () {
    if (!('mediaSession' in navigator)) return
    if (typeof navigator.mediaSession.setPositionState !== 'function') return
    const d = els.audio.duration
    if (!isFinite(d) || d <= 0) return
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: els.audio.playbackRate || 1,
        position: Math.min(d, Math.max(0, els.audio.currentTime || 0))
      })
    } catch {}
  }

  function setupMediaSessionActions () {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const safeSet = (name, fn) => { try { ms.setActionHandler(name, fn) } catch {} }
    safeSet('play',          () => { if (els.audio.paused) els.audio.play().catch(() => {}) })
    safeSet('pause',         () => { els.audio.pause() })
    safeSet('previoustrack', () => advance(-1))
    safeSet('nexttrack',     () => advance(1))
    safeSet('stop',          () => { els.audio.pause(); els.audio.currentTime = 0 })
    safeSet('seekto', (d) => {
      if (typeof d.seekTime !== 'number') return
      if (d.fastSeek && typeof els.audio.fastSeek === 'function') els.audio.fastSeek(d.seekTime)
      else els.audio.currentTime = d.seekTime
      updateMediaPosition()
    })
    safeSet('seekbackward', (d) => {
      const off = d && d.seekOffset ? d.seekOffset : 10
      els.audio.currentTime = Math.max(0, (els.audio.currentTime || 0) - off)
      updateMediaPosition()
    })
    safeSet('seekforward', (d) => {
      const off = d && d.seekOffset ? d.seekOffset : 10
      const dur = els.audio.duration || Infinity
      els.audio.currentTime = Math.min(dur, (els.audio.currentTime || 0) + off)
      updateMediaPosition()
    })
  }
  setupMediaSessionActions()

  function setBackdrop (picUrl) {
    if (!picUrl) {
      els.bg.style.backgroundImage = ''
      return
    }
    els.bg.style.backgroundImage = "url('" + picUrl.replace(/'/g, "%27") + "')"
  }

  function updateTransportEnabled () {
    const hasList = currentResults.length > 0
    const hasTrack = currentIndex >= 0
    els.prevBtn.disabled = !hasList
    els.nextBtn.disabled = !hasList
    els.playBtn.disabled = !hasTrack && !hasList
  }
  updateTransportEnabled()

  /* ---------- Loading indicator ---------- */

  let loadingState = false
  function setLoading (on) {
    loadingState = !!on
    els.playBtn.classList.toggle('loading', loadingState)
    if (loadingState) els.playIcon.textContent = ''
    else els.playIcon.textContent = els.audio.paused ? '▶' : '⏸'
  }

  /* ---------- Transport ---------- */

  function togglePlay () {
    if (currentIndex < 0) {
      // No track selected yet — surface the search panel so the
      // listener picks one.
      if (currentResults.length > 0) playIndex(0)
      else togglePanel(true)
      return
    }
    if (els.audio.paused) els.audio.play().catch(() => {})
    else els.audio.pause()
  }
  els.playBtn.addEventListener('click', togglePlay)

  function advance (direction) {
    if (currentResults.length === 0) return
    if (currentIndex < 0) { playIndex(0); return }
    if (shuffleMode === 'on' && currentResults.length > 1) {
      let next
      do { next = Math.floor(Math.random() * currentResults.length) } while (next === currentIndex)
      playIndex(next)
      return
    }
    const next = (currentIndex + direction + currentResults.length) % currentResults.length
    playIndex(next)
  }
  els.prevBtn.addEventListener('click', () => advance(-1))
  els.nextBtn.addEventListener('click', () => advance(1))

  // End-of-track honoring shuffle + loop:
  //   loop=single → replay current
  //   shuffle on  → random index (avoid the same one twice)
  //   loop=all    → wrap on overflow
  //   loop=off    → stop on overflow
  els.audio.addEventListener('ended', () => {
    if (currentIndex < 0 || currentResults.length === 0) return
    if (loopMode === 'single') { playIndex(currentIndex); return }
    if (shuffleMode === 'on') {
      if (currentResults.length === 1) {
        if (loopMode === 'all') playIndex(0)
        return
      }
      let next
      do { next = Math.floor(Math.random() * currentResults.length) } while (next === currentIndex)
      playIndex(next)
      return
    }
    const next = currentIndex + 1
    if (next < currentResults.length) playIndex(next)
    else if (loopMode === 'all') playIndex(0)
  })

  /* ---------- Audio events → UI ---------- */

  function setMediaPlaybackState (state) {
    if (!('mediaSession' in navigator)) return
    try { navigator.mediaSession.playbackState = state } catch {}
  }

  // Auto-skip-on-error: a single track 404 (Meting-API "VIP only" /
  // "taken down", or upstream HTTP2 cut mid-stream) shouldn't stall
  // the whole session — advance after a short pause so the listener
  // notices the skip without it feeling jarring. Counter prevents an
  // infinite skip loop when every track in the list is dead. Reset
  // every time a track *actually* starts producing audio.
  let consecutiveErrors = 0
  let pendingSkipTimer = 0

  els.audio.addEventListener('play',     () => { setLoading(loadingState); setMediaPlaybackState('playing') })
  els.audio.addEventListener('pause',    () => { setLoading(loadingState); setMediaPlaybackState('paused') })
  els.audio.addEventListener('loadstart', () => setLoading(true))
  els.audio.addEventListener('waiting',   () => setLoading(true))
  els.audio.addEventListener('canplay',   () => setLoading(false))
  els.audio.addEventListener('playing',   () => {
    setLoading(false)
    consecutiveErrors = 0
  })
  els.audio.addEventListener('error', () => {
    setLoading(false)
    setMediaPlaybackState('none')
    if (!els.audio.src) return
    console.warn('[rmusic] audio error for', els.audio.currentSrc, 'code=', els.audio.error?.code)

    consecutiveErrors += 1
    // Single-loop is an explicit "stay on this track" — don't skip.
    if (loopMode === 'single') {
      els.nowAuthor.textContent = '本曲加载失败'
      return
    }
    if (consecutiveErrors >= 3 || currentResults.length === 0) {
      consecutiveErrors = 0
      els.nowAuthor.textContent = '连续多曲不可播放,请换关键词'
      return
    }
    els.nowAuthor.textContent = '本曲不可播放,跳到下一首…'
    clearTimeout(pendingSkipTimer)
    pendingSkipTimer = setTimeout(() => advance(1), 800)
  })

  /* ---------- Progress bar ---------- */

  function formatTime (s) {
    if (!isFinite(s) || s < 0) return '0:00'
    const m = Math.floor(s / 60)
    const r = Math.floor(s % 60)
    return m + ':' + (r < 10 ? '0' + r : r)
  }

  function updateProgress () {
    const t = els.audio.currentTime || 0
    const d = els.audio.duration || 0
    els.currTime.textContent = formatTime(t)
    els.duration.textContent = formatTime(d)
    const pct = d > 0 ? (t / d) * 100 : 0
    if (!progressDragging) {
      els.progressFill.style.width = pct + '%'
      els.progressThumb.style.left = pct + '%'
    }
  }
  els.audio.addEventListener('timeupdate', updateProgress)
  els.audio.addEventListener('durationchange', updateProgress)
  // Throttle position-state pushes — timeupdate fires ~4×/s in
  // Chromium and the OS only needs occasional refreshes. Cheap
  // setTimeout-debounce keeps the lock-screen scrubber in sync
  // without spamming the API.
  let positionPushTimer = 0
  els.audio.addEventListener('timeupdate', () => {
    if (positionPushTimer) return
    positionPushTimer = setTimeout(() => {
      positionPushTimer = 0
      updateMediaPosition()
    }, 800)
  })
  els.audio.addEventListener('durationchange', updateMediaPosition)
  els.audio.addEventListener('ratechange', updateMediaPosition)

  /* ---------- Next-track pre-warm ----------
   *
   * iOS Safari's background tab killer pulls the rug fast: once
   * the current audio element goes idle (i.e. between `ended` and
   * the new `loadeddata`), the OS suspends the tab and the new
   * track silently never starts. The `playIndex` reorder above
   * keeps the audio element busy synchronously, but if the new
   * URL takes a long time to first-byte (cold R2 cache + slow
   * upstream resolution) the gap is still there.
   *
   * Mitigate by HEAD-prefetching the next track's audio URL when
   * we're ≤8 s from the end of the current one. That nudges the
   * Meting-API proxy worker to resolve the upstream URL and start
   * populating R2 in the background, so the actual `src =
   * next.url` 8 s later either hits R2 directly or arrives over a
   * warm connection. Per-track latched so we don't re-fetch every
   * timeupdate tick.
   */
  let _prewarmedTrackUrl = ''
  els.audio.addEventListener('timeupdate', () => {
    const d = els.audio.duration || 0
    if (d <= 0 || currentResults.length <= 1 || currentIndex < 0) return
    const remaining = d - (els.audio.currentTime || 0)
    if (remaining > 8 || remaining < 0) return
    // Pick the same index `ended` would pick — single/all/shuffle
    // semantics already lived in the ended handler; we just mirror
    // the "next sequential" rule here, which covers the common
    // case. Shuffle picks something different at the time of
    // `ended`, which is fine: at worst the pre-warm hit the wrong
    // R2 key, no user-visible regression.
    const nextIdx = (currentIndex + 1) % currentResults.length
    const nextTrack = currentResults[nextIdx]
    if (!nextTrack?.url || _prewarmedTrackUrl === nextTrack.url) return
    _prewarmedTrackUrl = nextTrack.url
    // HEAD so the Meting-API proxy worker resolves the upstream URL
    // + tees the body into R2 (its handler kicks off the full-body
    // fetch via ctx.waitUntil regardless of HEAD vs GET).
    fetch(nextTrack.url, { method: 'HEAD' }).catch(() => {})
  })

  function updateBuffered () {
    const d = els.audio.duration || 0
    if (d <= 0 || els.audio.buffered.length === 0) {
      els.progressBuffered.style.width = '0%'
      return
    }
    const end = els.audio.buffered.end(els.audio.buffered.length - 1)
    els.progressBuffered.style.width = ((end / d) * 100) + '%'
  }
  els.audio.addEventListener('progress', updateBuffered)
  els.audio.addEventListener('timeupdate', updateBuffered)

  // Progress bar drag + click. PointerEvents collapse mouse and
  // touch into one API; the bar captures the pointer on down so we
  // get the move/up events even when the finger drifts off-element.
  let progressDragging = false
  function pctFromEvent (e) {
    const rect = els.progressBar.getBoundingClientRect()
    let x = e.clientX
    if (x === undefined && e.touches && e.touches[0]) x = e.touches[0].clientX
    const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width))
    return pct
  }
  function seekToPct (pct) {
    const d = els.audio.duration
    if (!isFinite(d) || d <= 0) return
    els.audio.currentTime = pct * d
    els.progressFill.style.width = (pct * 100) + '%'
    els.progressThumb.style.left = (pct * 100) + '%'
    els.currTime.textContent = formatTime(pct * d)
  }
  els.progressBar.addEventListener('pointerdown', (e) => {
    if (currentIndex < 0) return
    progressDragging = true
    els.progressBar.classList.add('dragging')
    els.progressBar.setPointerCapture(e.pointerId)
    seekToPct(pctFromEvent(e))
  })
  els.progressBar.addEventListener('pointermove', (e) => {
    if (!progressDragging) return
    seekToPct(pctFromEvent(e))
  })
  els.progressBar.addEventListener('pointerup', (e) => {
    if (!progressDragging) return
    progressDragging = false
    els.progressBar.classList.remove('dragging')
    try { els.progressBar.releasePointerCapture(e.pointerId) } catch {}
  })
  els.progressBar.addEventListener('pointercancel', () => {
    progressDragging = false
    els.progressBar.classList.remove('dragging')
  })

  /* ---------- LRC: parse + render + auto-scroll ---------- */

  async function loadLrc (lrcUrl) {
    lrcData = []
    _lastWordLineIdx = -1
    els.lrcList.innerHTML = ''
    delete els.lrcList.dataset.intro
    els.lrcList.style.transform = ''
    if (!lrcUrl) return
    try {
      const res = await fetch(lrcUrl)
      if (!res.ok) return
      const text = await res.text()
      lrcData = parseLrc(text)
      renderLrc()
    } catch { /* LRC missing is non-fatal */ }
  }

  /* Parse LRC OR Enhanced LRC.
   *
   * Standard LRC:                 `[mm:ss.xx]words`
   * Enhanced LRC (per-word):      `[mm:ss.xx]<mm:ss.xx>word1<mm:ss.xx>word2<mm:ss.xx>`
   *
   * Output normalised to a single shape so renderLrc doesn't care:
   *
   *   [{ time, words: [{ t, text }] }]
   *
   * Standard lines compress to a single-word entry. Word-level
   * lines preserve the inline `<>` timing as one entry per word.
   * The trailing `<>` marker (end-of-line) is dropped — we don't
   * render a phantom empty word. */
  /* Parse timestamp fragment (mm,ss,frac) into seconds. `frac` is
   * the digit string after the dot — interpreted in its own base
   * so `.1` = 0.1 s, `.11` = 0.11 s, `.111` = 0.111 s. Standard LRC
   * spec is centiseconds (2 digits) but karaoke formats often emit
   * milliseconds (3 digits) so we handle both. */
  function lrcStampToSeconds (mm, ss, frac) {
    const fracSec = frac ? parseInt(frac, 10) / Math.pow(10, frac.length) : 0
    return parseInt(mm, 10) * 60 + parseInt(ss, 10) + fracSec
  }

  /* Parse LRC OR Enhanced LRC, then group co-timestamped subs.
   *
   *   Standard LRC:            `[mm:ss.xx]words`
   *   Enhanced LRC (per-word): `[mm:ss.xx]<mm:ss.xx>w1<mm:ss.xx>w2<mm:ss.xx>`
   *   Translation merge from   Meting-API emits the translation on
   *   its own line with the *same* `[mm:ss.xx]` head as the source
   *   line — e.g. lyric-enhanced.js's mergeTranslation puts the
   *   translation right after the source as
   *   `[00:21.10](粉橙交织的天空…)`.
   *   Duet / overlapping vocal lines also routinely share a
   *   timestamp.
   *
   * Output is a list of GROUPS — each group is a single semantic
   * "line" the listener sees and tracks as one unit:
   *
   *   [{
   *     time,
   *     subs: [ { words: [{ t, text }], wordLevel: bool } ]
   *   }]
   *
   * Standard LRC subs compress to a single-word entry; word-level
   * subs preserve the inline `<>` timestamps as one entry per word.
   * `wordLevel` is true when the original LRC had more than one
   * inline `<>` marker, so the renderer knows whether to expect
   * per-word highlight on this sub. */
  const GROUP_TOLERANCE_SEC = 0.05

  function parseLrc (text) {
    if (!text) return []
    const flat = []
    text.split(/\r?\n/).forEach((line) => {
      const headRe = /\[(\d+):(\d+)(?:\.(\d+))?\]/g
      const heads = []
      let m
      let bodyStart = 0
      while ((m = headRe.exec(line)) !== null && m.index === bodyStart) {
        heads.push(lrcStampToSeconds(m[1], m[2], m[3]))
        bodyStart = headRe.lastIndex
      }
      if (heads.length === 0) return
      const body = line.slice(bodyStart)
      const wordRe = /<(\d+):(\d+)(?:\.(\d+))?>([^<]*)/g
      const words = []
      let lastIndex = 0
      let wm
      while ((wm = wordRe.exec(body)) !== null) {
        const t = lrcStampToSeconds(wm[1], wm[2], wm[3])
        const wtext = wm[4]
        if (wtext !== '') words.push({ t, text: wtext })
        lastIndex = wordRe.lastIndex
      }
      if (words.length > 0) {
        heads.forEach((time) => flat.push({ time, words: words.slice(), wordLevel: words.length > 1 }))
        return
      }
      // Standard LRC fallback — wrap the line's text in a single
      // "word" so rendering / highlight code doesn't have to branch.
      const plain = body.slice(lastIndex).trim()
      heads.forEach((time) => flat.push({ time, words: [{ t: time, text: plain }], wordLevel: false }))
    })
    flat.sort((a, b) => a.time - b.time)
    // Group lines whose timestamps land within GROUP_TOLERANCE_SEC.
    // The merged Enhanced LRC emits source + translation back to
    // back at the same `[mm:ss.xx]`; duets routinely do the same.
    // We treat each group as ONE row the listener sees + scrolls
    // through. First sub in the group is the "primary" that owns
    // the per-word highlight.
    const groups = []
    for (const line of flat) {
      const last = groups[groups.length - 1]
      if (last && Math.abs(line.time - last.time) <= GROUP_TOLERANCE_SEC) {
        last.subs.push(line)
      } else {
        groups.push({ time: line.time, subs: [line] })
      }
    }
    return groups
  }

  /** Pick the sub inside a group that should drive word-level
   *  highlight. Prefer the first wordLevel sub; fall back to the
   *  first sub for monolithic / line-only LRC. */
  function primarySub (group) {
    for (const s of group.subs) if (s.wordLevel) return s
    return group.subs[0]
  }

  function renderLrc () {
    const frag = document.createDocumentFragment()
    lrcData.forEach((group, i) => {
      const li = document.createElement('li')
      li.dataset.time = String(group.time)
      li.dataset.index = String(i)
      const primary = primarySub(group)
      group.subs.forEach((sub) => {
        const subDiv = document.createElement('div')
        const isPrimary = sub === primary
        subDiv.className = 'lrc-sub' + (isPrimary ? ' lrc-sub-primary' : ' lrc-sub-secondary')
        if (sub.words.length === 0 || (sub.words.length === 1 && !sub.words[0].text)) {
          // Truly empty sub — render a sentinel so the row doesn't
          // collapse the LRC list's line-height math.
          const sentinel = document.createElement('span')
          sentinel.className = 'word'
          sentinel.textContent = '♪'
          subDiv.appendChild(sentinel)
        } else {
          sub.words.forEach((w, wi) => {
            const span = document.createElement('span')
            span.className = 'word'
            span.dataset.t = String(w.t)
            span.dataset.wi = String(wi)
            span.textContent = w.text
            subDiv.appendChild(span)
          })
        }
        li.appendChild(subDiv)
      })
      // No per-li click listener — taps are detected in
      // endLrcDrag's "didn't move" branch by reading e.target.
      // Avoids the double-seek that happens when browsers
      // synthesise a click after pointerup at the end of a drag.
      frag.appendChild(li)
    })
    els.lrcList.appendChild(frag)
    requestAnimationFrame(setLrcOffset)
  }

  /* Per-word highlight. Walks just the active line's spans, marks
   * every word whose `t` is ≤ currentTime as "passed" and the
   * latest one specifically as "current". When the active line
   * itself changes we also clear the previous line's word classes,
   * so seeking backwards through a song doesn't leave a trail of
   * "passed" highlights on what's now a future line. */
  let _lastWordLineIdx = -1
  function setActiveWord () {
    if (!lrcData.length) return
    const idx = findLrcIndex()
    if (idx < 0) return
    if (_lastWordLineIdx >= 0 && _lastWordLineIdx !== idx) {
      const oldLi = els.lrcList.children[_lastWordLineIdx]
      if (oldLi) {
        oldLi.querySelectorAll('.word-current, .word-passed').forEach((s) => {
          s.classList.remove('word-current')
          s.classList.remove('word-passed')
        })
      }
    }
    _lastWordLineIdx = idx
    const li = els.lrcList.children[idx]
    if (!li) return
    const group = lrcData[idx]
    if (!group) return
    // Light a word *before* its nominal start so the highlight
    // never lags behind what the listener is hearing — singers'
    // word onsets are typically a fraction earlier than the LRC
    // timestamp, and the CSS transition into `.word-current`
    // takes another ~150 ms to peak. WORD_LEAD_MS compensates for
    // both. Tweak in one spot rather than scattering offsets.
    const WORD_LEAD_MS = 180
    const t = els.audio.currentTime + WORD_LEAD_MS / 1000
    // The group's primary sub owns the per-word highlight. Find
    // its position in this <li>'s children so we can target only
    // that sub-div's spans (translation / secondary sub spans
    // stay neutral). For monolithic groups (single sub) this
    // collapses to "the only sub".
    const primary = primarySub(group)
    if (!primary || primary.words.length < 2) return
    const subIdx = group.subs.indexOf(primary)
    const subDiv = li.children[subIdx]
    if (!subDiv) return
    const spans = subDiv.querySelectorAll('.word')
    let activeI = -1
    for (let i = 0; i < primary.words.length; i++) {
      if (primary.words[i].t <= t) activeI = i
      else break
    }
    spans.forEach((s, i) => {
      s.classList.toggle('word-passed', i < activeI)
      s.classList.toggle('word-current', i === activeI)
    })
  }
  els.audio.addEventListener('timeupdate', setActiveWord)

  function findLrcIndex () {
    if (!lrcData.length) return -1
    const t = els.audio.currentTime
    for (let i = 0; i < lrcData.length; i++) {
      if (t < lrcData[i].time) return i - 1
    }
    return lrcData.length - 1
  }

  /** Cumulative top offset (from list start, unscaled px) for an
   *  index — handles the new world where each row's height varies
   *  with how many subs the group holds (single-line vs orig +
   *  translation, etc). */
  function rowTopAt (idx) {
    let top = 0
    for (let i = 0; i < idx; i++) {
      const child = els.lrcList.children[i]
      if (child) top += child.clientHeight
    }
    return top
  }

  function setLrcOffset () {
    if (lrcDragging) return  // user is scrubbing; don't fight them
    if (!lrcData.length || !els.lrcList.children.length) return
    if (els.lrcList.dataset.intro) return
    const idx = findLrcIndex()
    const container = els.lrcWrap
    const containerH = container.clientHeight
    const ulH = els.lrcList.clientHeight
    let offset
    if (idx < 0) {
      offset = 0
    } else {
      const top = rowTopAt(idx)
      const child = els.lrcList.children[idx]
      const h = child ? child.clientHeight : 50
      offset = containerH / 2 - top - h / 2
    }
    const maxOffset = containerH - ulH
    if (offset < maxOffset) offset = maxOffset
    if (offset > 0) offset = 0
    els.lrcList.style.transform = 'translateY(' + offset + 'px)'
    const active = els.lrcList.querySelector('.active')
    if (active) active.classList.remove('active')
    const next = els.lrcList.children[idx]
    if (next) next.classList.add('active')
  }
  els.audio.addEventListener('timeupdate', setLrcOffset)

  /* ---------- LRC drag-to-seek ----------
   *
   * Drag the LRC vertically: every line's worth of motion seeks one
   * line forward/back. Pause auto-scroll while dragging so the
   * playhead doesn't fight the user's finger. On release, snap to
   * the line under the centre marker and seek there.
   */
  let lrcDragging = false
  let dragStartY = 0
  let dragStartTransform = 0
  let dragMoved = false

  function currentTransformY () {
    const m = (els.lrcList.style.transform || '').match(/translateY\((-?\d+(?:\.\d+)?)px\)/)
    return m ? parseFloat(m[1]) : 0
  }

  els.lrcWrap.addEventListener('pointerdown', (e) => {
    if (!lrcData.length || els.lrcList.dataset.intro) return
    // Buttons in the LRC slot? None right now, but skip if the
    // event originated on an <a>/<button> defensively.
    if (e.target.closest('button, a')) return
    lrcDragging = true
    dragMoved = false
    dragStartY = e.clientY
    dragStartTransform = currentTransformY()
    els.lrcWrap.classList.add('dragging')
    els.lrcWrap.setPointerCapture(e.pointerId)
  })
  els.lrcWrap.addEventListener('pointermove', (e) => {
    if (!lrcDragging) return
    const dy = e.clientY - dragStartY
    if (Math.abs(dy) > 4) dragMoved = true
    const newOffset = dragStartTransform + dy
    els.lrcList.style.transform = 'translateY(' + newOffset + 'px)'
  })
  function endLrcDrag (e) {
    if (!lrcDragging) return
    lrcDragging = false
    els.lrcWrap.classList.remove('dragging')
    try { els.lrcWrap.releasePointerCapture(e.pointerId) } catch {}
    if (!dragMoved) {
      // It was a tap. Find the <li> under the pointer (e.target can
      // be the inner text node) and seek to its timestamp.
      const li = e.target && e.target.closest ? e.target.closest('li') : null
      if (!li || !li.dataset.time) return
      const t = parseFloat(li.dataset.time)
      if (!isNaN(t)) {
        els.audio.currentTime = t
        if (els.audio.paused) els.audio.play().catch(() => {})
      }
      return
    }
    // Drag-end: walk variable-height rows from list top to find
    // whichever row's centre is now closest to the container's
    // centre. Uniform-height math is wrong now that a group with a
    // translation sub is taller than a group with only the source.
    const containerH = els.lrcWrap.clientHeight
    const offset = currentTransformY()
    const centerY = containerH / 2 - offset  // world-y inside list
    let bestIdx = -1
    let bestDist = Infinity
    let accumTop = 0
    for (let i = 0; i < els.lrcList.children.length; i++) {
      const child = els.lrcList.children[i]
      const h = child.clientHeight
      const center = accumTop + h / 2
      const dist = Math.abs(center - centerY)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
      accumTop += h
    }
    const clamped = Math.max(0, Math.min(lrcData.length - 1, bestIdx))
    const row = lrcData[clamped]
    if (row && isFinite(row.time)) {
      els.audio.currentTime = row.time
      if (els.audio.paused) els.audio.play().catch(() => {})
    }
    // Let the timeupdate listener re-centre on the new active line.
    setLrcOffset()
  }
  els.lrcWrap.addEventListener('pointerup', endLrcDrag)
  els.lrcWrap.addEventListener('pointercancel', endLrcDrag)

  // Mouse wheel = same as drag, but in 60px-per-line increments.
  els.lrcWrap.addEventListener('wheel', (e) => {
    if (!lrcData.length || els.lrcList.dataset.intro) return
    e.preventDefault()
    const liH = els.lrcList.children[0]?.clientHeight || 50
    const lineDelta = e.deltaY > 0 ? 1 : -1
    const idx = Math.max(0, Math.min(lrcData.length - 1, (findLrcIndex() < 0 ? 0 : findLrcIndex()) + lineDelta))
    const row = lrcData[idx]
    if (row && isFinite(row.time)) {
      els.audio.currentTime = row.time
      if (els.audio.paused) els.audio.play().catch(() => {})
      setLrcOffset()
    }
    void liH
  }, { passive: false })

  /* ---------- First-paint intro state ----------
   *
   * Keep the page from looking like a blank black slab before the
   * first track loads. CSS supplies the radial backdrop; this
   * paints a handful of static hint lines into the LRC slot.
   */
  function renderIntro () {
    if (lrcData.length || currentResults.length) return
    els.lrcList.innerHTML = ''
    els.lrcList.dataset.intro = '1'
    els.lrcList.style.transform = ''
    const lines = [
      'RMusic',
      '点击右上角 ⌕ 搜一首歌',
      '默认网易云 · 可换其他源',
      '点歌词或拖动可调整进度',
      '随机 / 顺序 · 全部 / 单曲循环'
    ]
    const activeIdx = 1
    const frag = document.createDocumentFragment()
    lines.forEach((s, i) => {
      const li = document.createElement('li')
      li.className = 'intro' + (i === activeIdx ? ' active' : '')
      li.textContent = s
      frag.appendChild(li)
    })
    els.lrcList.appendChild(frag)
  }
  renderIntro()
})()
