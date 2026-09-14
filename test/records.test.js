const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { importMaterials, patchMaterial, listMaterials } = require('../lib/materials')
const { importPartners, ensureDefaultPartner, resolvePartner, patchPartner, DEFAULT_PARTNER_ID } = require('../lib/partners')
const { upsertCondition, deleteCondition, listConditions } = require('../lib/conditions')
const { pending, ack } = require('../lib/outbox')
const { wipe } = require('../lib/admin')
const { getSettings, updateSettings } = require('../lib/settings')

let cols
beforeEach(() => { cols = memoryCollections() })

test('import creates then updates, and keeps ERP-owned edits on re-import', async () => {
  const first = await importMaterials(cols, [{ sku: 'A1', name: 'Widget', listPrice: 10, stock: 5 }])
  assert.deepEqual(first, { created: 1, updated: 0 })
  await patchMaterial(cols, 'A1', { listPrice: 12 })
  const second = await importMaterials(cols, [{ sku: 'A1', name: 'Widget v2', listPrice: 10, stock: 5 }])
  assert.deepEqual(second, { created: 0, updated: 1 })
  const [material] = await listMaterials(cols)
  assert.equal(material.name, 'Widget v2')
  assert.equal(material.listPrice, 12)
})

test('a price or stock edit emits exactly one outbox entry per changed field', async () => {
  await importMaterials(cols, [{ sku: 'A1', listPrice: 10, stock: 5 }])
  await patchMaterial(cols, 'A1', { listPrice: 10, stock: 7 })
  const entries = await pending(cols)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'material.stock')
  assert.equal(entries[0].stock, 7)
  assert.equal(await ack(cols, [entries[0]._id, 'nope']), 1)
  assert.equal((await pending(cols)).length, 0)
})

test('bad material values are refused', async () => {
  await importMaterials(cols, [{ sku: 'A1' }])
  await assert.rejects(patchMaterial(cols, 'A1', { listPrice: -1 }), { statusCode: 400 })
  await assert.rejects(patchMaterial(cols, 'A1', { stock: 1.5 }), { statusCode: 400 })
  assert.equal(await patchMaterial(cols, 'ZZ', { stock: 1 }), null)
})

test('partners resolve by id, Commerce company, customer group, then the default', async () => {
  await importPartners(cols, [{ id: 'P1', name: 'Acme', commerceCompanyId: '7', customerGroupId: '3' }])
  await ensureDefaultPartner(cols, 'Demo')
  assert.equal((await resolvePartner(cols, { partnerId: 'P1' })).id, 'P1')
  assert.equal((await resolvePartner(cols, { commerceCompanyId: 7 })).id, 'P1')
  assert.equal((await resolvePartner(cols, { customerGroupId: '3' })).id, 'P1')
  const fallback = await resolvePartner(cols, { commerceCompanyId: '99' })
  assert.equal(fallback.id, DEFAULT_PARTNER_ID)
  assert.equal(fallback.isDefault, true)
})

test('credit limit and block changes go to the outbox with the Commerce company id', async () => {
  await importPartners(cols, [{ id: 'P1', commerceCompanyId: '7' }])
  await patchPartner(cols, 'P1', { creditLimit: 1000, blocked: true })
  const entries = await pending(cols)
  assert.deepEqual(entries.map((e) => e.kind), ['partner.creditLimit', 'partner.blocked'])
  assert.equal(entries[0].commerceCompanyId, '7')
  assert.equal(entries[0].creditLimit, 1000)
})

test('conditions validate their shape and can be removed', async () => {
  await assert.rejects(upsertCondition(cols, { kind: 'nope' }), { statusCode: 400 })
  await assert.rejects(upsertCondition(cols, { kind: 'contractPrice', partnerId: 'P1' }), { statusCode: 400 })
  const c = await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'P1', percent: 10 })
  assert.equal((await listConditions(cols)).length, 1)
  assert.equal(await deleteCondition(cols, c._id), 1)
  assert.equal((await listConditions(cols)).length, 0)
})

test('wipe clears records, keeps settings and counters, stamps the time', async () => {
  await importMaterials(cols, [{ sku: 'A1' }])
  await importPartners(cols, [{ id: 'P1' }])
  await updateSettings(cols, { displayName: 'Contoso ERP' })
  await cols.counters.replaceOne({ _id: 'salesOrder' }, { _id: 'salesOrder', value: 1234 }, { upsert: true })
  const removed = await wipe(cols)
  assert.equal(removed.materials, 1)
  assert.equal(removed.businessPartners, 1)
  assert.equal((await cols.counters.findOne({ _id: 'salesOrder' })).value, 1234)
  const settings = await getSettings(cols)
  assert.equal(settings.displayName, 'Contoso ERP')
  assert.ok(settings.lastWipeAt)
})

test('the display name defaults from the deploy input, then from Acme', async () => {
  assert.equal((await getSettings(cols, 'Northwind ERP')).displayName, 'Northwind ERP')
  assert.equal((await getSettings(memoryCollections())).displayName, 'Acme ERP')
})

test('a redeploy with a new name renames the ERP unless it was renamed on screen', async () => {
  await getSettings(cols, 'First ERP')
  assert.equal((await getSettings(cols, 'Second ERP')).displayName, 'Second ERP')
  await updateSettings(cols, { displayName: 'Mine' })
  assert.equal((await getSettings(cols, 'Third ERP')).displayName, 'Mine')
})
