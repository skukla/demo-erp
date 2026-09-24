/*
 * The product as a master record (screen-realism plan slice 6, §3.7): what is committed
 * to open orders, what is available, and which orders hold it. Nothing here is stored —
 * it is read off the order lines the fulfilment module already keeps.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { importProducts, listProducts, getProduct } = require('../lib/products')
const { ensureDefaultPartner } = require('../lib/partners')
const { createOrder, listOrders } = require('../lib/orders')
const { confirmOrder, cancelOrder, createShipment, postShipment, createInvoice } = require('../lib/fulfilment')
const { committedBySku, openOrdersFor, withAvailability, stockStatus, LOW_STOCK_THRESHOLD } = require('../lib/availability')
const products = require('../actions/products')
const { invoke } = require('./helpers/memory-db')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await ensureDefaultPartner(cols)
  await importProducts(cols, [
    { sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] },
    { sku: 'B2', name: 'Shirt', listPrice: 5, warehouses: [{ code: 'default', name: 'Default Source', quantity: 9 }] },
    { sku: 'P', name: 'Coat', type: 'configurable' },
    { sku: 'P-S', name: 'Coat S', parentSku: 'P', listPrice: 100, warehouses: [{ code: 'default', name: 'Default Source', quantity: 3 }] },
    { sku: 'P-M', name: 'Coat M', parentSku: 'P', listPrice: 100, warehouses: [{ code: 'default', name: 'Default Source', quantity: 4 }] }
  ])
})

const order = (id, lines) => createOrder(cols, { commerceOrderId: id, commerceIncrementId: `0000${id}`, lines })

test('committed is the open quantity on orders that are neither cancelled nor invoiced', async () => {
  await order('1', [{ sku: 'A1', qty: 12, price: 10 }])
  const second = await order('2', [{ sku: 'A1', qty: 5, price: 10 }, { sku: 'B2', qty: 2, price: 5 }])
  const third = await order('3', [{ sku: 'A1', qty: 7, price: 10 }])
  await cancelOrder(cols, third.number, 'Customer request')
  // Shipping part of an order releases what shipped and keeps the rest committed.
  await confirmOrder(cols, second.number)
  await createShipment(cols, second.number, { lines: [{ item: 10, qty: 3 }] })
  await postShipment(cols, second.number, '8000000001')
  const committed = committedBySku(await listOrders(cols))
  assert.equal(committed.get('A1'), 12 + 2)
  assert.equal(committed.get('B2'), 2)
  assert.equal(committed.get('P-S'), undefined)
})

test('an invoiced order commits nothing: what it ordered has shipped or was given up on', async () => {
  const o = await order('1', [{ sku: 'B2', qty: 4, price: 5 }])
  await confirmOrder(cols, o.number)
  await createShipment(cols, o.number, { lines: [{ item: 10, qty: 4 }] })
  await postShipment(cols, o.number, '8000000001')
  await createInvoice(cols, o.number)
  assert.equal(committedBySku(await listOrders(cols)).get('B2'), undefined)
})

test('available is on hand less committed, and may go below zero when over-committed', async () => {
  await order('1', [{ sku: 'B2', qty: 12, price: 5 }])
  const committed = committedBySku(await listOrders(cols))
  const [a1, b2] = (await listProducts(cols)).filter((p) => ['A1', 'B2'].includes(p.sku)).map((p) => withAvailability(p, committed))
  assert.deepEqual({ committed: a1.committed, available: a1.available }, { committed: 0, available: 50 })
  assert.deepEqual({ committed: b2.committed, available: b2.available }, { committed: 12, available: -3 })
})

test('a configurable parent is committed and available across its variants', async () => {
  await order('1', [{ sku: 'P-S', qty: 2, price: 100 }, { sku: 'P-M', qty: 1, price: 100 }])
  const committed = committedBySku(await listOrders(cols))
  const parent = withAvailability(await getProduct(cols, 'P'), committed)
  assert.equal(parent.stock, 7)
  assert.equal(parent.committed, 3)
  assert.equal(parent.available, 4)
  assert.deepEqual(parent.variants.map((v) => [v.sku, v.committed, v.available]), [['P-M', 1, 3], ['P-S', 2, 1]])
})

test('the open orders for a product name each order once with the quantity still open on it', async () => {
  const first = await order('1', [{ sku: 'A1', qty: 12, price: 10 }, { sku: 'A1', qty: 3, price: 10 }])
  const second = await order('2', [{ sku: 'A1', qty: 5, price: 10 }])
  const third = await order('3', [{ sku: 'A1', qty: 7, price: 10 }])
  await cancelOrder(cols, third.number, 'Customer request')
  const open = openOrdersFor(await listOrders(cols), 'A1')
  assert.deepEqual(open.map((o) => [o.number, o.qty]), [[second.number, 5], [first.number, 15]])
  assert.ok(open.every((o) => o.status && o.createdAt))
})

test('stock status has three tints: out at or below zero, low under the threshold, in stock above it', () => {
  assert.equal(stockStatus(0), 'out')
  assert.equal(stockStatus(-2), 'out')
  assert.equal(stockStatus(1), 'low')
  assert.equal(stockStatus(LOW_STOCK_THRESHOLD - 1), 'low')
  assert.equal(stockStatus(LOW_STOCK_THRESHOLD), 'in')
  assert.equal(stockStatus(500), 'in')
})

test('the products action lists committed and available, and a product answers its open orders with the customer named', async () => {
  const o = await order('1', [{ sku: 'A1', qty: 12, price: 10 }])
  const list = await invoke(products, cols, { method: 'GET' })
  const a1 = list.body.items.find((p) => p.sku === 'A1')
  assert.equal(a1.committed, 12)
  assert.equal(a1.available, 38)
  const one = await invoke(products, cols, { method: 'GET', path: 'A1' })
  assert.equal(one.body.available, 38)
  assert.deepEqual(one.body.openOrders.map((x) => [x.number, x.qty, x.customer]), [[o.number, 12, 'Walk-in customers']])
})
