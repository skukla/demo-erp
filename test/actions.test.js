const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const health = require('../actions/health')
const settings = require('../actions/settings')
const admin = require('../actions/admin')
const products = require('../actions/products')
const partners = require('../actions/partners')
const pricing = require('../actions/pricing')
const orders = require('../actions/orders')
const events = require('../actions/events')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: {
      projectName: 'Demo',
      products: [{ sku: 'A1', name: 'Widget', listPrice: 100, stock: 10 }, { sku: 'B2', name: 'Gadget', listPrice: 50, stock: 0 }],
      partners: [{ id: 'P1', name: 'Acme', commerceCompanyId: '7' }]
    }
  })
})

test('health reports the name, the offline flag and the counts', async () => {
  const res = await invoke(health, cols, { params: { ERP_DISPLAY_NAME: 'Contoso ERP' } })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.displayName, 'Contoso ERP')
  assert.equal(res.body.counts.products, 2)
  assert.equal(res.body.counts.businessPartners, 2)
  assert.ok(res.body.lastImportAt)
})

test('products list, read, patch and 404', async () => {
  assert.equal((await invoke(products, cols)).body.items.length, 2)
  assert.equal((await invoke(products, cols, { path: '/A1' })).body.name, 'Widget')
  const patched = await invoke(products, cols, { method: 'PATCH', path: '/A1', body: { stock: 3 } })
  assert.equal(patched.body.stock, 3)
  assert.equal((await invoke(products, cols, { path: '/ZZ' })).statusCode, 404)
  assert.equal((await invoke(products, cols, { method: 'PATCH', path: '/A1', body: { stock: -1 } })).statusCode, 400)
})

test('partners list and patch', async () => {
  assert.equal((await invoke(partners, cols)).body.items.length, 2)
  const res = await invoke(partners, cols, { method: 'PATCH', path: '/P1', body: { creditLimit: 500 } })
  assert.equal(res.body.creditLimit, 500)
})

test('pricing: a condition then a quote resolved by Commerce company', async () => {
  const created = await invoke(pricing, cols, { method: 'POST', body: { kind: 'contractDiscount', partnerId: 'P1', percent: 20 } })
  assert.equal(created.statusCode, 201)
  const q = await invoke(pricing, cols, { method: 'POST', path: '/quote', body: { commerceCompanyId: 7, lines: [{ sku: 'A1', qty: 2 }] } })
  assert.equal(q.body.partnerId, 'P1')
  assert.equal(q.body.lines[0].contractPrice, 80)
  assert.equal(q.body.total, 160)
  const walkIn = await invoke(pricing, cols, { method: 'POST', path: '/quote', body: { lines: [{ sku: 'A1', qty: 1 }] } })
  assert.equal(walkIn.body.partnerId, 'P000000')
  assert.equal(walkIn.body.total, 100)
  assert.equal((await invoke(pricing, cols, { method: 'POST', path: '/quote', body: {} })).statusCode, 400)
})

test('orders: create is 201 then 200 for the same Commerce order; status moves publish events', async () => {
  const body = { commerceOrderId: '42', partnerId: 'P1', lines: [{ sku: 'A1', qty: 1, price: 80 }] }
  const first = await invoke(orders, cols, { method: 'POST', body })
  assert.equal(first.statusCode, 201)
  const again = await invoke(orders, cols, { method: 'POST', body })
  assert.equal(again.statusCode, 200)
  assert.equal(again.body.number, first.body.number)
  const moved = await invoke(orders, cols, { method: 'POST', path: `/${first.body.number}/status`, body: { status: 'confirmed' } })
  assert.equal(moved.body.status, 'confirmed')
  assert.deepEqual(moved.body.nextStatuses, ['shipped', 'cancelled'])
  const log = await invoke(events, cols)
  assert.equal(log.body.items.length, 1)
  assert.equal(log.body.pending, 1)
})

test('offline: record routes answer 503, health/settings/admin still work, wipe is honoured', async () => {
  const off = await invoke(settings, cols, { method: 'PATCH', body: { offline: true } })
  assert.equal(off.body.offline, true)
  assert.equal((await invoke(products, cols)).statusCode, 503)
  assert.equal((await invoke(orders, cols, { method: 'POST', body: { commerceOrderId: '1' } })).statusCode, 503)
  assert.equal((await invoke(health, cols)).body.offline, true)
  const wiped = await invoke(admin, cols, { method: 'POST', path: '/wipe' })
  assert.equal(wiped.body.wiped.products, 2)
  await invoke(settings, cols, { method: 'PATCH', body: { offline: false } })
  assert.equal((await invoke(products, cols)).statusCode, 200)
})

test('an unknown route is a 404, a bad import is a 400', async () => {
  assert.equal((await invoke(products, cols, { method: 'DELETE', path: '/A1' })).statusCode, 404)
  assert.equal((await invoke(admin, cols, { method: 'POST', path: '/import', body: {} })).statusCode, 400)
})

test('events are delivered to the ingestion webhook with the journal id, and retried when pending', async () => {
  const calls = []
  const realFetch = global.fetch
  global.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: calls.length > 1, status: calls.length > 1 ? 200 : 503, text: async () => 'busy' } }
  try {
    const params = { EVENTS_WEBHOOK_URL: 'https://example.test/api/v1/web/ingestion/webhook' }
    await invoke(products, cols, { method: 'PATCH', path: '/A1', body: { stock: 1 }, params })
    let log = await invoke(events, cols, { params })
    assert.equal(log.body.pending, 1)
    assert.equal(log.body.items[0].lastError, 'busy')
    assert.equal(calls[0].url, params.EVENTS_WEBHOOK_URL)
    assert.equal(calls[0].body.data.event, 'be-observer.catalog_stock_update')
    assert.equal(calls[0].body.data.uid, log.body.items[0]._id)
    assert.equal(calls[0].auth, undefined)
    const retried = await invoke(events, cols, { method: 'POST', path: '/retry', params })
    assert.deepEqual(retried.body, { delivered: 1, pending: 0 })
    log = await invoke(events, cols, { params })
    assert.equal(log.body.items[0].delivered, true)
  } finally {
    global.fetch = realFetch
  }
})

test('an event that keeps failing is marked failed after ten attempts, leaves the queue, and can be requeued', async () => {
  const realFetch = global.fetch
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'down' })
  try {
    const params = { EVENTS_WEBHOOK_URL: 'https://example.test/api/v1/web/ingestion/webhook' }
    await invoke(products, cols, { method: 'PATCH', path: '/A1', body: { stock: 2 }, params })
    for (let i = 0; i < 9; i += 1) await invoke(events, cols, { method: 'POST', path: '/retry', params })
    let log = await invoke(events, cols, { params })
    assert.equal(log.body.pending, 0)
    assert.equal(log.body.failed, 1)
    assert.equal(log.body.items[0].attempts, 10)
    const retried = await invoke(events, cols, { method: 'POST', path: '/retry', params })
    assert.deepEqual(retried.body, { delivered: 0, pending: 0 })
    const requeued = await invoke(events, cols, { method: 'POST', path: '/requeue', params })
    assert.deepEqual(requeued.body, { requeued: 1 })
    log = await invoke(events, cols, { params })
    assert.equal(log.body.pending, 1)
    assert.equal(log.body.items[0].attempts, 0)
  } finally {
    global.fetch = realFetch
  }
})
