const { test } = require('node:test')
const assert = require('node:assert/strict')
const { priceLine, quote } = require('../lib/pricing')

const product = { sku: 'A1', listPrice: 100 }
const partner = { id: 'P1' }

test('list price when no condition matches', () => {
  const line = priceLine({ product, partner, conditions: [], qty: 2 })
  assert.equal(line.contractPrice, 100)
  assert.equal(line.source, 'list')
  assert.equal(line.lineTotal, 200)
})

test('a contract price for the partner and sku wins over a discount', () => {
  const conditions = [
    { kind: 'contractDiscount', partnerId: 'P1', sku: null, percent: 10 },
    { kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 80 }
  ]
  const line = priceLine({ product, partner, conditions })
  assert.equal(line.contractPrice, 80)
  assert.equal(line.source, 'contractPrice')
  assert.equal(line.discountPercent, 20)
})

test('a partner-wide discount applies to every sku', () => {
  const conditions = [{ kind: 'contractDiscount', partnerId: 'P1', sku: null, percent: 15 }]
  assert.equal(priceLine({ product, partner, conditions }).contractPrice, 85)
})

test('another partner\'s conditions never apply', () => {
  const conditions = [{ kind: 'contractPrice', partnerId: 'P2', sku: 'A1', price: 1 }]
  assert.equal(priceLine({ product, partner, conditions }).contractPrice, 100)
})

test('the max discount ceiling bounds a contract price, most specific ceiling wins', () => {
  const conditions = [
    { kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 40 },
    { kind: 'maxDiscount', partnerId: null, sku: null, percent: 50 },
    { kind: 'maxDiscount', partnerId: 'P1', sku: null, percent: 30 }
  ]
  const line = priceLine({ product, partner, conditions })
  assert.equal(line.contractPrice, 70)
  assert.equal(line.source, 'ceiling')
  assert.equal(line.maxDiscountPercent, 30)
})

test('a quote prices known lines, flags unknown skus and totals', () => {
  const q = quote({ products: [product], partner, conditions: [], lines: [{ sku: 'A1', qty: 3 }, { sku: 'ZZ', qty: 1 }] })
  assert.equal(q.total, 300)
  assert.equal(q.lines[1].unknown, true)
  assert.equal(q.partnerId, 'P1')
})

test('without a partner only list prices and global ceilings apply', () => {
  const conditions = [{ kind: 'contractDiscount', partnerId: 'P1', sku: null, percent: 15 }]
  assert.equal(priceLine({ product, partner: null, conditions }).contractPrice, 100)
})

/*
 * Validity and minimum quantity (plan §3.10, §6.2). A record applies only on a date inside
 * its validity and only when the line reaches its minimum quantity — Business Central's
 * "best price on a given date" and SAP's "valid on the relevant date of the business
 * document". The quote says which records did NOT apply, and why: the cheapest
 * credibility on the pricing screen.
 */
const { conditionStatus } = require('../lib/pricing')

const ON = '2026-09-24'
const dated = (extra) => ({ kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 80, _id: 'cp', ...extra })

test('a record applies only on a date inside its validity', () => {
  const future = [dated({ validFrom: '2026-10-01', validTo: null })]
  const line = priceLine({ product, partner, conditions: future, qty: 1, date: ON })
  assert.equal(line.contractPrice, 100)
  assert.equal(line.source, 'list')
  assert.deepEqual(line.notApplied, [{ id: 'cp', kind: 'contractPrice', reason: 'not valid until 1 Oct 2026' }])

  const expired = [dated({ validFrom: '2026-01-01', validTo: '2026-06-30' })]
  assert.deepEqual(priceLine({ product, partner, conditions: expired, qty: 1, date: ON }).notApplied[0].reason, 'expired on 30 Jun 2026')

  const current = [dated({ validFrom: '2026-09-01', validTo: '2026-12-31' })]
  const applied = priceLine({ product, partner, conditions: current, qty: 1, date: ON })
  assert.equal(applied.contractPrice, 80)
  assert.deepEqual(applied.notApplied, [])
})

test('a record with a minimum quantity applies only when the line reaches it, and says so', () => {
  const conditions = [dated({ minQty: 10 })]
  const small = priceLine({ product, partner, conditions, qty: 4, date: ON })
  assert.equal(small.contractPrice, 100)
  assert.deepEqual(small.notApplied, [{ id: 'cp', kind: 'contractPrice', reason: 'minimum quantity 10, this line is 4' }])
  assert.equal(priceLine({ product, partner, conditions, qty: 10, date: ON }).contractPrice, 80)
})

test('a record outranked by a more specific one is reported too, so the analysis is complete', () => {
  const conditions = [
    { _id: 'cd', kind: 'contractDiscount', partnerId: 'P1', sku: null, percent: 10 },
    dated({})
  ]
  const line = priceLine({ product, partner, conditions, qty: 1, date: ON })
  assert.equal(line.source, 'contractPrice')
  assert.deepEqual(line.notApplied, [{ id: 'cd', kind: 'contractDiscount', reason: 'a contract price takes precedence' }])
})

test('the quote carries the date it priced on, and each line its not-applied list', () => {
  const q = quote({ products: [product], partner, conditions: [dated({ validFrom: '2027-01-01' })], lines: [{ sku: 'A1', qty: 1 }], date: ON })
  assert.equal(q.date, ON)
  assert.equal(q.lines[0].notApplied.length, 1)
})

