// esbuild wrapper. Two jobs:
//   1. Bundle src/worker.js → dist/worker.js as an ESM bundle for
//      bigrandall / workerd / CF Workers.
//   2. Inline the widget assets (HTML, CSS, client-side JS) as
//      build-time string constants via esbuild's `define`. That
//      way the worker doesn't have to read from disk (there isn't
//      one in workerd) and the dist bundle ships as a single file.

import fs from 'node:fs'
import { build } from 'esbuild'

const read = (p) => fs.readFileSync(p, 'utf8')

const widgetHtml = read('src/widget/index.html')
const widgetJs = read('src/widget/client.js')

// CSS keeps the spinning-disc + pointer artwork as data: URIs so the
// bundle stays self-contained (workerd has no static asset hosting).
// Cheap — PNGs are ~21 KB + ~45 KB raw, the bundle bloats by ~90 KB
// after base64. Browser caches /widget.css for an hour so each
// visitor downloads it once.
const discB64 = fs.readFileSync('src/widget/disc.png').toString('base64')
const pointerB64 = fs.readFileSync('src/widget/pointer.png').toString('base64')
const widgetCss = read('src/widget/index.css')
  .replaceAll('__DISC_B64__', discB64)
  .replaceAll('__POINTER_B64__', pointerB64)

await build({
  entryPoints: ['src/worker.js'],
  bundle: true,
  format: 'esm',
  target: 'esnext',
  platform: 'neutral',
  conditions: ['worker', 'browser', 'import', 'default'],
  define: {
    __WIDGET_HTML__: JSON.stringify(widgetHtml),
    __WIDGET_CSS__: JSON.stringify(widgetCss),
    __WIDGET_JS__: JSON.stringify(widgetJs)
  },
  outfile: 'dist/worker.js',
  legalComments: 'none',
  logLevel: 'info'
})
