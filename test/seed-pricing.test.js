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

/*
 * The seed on top of data it seeded before (2026-10-30, found live on Justrite: price lists grew
 * 6 to 9 after a store wipe refilled the ERP). Demo Builder's fill now runs over an ERP that keeps
 * its other demos' records, so the seed is idempotent per price group: the list it seeded
 * (`source: 'seed'`) is updated in place, and a list made by hand is never touched.
 */
const { createContract, activateContract } = require('../lib/contracts')

const seededLists = async () => (await listContracts(cols, { priceGroup: 'RETAIL' })).filter((l) => l.source === 'seed')
const withPrice = (price) => seed({ contracts: [{ priceGroup: 'RETAIL', description: 'Retail', startingDate: '2026-02-01', lines: [{ sku: 'A1', kind: 'price', price }] }] })

test('seeding twice keeps one list per price group, with the same number and created time, and the new lines and term', async () => {
  await seedPricing(cols, withPrice(80))
  const [first] = await seededLists()
  const counter = await cols.counters.findOne({ _id: 'contract' })
  await seedPricing(cols, withPrice(70))
  const lists = await seededLists()
  assert.equal(lists.length, 1)
  assert.equal(lists[0].number, first.number)
  assert.equal(lists[0].createdAt, first.createdAt)
  assert.equal(lists[0].lines[0].price, 70)
  assert.equal(lists[0].startingDate, '2026-02-01')
  assert.deepEqual(await cols.counters.findOne({ _id: 'contract' }), counter, 'no number is taken')
  assert.equal((await pending(cols)).filter((e) => e.type === 'PriceList.Changed').length, 0, 'still silent')
})

test('a price list made by hand for the same price group survives both seeds untouched', async () => {
  await seedPricing(cols, seed())
  const made = await createContract(cols, { appliesTo: 'priceGroup', priceGroup: 'RETAIL', startingDate: '2026-01-01', lines: [{ sku: 'B2', kind: 'price', price: 40 }] })
  const active = await activateContract(cols, made.number)
  await seedPricing(cols, withPrice(80))
  await seedPricing(cols, withPrice(70))
  const lists = await listContracts(cols, { priceGroup: 'RETAIL' })
  assert.equal(lists.length, 2)
  assert.deepEqual(lists.find((l) => l.number === made.number), active)
})

test('lists seeded before the flag existed, several for one group, collapse to the newest; an edited or hand-made one stays', async () => {
  // As the old seed stored them: active, for the group, written once (created and updated
  // together), described by the group's name, as Demo Builder's fill sends it.
  const legacy = (number, at, price) => ({ _id: number, number, appliesTo: 'priceGroup', partnerId: null, priceGroup: 'RETAIL', description: 'Retail shops', startingDate: '2026-01-01', endingDate: null, status: 'active', lines: [{ sku: 'A1', kind: 'price', price, minQty: 1, startingDate: null, endingDate: null }], createdAt: at, updatedAt: at })
  await seedPricing(cols, { priceGroups: [{ code: 'RETAIL', name: 'Retail shops' }] })
  for (const list of [legacy('4000000001', '2026-10-01T10:00:00.000Z', 80), legacy('4000000002', '2026-10-09T10:00:00.000Z', 80), legacy('4000000003', '2026-10-30T10:00:00.000Z', 80)]) {
    await cols.contracts.replaceOne({ _id: list._id }, list, { upsert: true })
  }
  // An old seeded list someone then edited on the screen: saved after it was created.
  const edited = { ...legacy('4000000004', '2026-10-02T10:00:00.000Z', 75), updatedAt: '2026-10-03T09:00:00.000Z' }
  await cols.contracts.replaceOne({ _id: edited._id }, edited, { upsert: true })
  // Made by a script in one go, with a name of its own: written once too, but not the seed's.
  const scripted = { ...legacy('4000000005', '2026-10-04T10:00:00.000Z', 60), description: 'Spring promo' }
  await cols.contracts.replaceOne({ _id: scripted._id }, scripted, { upsert: true })

  await seedPricing(cols, withPrice(70))

  const lists = await listContracts(cols, { priceGroup: 'RETAIL' })
  assert.deepEqual(lists.map((l) => l.number).sort(), ['4000000003', '4000000004', '4000000005'])
  assert.deepEqual(lists.find((l) => l.number === '4000000005'), scripted)
  const kept = lists.find((l) => l.number === '4000000003')
  assert.equal(kept.source, 'seed')
  assert.equal(kept.createdAt, '2026-10-30T10:00:00.000Z')
  assert.equal(kept.lines[0].price, 70)
  assert.deepEqual(lists.find((l) => l.number === '4000000004'), edited)
})
