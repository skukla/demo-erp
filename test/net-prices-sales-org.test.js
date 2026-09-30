/*
 * A price condition scoped to one sales organization is NOT published (review, 2026-09-30):
 * a company has one shared catalog for every website, so a per-site discount cannot land in
 * it without showing on a site the ERP never granted it for. It prices the ORDER instead —
 * the quote and order paths pass their sales organization to lib/pricing — so the catalog
 * shows the base price and the ERP applies the discount where it belongs.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { netPricesFor } = require('../lib/net-prices')
const { decide } = require('../lib/pricing')

const ON = '2026-09-28'
const products = [{ sku: 'A1', listPrice: 100, type: 'simple' }, { sku: 'B2', listPrice: 50, type: 'simple' }]
const P1 = { id: 'P1', priceGroup: null }
const euOnly = { kind: 'contractDiscount', partnerId: 'P1', sku: null, percent: 10, salesOrg: '2000', minQty: 1 }
const everywhere = { kind: 'contractDiscount', partnerId: 'P1', sku: 'B2', percent: 5, minQty: 1 }

test('a sales-organization-scoped discount is left out of the published prices; the unscoped one still goes', () => {
  const lines = netPricesFor({ products, conditions: [euOnly, everywhere], lists: [], customer: P1, date: ON })
  assert.deepEqual(lines, [
    { sku: 'B2', kind: 'discount', percent: 5, minQty: 1, contractNumber: null, appliesTo: 'customer' }
  ])
})

test('the same condition still prices an order placed through its sales organization, and not one through another', () => {
  const product = products[0]
  const eu = decide({ product, partner: P1, conditions: [euOnly], qty: 1, date: ON, salesOrg: '2000' })
  assert.equal(eu.source, 'contractDiscount')
  assert.equal(eu.percent, 10)
  const us = decide({ product, partner: P1, conditions: [euOnly], qty: 1, date: ON, salesOrg: '1000' })
  assert.equal(us.source, 'list')
})
