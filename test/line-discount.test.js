/*
 * A line's discount (contract version 17, AB-16l): the amount the customer's web shop took
 * off one order line, a promotion there. The ERP does not reprice a web order; it keeps the
 * discount on the line, so the line's net amount is quantity × price − discount, the order's
 * net is the sum of those, and the invoice, a return and every credit memo carry the
 * discount through in proportion to the quantity they cover.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder, describeOrder, getOrder, setStatus } = require('../lib/orders')
const { importProducts } = require('../lib/products')
const { importPartners, exposureOf } = require('../lib/partners')
const { createReturn, receiveReturn, creditReturn } = require('../lib/returns')
const { creditInvoice } = require('../lib/credit-memos')
const { pending } = require('../lib/events')
const ordersAction = require('../actions/orders')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [
    { sku: 'A1', name: 'Trouser', listPrice: 20, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] },
    { sku: 'B2', name: 'Shirt', listPrice: 5, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }
  ])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', creditLimit: 1000 }])
})

/** 3 × 20 less 10, and 2 × 5 with no discount: net 60. The shop charged 64.95 (4.95 tax). */
const discounted = (extra = {}) => createOrder(cols, {
  purchaseOrderByCustomer: '000000077',
  partnerId: 'C1',
  total: 64.95,
  lines: [
    { sku: 'A1', qty: 3, price: 20, discount: 10, customerLineReference: '1' },
    { sku: 'B2', qty: 2, price: 5, customerLineReference: '2' }
  ],
  ...extra
})

const invoiced = async () => {
  const order = await discounted()
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, order.number, status)
  return getOrder(cols, order.number)
}

test('an order line keeps its discount; its net amount is quantity × price − discount, and the order adds up', async () => {
  const order = await discounted()
  assert.deepEqual(order.lines.map((l) => l.discount), [10, 0])
  const document = await describeOrder(cols, order)
  assert.deepEqual(document.lines.map((l) => [l.price, l.discount, l.amount]), [[20, 10, 50], [5, 0, 10]])
  assert.equal(document.net, 60)
  assert.equal(document.total, 64.95)
  assert.equal(document.tax, 4.95)
})

test('an order sent with no total is worth its net, discount taken off', async () => {
  const order = await discounted({ total: undefined })
  assert.equal(order.total, 60)
})

test('a discount that is not an amount from 0 to the line\'s quantity × price is refused in words', async () => {
  const send = (discount) => invoke(ordersAction, cols, { method: 'POST', body: { purchaseOrderByCustomer: '78', lines: [{ sku: 'A1', qty: 3, price: 20, discount }] } })
  for (const bad of [-1, 60.01, 'ten']) {
    const res = await send(bad)
    assert.equal(res.statusCode, 400, String(bad))
    assert.match(res.body.errorMessage, /Line 1: the discount must be an amount from 0 to 60/)
  }
  assert.equal((await send(60)).statusCode, 201)
})

test('an order stored before version 17 reads with no discount on its lines', async () => {
  const order = await discounted()
  const stored = await cols.salesOrders.findOne({ _id: order.number })
  await cols.salesOrders.replaceOne({ _id: order.number }, { ...stored, lines: stored.lines.map(({ discount, ...rest }) => rest) }, { upsert: true })
  const read = await describeOrder(cols, await cols.salesOrders.findOne({ _id: order.number }))
  assert.deepEqual(read.lines.map((l) => [l.discount, l.amount]), [[0, 60], [0, 10]])
})

test('a customer\'s exposure counts an open order at its net, discount taken off', async () => {
  await discounted()
  assert.equal(await exposureOf(cols, 'C1'), 60)
})

test('the invoice carries each line\'s discount, bills the net, and says so in its event', async () => {
  const order = await invoiced()
  assert.deepEqual(order.invoice.lines.map((l) => [l.item, l.qty, l.price, l.discount, l.amount]), [[10, 3, 20, 10, 50], [20, 2, 5, 0, 10]])
  assert.equal(order.invoice.net, 60)
  assert.equal(order.invoice.tax, 4.95)
  assert.equal(order.invoice.total, 64.95)
  const event = (await pending(cols)).find((e) => e.type === 'BillingDocument.Created')
  assert.equal(event.data.TotalNetAmount, 60)
  assert.equal(event.data.TotalGrossAmount, 64.95)
})

test('an invoice credited in whole credits the discounted net, never the list amount', async () => {
  const order = await invoiced()
  const credited = await creditInvoice(cols, order.number)
  const [memo] = credited.creditMemos
  assert.deepEqual(memo.lines.map((l) => [l.qty, l.price, l.discount, l.amount]), [[3, 20, 10, 50], [2, 5, 0, 10]])
  assert.equal(memo.net, 60)
  assert.equal(memo.tax, 4.95)
  assert.equal(memo.total, 64.95)
})

test('returns take the discount in proportion to the quantity, and to the cent: three returns of one credit exactly the line\'s net', async () => {
  const order = await invoiced()
  const memos = []
  for (const reference of ['R1', 'R2', 'R3']) {
    const { returnOrder } = await createReturn(cols, { customerReturnReference: reference, orderNumber: order.number, lines: [{ customerLineReference: '1', qty: 1 }] })
    await receiveReturn(cols, returnOrder.number)
    memos.push((await creditReturn(cols, returnOrder.number)).creditMemo)
  }
  // 10 over 3 units: 3.33, then 6.67 so far, then 10 so far.
  assert.deepEqual(memos.map((m) => m.lines[0].discount), [3.33, 3.34, 3.33])
  assert.deepEqual(memos.map((m) => m.lines[0].amount), [16.67, 16.66, 16.67])
  assert.deepEqual(memos.map((m) => m.net), [16.67, 16.66, 16.67])
  assert.equal(Math.round(memos.reduce((sum, m) => sum + m.net, 0) * 100) / 100, 50)
})

test('a return of two of three units takes two thirds of the discount; an undiscounted line returns at its price', async () => {
  const order = await invoiced()
  const { returnOrder } = await createReturn(cols, { customerReturnReference: 'R9', orderNumber: order.number, lines: [{ customerLineReference: '1', qty: 2 }, { customerLineReference: '2', qty: 1 }] })
  assert.deepEqual(returnOrder.lines.map((l) => [l.qty, l.price, l.discount]), [[2, 20, 6.67], [1, 5, 0]])
  await receiveReturn(cols, returnOrder.number)
  const { creditMemo } = await creditReturn(cols, returnOrder.number)
  assert.deepEqual(creditMemo.lines.map((l) => l.amount), [33.33, 5])
  assert.equal(creditMemo.net, 38.33)
  // The invoice's tax (4.95 on a net of 60) in proportion to the net credited.
  assert.equal(creditMemo.tax, 3.16)
  assert.equal(creditMemo.total, 41.49)
})
