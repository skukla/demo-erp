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
const { DEFAULT_APPEARANCE } = require('../lib/appearance')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: {
      projectName: 'Demo',
      products: [{ sku: 'A1', name: 'Widget', listPrice: 100, warehouses: [{ code: 'default', name: 'Default Source', quantity: 10 }] }, { sku: 'B2', name: 'Gadget', listPrice: 50, warehouses: [{ code: 'default', name: 'Default Source', quantity: 0 }] }],
      partners: [{ id: 'P1', name: 'Acme', commerceCompanyId: '7' }]
    }
  })
})

test('health reports the name and the counts', async () => {
  const res = await invoke(health, cols, { params: { ERP_DISPLAY_NAME: 'Contoso ERP' } })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.displayName, 'Contoso ERP')
  assert.equal(res.body.counts.products, 2)
  assert.equal(res.body.counts.businessPartners, 2)
  assert.ok(res.body.lastImportAt)
})

test('health carries the work list Home and the rail draw: cue counts, open order value, recent documents', async () => {
  await invoke(orders, cols, { method: 'POST', body: { commerceOrderId: '9', partnerId: 'P1', lines: [{ sku: 'A1', qty: 2, price: 100 }] } })
  const res = await invoke(health, cols)
  assert.equal(res.body.work.counts.toConfirm, 1)
  assert.equal(res.body.work.counts.toShip, 0)
  assert.deepEqual(res.body.work.openValue, { amount: 200, currency: 'USD' })
  assert.equal(res.body.work.recent[0].kind, 'order')
})

test('health carries the appearance, so the shell bar paints dressed on first render', async () => {
  // The screen already fetches health on load. Putting the look here rather than behind
  // a second request is what stops the default teal flashing before the SC's palette.
  const res = await invoke(health, cols, { params: { ERP_DISPLAY_NAME: 'Contoso ERP' } })
  assert.deepEqual(res.body.appearance, DEFAULT_APPEARANCE)

  await invoke(settings, cols, { method: 'PATCH', body: { appearance: { theme: 'meridian' } } })
  const dressed = await invoke(health, cols)
  assert.equal(dressed.body.appearance.palette, 'indigo')
  assert.equal(dressed.body.appearance.nav, 'top')
})

