/*
 * Serves preview/ on localhost so the screen can be looked at without a deployed
 * action, a key, or any records. Never shipped: the `screen` action serves
 * actions/screen/assets.generated.js, which scripts/build-screen.js builds.
 */
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..')
const PORT = Number(process.env.PREVIEW_PORT || 8975)

async function serve () {
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
  const server = await context.serve({ servedir: path.join(ROOT, 'preview'), port: PORT })
  console.log(`preview: http://localhost:${server.port}/`)
}

serve().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
