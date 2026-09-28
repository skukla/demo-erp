/*
 * Customer price lists (lib/contracts) and customer price groups (lib/price-groups):
 * Business Central's sales price lists in this ERP's storage. A list applies to one customer
 * or to one price group, has a number, a term, a status and its lines, each with its own dates.
 * The route and the record keep the name `contracts`, which the integration calls.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { importProducts } = require('../lib/products')
const { importPartners, patchPartner, getPartner } = require('../lib/partners')
const { createContract, getContract, listContracts, updateContract, activateContract, deactivateContract } = require('../lib/contracts')
const { listPriceGroups, savePriceGroup, deletePriceGroup } = require('../lib/price-groups')
const { wipe } = require('../lib/admin')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 100 }, { sku: 'B2', name: 'Gadget', listPrice: 50 }])
  await importPartners(cols, [{ id: 'P1', name: 'Acme' }, { id: 'P2', name: 'Kukla Studios' }, { id: 'P3', name: 'Third' }])
})

const draft = (extra) => ({
  partnerId: 'P1',
  description: 'Acme 2026 terms',
  startingDate: '2026-01-01',
  lines: [{ sku: 'A1', kind: 'price', price: 80 }],
  ...extra
})
const groupDraft = (extra) => draft({ appliesTo: 'priceGroup', partnerId: undefined, priceGroup: 'RETAIL', description: 'Retail', ...extra })
const priced = (extra) => ({ sku: 'A1', kind: 'price', price: 80, minQty: 1, startingDate: null, endingDate: null, ...extra })

test('a new price list is a draft for one customer, with the ERP\'s own number; lines default to quantity 1 and open dates', async () => {
  const c = await createContract(cols, draft({ lines: [{ sku: 'A1', kind: 'price', price: 80 }, { sku: 'B2', kind: 'discount', percent: 10, minQty: 5, startingDate: '2026-03-01', endingDate: '2026-12-31' }] }))
  assert.equal(c.number, '4000000001')
  assert.equal(c.status, 'draft')
  assert.equal(c.appliesTo, 'customer')
  assert.equal(c.partnerId, 'P1')
  assert.equal(c.priceGroup, null)
  assert.equal(c.endingDate, null)
  assert.deepEqual(c.lines, [
    priced(),
    { sku: 'B2', kind: 'discount', percent: 10, minQty: 5, startingDate: '2026-03-01', endingDate: '2026-12-31' }
  ])
  assert.equal((await createContract(cols, draft())).number, '4000000002')
  assert.deepEqual(await getContract(cols, '4000000001'), c)
})

test('a price list is refused when it names no known customer or group, a bad date, or a bad line', async () => {
  await savePriceGroup(cols, { code: 'RETAIL', name: 'Retail' })
  const refused = async (input, message) => assert.rejects(createContract(cols, input), (e) => e.statusCode === 400 && message.test(e.message))
  await refused(draft({ partnerId: 'NOPE' }), /customer NOPE/i)
  await refused(groupDraft({ priceGroup: 'NOPE' }), /price group NOPE/i)
  await refused(draft({ appliesTo: 'everyone' }), /appliesTo/)
  await refused(draft({ startingDate: '28/09/2026' }), /startingDate/)
  await refused(draft({ startingDate: undefined }), /startingDate/)
  await refused(draft({ endingDate: '2025-12-31' }), /endingDate/)
  await refused(draft({ lines: [{ sku: 'ZZ', kind: 'price', price: 1 }] }), /ZZ/)
  await refused(draft({ lines: [{ sku: 'A1', kind: 'rebate', price: 1 }] }), /kind/)
  await refused(draft({ lines: [{ sku: 'A1', kind: 'price', price: -1 }] }), /price/)
  await refused(draft({ lines: [{ sku: 'A1', kind: 'discount', percent: 120 }] }), /percent/)
  await refused(draft({ lines: [{ sku: 'A1', kind: 'price', price: 1, minQty: 0 }] }), /minQty/)
  await refused(draft({ lines: [{ sku: 'A1', kind: 'price', price: 1, startingDate: '2026-05-01', endingDate: '2026-04-01' }] }), /line.*endingDate/)
  // The same product, quantity and starting date twice is one line written twice.
  await refused(draft({ lines: [{ sku: 'A1', kind: 'price', price: 1 }, { sku: 'A1', kind: 'discount', percent: 5 }] }), /once/)
})

test('a later-dated line for the same product and quantity is allowed: "the price goes up on 1 January"', async () => {
  const c = await createContract(cols, draft({ lines: [{ sku: 'A1', kind: 'price', price: 80 }, { sku: 'A1', kind: 'price', price: 90, startingDate: '2027-01-01' }] }))
  assert.equal(c.lines.length, 2)
})

test('a price list for a price group names the group and no customer', async () => {
  await savePriceGroup(cols, { code: 'RETAIL', name: 'Retail' })
  const c = await createContract(cols, groupDraft())
  assert.equal(c.appliesTo, 'priceGroup')
  assert.equal(c.priceGroup, 'RETAIL')
  assert.equal(c.partnerId, null)
})

test('the list filters by customer or by price group', async () => {
  await savePriceGroup(cols, { code: 'RETAIL', name: 'Retail' })
  await createContract(cols, draft())
  await createContract(cols, draft({ partnerId: 'P2' }))
  await createContract(cols, groupDraft())
  assert.equal((await listContracts(cols)).length, 3)
  assert.deepEqual((await listContracts(cols, { partnerId: 'P2' })).map((c) => c.partnerId), ['P2'])
  assert.deepEqual((await listContracts(cols, { priceGroup: 'RETAIL' })).map((c) => c.priceGroup), ['RETAIL'])
})

test('draft → active → inactive → active; a draft cannot be deactivated', async () => {
  const c = await createContract(cols, draft())
  await assert.rejects(deactivateContract(cols, c.number), (e) => e.statusCode === 400)
  assert.equal((await activateContract(cols, c.number)).status, 'active')
  await assert.rejects(activateContract(cols, c.number), (e) => e.statusCode === 400)
  assert.equal((await deactivateContract(cols, c.number)).status, 'inactive')
  assert.equal((await activateContract(cols, c.number)).status, 'active')
  assert.equal(await activateContract(cols, '4999999999'), null)
})

test('lines, dates and description change while draft or active, never once inactive', async () => {
  const c = await createContract(cols, draft())
  const edited = await updateContract(cols, c.number, { description: 'Renewed', endingDate: '2026-12-31', lines: [{ sku: 'B2', kind: 'discount', percent: 20 }] })
  assert.equal(edited.description, 'Renewed')
  assert.equal(edited.endingDate, '2026-12-31')
  assert.deepEqual(edited.lines, [{ sku: 'B2', kind: 'discount', percent: 20, minQty: 1, startingDate: null, endingDate: null }])
  assert.equal(edited.partnerId, 'P1', 'who the list applies to is not changed by an update')
  await activateContract(cols, c.number)
  assert.equal((await updateContract(cols, c.number, { endingDate: null })).endingDate, null)
  await deactivateContract(cols, c.number)
  await assert.rejects(updateContract(cols, c.number, { description: 'x' }), (e) => e.statusCode === 400 && /price list .* is inactive/.test(e.message))
  await assert.rejects(updateContract(cols, c.number, { lines: [{ sku: 'ZZ', kind: 'price', price: 1 }] }), (e) => e.statusCode === 400)
})

test('price groups: a code and a name; a customer belongs to at most one, set on the customer', async () => {
  const retail = await savePriceGroup(cols, { code: 'retail', name: 'Retail' })
  assert.deepEqual(retail, { code: 'RETAIL', name: 'Retail' })
  await savePriceGroup(cols, { code: 'TRADE', name: 'Trade' })
  await savePriceGroup(cols, { code: 'RETAIL', name: 'Retail shops' })
  assert.deepEqual(await listPriceGroups(cols), [{ code: 'RETAIL', name: 'Retail shops' }, { code: 'TRADE', name: 'Trade' }])
  await assert.rejects(savePriceGroup(cols, { code: '', name: 'x' }), (e) => e.statusCode === 400)
  await patchPartner(cols, 'P1', { priceGroup: 'RETAIL' })
  assert.equal((await getPartner(cols, 'P1')).priceGroup, 'RETAIL')
  await assert.rejects(patchPartner(cols, 'P1', { priceGroup: 'NOPE' }), (e) => e.statusCode === 400)
  // An import from Commerce never touches it: the price group is the ERP's own.
  await importPartners(cols, [{ id: 'P1', name: 'Acme Ltd' }])
  assert.equal((await getPartner(cols, 'P1')).priceGroup, 'RETAIL')
  await patchPartner(cols, 'P1', { priceGroup: null })
  assert.equal((await getPartner(cols, 'P1')).priceGroup, null)
})

test('a price group in use is not deleted; an unused one is', async () => {
  await savePriceGroup(cols, { code: 'RETAIL', name: 'Retail' })
  await savePriceGroup(cols, { code: 'TRADE', name: 'Trade' })
  await patchPartner(cols, 'P1', { priceGroup: 'RETAIL' })
  await assert.rejects(deletePriceGroup(cols, 'RETAIL'), (e) => e.statusCode === 400 && /customer/.test(e.message))
  await createContract(cols, groupDraft({ priceGroup: 'TRADE' }))
  await assert.rejects(deletePriceGroup(cols, 'TRADE'), (e) => e.statusCode === 400 && /price list/.test(e.message))
  await savePriceGroup(cols, { code: 'SPARE', name: 'Spare' })
  assert.equal(await deletePriceGroup(cols, 'SPARE'), 1)
})

test('a wipe removes price lists and price groups; the numbering carries on', async () => {
  await savePriceGroup(cols, { code: 'RETAIL', name: 'Retail' })
  await createContract(cols, draft())
  const removed = await wipe(cols)
  assert.equal(removed.contracts, 1)
  assert.equal(removed.priceGroups, 1)
  assert.deepEqual(await listContracts(cols), [])
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 100 }])
  await importPartners(cols, [{ id: 'P1', name: 'Acme' }])
  assert.equal((await createContract(cols, draft())).number, '4000000002')
})

/*
 * contract.changed: raised for every customer whose prices in force change, carrying that
 * customer's WHOLE current set (lib/contract-prices), so delivering it twice is harmless.
 */
