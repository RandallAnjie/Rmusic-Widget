/* RMusic widget — client-side controller.
 *
 * Talks only to /api/proxy on the same origin. The worker handles
 * rate limiting, env-token injection, and proxying to the Meting-API
 * binding. No secrets here, no cross-origin calls.
 *
 * Behaviour:
 *   - Click ⌕ → toggle the right-top search panel.
 *   - Pick a server (default ytmusic) + type a query → /api/proxy
 *     returns a list of tracks (already rewritten to point back at
 *     this worker).
 *   - Click a result → that track plays: audio src updated, LRC
 *     fetched and rendered, cover loaded as the page backdrop.
 *   - Click the disc → toggle play/pause (preserves the original
 *     interaction from the startpage widget).
 */

(function () {
  'use strict'

  const $ = (id) => document.getElementById(id)

  const els = {
    audio:    $('audio'),
    bg:       $('bg'),
    lrcList:  $('lrc-list'),
    songstatus: $('songstatus'),
    disc:     $('songstatus_pic'),
    searchToggle: $('searchToggle'),
    panel:    $('search-panel'),
    server:   $('server'),
    query:    $('query'),
    searchBtn: $('searchBtn'),
    shuffleBtn: $('shuffleBtn'),
    loopBtn:  $('loopBtn'),
    results:  $('results'),
    status:   $('search-status'),
    nowPlaying: $('now-playing'),
    nowTitle: $('now-title'),
    nowAuthor: $('now-author')
  }

  // Server-side proxy path. The worker injects the master token, the
  // search/song/playlist responses already have url/pic/lrc rewritten
  // to point right back here.
  const API = '/api/proxy'

  // Track list state — we keep the current search result around so a
  // hot-reload of the LRC or audio doesn't need to refetch metadata.
  let currentResults = []
  let currentIndex = -1

  // LRC state — array of { time, words }, current highlighted line.
  let lrcData = []

  /* ---------- Playback modes (shuffle + loop) ----------
   *
   * Two independent dimensions:
   *   shuffleMode: 'off' | 'on'
   *   loopMode:    'off' | 'all' | 'single'
   *
   * Behaviour on track end:
   *   single → replay current
   *   else if shuffle on → pick a random index
   *   else → next in order; off stops at the end, all wraps to start
   *
   * Persisted to localStorage so an embedded widget remembers the
   * listener's preference across page reloads.
   */
  const STORAGE_KEY = 'rmusic_playback_mode'
  let shuffleMode = 'off'
  let loopMode = 'off'

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (saved.shuffle === 'on' || saved.shuffle === 'off') shuffleMode = saved.shuffle
    if (saved.loop === 'off' || saved.loop === 'all' || saved.loop === 'single') loopMode = saved.loop
  } catch { /* ignore storage errors (private browsing, quota) */ }

  function persistMode () {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ shuffle: shuffleMode, loop: loopMode })) } catch {}
  }

  function renderModes () {
    els.shuffleBtn.dataset.mode = shuffleMode
    els.shuffleBtn.querySelector('.mode-icon').textContent = shuffleMode === 'on' ? '⇄' : '→'
    els.shuffleBtn.querySelector('.mode-label').textContent = shuffleMode === 'on' ? '随机' : '顺序'

    els.loopBtn.dataset.mode = loopMode
    const loopLabels = { off: ['✗', '不循环'], all: ['↻', '全部循环'], single: ['↺', '单曲循环'] }
    const [icon, label] = loopLabels[loopMode] || loopLabels.off
    els.loopBtn.querySelector('.mode-icon').textContent = icon
    els.loopBtn.querySelector('.mode-label').textContent = label
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
  // Esc closes the panel — small UX nicety.
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
    if (!query) {
      setStatus('请输入关键词')
      return
    }
    const server = els.server.value || 'ytmusic'
    setStatus('搜索中…')
    els.results.innerHTML = ''
    try {
      const usp = new URLSearchParams({
        server,
        type: 'search',
        id: query
      })
      const res = await fetch(API + '?' + usp.toString(), {
        headers: { accept: 'application/json' }
      })
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

  async function playIndex (i) {
    const track = currentResults[i]
    if (!track) return
    currentIndex = i
    Array.from(els.results.children).forEach((li, idx) => {
      li.classList.toggle('playing', idx === i)
    })
    showNowPlaying(track)
    setBackdrop(track.pic)
    await loadLrc(track.lrc)
    els.audio.src = track.url
    els.audio.play().catch(() => {
      // Browsers can refuse autoplay; the disc click below is the
      // user gesture that unblocks it.
    })
  }

  function showNowPlaying (track) {
    els.nowTitle.textContent = track.title || ''
    els.nowAuthor.textContent = track.author || ''
    if (track.title || track.author) els.nowPlaying.removeAttribute('hidden')
    else els.nowPlaying.setAttribute('hidden', '')
  }

  function setBackdrop (picUrl) {
    if (!picUrl) {
      els.bg.style.backgroundImage = ''
      return
    }
    els.bg.style.backgroundImage = "url('" + picUrl.replace(/'/g, "%27") + "')"
  }

  /* ---------- Lyrics ---------- */

  async function loadLrc (lrcUrl) {
    lrcData = []
    els.lrcList.innerHTML = ''
    // Drop the intro flag the moment we know a real track is being
    // loaded — intro layout is flex-centered, real LRC is transform-
    // scrolled, and the two don't share a coordinate system.
    delete els.lrcList.dataset.intro
    els.lrcList.style.transform = ''
    if (!lrcUrl) return
    try {
      const res = await fetch(lrcUrl)
      if (!res.ok) return
      const text = await res.text()
      lrcData = parseLrc(text)
      renderLrc()
    } catch {
      /* swallow — LRC missing is non-fatal, the player still works */
    }
  }

  function parseLrc (text) {
    if (!text) return []
    const out = []
    text.split(/\r?\n/).forEach((line) => {
      // [mm:ss.xx]words OR [mm:ss]words. Multiple [mm:ss] timestamps
      // on one line repeat the same words at each stamp (common in
      // chorus LRCs).
      const ms = []
      const re = /\[(\d+):(\d+)(?:\.(\d+))?\]/g
      let m
      let lastIndex = 0
      while ((m = re.exec(line)) !== null) {
        ms.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 1000 : 0))
        lastIndex = re.lastIndex
      }
      const words = line.slice(lastIndex).trim()
      if (ms.length === 0) return
      ms.forEach((t) => out.push({ time: t, words }))
    })
    out.sort((a, b) => a.time - b.time)
    return out
  }

  function renderLrc () {
    const frag = document.createDocumentFragment()
    lrcData.forEach((row) => {
      const li = document.createElement('li')
      li.textContent = row.words || '♪'
      frag.appendChild(li)
    })
    els.lrcList.appendChild(frag)
    requestAnimationFrame(setLrcOffset) // initial paint
  }

  function findLrcIndex () {
    if (!lrcData.length) return -1
    const t = els.audio.currentTime
    for (let i = 0; i < lrcData.length; i++) {
      if (t < lrcData[i].time) return i - 1
    }
    return lrcData.length - 1
  }

  function setLrcOffset () {
    if (!lrcData.length || !els.lrcList.children.length) return
    const idx = findLrcIndex()
    const container = els.lrcList.parentElement
    const containerH = container.clientHeight
    const liH = els.lrcList.children[0].clientHeight || 50
    const ulH = els.lrcList.clientHeight
    let offset = containerH / 2 - liH * idx + liH / 2
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

  /* ---------- Disc play/pause + auto-advance ---------- */

  function togglePlay () {
    if (!els.audio.src) {
      togglePanel(true)
      return
    }
    if (els.audio.paused) els.audio.play().catch(() => {})
    else els.audio.pause()
  }
  els.disc.addEventListener('click', togglePlay)
  els.disc.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); togglePlay() }
  })

  els.audio.addEventListener('play', () => els.songstatus.classList.add('playing'))
  els.audio.addEventListener('pause', () => els.songstatus.classList.remove('playing'))
  // Auto-advance honoring shuffle + loop:
  //   loop=single   → replay current
  //   shuffle on    → random other index (avoid the same one twice
  //                   in a row when the list has more than 1 track)
  //   loop=all      → wrap to first when reaching the end
  //   loop=off      → stop at the end
  els.audio.addEventListener('ended', () => {
    if (currentIndex < 0 || currentResults.length === 0) return
    if (loopMode === 'single') {
      playIndex(currentIndex)
      return
    }
    if (shuffleMode === 'on') {
      if (currentResults.length === 1) {
        if (loopMode === 'all') playIndex(0)
        return
      }
      let next
      do {
        next = Math.floor(Math.random() * currentResults.length)
      } while (next === currentIndex)
      playIndex(next)
      return
    }
    const next = currentIndex + 1
    if (next < currentResults.length) {
      playIndex(next)
    } else if (loopMode === 'all') {
      playIndex(0)
    }
  })

  // Network-level error → log to console. The browser fires `error`
  // for many reasons (CORS, 4xx, decode); we don't auto-retry because
  // the worker already 429s when rate-limited, and the user can
  // re-pick from the list.
  els.audio.addEventListener('error', () => {
    if (els.audio.src) console.warn('[rmusic] audio error for', els.audio.currentSrc)
  })

  /* ---------- First-paint intro state ----------
   *
   * Without an intro the page would render as plain black with an
   * empty middle until someone searched — the exact opposite of
   * the original startpage widget, which always had a track + LRC
   * loaded so the lyrics + blurred cover were there immediately.
   * We can't preload a real track here without burning rate limit
   * on every visitor, so we fake it: a handful of static lines in
   * the LRC slot, plus the CSS radial-vignette backdrop on
   * .background, give the page a presence on first paint that
   * gets seamlessly replaced when the listener picks a real
   * track.
   */
  function renderIntro () {
    if (lrcData.length || currentResults.length) return
    els.lrcList.innerHTML = ''
    els.lrcList.dataset.intro = '1'
    els.lrcList.style.transform = ''
    const lines = [
      'RMusic',
      '点击右上角 ⌕ 搜一首歌',
      '默认 QQ 音乐 · 可换其他源',
      '随机 / 顺序 · 全部 / 单曲循环',
      '点击唱片 暂停 / 继续'
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
