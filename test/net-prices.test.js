/*
 * Prices in force as the ERP would CHARGE them (lib/net-prices, pure): per customer and
 * product, the same decision lib/pricing makes for a quote — the customer's own price list,
 * then its price group's, then its loose contract price or discount, then the list price, all
 * bounded by the maximum discount. What a subscriber is sent is that result, one line per
 * product and quantity break, in the lines' published shape.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { netPricesFor, netPricesInForce } = require('../lib/net-prices')
const { quote, round2 } = require('../lib/pricing')

const ON = '2026-09-28'
const products = [
  { sku: 'A1', listPrice: 100, type: 'simple' },
  { sku: 'B2', listPrice: 50, type: 'simple' },
  { sku: 'SHIRT', listPrice: 30, type: 'configurable' },
  { sku: 'SHIRT-M', listPrice: 30, type: 'simple', parentSku: 'SHIRT' }
]
const P1 = { id: 'P1', priceGroup: null }
const list = (lines, extra) => ({ number: '4000000001', appliesTo: 'customer', partnerId: 'P1', priceGroup: null, status: 'active', startingDate: '2026-01-01', endingDate: null, lines, ...extra })
const listLine = (extra) => ({ sku: 'A1', kind: 'price', price: 80, minQty: 1, startingDate: null, endingDate: null, ...extra })
const net = (conditions, lists = [], customer = P1) => netPricesFor({ products, conditions, lists, customer, date: ON })
// Every published line carries salesOrg (contract version 12): null is "for every website".
const loose = (sku, extra) => ({ sku, contractNumber: null, appliesTo: 'customer', minQty: 1, salesOrg: null, ...extra })

test('a loose all-products discount becomes one discount line per product the ERP sells, never a configurable parent', () => {
  const lines = net([{ kind: 'contractDiscount', partnerId: 'P1', sku: null, percent: 10 }])
  assert.deepEqual(lines, [
    loose('A1', { kind: 'discount', percent: 10 }),
    loose('B2', { kind: 'discount', percent: 10 }),
    loose('SHIRT-M', { kind: 'discount', percent: 10 })
  ])
})

test('a price list line for a product sets the customer\'s loose discount aside for it; the loose one still covers the rest', () => {
  const lines = net([{ kind: 'contractDiscount', partnerId: 'P1', sku: null, percent: 10 }, { kind: 'contractDiscount', partnerId: 'P1', sku: 'A1', percent: 25 }], [list([listLine()])])
  assert.deepEqual(lines.filter((l) => l.sku !== 'SHIRT-M'), [
    { sku: 'A1', kind: 'price', price: 80, minQty: 1, contractNumber: '4000000001', appliesTo: 'customer', salesOrg: null },
    loose('B2', { kind: 'discount', percent: 10 })
  ])
})

test('a SKU-specific loose price or discount beats the all-products discount, and a price stays a price', () => {
  const lines = net([
    { kind: 'contractDiscount', partnerId: 'P1', sku: null, percent: 10 },
    { kind: 'contractDiscount', partnerId: 'P1', sku: 'B2', percent: 20 },
    { kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 88 }
  ])
  assert.deepEqual(lines.filter((l) => l.sku !== 'SHIRT-M'), [
    loose('A1', { kind: 'price', price: 88 }),
    loose('B2', { kind: 'discount', percent: 20 })
  ])
})

test('the maximum discount cuts a larger discount to the ceiling, list line or loose', () => {
  const ceiling = { kind: 'maxDiscount', partnerId: null, sku: null, percent: 15 }
  const lines = net([ceiling, { kind: 'contractDiscount', partnerId: 'P1', sku: 'B2', percent: 30 }], [list([listLine({ kind: 'discount', percent: 20, price: undefined })])])
  assert.deepEqual(lines, [
    { sku: 'A1', kind: 'discount', percent: 15, minQty: 1, contractNumber: '4000000001', appliesTo: 'customer', salesOrg: null },
    loose('B2', { kind: 'discount', percent: 15 })
  ])
})

test('the maximum discount raises a fixed price below list × (1 − ceiling) to that floor, sent as the ceiling\'s discount', () => {
  const lines = net([{ kind: 'maxDiscount', partnerId: 'P1', sku: null, percent: 15 }, { kind: 'contractPrice', partnerId: 'P1', sku: 'B2', price: 30 }], [list([listLine({ price: 70 })])])
  assert.deepEqual(lines, [
    { sku: 'A1', kind: 'discount', percent: 15, minQty: 1, contractNumber: '4000000001', appliesTo: 'customer', salesOrg: null },
    loose('B2', { kind: 'discount', percent: 15 })
  ])
  // A fixed price at or above the floor stays a fixed price.
  assert.deepEqual(net([{ kind: 'maxDiscount', percent: 15 }, { kind: 'contractPrice', partnerId: 'P1', sku: 'B2', price: 45 }]), [loose('B2', { kind: 'price', price: 45 })])
})

test('a ceiling alone prices nothing, and a ceiling of 0 leaves every price at list', () => {
  assert.deepEqual(net([{ kind: 'maxDiscount', percent: 15 }]), [])
  assert.deepEqual(net([{ kind: 'maxDiscount', percent: 0 }, { kind: 'contractDiscount', partnerId: 'P1', sku: 'A1', percent: 10 }]), [])
})

test('a loose condition\'s validity and minimum quantity carry over: out of date prices nothing; a minimum quantity is the line\'s', () => {
  assert.deepEqual(net([{ kind: 'contractDiscount', partnerId: 'P1', sku: 'A1', percent: 10, validFrom: '2026-10-01' }]), [])
  assert.deepEqual(net([{ kind: 'contractDiscount', partnerId: 'P1', sku: 'A1', percent: 10, validTo: '2026-09-27' }]), [])
  assert.deepEqual(net([{ kind: 'contractDiscount', partnerId: 'P1', sku: 'A1', percent: 10, validFrom: '2026-09-28', validTo: '2026-09-28', minQty: 10 }]), [loose('A1', { kind: 'discount', percent: 10, minQty: 10 })])
})

test('quantity breaks: each break where the charged price moves is a line; one that moves nothing is not repeated', () => {
  const conditions = [{ kind: 'contractDiscount', partnerId: 'P1', sku: 'B2', percent: 5 }, { kind: 'contractDiscount', partnerId: 'P1', sku: 'B2', percent: 5, minQty: 20 }]
  const lists = [list([listLine({ price: 95 }), listLine({ price: 90, minQty: 10 })])]
  assert.deepEqual(net(conditions, lists), [
    { sku: 'A1', kind: 'price', price: 95, minQty: 1, contractNumber: '4000000001', appliesTo: 'customer', salesOrg: null },
    { sku: 'A1', kind: 'price', price: 90, minQty: 10, contractNumber: '4000000001', appliesTo: 'customer', salesOrg: null },
    loose('B2', { kind: 'discount', percent: 5 })
  ])
})

test('another customer\'s conditions never apply; a price group\'s list line says so', () => {
  assert.deepEqual(net([{ kind: 'contractDiscount', partnerId: 'P2', sku: null, percent: 10 }]), [])
  const group = list([listLine({ sku: 'B2', price: 40 })], { number: '4000000009', appliesTo: 'priceGroup', partnerId: null, priceGroup: 'RETAIL' })
  assert.deepEqual(net([], [group], { id: 'P1', priceGroup: 'RETAIL' }), [
    { sku: 'B2', kind: 'price', price: 40, minQty: 1, contractNumber: '4000000009', appliesTo: 'priceGroup', salesOrg: null }
  ])
})

test('every customer: those with at least one line, by id', () => {
  const items = netPricesInForce({
    products,
    conditions: [{ kind: 'contractDiscount', partnerId: 'P2', sku: 'A1', percent: 10 }],
    lists: [list([listLine()])],
    customers: [{ id: 'P3' }, { id: 'P2' }, { id: 'P1' }],
    date: ON
  })
  assert.deepEqual(items.map((i) => [i.partnerId, i.lines.map((l) => l.sku)]), [['P1', ['A1']], ['P2', ['A1']]])
})

/*
 * The in-force answer and the quote must agree. Commerce prices a quantity at the lowest of
 * the product's price and every tier price whose quantity the line reaches (Experience
 * League, "Tier pricing"); a percentage tier discounts the product's price. For every
 * customer, product and quantity below, that price equals what the ERP's quote charges.
 */
