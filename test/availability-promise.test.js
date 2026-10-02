/*
 * Available-to-promise (lib/availability promiseLine + POST products/availability, AB-19): the
 * ERP answers whether it can promise a quantity and by when — available now ships today, a
 * shortfall after the product's lead time.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importProducts } = require('../lib/products')
const { createOrder } = require('../lib/orders')
const products = require('../actions/products')
const { promiseLine, DEFAULT_LEAD_TIME_DAYS } = require('../lib/availability')

const DAY = new Date('2026-10-02T00:00:00Z')

test('promiseLine promises today when what is available covers the request', () => {
  assert.deepEqual(promiseLine({ sku: 'A1', available: 10, requested: 5, today: DAY }), {
    sku: 'A1', requested: 5, availableNow: 10, canPromiseNow: true, promiseDate: '2026-10-02', leadTimeDays: DEFAULT_LEAD_TIME_DAYS
  })
})

test('promiseLine promises after the lead time when short; a per-product lead time wins over the default', () => {
  const short = promiseLine({ sku: 'A1', available: 2, requested: 5, today: DAY })
  assert.equal(short.canPromiseNow, false)
  assert.equal(short.promiseDate, '2026-10-07')
  assert.equal(promiseLine({ sku: 'A1', available: 2, requested: 5, leadTimeDays: 10, today: DAY }).promiseDate, '2026-10-12')
})

test('promiseLine treats an oversold (negative) available as promising after the lead time', () => {
  assert.equal(promiseLine({ sku: 'A1', available: -3, requested: 1, today: DAY }).canPromiseNow, false)
})

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 100, warehouses: [{ code: 'default', name: 'Default', quantity: 8 }] }])
})

test('POST products/availability answers per line; an open order reduces what is available now; an unknown SKU is flagged', async () => {
  await createOrder(cols, { purchaseOrderByCustomer: '1', partnerId: 'C1', lines: [{ sku: 'A1', qty: 6, price: 100, customerLineReference: '1' }] })
  const res = await invoke(products, cols, { method: 'POST', path: '/availability', body: { lines: [{ sku: 'A1', qty: 2 }, { sku: 'A1', qty: 5 }, { sku: 'GHOST', qty: 1 }] } })
  const lines = res.body.lines
  assert.equal(lines[0].availableNow, 2, 'stock 8 less 6 committed')
  assert.equal(lines[0].canPromiseNow, true)
  assert.equal(lines[1].canPromiseNow, false)
  assert.deepEqual(lines[2], { sku: 'GHOST', unknown: true })
})
