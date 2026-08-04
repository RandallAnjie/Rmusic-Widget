import assert from 'node:assert/strict'
import fs from 'node:fs'
import worker from '../dist/_worker.js'

const calls = []
const fixture = [{
  id: 'track-1',
  title: 'Night Drive',
  author: 'RMusic',
  album: 'City Lights',
  duration_ms: 213000,
  url: 'https://music.example/api?server=netease&type=url&id=audio-1&auth=old',
  pic: '/api?server=netease&type=pic&id=cover-1&auth=old',
  lrc: 'https://music.example/api?server=netease&type=lrc&id=lyric-1',
  lrcpword: 'https://music.example/api?server=netease&type=lrcpword&id=word-1&auth=old'
}]

const env = {
  MUSIC_API_TOKEN: 'server-only-secret',
  RATE_MAX: '1000',
  MUSIC_API: {
    async fetch (input, init) {
      const url = new URL(input)
      calls.push({ url, init })
      const type = url.searchParams.get('type')
      if (['search', 'playlist'].includes(type)) {
        return Response.json(fixture)
      }
      if (type === 'pic') {
        return new Response(null, { status: 302, headers: { location: 'https://img.example/cover.jpg' } })
      }
      if (type === 'url') {
        return new Response('audio', {
          status: init.headers.range ? 206 : 200,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-4/5',
            'accept-ranges': 'bytes'
          }
        })
      }
      return new Response('[00:00.00]Night Drive', { headers: { 'content-type': 'text/plain' } })
    }
  }
}

const request = (path, init) => worker.fetch(new Request('https://rmusic.test' + path, init), env)

const home = await request('/')
assert.equal(home.status, 200)
const html = await home.text()
assert.match(html, /id="view-home"/)
assert.match(html, /id="view-library"/)
assert.match(html, /id="context-panel"/)
assert.doesNotMatch(html, /server-only-secret/)

const sourceHtml = fs.readFileSync(new URL('../src/widget/index.html', import.meta.url), 'utf8')
const clientSource = fs.readFileSync(new URL('../src/widget/client.js', import.meta.url), 'utf8')
const sourceCss = fs.readFileSync(new URL('../src/widget/index.css', import.meta.url), 'utf8')
const htmlIds = [...sourceHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
assert.equal(new Set(htmlIds).size, htmlIds.length, 'HTML must not contain duplicate IDs')
const referencedIds = [...clientSource.matchAll(/(?<!\$)\$\('([^']+)'\)/g)].map((match) => match[1])
for (const id of referencedIds) assert.ok(htmlIds.includes(id), `client references missing #${id}`)
assert.match(sourceCss, /@media \(max-width: 900px\)/)
assert.match(sourceCss, /@media \(max-width: 720px\)/)

const css = await request('/widget.css')
assert.match(css.headers.get('content-type'), /text\/css/)
assert.match(await css.text(), /\.app-shell/)

const js = await request('/widget.js')
assert.match(js.headers.get('content-type'), /javascript/)
assert.match(await js.text(), /rmusic_favorites_v2/)

const search = await request('/api/proxy?server=netease&type=search&id=night')
assert.equal(search.status, 200)
const [track] = await search.json()
assert.equal(track.album, 'City Lights')
assert.equal(track.duration_ms, 213000)
assert.equal(track.server, 'netease')
assert.equal(track.url, '/api/proxy?server=netease&type=url&id=audio-1')
assert.equal(track.pic, '/api/proxy?server=netease&type=pic&id=cover-1')
assert.equal(track.lrc, '/api/proxy?server=netease&type=lrc&id=lyric-1')
assert.equal(track.lrcpword, '/api/proxy?server=netease&type=lrcpword&id=word-1')
assert.equal(calls.at(-1).url.searchParams.get('token'), 'server-only-secret')

const lyrics = await request(track.lrcpword)
assert.equal(lyrics.status, 200)
assert.match(await lyrics.text(), /Night Drive/)
assert.equal(calls.at(-1).url.searchParams.get('type'), 'lrcpword')
assert.equal(calls.at(-1).url.searchParams.get('token'), 'server-only-secret')

const audio = await request(track.url, { headers: { range: 'bytes=0-4' } })
assert.equal(audio.status, 206)
assert.equal(audio.headers.get('accept-ranges'), 'bytes')
assert.equal(calls.at(-1).init.headers.range, 'bytes=0-4')

console.log('smoke: app shell, metadata rewrite, lyrics and audio proxy passed')
