/*
 * Prices in force: what customer price lists price for a customer on a day, worked out from
 * the lists alone (lib/contract-prices, pure). Business Central's shape: a list applies to one
 * customer or to one customer price group; a Draft or Inactive list prices nothing; an Active
 * one prices only inside its own dates AND each line's dates. SAP's access sequence decides
 * between them: the customer's own list first, then its price group's.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isInForce, lineInForce, pricesInForce, partnerPricesInForce } = require('../lib/contract-prices')

const ON = '2026-09-28'
const P1 = { id: 'P1', priceGroup: null }
const line = (extra) => ({ sku: 'A1', kind: 'price', price: 80, minQty: 1, startingDate: null, endingDate: null, ...extra })
const list = (extra) => ({
  number: '4000000001',
  appliesTo: 'customer',
  partnerId: 'P1',
  priceGroup: null,
  status: 'active',
  startingDate: '2026-01-01',
  endingDate: null,
  lines: [line()],
  ...extra
})
const groupList = (extra) => list({ number: '4000000009', appliesTo: 'priceGroup', partnerId: null, priceGroup: 'RETAIL', ...extra })

test('only an active list inside its dates is in force', () => {
  assert.equal(isInForce(list(), ON), true)
  assert.equal(isInForce(list({ status: 'draft' }), ON), false)
  assert.equal(isInForce(list({ status: 'inactive' }), ON), false)
  assert.equal(isInForce(list({ startingDate: '2026-10-01' }), ON), false)
  assert.equal(isInForce(list({ endingDate: '2026-09-27' }), ON), false)
  // Both ends count as inside, as Business Central's starting and ending dates do.
  assert.equal(isInForce(list({ startingDate: ON, endingDate: ON }), ON), true)
})

test('a line is in force only inside its own dates as well', () => {
  assert.equal(lineInForce(line(), ON), true)
  assert.equal(lineInForce(line({ startingDate: '2026-10-01' }), ON), false)
  assert.equal(lineInForce(line({ endingDate: '2026-09-27' }), ON), false)
  assert.equal(lineInForce(line({ startingDate: ON, endingDate: ON }), ON), true)
  const dated = [list({ lines: [line(), line({ sku: 'B2', startingDate: '2027-01-01' })] })]
  assert.deepEqual(partnerPricesInForce(dated, P1, ON).map((l) => l.sku), ['A1'])
})

test('each line says which list set it and whether that list is the customer\'s or its group\'s', () => {
  const lists = [list({ lines: [line(), { sku: 'B2', kind: 'discount', percent: 10, minQty: 5, startingDate: null, endingDate: null }] })]
  assert.deepEqual(partnerPricesInForce(lists, P1, ON), [
    { sku: 'A1', kind: 'price', price: 80, minQty: 1, contractNumber: '4000000001', appliesTo: 'customer' },
    { sku: 'B2', kind: 'discount', percent: 10, minQty: 5, contractNumber: '4000000001', appliesTo: 'customer' }
  ])
})

test('a draft, an inactive and an out-of-date list contribute nothing', () => {
  const lists = [list({ status: 'draft' }), list({ number: '4000000002', status: 'inactive' }), list({ number: '4000000003', endingDate: '2026-06-30' })]
  assert.deepEqual(partnerPricesInForce(lists, P1, ON), [])
})

test('the customer\'s own list comes first; its price group\'s list prices what the customer\'s does not', () => {
  const member = { id: 'P1', priceGroup: 'RETAIL' }
  const lists = [
    list({ lines: [line({ price: 70 })] }),
    groupList({ lines: [line({ price: 90 }), line({ sku: 'B2', price: 40 }), line({ price: 85, minQty: 10 })] })
  ]
  assert.deepEqual(partnerPricesInForce(lists, member, ON).map((l) => [l.sku, l.minQty, l.price, l.appliesTo]), [
    ['A1', 1, 70, 'customer'],
    ['A1', 10, 85, 'priceGroup'],
    ['B2', 1, 40, 'priceGroup']
  ])
  // Out of the group, the group's list prices nothing for it.
  assert.deepEqual(partnerPricesInForce(lists, P1, ON).map((l) => l.sku), ['A1'])
  // Another group's list never applies.
  assert.deepEqual(partnerPricesInForce([groupList({ priceGroup: 'TRADE' })], member, ON), [])
})

test('two lines for one SKU and quantity: the later start wins (list or line date), then the higher list number', () => {
  const older = list({ number: '4000000001', startingDate: '2026-01-01', lines: [line({ price: 80 })] })
  const newer = list({ number: '4000000002', startingDate: '2026-09-01', lines: [line({ price: 70 })] })
  assert.equal(partnerPricesInForce([newer, older], P1, ON)[0].price, 70)
  const sameDay = list({ number: '4000000003', startingDate: '2026-09-01', lines: [line({ price: 60 })] })
  assert.equal(partnerPricesInForce([sameDay, newer, older], P1, ON)[0].contractNumber, '4000000003')
  // "This price goes up on 1 September": one dated line in the same list beats the undated one from that day.
  const rise = list({ lines: [line({ price: 80 }), line({ price: 95, startingDate: '2026-09-01' })] })
  assert.equal(partnerPricesInForce([rise], P1, ON)[0].price, 95)
  assert.equal(partnerPricesInForce([rise], P1, '2026-08-31')[0].price, 80)
})

test('prices in force for every customer: each customer resolved, customers with nothing left out', () => {
  const customers = [{ id: 'P1', priceGroup: 'RETAIL' }, { id: 'P2', priceGroup: 'RETAIL' }, { id: 'P3', priceGroup: null }]
  const lists = [list(), groupList({ lines: [line({ sku: 'B2', price: 40 })] })]
  assert.deepEqual(pricesInForce(lists, customers, ON).map((i) => [i.partnerId, i.lines.map((l) => l.sku)]), [
    ['P1', ['A1', 'B2']],
    ['P2', ['B2']]
  ])
})
