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

// Commerce shows the buyer's price and the store operator asks "why that one?". The
// answer is which rule the ERP applied, so a priced line carries it — the ERP owns the
// rules, so the ERP is the one that can explain them (AB-25, decision 2).
test('a priced line says which rules decided it', () => {
  const conditions = [
    { _id: 'c1', kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 80 },
    { _id: 'c2', kind: 'maxDiscount', partnerId: null, sku: null, percent: 30 }
  ]
  const line = priceLine({ product, partner, conditions })
  assert.deepEqual(line.applied, {
    ceiling: { id: 'c2', kind: 'maxDiscount', partnerId: null, percent: 30, sku: null },
    price: { id: 'c1', kind: 'contractPrice', partnerId: 'P1', price: 80, sku: 'A1' }
  })
})

test('a line at list price says no rule applied, rather than nothing', () => {
  const line = priceLine({ product, partner, conditions: [] })
  assert.deepEqual(line.applied, {})
})

test('the rule that CUT a price is the ceiling, and it is named', () => {
  const conditions = [
    { _id: 'c1', kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 50 },
    { _id: 'c2', kind: 'maxDiscount', partnerId: 'P1', sku: null, percent: 20 }
  ]
  const line = priceLine({ product, partner, conditions })
  assert.equal(line.source, 'ceiling')
  assert.equal(line.contractPrice, 80)
  assert.equal(line.applied.ceiling.id, 'c2')
  // The contract price is still named: it is what the ceiling cut.
  assert.equal(line.applied.price.price, 50)
})

test("a discount belonging to another partner is not named as applied", () => {
  const conditions = [{ _id: 'c9', kind: 'contractDiscount', partnerId: 'P2', sku: null, percent: 50 }]
  const line = priceLine({ product, partner, conditions })
  assert.equal(line.source, 'list')
  assert.deepEqual(line.applied, {})
})