const { pending, EVENT_NAMES } = require('../lib/events')

// Oldest first; nothing is delivered without action params, so every event is pending.
const changes = async () => (await pending(cols)).filter((e) => e.kind === 'contract.changed').map((e) => e.value)
const own = (number, extra) => ({ sku: 'A1', kind: 'price', price: 80, minQty: 1, contractNumber: number, appliesTo: 'customer', ...extra })

test('contract.changed is delivered as be-observer.company_contract_update', () => {
  assert.equal(EVENT_NAMES['contract.changed'], 'be-observer.company_contract_update')
})

test('a draft changes no price, so creating or editing one raises nothing', async () => {
  const c = await createContract(cols, draft())
  await updateContract(cols, c.number, { description: 'Edited' })
  assert.deepEqual(await changes(), [])
})

test('activating, editing and deactivating an in-date list each raise the customer\'s whole set', async () => {
  const c = await createContract(cols, draft())
  await activateContract(cols, c.number)
  await updateContract(cols, c.number, { lines: [{ sku: 'A1', kind: 'price', price: 75 }, { sku: 'B2', kind: 'discount', percent: 10, minQty: 5 }] })
  await updateContract(cols, c.number, { description: 'Only the words' })
  await deactivateContract(cols, c.number)
  assert.deepEqual(await changes(), [
    { partnerId: 'P1', lines: [own(c.number)] },
    { partnerId: 'P1', lines: [own(c.number, { price: 75 }), { sku: 'B2', kind: 'discount', percent: 10, minQty: 5, contractNumber: c.number, appliesTo: 'customer' }] },
    { partnerId: 'P1', lines: [] }
  ], 'the description-only edit changed no price and raised nothing')
})

