/*
 * Settings → Number series (AB-59), as Business Central's No. Series lines: one row per
 * document type with its starting, next and ending number. The next number moves FORWARD
 * only: a series never rewinds, so a number handed out once is never handed out again, and
 * a lowered number is refused in words. The next document drawn takes the number set.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importProducts } = require('../lib/products')
const { createOrder } = require('../lib/orders')
const settings = require('../actions/settings')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
})

const patch = (numberSeries) => invoke(settings, cols, { method: 'PATCH', path: '/setup', body: { numberSeries } })
const order = (id) => createOrder(cols, { commerceOrderId: id, lines: [{ sku: 'A1', qty: 1, price: 10 }] })

test('one row per document type: starting, next and ending number', async () => {
  const res = await invoke(settings, cols, { path: '/setup' })
  assert.deepEqual(res.body.numberSeries.map((s) => s.type), ['salesOrder', 'shipment', 'invoice', 'contract', 'creditMemo', 'returnOrder', 'payment'])
  assert.deepEqual(res.body.numberSeries.find((s) => s.type === 'invoice'), { type: 'invoice', starting: '9000000001', next: '9000000001', ending: '9500000000' })
  assert.deepEqual(res.body.numberSeries.find((s) => s.type === 'creditMemo'), { type: 'creditMemo', starting: '9500000001', next: '9500000001', ending: '9999999999' })
  assert.deepEqual(res.body.numberSeries.find((s) => s.type === 'salesOrder'), { type: 'salesOrder', starting: '0000001000', next: '0000001000', ending: '4000000000' })
})

test('the next number moves forward, and the next document takes it', async () => {
  await order('1')
  const res = await patch({ salesOrder: { next: '0000005000' } })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.numberSeries.find((s) => s.type === 'salesOrder').next, '0000005000')
  assert.equal((await order('2')).number, '0000005000')
  assert.equal((await order('3')).number, '0000005001')
})

test('the next number as it stands is no change', async () => {
  await order('1')
  const res = await patch({ salesOrder: { next: 1001 } })
  assert.equal(res.statusCode, 200)
  assert.equal((await order('2')).number, '0000001001')
})

test('a series never goes back: a lowered next number is refused in words, and nothing moves', async () => {
  await order('1')
  await order('2')
  const res = await patch({ salesOrder: { next: 1001 }, invoice: { next: 9000000100 } })
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.errorMessage, 'A number series never goes back: the next sales order number is 0000001002. Enter 0000001002 or higher.')
  const after = await invoke(settings, cols, { path: '/setup' })
  assert.equal(after.body.numberSeries.find((s) => s.type === 'invoice').next, '9000000001', 'the invoice series in the same patch did not move')
})

test('a number past the series\' end, or not a number, or not a series, is refused', async () => {
  const refusals = [
    [{ invoice: { next: 9500000001 } }, 'Invoice numbers end at 9500000000.'],
    [{ invoice: { next: 'soon' } }, 'The next invoice number must be a whole number.'],
    [{ quote: { next: 1 } }, 'quote is not a number series of this ERP.']
  ]
  for (const [body, message] of refusals) {
    const res = await patch(body)
    assert.equal(res.statusCode, 400, JSON.stringify(body))
    assert.equal(res.body.errorMessage, message)
  }
})
