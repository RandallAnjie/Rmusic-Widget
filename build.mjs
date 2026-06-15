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
const widgetCss = read('src/widget/index.css')
const widgetJs = read('src/widget/client.js')

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