test('activating a list that starts in the future raises nothing today', async () => {
  const c = await createContract(cols, draft({ startingDate: '2999-01-01' }))
  await activateContract(cols, c.number)
  assert.deepEqual(await changes(), [])
})

test('a group list raises for every member whose prices moved, and only them', async () => {
  await savePriceGroup(cols, { code: 'RETAIL', name: 'Retail' })
  await patchPartner(cols, 'P1', { priceGroup: 'RETAIL' })
  await patchPartner(cols, 'P2', { priceGroup: 'RETAIL' })
  // P1's own list already prices A1, so the group's A1 line moves nothing for P1.
  const mine = await createContract(cols, draft({ lines: [{ sku: 'A1', kind: 'price', price: 70 }] }))
  await activateContract(cols, mine.number)
  const before = (await changes()).length
  const g = await createContract(cols, groupDraft({ lines: [{ sku: 'A1', kind: 'price', price: 90 }] }))
  await activateContract(cols, g.number)
  assert.deepEqual((await changes()).slice(before), [
    { partnerId: 'P2', lines: [own(g.number, { price: 90, appliesTo: 'priceGroup' })] }
  ])
})

test('moving a customer into or out of a group raises its whole set when its prices move', async () => {
  await savePriceGroup(cols, { code: 'RETAIL', name: 'Retail' })
  await savePriceGroup(cols, { code: 'EMPTY', name: 'Nothing priced' })
  const g = await createContract(cols, groupDraft())
  await activateContract(cols, g.number)
  await patchPartner(cols, 'P3', { priceGroup: 'RETAIL' })
  await patchPartner(cols, 'P3', { priceGroup: 'EMPTY' })
  await patchPartner(cols, 'P3', { priceGroup: null })
  assert.deepEqual(await changes(), [
    { partnerId: 'P3', lines: [own(g.number, { appliesTo: 'priceGroup' })] },
    { partnerId: 'P3', lines: [] }
  ], 'leaving EMPTY for no group moved no price and raised nothing')
})
