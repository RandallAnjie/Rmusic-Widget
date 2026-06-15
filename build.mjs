// esbuild wrapper. Two jobs:
//   1. Bundle src/worker.js → dist/worker.js as an ESM bundle for
//      bigrandall / workerd / CF Workers.
//   2. Inline the widget assets (HTML, CSS, client-side JS) as
//      build-time string constants via esbuild's `define`. That
//      way the worker doesn't have to read from disk (there isn't
//      one in workerd) and the dist bundle ships as a single file.

import fs from 'node:fs'
import crypto from 'node:crypto'
import { build } from 'esbuild'

const read = (p) => fs.readFileSync(p, 'utf8')

const widgetCss = read('src/widget/index.css')
const widgetJs = read('src/widget/client.js')

// Content-hash the two changing assets and stitch the hash into the
// HTML's `<link>` and `<script>` URLs so a redeploy guarantees fresh
// asset fetches even past any CDN / browser cache. Eight base16 chars
// of sha-1 are more than enough — one collision per ~4e9 builds.
const assetHash = crypto
  .createHash('sha1')
  .update(widgetCss)
  .update(widgetJs)
  .digest('hex')
  .slice(0, 8)
const widgetHtml = read('src/widget/index.html').replaceAll('__ASSET_HASH__', assetHash)
console.log('  asset hash:', assetHash)

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
  // Output filename is the underscore-prefixed `_worker.js` so a
  // bigrandall *pages-mode* deployment recognises it as the catch-
  // all function (CF Pages convention). In *workers-mode* the
  // operator just points the "output file" knob at this same path
  // — works for both setups without code changes.
  outfile: 'dist/_worker.js',
  legalComments: 'none',
  logLevel: 'info'
})
