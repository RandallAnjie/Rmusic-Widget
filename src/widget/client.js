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
  // Auto-advance — when the current track ends, play the next one in
  // the result list if there is one.
  els.audio.addEventListener('ended', () => {
    if (currentIndex >= 0 && currentIndex + 1 < currentResults.length) {
      playIndex(currentIndex + 1)
    }
  })

  // Network-level error → log to console. The browser fires `error`
  // for many reasons (CORS, 4xx, decode); we don't auto-retry because
  // the worker already 429s when rate-limited, and the user can
  // re-pick from the list.
  els.audio.addEventListener('error', () => {
    if (els.audio.src) console.warn('[rmusic] audio error for', els.audio.currentSrc)
  })

  /* ---------- First-paint state ---------- */

  // No track loaded → disc reveals the panel so the user can search.
  // (The visible disc + ⌕ button hint is enough; no auto-open.)
})()
