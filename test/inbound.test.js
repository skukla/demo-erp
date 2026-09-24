/*
 * What arrives from Commerce: a stock number lands on the right warehouse, and every
 * write a Commerce event brings is journaled, so the Events log shows both directions.
 *
 * Found live 2026-09-18: a product renamed in Commerce reached the ERP two minutes later
 * and left no trace on the Events page, and a stock change never reached it at all — the
 * integration sent `{ sku, stock }` and the import read only `warehouses`.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importProducts, getProduct } = require('../lib/products')
const { pending, recent } = require('../lib/events')
const { recordSync } = require('../lib/sync-status')
const admin = require('../actions/admin')
const orders = require('../actions/orders')
const health = require('../actions/health')

const PRODUCT_EVENT = 'observer.catalog_product_save_commit_after'
const STOCK_EVENT = 'observer.cataloginventory_stock_item_save_commit_after'
const ORDER_EVENT = 'observer.sales_order_save_commit_after'

let cols
beforeEach(() => { cols = memoryCollections() })

function warehouses (...list) {
  return list.map(([code, quantity]) => ({ code, name: code, quantity }))
}

test("Commerce's stock number lands on the default warehouse and nowhere else", async () => {
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', warehouses: warehouses(['default', 5], ['east', 3]) }])

  const result = await importProducts(cols, [{ sku: 'A1', stock: 12 }])

  assert.deepEqual(result, { created: 0, updated: 1 })
  const product = await getProduct(cols, 'A1')
  assert.deepEqual(product.warehouses.map((w) => [w.code, w.quantity]), [['default', 12], ['east', 3]])
})

test('a product stocked only in other sources keeps them, and the import says the stock was not applied', async () => {
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', warehouses: warehouses(['east', 3]) }])

  const result = await importProducts(cols, [{ sku: 'A1', stock: 12 }])

  assert.deepEqual(result, { created: 0, updated: 1, stockNotApplied: ['A1'] })
  const product = await getProduct(cols, 'A1')
  assert.deepEqual(product.warehouses.map((w) => [w.code, w.quantity]), [['east', 3]])
})

test('a product with no warehouses yet gets the default one', async () => {
  await importProducts(cols, [{ sku: 'A1', stock: 7 }])

  const product = await getProduct(cols, 'A1')
  assert.deepEqual(product.warehouses.map((w) => [w.code, w.quantity]), [['default', 7]])
})

test('an import a Commerce event brought is journaled once, in words', async () => {
  await importProducts(cols, [{ sku: 'DW1', name: 'DigiWrist Explorer' }])

  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: { products: [{ sku: 'DW1', name: 'DigiWrist ExplorerTest', listPrice: 199 }], origin: { event: PRODUCT_EVENT } },
  })

  const [entry] = await recent(cols)
  assert.equal(entry.direction, 'in')
  assert.equal(entry.event, PRODUCT_EVENT)
  assert.equal(entry.summary, 'Product DW1 updated: name "DigiWrist ExplorerTest", price 199')
  assert.deepEqual(entry.value, { skus: ['DW1'], partners: [] })
})

test('a stock event that could not land says so in the journal', async () => {
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', warehouses: warehouses(['east', 3]) }])

  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: { products: [{ sku: 'A1', stock: 12 }], origin: { event: STOCK_EVENT } },
  })

  const [entry] = await recent(cols)
  assert.equal(entry.summary, 'Product A1 updated: stock 12 not applied (it is not stocked in the default source)')
})

test('a sync batch carries no origin and is not journaled row by row', async () => {
  await invoke(admin, cols, { method: 'POST', path: '/import', body: { products: [{ sku: 'A1' }, { sku: 'A2' }] } })

  assert.deepEqual(await recent(cols), [])
})

test('a finished sync is journaled once, not on every report', async () => {
  await recordSync(cols, { state: 'requested' })
  await recordSync(cols, { state: 'running', phase: 'products', products: { done: 0, total: 182 } })
  await recordSync(cols, { state: 'done', products: { done: 182, total: 182 }, partners: { done: 4, total: 4 } })
  await recordSync(cols, { state: 'done', products: { done: 182, total: 182 }, partners: { done: 4, total: 4 } })

  const entries = await recent(cols)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].summary, 'Synced 182 products and 4 customers')
})

test('a Commerce order is journaled the first time, and a redelivery is not', async () => {
  const body = { commerceOrderId: '42', commerceIncrementId: '000000042', lines: [], origin: { event: ORDER_EVENT } }

  const first = await invoke(orders, cols, { method: 'POST', body })
  await invoke(orders, cols, { method: 'POST', body })

  const entries = await recent(cols)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].summary, `Commerce order 000000042 received as sales order ${first.body.number}`)
})

test('incoming entries never join the retry queue, and Home counts only what is waiting', async () => {
  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: { products: [{ sku: 'A1', name: 'Widget' }], origin: { event: PRODUCT_EVENT } },
  })

  assert.deepEqual(await pending(cols), [])
  const res = await invoke(health, cols)
  assert.equal(res.body.eventsPending, 0)
  assert.equal(res.body.counts.events, 1)
})

test("the delivered event's own id is kept, so the row can be found in I/O Events", async () => {
  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: {
      products: [{ sku: 'A1', name: 'Widget' }],
      origin: { event: PRODUCT_EVENT, eventId: 'ca67f792-f56e-45f3-ba7c-7c97302bcc00' },
    },
  })

  const [entry] = await recent(cols)
  assert.equal(entry.eventId, 'ca67f792-f56e-45f3-ba7c-7c97302bcc00')
})

test('an origin without an id is journaled without one, rather than failing', async () => {
  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: { products: [{ sku: 'A1', name: 'Widget' }], origin: { event: PRODUCT_EVENT } },
  })

  const [entry] = await recent(cols)
  assert.equal('eventId' in entry, false)
})

test('a stock-only import moves quantities on products the ERP has, reports the SKUs it does not, leaves the last-import time alone, and is journaled per SKU', async () => {
  await invoke(admin, cols, { method: 'POST', path: '/import', body: { products: [{ sku: 'A1', name: 'Widget', listPrice: 9, warehouses: warehouses(['default', 5], ['east', 3]) }] } })
  const before = (await invoke(health, cols)).body.lastImportAt
  assert.ok(before, 'the products import stamped the last-import time')

  const res = await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: { stock: [{ sku: 'A1', warehouses: warehouses(['default', 5], ['east', 12]) }, { sku: 'ZZ', warehouses: warehouses(['default', 1]) }], origin: { event: 'inventory source items, read every minute' } }
  })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.stock, { updated: 1, unknown: ['ZZ'] })
  const product = await getProduct(cols, 'A1')
  assert.deepEqual(product.warehouses.map((w) => [w.code, w.quantity]), [['default', 5], ['east', 12]])
  assert.equal(product.name, 'Widget')
  assert.equal(product.listPrice, 9)
  assert.equal((await invoke(health, cols)).body.lastImportAt, before, 'a stock refresh is not a full import')
  assert.equal(await cols.products.countDocuments({}), 1, 'the unknown SKU was not created')
  const [entry] = await recent(cols)
  assert.equal(entry.direction, 'in')
  assert.equal(entry.summary, 'Stock of A1: default 5, east 12. Stock of ZZ not applied (the ERP has no such product)')
})
