/*
 * The Discount column and total on a document's lines (screen/src/components/lineDiscount.js):
 * shown only when a line carries a discount (contract version 17), the way the Tax row is
 * shown only when there is tax, so a document with no promotion on it reads as it did.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

const load = () => import('../screen/src/components/lineDiscount.js')

const COLUMNS = [{ key: 'qty' }, { key: 'price' }, { key: 'amount' }]

test('no line with a discount: the columns are the ones given, and the total is 0', async () => {
  const { withDiscountColumn, discountTotal } = await load()
  const lines = [{ qty: 1, price: 5, discount: 0 }, { qty: 1, price: 5 }]
  assert.equal(withDiscountColumn(COLUMNS, lines), COLUMNS)
  assert.equal(discountTotal(lines), 0)
  assert.equal(discountTotal(undefined), 0)
})

test('a line with a discount: a Discount column sits before the net amount, and the total is the lines\' discounts to the cent', async () => {
  const { withDiscountColumn, discountTotal } = await load()
  const lines = [{ qty: 3, price: 20, discount: 3.33 }, { qty: 1, price: 5, discount: 0 }, { qty: 1, price: 5, discount: 3.34 }]
  const columns = withDiscountColumn(COLUMNS, lines)
  assert.deepEqual(columns.map((c) => c.key), ['qty', 'price', 'discount', 'amount'])
  assert.deepEqual(columns[2], { key: 'discount', label: 'Discount', width: 106, align: 'end', holds: 'amount' })
  assert.equal(discountTotal(lines), 6.67)
})
