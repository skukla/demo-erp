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
