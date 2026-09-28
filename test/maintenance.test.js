/*
 * The maintenance window (AB-16j, owner 2026-09-28): a real ERP's API answers "unavailable"
 * while it is in maintenance, and so does this one. The record routes answer 503 naming when
 * the window ends; health, settings (which starts and ends it) and the screen still answer,
 * so the integration and the ERP's own page can say why. The window ends by itself: an
 * expired one counts as off, with no timer to forget.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { SETTINGS_ID } = require('../lib/settings')
const { maintenanceOf, DEFAULT_MINUTES } = require('../lib/maintenance')
const { serveScreen, KEY_HEADER } = require('../lib/screen')
const health = require('../actions/health')
const settings = require('../actions/settings')
const admin = require('../actions/admin')
const products = require('../actions/products')
const partners = require('../actions/partners')
const pricing = require('../actions/pricing')
const contracts = require('../actions/contracts')
const orders = require('../actions/orders')
const shipments = require('../actions/shipments')
const invoices = require('../actions/invoices')
const events = require('../actions/events')
const retry = require('../actions/events/retry')
const search = require('../actions/search')

const MINUTE = 60 * 1000
const NAME = { ERP_DISPLAY_NAME: 'Contoso ERP' }

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: { projectName: 'Demo', products: [{ sku: 'A1', name: 'Widget', listPrice: 100, warehouses: [{ code: 'default', name: 'Default Source', quantity: 10 }] }], partners: [] }
  })
})

const start = (body) => invoke(settings, cols, { method: 'POST', path: '/maintenance', body, params: NAME })
const end = () => invoke(settings, cols, { method: 'DELETE', path: '/maintenance', params: NAME })

test('starting maintenance opens a 30-minute window by default and answers when it ends', async () => {
  const before = Date.now()
  const res = await start({})
  assert.equal(res.statusCode, 200)
  assert.equal(DEFAULT_MINUTES, 30)
  const until = Date.parse(res.body.maintenance.until)
  assert.ok(until >= before + 30 * MINUTE && until <= Date.now() + 30 * MINUTE)
  assert.match(res.body.maintenance.message, /^Contoso ERP is in maintenance until \d\d:\d\d UTC\.$/)
})

test('a window of any whole number of minutes from 1 to 1440; anything else is refused', async () => {
  const res = await start({ minutes: 5 })
  assert.ok(Date.parse(res.body.maintenance.until) <= Date.now() + 5 * MINUTE)
  for (const minutes of [0, -1, 1441, 2.5, 'soon', null]) {
    const refused = await start({ minutes })
    assert.equal(refused.statusCode, 400, `minutes ${JSON.stringify(minutes)}`)
    assert.match(refused.body.errorMessage, /1 to 1440/)
  }
})

test('starting again restarts the window from now', async () => {
  await start({ minutes: 60 })
  const again = await start({ minutes: 5 })
  assert.ok(Date.parse(again.body.maintenance.until) <= Date.now() + 5 * MINUTE)
})

test('in maintenance every record route answers 503 naming the end, and nothing is written', async () => {
  const { body } = await start({ minutes: 10 })
  const calls = [
    [products], [products, { path: '/A1' }], [partners], [pricing, { method: 'POST', path: '/quote', body: { lines: [{ sku: 'A1', qty: 1 }] } }],
    [contracts, { path: '/in-force' }], [orders, { method: 'POST', body: { commerceOrderId: '9', lines: [{ sku: 'A1', qty: 1, price: 100 }] } }],
    [shipments], [invoices], [events], [retry], [search, { params: { q: 'A1' } }],
    [admin, { method: 'POST', path: '/import', body: { products: [{ sku: 'B2', name: 'New', listPrice: 1 }] } }]
  ]
  for (const [action, options = {}] of calls) {
    const res = await invoke(action, cols, { ...options, params: { ...NAME, ...(options.params || {}) } })
    assert.equal(res.statusCode, 503, `${options.method || 'GET'} ${options.path || ''}`)
    assert.equal(res.body.errorCode, 'ERP_MAINTENANCE')
    assert.equal(res.body.errorMessage, body.maintenance.message)
    assert.equal(res.body.maintenanceUntil, body.maintenance.until)
  }
  assert.equal(await cols.salesOrders.countDocuments({}), 0)
  assert.equal(await cols.products.countDocuments({}), 1)
})

test('in maintenance health, settings and the maintenance route still answer; health says until when', async () => {
  const { body } = await start({})
  const h = await invoke(health, cols, { params: NAME })
  assert.equal(h.statusCode, 200)
  assert.deepEqual(h.body.maintenance, body.maintenance)
  assert.equal((await invoke(settings, cols, { params: NAME })).statusCode, 200)
  assert.equal((await invoke(settings, cols, { method: 'PATCH', body: { timeZone: 'UTC' }, params: NAME })).statusCode, 200)
  const ended = await end()
  assert.equal(ended.statusCode, 200)
  assert.equal(ended.body.maintenance, null)
})

test('ending maintenance opens the record routes again, and health says it is off', async () => {
  await start({})
  await end()
  assert.equal((await invoke(products, cols)).statusCode, 200)
  assert.equal((await invoke(health, cols)).body.maintenance, null)
})

test('a window that has passed counts as off, with nothing to switch back', async () => {
  await start({})
  const stored = await cols.settings.findOne({ _id: SETTINGS_ID })
  await cols.settings.replaceOne({ _id: SETTINGS_ID }, { ...stored, maintenanceUntil: new Date(Date.now() - MINUTE).toISOString() })
  assert.equal((await invoke(products, cols)).statusCode, 200)
  assert.equal((await invoke(health, cols)).body.maintenance, null)
})

test('the end time is told in the ERP\'s own time zone', () => {
  const view = maintenanceOf({ displayName: 'Contoso ERP', timeZone: 'America/New_York', maintenanceUntil: '2026-09-28T18:30:00.000Z' }, new Date('2026-09-28T18:00:00.000Z'))
  assert.equal(view.until, '2026-09-28T18:30:00.000Z')
  assert.equal(view.message, 'Contoso ERP is in maintenance until 14:30 EDT.')
  assert.equal(maintenanceOf({ maintenanceUntil: null }), null)
  assert.equal(maintenanceOf({}), null)
})

test('through the screen: the page and health answer, a record route answers 503', async () => {
  const KEY = 'k3y-for-tests-only'
  const handlers = { health, settings, products }
  const screen = (path, method = 'GET') => serveScreen(
    { ERP_SCREEN_KEY: KEY, ...NAME, __ow_method: method.toLowerCase(), __ow_path: path, __ow_headers: { [KEY_HEADER]: KEY } },
    { assets: { js: '', css: '' }, handlers, collections: async () => cols }
  )
  assert.equal((await screen('/api/settings/maintenance', 'POST')).statusCode, 200)
  assert.equal((await screen('')).statusCode, 200)
  assert.ok((await screen('/api/health')).body.maintenance)
  assert.equal((await screen('/api/products')).statusCode, 503)
  assert.equal((await screen('/api/settings/maintenance', 'DELETE')).statusCode, 200)
  assert.equal((await screen('/api/products')).statusCode, 200)
})
