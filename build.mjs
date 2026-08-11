// esbuild wrapper. Two jobs:
//   1. Bundle src/worker.js → dist/worker.js as an ESM bundle for
//      bigrandall / workerd / CF Workers.
//   2. Inline the widget assets (HTML, CSS, client-side JS) as
//      build-time string constants via esbuild's `define`. That
//      way the worker doesn't have to read from disk (there isn't
//      one in workerd) and the dist bundle ships as a single file.

import fs from 'node:fs'
import crypto from 'node:crypto'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import { build, transform } from 'esbuild'

const read = (p) => fs.readFileSync(p, 'utf8')

const [{ code: widgetCss }, { code: widgetJs }] = await Promise.all([
  transform(read('src/widget/index.css'), { loader: 'css', minify: true }),
  transform(read('src/widget/client.js'), { loader: 'js', minify: true, target: 'es2022' })
])

function compressedBase64 (value, encoding) {
  const bytes = Buffer.from(value)
  const compressed = encoding === 'br'
    ? brotliCompressSync(bytes, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 }
      })
    : gzipSync(bytes, { level: 9 })
  return compressed.toString('base64')
}

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
console.log('  widget bytes:', `${Buffer.byteLength(widgetHtml)} html, ${Buffer.byteLength(widgetCss)} css, ${Buffer.byteLength(widgetJs)} js`)

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
    __WIDGET_JS__: JSON.stringify(widgetJs),
    __WIDGET_ASSET_HASH__: JSON.stringify(assetHash),
    __WIDGET_HTML_BR__: JSON.stringify(compressedBase64(widgetHtml, 'br')),
    __WIDGET_HTML_GZIP__: JSON.stringify(compressedBase64(widgetHtml, 'gzip')),
    __WIDGET_CSS_BR__: JSON.stringify(compressedBase64(widgetCss, 'br')),
    __WIDGET_CSS_GZIP__: JSON.stringify(compressedBase64(widgetCss, 'gzip')),
    __WIDGET_JS_BR__: JSON.stringify(compressedBase64(widgetJs, 'br')),
    __WIDGET_JS_GZIP__: JSON.stringify(compressedBase64(widgetJs, 'gzip'))
  },
  // Output filename is the underscore-prefixed `_worker.js` so a
  // bigrandall *pages-mode* deployment recognises it as the catch-
  // all function (CF Pages convention). In *workers-mode* the
  // operator just points the "output file" knob at this same path
  // — works for both setups without code changes.
  outfile: 'dist/_worker.js',
  minify: true,
  legalComments: 'none',
  logLevel: 'info'
})
