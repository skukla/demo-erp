/* How a contract reads on screen (screen/src/components/contractFormat.js). */
const { test } = require('node:test')
const assert = require('node:assert/strict')

async function load () {
  return import('../screen/src/components/contractFormat.js')
}

const ON = '2026-09-28'

test('the status says whether the contract prices anything today, the way lib/contract-prices decides it', async () => {
  const { contractStatus } = await load()
  assert.deepEqual(contractStatus({ status: 'draft' }, ON), { text: 'Draft', variant: 'neutral' })
  assert.deepEqual(contractStatus({ status: 'inactive' }, ON), { text: 'Inactive', variant: 'notice' })
  assert.deepEqual(contractStatus({ status: 'active', startingDate: '2026-01-01' }, ON), { text: 'Active', variant: 'positive' })
  assert.deepEqual(contractStatus({ status: 'active', startingDate: '2026-10-01' }, ON), { text: 'Active · not yet started', variant: 'info' })
  assert.deepEqual(contractStatus({ status: 'active', startingDate: '2026-01-01', endingDate: '2026-06-30' }, ON), { text: 'Active · ended', variant: 'neutral' })
})

test('a line reads as what it does and its amount', async () => {
  const { lineKindText, lineAmountText } = await load()
  assert.equal(lineKindText('price'), 'Agreed price')
  assert.equal(lineKindText('discount'), 'Line discount')
  assert.equal(lineAmountText({ kind: 'price', price: 80 }), '$80.00')
  assert.equal(lineAmountText({ kind: 'discount', percent: 12.5 }), '12.5%')
})

test('who a price list applies to reads as the customer or the price group, named', async () => {
  const { appliesToText } = await load()
  const customers = new Map([['C1', 'Acme']])
  const groups = new Map([['RETAIL', 'Retail shops']])
  assert.equal(appliesToText({ appliesTo: 'customer', partnerId: 'C1' }, customers, groups), 'Customer C1 · Acme')
  assert.equal(appliesToText({ partnerId: 'C9' }, customers, groups), 'Customer C9')
  assert.equal(appliesToText({ appliesTo: 'priceGroup', priceGroup: 'RETAIL' }, customers, groups), 'Price group RETAIL · Retail shops')
  assert.equal(appliesToText({ appliesTo: 'priceGroup', priceGroup: 'X' }, customers, groups), 'Price group X')
})

test('a line\'s own dates read as a range, or "as the list" when it has none', async () => {
  const { lineDatesText } = await load()
  assert.equal(lineDatesText({ startingDate: null, endingDate: null }), 'As the list')
  assert.match(lineDatesText({ startingDate: '2027-01-01', endingDate: null }), /^from .*2027$/)
})
