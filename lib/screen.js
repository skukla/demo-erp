/*
 * The ERP's screen, served by its own web action rather than App Builder's static
 * site. The ERP shares a Runtime namespace with the integration it serves, a
 * namespace has one static site, and `aio app deploy` empties that site before it
 * uploads — so two apps with web assets delete each other's screens.
 *
 * The action answers three kinds of path:
 *   /                 the page
 *   /app.js, /app.css the built screen (each its own response: Runtime caps a result at 1 MB)
 *   /api/<action>/…   a data call, run in-process by that action's own handler
 *   /api/sync         POST: ask the connected integration to send its records again
 *
 * Data calls need the key Demo Builder generated and put in the link it opens. The
 * action carries no Adobe sign-in (`require-adobe-auth: false`), so the key is the
 * whole of its access control.
 */
const crypto = require('crypto')
const { run } = require('./action')
const http = require('./http')
const { requestSync } = require('./sync')
const { recordSync } = require('./sync-status')

const KEY_HEADER = 'x-erp-screen-key'

/**
 * Whether the request carries the configured key. Constant time; an unset key
 * matches nothing.
 *
 * @param {object} params the action params
 * @returns {boolean}
 */
function hasScreenKey (params) {
  const expected = params.ERP_SCREEN_KEY
  const given = params.__ow_headers && params.__ow_headers[KEY_HEADER]
  if (typeof expected !== 'string' || !expected || typeof given !== 'string' || !given) return false
  const digest = (value) => crypto.createHash('sha256').update(value).digest()
  return crypto.timingSafeEqual(digest(expected), digest(given))
}

/** The page. Asset paths are resolved from its own address, with or without a trailing slash. */
function page (title) {
  const safeTitle = String(title || 'ERP').replace(/[<>&"]/g, '')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
</head>
<body>
  <noscript>You need to enable JavaScript to run this app.</noscript>
  <div id="root"></div>
  <script>
    (function () {
      var base = location.pathname.replace(/\\/?$/, '/');
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = base + 'app.css';
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.type = 'module';
      js.src = base + 'app.js';
      document.body.appendChild(js);
    })();
  </script>
</body>
</html>`
}

function text (body, contentType) {
  return { statusCode: 200, headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' }, body }
}

/**
 * @param {object} params the action params
 * @param {object} deps `assets` ({ js, css }), `handlers` (action name → module exporting
 *   `handler` and optionally `allowOffline`), `collections` and `sync` (test injection)
 * @returns {Promise<object>} a web-action response
 */
async function serveScreen (params, { assets, handlers, collections, sync = requestSync }) {
  const segments = http.segments(params)
  const method = http.method(params)

  if (segments.length === 0 && method === 'GET') {
    return text(page(params.ERP_DISPLAY_NAME), 'text/html; charset=utf-8')
  }
  if (segments.length === 1 && method === 'GET' && segments[0] === 'app.js') {
    return text(assets.js, 'text/javascript; charset=utf-8')
  }
  if (segments.length === 1 && method === 'GET' && segments[0] === 'app.css') {
    return text(assets.css, 'text/css; charset=utf-8')
  }
  if (segments[0] !== 'api') {
    return http.fail(404, 'NO_ROUTE', `No route for ${method} /${segments.join('/')}.`)
  }

  if (!params.ERP_SCREEN_KEY) {
    return http.fail(503, 'SCREEN_KEY_UNSET', 'This ERP was deployed without a screen key. Redeploy it from Demo Builder.')
  }
  if (!hasScreenKey(params)) {
    return http.fail(401, 'SCREEN_KEY_REQUIRED', 'Open the ERP from Demo Builder: this call needs the key in its link.')
  }

  if (segments[1] === 'sync' && segments.length === 2) {
    if (method !== 'POST') return http.fail(404, 'NO_ROUTE', `No route for ${method} /api/sync.`)
    return run(params, async ({ cols }) => {
      // Recorded before asking, so the screen can say "waiting" at once; a refusal is
      // recorded too, so a screen opened later still shows why.
      await recordSync(cols, { state: 'requested' })
      try {
        return http.ok(await sync(params), 202)
      } catch (error) {
        if (!(error && error.statusCode)) throw error
        await recordSync(cols, { state: 'failed', error: error.message })
        return http.fail(error.statusCode, error.code, error.message)
      }
    }, { allowOffline: true, collections })
  }

  const target = handlers[segments[1]]
  if (!target) {
    return http.fail(404, 'NO_ROUTE', `No ERP action named ${segments[1] || '(none)'}.`)
  }

  // The handler sees exactly what a direct call to its own action would: its own
  // path, and none of this action's plumbing.
  const forwarded = { ...params, __ow_path: `/${segments.slice(2).join('/')}` }
  delete forwarded.ERP_SCREEN_KEY
  return run(forwarded, target.handler, { allowOffline: Boolean(target.allowOffline), collections })
}

module.exports = { serveScreen, hasScreenKey, KEY_HEADER }