function commerceCharges (lines, product, qty) {
  const tiers = lines.filter((l) => l.sku === product.sku && l.minQty <= qty)
    .map((l) => (l.kind === 'price' ? l.price : round2(product.listPrice * (1 - l.percent / 100))))
  return Math.min(product.listPrice, ...tiers)
}

test('for every customer, product and quantity, the line Commerce applies charges what the ERP\'s quote charges', () => {
  const customers = [{ id: 'P1', priceGroup: 'RETAIL' }, { id: 'P2', priceGroup: 'RETAIL' }, { id: 'P3', priceGroup: null }, { id: 'P4', priceGroup: null }]
  const catalog = [...products, { sku: 'C3', listPrice: 19.99, type: 'simple' }, { sku: 'D4', listPrice: 250, type: 'simple' }]
  const conditions = [
    { kind: 'maxDiscount', partnerId: null, sku: null, percent: 30 },
    { kind: 'maxDiscount', partnerId: 'P2', sku: null, percent: 12 },
    { kind: 'contractDiscount', partnerId: 'P1', sku: null, percent: 7.5 },
    { kind: 'contractDiscount', partnerId: 'P2', sku: null, percent: 20 },
    { kind: 'contractPrice', partnerId: 'P2', sku: 'D4', price: 150 },
    { kind: 'contractDiscount', partnerId: 'P3', sku: 'C3', percent: 10, minQty: 5 },
    { kind: 'contractPrice', partnerId: 'P3', sku: 'D4', price: 200, validTo: '2026-12-31' },
    { kind: 'contractPrice', partnerId: 'P3', sku: 'B2', price: 10, validFrom: '2027-01-01' },
    { kind: 'contractDiscount', partnerId: 'P4', sku: null, percent: 40 }
  ]
  const lists = [
    list([listLine({ price: 90 }), listLine({ price: 85, minQty: 10 })]),
    list([listLine({ sku: 'B2', kind: 'discount', percent: 25, price: undefined }), listLine({ sku: 'C3', price: 15, minQty: 3 })], { number: '4000000009', appliesTo: 'priceGroup', partnerId: null, priceGroup: 'RETAIL' })
  ]
  let compared = 0
  for (const customer of customers) {
    const lines = netPricesFor({ products: catalog, conditions, lists, customer, date: ON })
    for (const product of catalog.filter((p) => p.type !== 'configurable')) {
      for (const qty of [1, 2, 3, 5, 9, 10, 50]) {
        const erp = quote({ products: catalog, partner: customer, conditions, contracts: lists, lines: [{ sku: product.sku, qty }], date: ON }).lines[0].contractPrice
        assert.equal(commerceCharges(lines, product, qty), erp, `${customer.id} ${product.sku} × ${qty}`)
        compared += 1
      }
    }
  }
  assert.equal(compared, 4 * 5 * 7)
})