test('settings takes an appearance, and answers the one it stored', async () => {
  const res = await invoke(settings, cols, { method: 'PATCH', body: { appearance: { palette: 'plum', nav: 'top' } } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.appearance, { palette: 'plum', logo: DEFAULT_APPEARANCE.logo, nav: 'top' })
})

test('products list, read, patch and 404', async () => {
  assert.equal((await invoke(products, cols)).body.items.length, 2)
  assert.equal((await invoke(products, cols, { path: '/A1' })).body.name, 'Widget')
  const patched = await invoke(products, cols, { method: 'PATCH', path: '/A1', body: { warehouses: [{ code: 'default', quantity: 3 }] } })
  assert.equal(patched.body.stock, 3)
  assert.equal((await invoke(products, cols, { path: '/ZZ' })).statusCode, 404)
  assert.equal((await invoke(products, cols, { method: 'PATCH', path: '/A1', body: { warehouses: [{ code: 'default', quantity: -1 }] } })).statusCode, 400)
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
  // A quote may name the date it prices on; the answer says why a record did not apply.
  await invoke(pricing, cols, { method: 'POST', body: { kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 50, validFrom: '2027-01-01' } })
  const future = await invoke(pricing, cols, { method: 'POST', path: '/quote', body: { partnerId: 'P1', date: '2026-09-24', lines: [{ sku: 'A1', qty: 2 }] } })
  assert.equal(future.body.lines[0].contractPrice, 80)
  assert.equal(future.body.lines[0].notApplied[0].reason, 'not valid until 1 Jan 2027')
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

test('settings takes the appearance and ignores anything else sent with it', async () => {
  // The "offline" switch was removed on 2026-09-17; a stale client still sending
  // it must not resurrect a field, and must not fail either.
  const res = await invoke(settings, cols, { method: 'PATCH', body: { appearance: { logo: 'orbit' }, offline: true } })

  assert.equal(res.body.appearance.logo, 'orbit')
  assert.equal('offline' in res.body, false)
  assert.equal((await invoke(products, cols)).statusCode, 200)
})

test('an unknown route is a 404, a bad import is a 400', async () => {
  // PUT is no route of products (PATCH edits, DELETE removes).
  assert.equal((await invoke(products, cols, { method: 'PUT', path: '/A1' })).statusCode, 404)
  assert.equal((await invoke(admin, cols, { method: 'POST', path: '/import', body: {} })).statusCode, 400)
})

test('the journal answers each entry with its sentence, so the screen names documents rather than JSON', async () => {
  await invoke(orders, cols, { method: 'POST', body: { commerceOrderId: '9', commerceIncrementId: '000000009', partnerId: 'P1', lines: [{ sku: 'A1', qty: 1, price: 100 }] } })
  await invoke(orders, cols, { method: 'POST', path: '/0000001000/confirm' })
  const res = await invoke(events, cols)
  const confirmed = res.body.items.find((e) => e.kind === 'order.confirmed')
  assert.equal(confirmed.describe.name, 'Order confirmed')
  assert.equal(confirmed.describe.text, 'Sales order 0000001000 confirmed (customer reference 000000009)')
})

test('events are delivered to the ingestion webhook with the journal id, and retried when pending', async () => {
  const calls = []
  const realFetch = global.fetch
  global.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: calls.length > 1, status: calls.length > 1 ? 200 : 503, text: async () => 'busy' } }
  try {
    const params = { EVENTS_WEBHOOK_URL: 'https://example.test/api/v1/web/ingestion/webhook' }
    await invoke(products, cols, { method: 'PATCH', path: '/A1', body: { warehouses: [{ code: 'default', quantity: 1 }] }, params })
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
    await invoke(products, cols, { method: 'PATCH', path: '/A1', body: { warehouses: [{ code: 'default', quantity: 2 }] }, params })
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

test('only an import with products moves the last-import time; the partner refresh does not', async () => {
  const before = (await invoke(health, cols)).body.lastImportAt
  await new Promise((resolve) => setTimeout(resolve, 5))

  await invoke(admin, cols, { method: 'POST', path: '/import', body: { partners: [{ id: 'P2', name: 'Beta', commerceCompanyId: '8' }] } })
  assert.equal((await invoke(health, cols)).body.lastImportAt, before)

  await invoke(admin, cols, { method: 'POST', path: '/import', body: { products: [], partners: [] } })
  assert.notEqual((await invoke(health, cols)).body.lastImportAt, before)
})

test('health answers the document numbering (the next numbers, nothing reserved) and the currency money falls back to', async () => {
  const before = await invoke(health, cols)
  assert.deepEqual(before.body.numbering, { salesOrder: '0000001000', shipment: '8000000001', invoice: '9000000001' })
  // No mirror has named a website for the company code yet: no currency of the ERP's own.
  assert.equal(before.body.currency, null)
  await invoke(admin, cols, { method: 'POST', path: 'import', body: { products: [], partners: [], structure: { websites: [{ code: 'base', name: 'Main', salesOrg: '1000', salesOrgName: null, storeInfo: { currency: 'EUR', countryId: 'DE', vatNumber: null, address: null } }] } } })
  const after = await invoke(health, cols)
  assert.equal(after.body.currency, 'EUR')
  assert.deepEqual(after.body.numbering, before.body.numbering)
})

test('orders: the list filters by the customer reference, as a real ERP API does', async () => {
  await invoke(orders, cols, { method: 'POST', body: { commerceOrderId: '9', commerceIncrementId: '000000009', partnerId: 'P1', lines: [{ sku: 'A1', qty: 1, price: 100 }] } })
  await invoke(orders, cols, { method: 'POST', body: { commerceOrderId: '10', commerceIncrementId: '000000010', partnerId: 'P1', lines: [{ sku: 'A1', qty: 1, price: 100 }] } })
  const one = await invoke(orders, cols, { params: { reference: '000000010' } })
  assert.equal(one.body.items.length, 1)
  assert.equal(one.body.items[0].commerceIncrementId, '000000010')
  const none = await invoke(orders, cols, { params: { reference: 'nope' } })
  assert.deepEqual(none.body.items, [])
  const all = await invoke(orders, cols, {})
  assert.equal(all.body.items.length, 2)
})
