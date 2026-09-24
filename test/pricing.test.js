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
