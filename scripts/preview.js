/*
 * Serves preview/ on localhost so the screen can be looked at without a deployed
 * action, a key, or any records. Never shipped: the `screen` action serves
 * actions/screen/assets.generated.js, which scripts/build-screen.js builds.
 *
 * esbuild's own dev server sends no cache headers, so a browser applies heuristic
 * caching and keeps re-running a build from minutes ago while the server holds the
 * current one. That cost real time three times in one afternoon, each look identical
 * to the change not working: the file on disk had it, the served file had it, the
 * running page did not. Everything here is served `no-store`, so what is on screen is
 * always what was built.
 */
const http = require('http')
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..')
const PORT = Number(process.env.PREVIEW_PORT || 8975)

/**
 * Build the preview and serve it. Exported so a test can start it on a free port and
 * stop it again (test/screens.test.js); run as a script it serves on PREVIEW_PORT.
 *
 * @param {object} [options] `port` (0 = any free port)
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
async function startPreview ({ port = PORT } = {}) {
  const context = await esbuild.context({
    entryPoints: [path.join(ROOT, 'preview', 'main.js')],
    bundle: true,
    format: 'esm',
    // NOT preview/ itself: the entry IS preview/main.js and the bundle would
    // overwrite it.
    outdir: path.join(ROOT, 'preview', 'dist'),
    loader: { '.js': 'jsx' },
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'warning'
  })
  await context.rebuild()
  /* esbuild on a port of its own; everything reaches it through the proxy below.
     serve() answers `{ host, port }` — read from it, not guessed: the first attempt
     here used `hosts[0]`, which is undefined in this version and threw on every
     request. */
  const inner = await context.serve({ servedir: path.join(ROOT, 'preview') })

  const proxy = http.createServer((request, response) => {
    const onward = http.request(
      { hostname: '127.0.0.1', port: inner.port, path: request.url, method: request.method, headers: request.headers },
      (answer) => {
        response.writeHead(answer.statusCode ?? 500, {
          ...answer.headers,
          'Cache-Control': 'no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        })
        answer.pipe(response, { end: true })
      }
    )
    onward.on('error', (error) => {
      response.writeHead(502, { 'Content-Type': 'text/plain' })
      response.end(`preview: the builder did not answer (${error.message})`)
    })
    request.pipe(onward, { end: true })
  })

  await new Promise((resolve) => proxy.listen(port, resolve))
  const bound = proxy.address().port
  return {
    url: `http://127.0.0.1:${bound}/`,
    port: bound,
    close: () => new Promise((resolve) => proxy.close(() => context.dispose().then(resolve, resolve)))
  }
}

module.exports = { startPreview }

if (require.main === module) {
  startPreview()
    .then(({ url }) => console.log(`preview: ${url}`))
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}