test('a record\'s status on a date: active, scheduled or expired', () => {
  assert.equal(conditionStatus({ validFrom: null, validTo: null }, ON), 'active')
  assert.equal(conditionStatus({ validFrom: '2026-10-01', validTo: null }, ON), 'scheduled')
  assert.equal(conditionStatus({ validFrom: null, validTo: '2026-09-23' }, ON), 'expired')
  assert.equal(conditionStatus({ validFrom: '2026-09-24', validTo: '2026-09-24' }, ON), 'active')
})

test('without a date the quote prices for today', () => {
  const q = quote({ products: [product], partner, conditions: [], lines: [{ sku: 'A1', qty: 1 }] })
  assert.match(q.date, /^\d{4}-\d{2}-\d{2}$/)
})

/*
 * Contracts (lib/contracts). The precedence: a customer's contract lines in force for a SKU
 * take the place of that customer's loose contract prices and discounts for that SKU, the
 * SKU-specific ones and the all-products discount alike. The quantity break is the line with
 * the highest minimum quantity the line reaches; below every break the list price stands.
 * The maximum discount stays a loose, store-wide rule and still bounds the result.
 */
const TODAY = '2026-09-28'
const agreement = (lines, extra) => ({ number: '4000000001', partnerId: 'P1', status: 'active', startingDate: '2026-01-01', endingDate: null, lines, ...extra })

test('a contract line beats a loose condition for the same customer and SKU, and names its contract', () => {
  const conditions = [{ _id: 'loose', kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 60 }]
  const contracts = [agreement([{ sku: 'A1', kind: 'price', price: 85, minQty: 1 }])]
  const line = priceLine({ product, partner, conditions, contracts, date: TODAY })
  assert.equal(line.contractPrice, 85)
  assert.equal(line.source, 'contractPrice')
  assert.equal(line.contractNumber, '4000000001')
  assert.deepEqual(line.notApplied, [{ id: 'loose', kind: 'contractPrice', reason: 'contract 4000000001 prices this product for this customer' }])
})

test('a contract discount line prices from the list price; the customer\'s loose all-products discount still covers other SKUs', () => {
  const conditions = [{ _id: 'all', kind: 'contractDiscount', partnerId: 'P1', sku: null, percent: 15 }]
  const contracts = [agreement([{ sku: 'A1', kind: 'discount', percent: 25, minQty: 1 }])]
  const a1 = priceLine({ product, partner, conditions, contracts, date: TODAY })
  assert.equal(a1.contractPrice, 75)
  assert.equal(a1.source, 'contractDiscount')
  const b2 = priceLine({ product: { sku: 'B2', listPrice: 100 }, partner, conditions, contracts, date: TODAY })
  assert.equal(b2.contractPrice, 85)
  assert.equal(b2.contractNumber, null)
})

test('the quantity break is the highest minimum quantity the line reaches; below every break the list price stands', () => {
  const conditions = [{ _id: 'loose', kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 60 }]
  const breaks = [agreement([{ sku: 'A1', kind: 'price', price: 90, minQty: 5 }, { sku: 'A1', kind: 'price', price: 80, minQty: 10 }])]
  assert.equal(priceLine({ product, partner, conditions, contracts: breaks, qty: 12, date: TODAY }).contractPrice, 80)
  assert.equal(priceLine({ product, partner, conditions, contracts: breaks, qty: 5, date: TODAY }).contractPrice, 90)
  const below = priceLine({ product, partner, conditions, contracts: breaks, qty: 1, date: TODAY })
  assert.equal(below.contractPrice, 100, 'the contract owns this SKU for this customer, so the loose price is set aside')
  assert.equal(below.source, 'list')
})

test('the maximum discount still bounds a contract line', () => {
  const conditions = [{ kind: 'maxDiscount', partnerId: null, sku: null, percent: 10 }]
  const line = priceLine({ product, partner, conditions, contracts: [agreement([{ sku: 'A1', kind: 'price', price: 50, minQty: 1 }])], date: TODAY })
  assert.equal(line.contractPrice, 90)
  assert.equal(line.source, 'ceiling')
})

test('a draft, inactive or out-of-date contract leaves the loose conditions in charge', () => {
  const conditions = [{ kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 60 }]
  for (const extra of [{ status: 'draft' }, { status: 'inactive' }, { endingDate: '2026-06-30' }, { startingDate: '2026-10-01' }]) {
    const line = priceLine({ product, partner, conditions, contracts: [agreement([{ sku: 'A1', kind: 'price', price: 85, minQty: 1 }], extra)], date: TODAY })
    assert.equal(line.contractPrice, 60, JSON.stringify(extra))
    assert.equal(line.contractNumber, null)
  }
})

test('another customer\'s contract never applies, and a quote reads the contracts it is handed', () => {
  const contracts = [agreement([{ sku: 'A1', kind: 'price', price: 85, minQty: 1 }], { partnerId: 'P2' })]
  assert.equal(priceLine({ product, partner, conditions: [], contracts, date: TODAY }).contractPrice, 100)
  const q = quote({ products: [product], partner: { id: 'P2' }, conditions: [], contracts, lines: [{ sku: 'A1', qty: 2 }], date: TODAY })
  assert.equal(q.total, 170)
  assert.equal(q.lines[0].contractNumber, '4000000001')
})
