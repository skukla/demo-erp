const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { serveScreen, KEY_HEADER } = require('../lib/screen')
const admin = require('../actions/admin')
const handlers = {
  health: require('../actions/health'),
  settings: require('../actions/settings'),
  admin,
  products: require('../actions/products')
}

const KEY = 'k3y-for-tests-only'
const assets = { js: 'console.log("screen")', css: 'body{}' }
let cols

beforeEach(async () => {
  cols = memoryCollections()
  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: { projectName: 'Demo', products: [{ sku: 'A1', name: 'Widget', listPrice: 100, warehouses: [{ code: 'default', name: 'Default Source', quantity: 10 }] }], partners: [] }
  })
})

/** Call the screen action the way Runtime would. */
function screen ({ method = 'GET', path = '', key, body, params = {}, sync } = {}) {
  const p = { ERP_SCREEN_KEY: KEY, ERP_DISPLAY_NAME: 'Acme ERP', ...params, __ow_method: method.toLowerCase(), __ow_path: path, __ow_headers: {} }
  if (key !== undefined) p.__ow_headers[KEY_HEADER] = key
  if (body !== undefined) p.__ow_body = JSON.stringify(body)
  return serveScreen(p, { assets, handlers, collections: async () => cols, sync })
}

test('serves the page without a key, named after the ERP', async () => {
  for (const path of ['', '/']) {
    const res = await screen({ path })
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['Content-Type'], /^text\/html/)
    assert.match(res.body, /<title>Acme ERP<\/title>/)
  }
})

test('the page resolves its assets from its own address', async () => {
  const res = await screen()
  assert.match(res.body, /base \+ 'app\.js'/)
  assert.match(res.body, /base \+ 'app\.css'/)
})

test('a display name cannot break out of the title', async () => {
  const res = await screen({ params: { ERP_DISPLAY_NAME: '</title><script>x</script>' } })
  assert.doesNotMatch(res.body, /<script>x/)
})

test('serves the built script and stylesheet with their types', async () => {
  const js = await screen({ path: '/app.js' })
  assert.equal(js.body, assets.js)
  assert.match(js.headers['Content-Type'], /^text\/javascript/)
  const css = await screen({ path: '/app.css' })
  assert.equal(css.body, assets.css)
  assert.match(css.headers['Content-Type'], /^text\/css/)
})

test('a data call without the key, or with a wrong one, is refused', async () => {
  assert.equal((await screen({ path: '/api/health' })).statusCode, 401)
  assert.equal((await screen({ path: '/api/health', key: 'wrong' })).statusCode, 401)
  assert.equal((await screen({ path: '/api/health', key: '' })).statusCode, 401)
})

test('an ERP deployed without a key refuses every data call, even one carrying a key', async () => {
  const res = await screen({ path: '/api/health', key: '', params: { ERP_SCREEN_KEY: '' } })
  assert.equal(res.statusCode, 503)
  assert.equal(res.body.errorCode, 'SCREEN_KEY_UNSET')
})

test('with the key, a data call runs that action\'s handler on its own path', async () => {
  const health = await screen({ path: '/api/health', key: KEY })
  assert.equal(health.statusCode, 200)
  assert.equal(health.body.counts.products, 1)

  const product = await screen({ path: '/api/products/A1', key: KEY })
  assert.equal(product.body.name, 'Widget')

  const patched = await screen({ method: 'PATCH', path: '/api/products/A1', key: KEY, body: { warehouses: [{ code: 'default', quantity: 4 }] } })
  assert.equal(patched.body.stock, 4)
})

test('the key never reaches a handler as data', async () => {
  const res = await screen({ method: 'PATCH', path: '/api/settings', key: KEY })
  assert.doesNotMatch(JSON.stringify(res.body), new RegExp(KEY))
})

test('an offline ERP still refuses what its own action refuses, and allows what it allows', async () => {
  await screen({ method: 'PATCH', path: '/api/settings', key: KEY, body: { offline: true } })
  assert.equal((await screen({ path: '/api/products', key: KEY })).statusCode, 503)
  assert.equal((await screen({ path: '/api/health', key: KEY })).statusCode, 200)
})

test('unknown actions and paths are 404s', async () => {
  assert.equal((await screen({ path: '/api/nope', key: KEY })).statusCode, 404)
  assert.equal((await screen({ path: '/api', key: KEY })).statusCode, 404)
  assert.equal((await screen({ path: '/elsewhere' })).statusCode, 404)
  assert.equal((await screen({ method: 'POST', path: '/app.js' })).statusCode, 404)
})

test('Sync records asks the subscriber and answers 202, only with the key and only by POST', async () => {
  const asked = []
  const sync = async (params) => { asked.push(params); return { started: true } }

  const res = await screen({ method: 'POST', path: '/api/sync', key: KEY, sync })
  assert.equal(res.statusCode, 202)
  assert.deepEqual(res.body, { started: true })
  assert.equal(asked.length, 1)

  // Recorded before asking, so a screen can say "waiting" at once.
  assert.equal((await invoke(require('../actions/health'), cols)).body.sync.state, 'requested')

  assert.equal((await screen({ method: 'POST', path: '/api/sync', sync })).statusCode, 401)
  assert.equal((await screen({ path: '/api/sync', key: KEY, sync })).statusCode, 404)
  assert.equal(asked.length, 1)
})

test('a sync the subscriber refuses comes back as the ERP\'s own error', async () => {
  const { HttpError } = require('../lib/errors')
  const sync = async () => { throw new HttpError(502, 'SYNC_REFUSED', 'The connected integration answered 401.') }

  const res = await screen({ method: 'POST', path: '/api/sync', key: KEY, sync })

  assert.equal(res.statusCode, 502)
  assert.equal(res.body.errorCode, 'SYNC_REFUSED')
  // ...and recorded, so a screen opened later still says why.
  const recorded = (await invoke(require('../actions/health'), cols)).body.sync
  assert.equal(recorded.state, 'failed')
  assert.equal(recorded.error, 'The connected integration answered 401.')
})
