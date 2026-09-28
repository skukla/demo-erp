/*
 * Prices in force: what a customer's contracts price today, worked out from the contracts
 * alone (lib/contract-prices, pure). Modelled on Business Central's sales price lists: a
 * Draft or Inactive list prices nothing; an Active one prices only inside its dates.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isInForce, pricesInForce, partnerPricesInForce } = require('../lib/contract-prices')

const ON = '2026-09-28'
const contract = (extra) => ({
  number: '4000000001',
  partnerId: 'P1',
  status: 'active',
  startingDate: '2026-01-01',
  endingDate: null,
  lines: [{ sku: 'A1', kind: 'price', price: 80, minQty: 1 }],
  ...extra
})

test('only an active contract inside its dates is in force', () => {
  assert.equal(isInForce(contract(), ON), true)
  assert.equal(isInForce(contract({ status: 'draft' }), ON), false)
  assert.equal(isInForce(contract({ status: 'inactive' }), ON), false)
  assert.equal(isInForce(contract({ startingDate: '2026-10-01' }), ON), false)
  assert.equal(isInForce(contract({ endingDate: '2026-09-27' }), ON), false)
  // Both ends count as inside, as Business Central's starting and ending dates do.
  assert.equal(isInForce(contract({ startingDate: ON, endingDate: ON }), ON), true)
})

test('prices in force list each partner\'s lines with the contract that set them', () => {
  const contracts = [
    contract({ lines: [{ sku: 'A1', kind: 'price', price: 80, minQty: 1 }, { sku: 'B2', kind: 'discount', percent: 10, minQty: 5 }] }),
    contract({ number: '4000000002', partnerId: 'P2', lines: [{ sku: 'A1', kind: 'discount', percent: 5, minQty: 1 }] })
  ]
  assert.deepEqual(pricesInForce(contracts, ON), [
    {
      partnerId: 'P1',
      lines: [
        { sku: 'A1', kind: 'price', price: 80, minQty: 1, contractNumber: '4000000001' },
        { sku: 'B2', kind: 'discount', percent: 10, minQty: 5, contractNumber: '4000000001' }
      ]
    },
    { partnerId: 'P2', lines: [{ sku: 'A1', kind: 'discount', percent: 5, minQty: 1, contractNumber: '4000000002' }] }
  ])
})

test('a draft, an inactive and an out-of-date contract contribute nothing', () => {
  const contracts = [
    contract({ status: 'draft' }),
    contract({ number: '4000000002', status: 'inactive' }),
    contract({ number: '4000000003', endingDate: '2026-06-30' })
  ]
  assert.deepEqual(pricesInForce(contracts, ON), [])
})

test('two contracts pricing the same SKU and quantity: the later starting date wins, then the higher number', () => {
  const older = contract({ number: '4000000001', startingDate: '2026-01-01', lines: [{ sku: 'A1', kind: 'price', price: 80, minQty: 1 }] })
  const newer = contract({ number: '4000000002', startingDate: '2026-09-01', lines: [{ sku: 'A1', kind: 'discount', percent: 30, minQty: 1 }] })
  assert.deepEqual(pricesInForce([newer, older], ON)[0].lines, [{ sku: 'A1', kind: 'discount', percent: 30, minQty: 1, contractNumber: '4000000002' }])

  const sameDay = contract({ number: '4000000003', startingDate: '2026-09-01', lines: [{ sku: 'A1', kind: 'price', price: 70, minQty: 1 }] })
  assert.equal(pricesInForce([sameDay, newer, older], ON)[0].lines[0].contractNumber, '4000000003')
})

test('a quantity break is its own line: the same SKU at another minimum quantity is kept', () => {
  const older = contract({ lines: [{ sku: 'A1', kind: 'price', price: 80, minQty: 1 }] })
  const newer = contract({ number: '4000000002', startingDate: '2026-09-01', lines: [{ sku: 'A1', kind: 'price', price: 70, minQty: 10 }] })
  assert.deepEqual(pricesInForce([older, newer], ON)[0].lines.map((l) => [l.minQty, l.price]), [[1, 80], [10, 70]])
})

test('one partner\'s prices in force, empty when it has none', () => {
  const contracts = [contract(), contract({ number: '4000000002', partnerId: 'P2' })]
  assert.deepEqual(partnerPricesInForce(contracts, 'P2', ON), [{ sku: 'A1', kind: 'price', price: 80, minQty: 1, contractNumber: '4000000002' }])
  assert.deepEqual(partnerPricesInForce(contracts, 'P9', ON), [])
})
