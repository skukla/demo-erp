/*
 * A price condition scoped to one sales organization is published to THAT organization's
 * websites only (contract version 12, AB-46; owner 2026-09-30: per-website pricing is what
 * Commerce's shared catalogs offer). A customer with any scoped condition gets one whole set per
 * sales organization the store sells through, each line tagged with it, and no untagged line; a
 * customer with none keeps one set tagged null ("for every website"). When the ERP knows no sales
 * organizations yet, a scoped condition cannot be placed and is left out rather than published
 * everywhere — it still prices the order, which passes its organization.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { netPricesFor, netPricesInForce } = require('../lib/net-prices')
const { decide } = require('../lib/pricing')

const ON = '2026-09-28'
const products = [{ sku: 'A1', listPrice: 100, type: 'simple' }, { sku: 'B2', listPrice: 50, type: 'simple' }]
const P1 = { id: 'P1', priceGroup: null }
const P2 = { id: 'P2', priceGroup: null }
const ORGS = ['1000', '2000']
// 10% off everything for P1, on the EU site only; 5% off B2 for P1 everywhere.
const euOnly = { kind: 'contractDiscount', partnerId: 'P1', sku: null, percent: 10, salesOrg: '2000', minQty: 1 }
const everywhere = { kind: 'contractDiscount', partnerId: 'P1', sku: 'B2', percent: 5, minQty: 1 }
const loose = (sku, extra) => ({ sku, contractNumber: null, appliesTo: 'customer', minQty: 1, salesOrg: null, ...extra })
const net = (conditions, customer = P1, salesOrgs = ORGS) => netPricesFor({ products, conditions, lists: [], customer, date: ON, salesOrgs })

test('a scoped discount gives the customer one whole set per sales organization; the EU set carries it, the US set does not', () => {
  const lines = net([euOnly, everywhere])
  // Sets by organization in order: US (1000) has only the everywhere discount; EU (2000) has
  // the 10% on both products — the organization-scoped condition outranks the SKU-specific one.
  assert.deepEqual(lines, [
    loose('B2', { kind: 'discount', percent: 5, salesOrg: '1000' }),
    loose('A1', { kind: 'discount', percent: 10, salesOrg: '2000' }),
    loose('B2', { kind: 'discount', percent: 10, salesOrg: '2000' })
  ])
  // No line for every website: one beside a tagged one for the same product would leave Commerce to choose.
  assert.ok(lines.every((l) => l.salesOrg !== null))
})

test('a customer with no scoped condition keeps one set for every website (salesOrg null), as before', () => {
  assert.deepEqual(net([everywhere]), [loose('B2', { kind: 'discount', percent: 5 })])
})

test('with no sales organizations known yet, a scoped condition is left out and the rest is for every website', () => {
  assert.deepEqual(net([euOnly, everywhere], P1, []), [loose('B2', { kind: 'discount', percent: 5 })])
})

test('every customer: the scoped one per organization (only the organizations with a line), the plain one once', () => {
  const items = netPricesInForce({ products, conditions: [euOnly, { ...everywhere, partnerId: 'P2' }], lists: [], customers: [P1, P2], date: ON, salesOrgs: ORGS })
  assert.deepEqual(items.map((i) => i.partnerId), ['P1', 'P2'])
  // P1: nothing below list on the US site, so no US lines; two EU lines.
  assert.deepEqual(items[0].lines.map((l) => [l.sku, l.percent, l.salesOrg]), [['A1', 10, '2000'], ['B2', 10, '2000']])
  assert.deepEqual(items[1].lines, [loose('B2', { kind: 'discount', percent: 5 })])
})

test('the same condition still prices an order through its organization, and not one through another', () => {
  const eu = decide({ product: products[0], partner: P1, conditions: [euOnly], qty: 1, date: ON, salesOrg: '2000' })
  assert.equal(eu.percent, 10)
  const us = decide({ product: products[0], partner: P1, conditions: [euOnly], qty: 1, date: ON, salesOrg: '1000' })
  assert.equal(us.source, 'list')
})
