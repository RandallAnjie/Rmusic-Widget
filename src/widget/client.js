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
    els.shuffleBtn.dataset.mode = shuffleMode
    els.shuffleBtn.querySelector('.ctrl-icon').textContent = shuffleMode === 'on' ? '⇄' : '→'

    els.loopBtn.dataset.mode = loopMode
    const icons = { off: '✗', all: '↻', single: '↺' }
    els.loopBtn.querySelector('.ctrl-icon').textContent = icons[loopMode] || '✗'
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

  async function playIndex (i) {
    const track = currentResults[i]
    if (!track) return
    currentIndex = i
    Array.from(els.results.children).forEach((li, idx) => {
      li.classList.toggle('playing', idx === i)
    })
    showNowPlaying(track)
    setBackdrop(track.pic)
    setLoading(true)
    await loadLrc(track.lrc)
    els.audio.src = track.url
    els.audio.play().catch(() => {
      // Browsers can refuse autoplay (first interaction not yet
      // performed) — the user can hit the play button to unblock.
      setLoading(false)
    })
    updateTransportEnabled()
  }

  function showNowPlaying (track) {
    els.nowTitle.textContent = track.title || ''
    els.nowAuthor.textContent = track.author || ''
  }

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

  els.audio.addEventListener('play',     () => setLoading(loadingState))
  els.audio.addEventListener('pause',    () => setLoading(loadingState))
  els.audio.addEventListener('loadstart', () => setLoading(true))
  els.audio.addEventListener('waiting',   () => setLoading(true))
  els.audio.addEventListener('canplay',   () => setLoading(false))
  els.audio.addEventListener('playing',   () => setLoading(false))
  els.audio.addEventListener('error', () => {
    setLoading(false)
    if (els.audio.src) console.warn('[rmusic] audio error for', els.audio.currentSrc)
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

  function parseLrc (text) {
    if (!text) return []
    const out = []
    text.split(/\r?\n/).forEach((line) => {
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
    lrcData.forEach((row, i) => {
      const li = document.createElement('li')
      li.textContent = row.words || '♪'
      li.dataset.time = String(row.time)
      li.dataset.index = String(i)
      // Click a line to seek to its timestamp.
      li.addEventListener('click', () => {
        if (lrcDragging) return  // drag-end synthesises a click, ignore
        const d = els.audio.duration
        if (!isFinite(d) || d <= 0) return
        els.audio.currentTime = row.time
        if (els.audio.paused) els.audio.play().catch(() => {})
      })
      frag.appendChild(li)
    })
    els.lrcList.appendChild(frag)
    requestAnimationFrame(setLrcOffset)
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
    if (lrcDragging) return  // user is scrubbing; don't fight them
    if (!lrcData.length || !els.lrcList.children.length) return
    if (els.lrcList.dataset.intro) return
    const idx = findLrcIndex()
    const container = els.lrcWrap
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
    if (!dragMoved) return  // treat as click; line handler will fire
    // Figure out which line is closest to the centre of the
    // container, then seek to its time.
    const containerH = els.lrcWrap.clientHeight
    const liH = els.lrcList.children[0]?.clientHeight || 50
    const offset = currentTransformY()
    // offset = containerH/2 - liH * idx + liH/2  →  solve for idx
    const idx = Math.round((containerH / 2 - offset + liH / 2) / liH - 1)
    const clamped = Math.max(0, Math.min(lrcData.length - 1, idx))
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
