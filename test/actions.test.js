const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const health = require('../actions/health')
const settings = require('../actions/settings')
const admin = require('../actions/admin')
const materials = require('../actions/materials')
const partners = require('../actions/partners')
const pricing = require('../actions/pricing')
const orders = require('../actions/orders')
const outbox = require('../actions/outbox')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: {
      projectName: 'Demo',
      materials: [{ sku: 'A1', name: 'Widget', listPrice: 100, stock: 10 }, { sku: 'B2', name: 'Gadget', listPrice: 50, stock: 0 }],
      partners: [{ id: 'P1', name: 'Acme', commerceCompanyId: '7' }]
    }
  })
})

test('health reports the name, the offline flag and the counts', async () => {
  const res = await invoke(health, cols, { params: { ERP_DISPLAY_NAME: 'Contoso ERP' } })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.displayName, 'Contoso ERP')
  assert.equal(res.body.counts.materials, 2)
  assert.equal(res.body.counts.businessPartners, 2)
  assert.ok(res.body.lastImportAt)
})

test('materials list, read, patch and 404', async () => {
  assert.equal((await invoke(materials, cols)).body.items.length, 2)
  assert.equal((await invoke(materials, cols, { path: '/A1' })).body.name, 'Widget')
  const patched = await invoke(materials, cols, { method: 'PATCH', path: '/A1', body: { stock: 3 } })
  assert.equal(patched.body.stock, 3)
  assert.equal((await invoke(materials, cols, { path: '/ZZ' })).statusCode, 404)
  assert.equal((await invoke(materials, cols, { method: 'PATCH', path: '/A1', body: { stock: -1 } })).statusCode, 400)
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

test('orders: create is 201 then 200 for the same Commerce order; status moves feed the outbox', async () => {
  const body = { commerceOrderId: '42', partnerId: 'P1', lines: [{ sku: 'A1', qty: 1, price: 80 }] }
  const first = await invoke(orders, cols, { method: 'POST', body })
  assert.equal(first.statusCode, 201)
  const again = await invoke(orders, cols, { method: 'POST', body })
  assert.equal(again.statusCode, 200)
  assert.equal(again.body.number, first.body.number)
  const moved = await invoke(orders, cols, { method: 'POST', path: `/${first.body.number}/status`, body: { status: 'confirmed' } })
  assert.equal(moved.body.status, 'confirmed')
  assert.deepEqual(moved.body.nextStatuses, ['shipped', 'cancelled'])
  const box = await invoke(outbox, cols)
  assert.equal(box.body.items.length, 1)
  const acked = await invoke(outbox, cols, { method: 'POST', path: '/ack', body: { ids: [box.body.items[0]._id] } })
  assert.equal(acked.body.acked, 1)
})

test('offline: record routes answer 503, health/settings/admin still work, wipe is honoured', async () => {
  const off = await invoke(settings, cols, { method: 'PATCH', body: { offline: true } })
  assert.equal(off.body.offline, true)
  assert.equal((await invoke(materials, cols)).statusCode, 503)
  assert.equal((await invoke(orders, cols, { method: 'POST', body: { commerceOrderId: '1' } })).statusCode, 503)
  assert.equal((await invoke(health, cols)).body.offline, true)
  const wiped = await invoke(admin, cols, { method: 'POST', path: '/wipe' })
  assert.equal(wiped.body.wiped.materials, 2)
  await invoke(settings, cols, { method: 'PATCH', body: { offline: false } })
  assert.equal((await invoke(materials, cols)).statusCode, 200)
})

test('an unknown route is a 404, a bad import is a 400', async () => {
  assert.equal((await invoke(materials, cols, { method: 'DELETE', path: '/A1' })).statusCode, 404)
  assert.equal((await invoke(admin, cols, { method: 'POST', path: '/import', body: {} })).statusCode, 400)
})
