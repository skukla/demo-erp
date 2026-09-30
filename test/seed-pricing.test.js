/*
 * The one-time setup seed of the ERP's pricing from Commerce's shared catalogs (lib/seed-pricing,
 * AB-44): a price group per custom shared catalog, each customer's group from its membership, and
 * the catalog's tier prices as the group's ACTIVE price list. It is silent — the prices are
 * Commerce's already, so it must not echo them back (no contract.changed).
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { importProducts } = require('../lib/products')
const { importPartners, getPartner } = require('../lib/partners')
const { getPriceGroup } = require('../lib/price-groups')
const { listContracts, resolvedFor } = require('../lib/contracts')
const { seedPricing } = require('../lib/seed-pricing')
const { pending } = require('../lib/events')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 100 }, { sku: 'B2', name: 'Gadget', listPrice: 50 }])
  await importPartners(cols, [{ id: 'P1', name: 'Acme' }, { id: 'P2', name: 'Kukla Studios' }])
})

const seed = (extra) => ({
  priceGroups: [{ code: 'RETAIL', name: 'Retail shops' }],
  partnerGroups: [{ id: 'P1', priceGroup: 'RETAIL' }],
  contracts: [{ priceGroup: 'RETAIL', description: 'Retail', startingDate: '2026-01-01', lines: [{ sku: 'A1', kind: 'price', price: 80 }] }],
  ...extra
})

test('the mirror import never sets a price group (the invariant the seed is the exception to)', async () => {
  assert.equal((await getPartner(cols, 'P1')).priceGroup, null)
})

test('the seed creates the group, moves the customer into it, and makes an active group price list', async () => {
  const result = await seedPricing(cols, seed())
  assert.deepEqual(result, { priceGroups: 1, partnerGroups: 1, contracts: 1 })
  assert.deepEqual(await getPriceGroup(cols, 'RETAIL'), { code: 'RETAIL', name: 'Retail shops' })
  assert.equal((await getPartner(cols, 'P1')).priceGroup, 'RETAIL')
  const lists = await listContracts(cols, { priceGroup: 'RETAIL' })
  assert.equal(lists.length, 1)
  assert.equal(lists[0].status, 'active')
  assert.equal(lists[0].appliesTo, 'priceGroup')
  assert.deepEqual(lists[0].lines, [{ sku: 'A1', kind: 'price', price: 80, minQty: 1, startingDate: null, endingDate: null }])
})

test('the seeded group price is in force for the member and not for a non-member', async () => {
  await seedPricing(cols, seed())
  const forP1 = await resolvedFor(cols, 'P1')
  const a1 = forP1.find((l) => l.sku === 'A1')
  assert.ok(a1, 'A1 should be priced for the group member')
  assert.equal(a1.price, 80)
  const forP2 = await resolvedFor(cols, 'P2')
  assert.equal(forP2.find((l) => l.sku === 'A1'), undefined)
})

test('the seed is SILENT — it raises no contract.changed (the prices are Commerce\'s already)', async () => {
  await seedPricing(cols, seed())
  const events = await pending(cols)
  assert.equal(events.filter((e) => e.kind === 'contract.changed').length, 0)
  assert.equal(events.length, 0)
})

test('a partner-group row whose customer does not exist yet is skipped, not an error', async () => {
  const result = await seedPricing(cols, seed({ partnerGroups: [{ id: 'P1', priceGroup: 'RETAIL' }, { id: 'NOPE', priceGroup: 'RETAIL' }] }))
  assert.equal(result.partnerGroups, 1)
})

test('a contract line for an unknown product is refused', async () => {
  await assert.rejects(
    seedPricing(cols, seed({ contracts: [{ priceGroup: 'RETAIL', startingDate: '2026-01-01', lines: [{ sku: 'GHOST', kind: 'price', price: 10 }] }] })),
    /not a product of this ERP/
  )
})

test('a contract for a group that was not seeded is refused', async () => {
  await assert.rejects(
    seedPricing(cols, { contracts: [{ priceGroup: 'UNKNOWN', startingDate: '2026-01-01', lines: [{ sku: 'A1', kind: 'price', price: 80 }] }] }),
    /is not a price group of this ERP/
  )
})
