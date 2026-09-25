const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { importProducts, patchProduct, listProducts, getProduct } = require('../lib/products')
const { importPartners, ensureDefaultPartner, resolvePartner, patchPartner, getPartner, DEFAULT_PARTNER_ID } = require('../lib/partners')
const { upsertCondition, deleteCondition, listConditions } = require('../lib/conditions')
const { pending } = require('../lib/events')
const { wipe } = require('../lib/admin')
const { getSettings, updateSettings, stamp } = require('../lib/settings')
const { DEFAULT_APPEARANCE } = require('../lib/appearance')
const { recordSync } = require('../lib/sync-status')

let cols
beforeEach(() => { cols = memoryCollections() })

test('import creates then updates; what Commerce sends wins, what it omits keeps its ERP value', async () => {
  const first = await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }] }])
  assert.deepEqual(first, { created: 1, updated: 0 })
  await patchProduct(cols, 'A1', { listPrice: 12, warehouses: [{ code: 'default', quantity: 9 }] })
  const second = await importProducts(cols, [{ sku: 'A1', name: 'Widget v2', listPrice: 10 }])
  assert.deepEqual(second, { created: 0, updated: 1 })
  const [product] = await listProducts(cols)
  assert.equal(product.name, 'Widget v2')
  assert.equal(product.listPrice, 10)
  assert.equal(product.stock, 9)
})

test('a partner re-import takes the credit limit and block Commerce reports', async () => {
  await importPartners(cols, [{ id: 'C2', name: 'Kukla', creditLimit: 100 }])
  await patchPartner(cols, 'C2', { creditLimit: 500, blocking: 'all', paymentTerms: 'NET60' })
  await importPartners(cols, [{ id: 'C2', name: 'Kukla Studios', creditLimit: 250, blocked: false }])
  const partner = await getPartner(cols, 'C2')
  assert.equal(partner.name, 'Kukla Studios')
  assert.equal(partner.creditLimit, 250)
  assert.equal(partner.blocking, 'open')
  assert.equal(partner.paymentTerms, 'NET60')
})

test('a price or stock edit raises exactly one ERP event per changed field', async () => {
  await importProducts(cols, [{ sku: 'A1', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }] }])
  await patchProduct(cols, 'A1', { listPrice: 10, warehouses: [{ code: 'default', quantity: 7 }] })
  const entries = await pending(cols)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].event, 'be-observer.catalog_stock_update')
  assert.deepEqual(entries[0].value, [{ sku: 'A1', source: 'default', quantity: 7, outOfStock: false }])
})

test('bad product values are refused', async () => {
  await importProducts(cols, [{ sku: 'A1', warehouses: [{ code: 'default', name: 'Default Source', quantity: 0 }] }])
  await assert.rejects(patchProduct(cols, 'A1', { listPrice: -1 }), { statusCode: 400 })
  await assert.rejects(patchProduct(cols, 'A1', { warehouses: [{ code: 'default', quantity: 1.5 }] }), { statusCode: 400 })
  assert.equal(await patchProduct(cols, 'ZZ', { warehouses: [{ code: 'default', quantity: 1 }] }), null)
})

test('partners resolve by id, Commerce company, email domain, customer group, then the default', async () => {
  await importPartners(cols, [{ id: 'P1', name: 'Acme', commerceCompanyId: '7', customerGroupId: '3', emailDomain: 'Acme.example' }])
  await ensureDefaultPartner(cols, 'Demo')
  assert.equal((await resolvePartner(cols, { partnerId: 'P1' })).id, 'P1')
  assert.equal((await resolvePartner(cols, { commerceCompanyId: 7 })).id, 'P1')
  assert.equal((await resolvePartner(cols, { email: 'buyer@acme.example', customerGroupId: '9' })).id, 'P1')
  assert.equal((await resolvePartner(cols, { customerGroupId: '3' })).id, 'P1')
  // A group two partners share names neither: the default, not the first one found
  // (Commerce puts every company in General unless a shared catalog gives it a group).
  await importPartners(cols, [{ id: 'P2', name: 'Bolt', commerceCompanyId: '8', customerGroupId: '3' }])
  assert.equal((await resolvePartner(cols, { customerGroupId: '3' })).id, DEFAULT_PARTNER_ID)
  assert.equal((await resolvePartner(cols, { commerceCompanyId: '8', customerGroupId: '3' })).id, 'P2')
  const fallback = await resolvePartner(cols, { commerceCompanyId: '99' })
  assert.equal(fallback.id, DEFAULT_PARTNER_ID)
  assert.equal(fallback.isDefault, true)
})

test('credit limit and block changes raise company events carrying the Commerce company id', async () => {
  await importPartners(cols, [{ id: 'P1', commerceCompanyId: '7' }])
  await patchPartner(cols, 'P1', { creditLimit: 1000, blocking: 'all' })
  const entries = await pending(cols)
  assert.deepEqual(entries.map((e) => e.event), ['be-observer.company_credit_update', 'be-observer.company_status_update'])
  assert.deepEqual(entries[0].value, { partnerId: 'P1', companyId: '7', creditLimit: 1000 })
  assert.deepEqual(entries[1].value, { partnerId: 'P1', companyId: '7', blocked: true })
})

test('conditions validate their shape and can be removed', async () => {
  await assert.rejects(upsertCondition(cols, { kind: 'nope' }), { statusCode: 400 })
  await assert.rejects(upsertCondition(cols, { kind: 'contractPrice', partnerId: 'P1' }), { statusCode: 400 })
  const c = await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'P1', percent: 10 })
  assert.equal((await listConditions(cols)).length, 1)
  // Validity and minimum quantity are stored as given, null when absent, and checked.
  assert.equal(c.validFrom, null)
  assert.equal(c.minQty, null)
  const dated = await upsertCondition(cols, { kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 5, validFrom: '2026-10-01', validTo: '2026-12-31', minQty: 10 })
  assert.deepEqual([dated.validFrom, dated.validTo, dated.minQty], ['2026-10-01', '2026-12-31', 10])
  await assert.rejects(upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'P1', percent: 10, validFrom: 'soon' }), /validFrom/)
  await assert.rejects(upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'P1', percent: 10, validFrom: '2026-12-31', validTo: '2026-01-01' }), /validTo/)
  await assert.rejects(upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'P1', percent: 10, minQty: 0 }), /minQty/)
  await deleteCondition(cols, dated._id)
  assert.equal(await deleteCondition(cols, c._id), 1)
  assert.equal((await listConditions(cols)).length, 0)
})

test('wipe clears records, keeps settings and counters, stamps the time', async () => {
  await importProducts(cols, [{ sku: 'A1' }])
  await importPartners(cols, [{ id: 'P1' }])
  await updateSettings(cols, { displayName: 'Contoso ERP' })
  await cols.counters.replaceOne({ _id: 'salesOrder' }, { _id: 'salesOrder', value: 1234 }, { upsert: true })
  const removed = await wipe(cols)
  assert.equal(removed.products, 1)
  assert.equal(removed.businessPartners, 1)
  assert.equal((await cols.counters.findOne({ _id: 'salesOrder' })).value, 1234)
  const settings = await getSettings(cols)
  assert.equal(settings.displayName, 'Contoso ERP')
  assert.ok(settings.lastWipeAt)
})

test('wipe keeps the last sync time and drops the sync record it described', async () => {
  await importProducts(cols, [{ sku: 'A1' }])
  // What a finished import leaves behind: the stamp and the record.
  await stamp(cols, { lastImportAt: '2026-09-17T18:33:23.836Z' })
  await recordSync(cols, { state: 'done', products: { done: 1, total: 1 } })
  const synced = (await getSettings(cols)).lastImportAt
  assert.equal(synced, '2026-09-17T18:33:23.836Z')
  assert.ok((await getSettings(cols)).sync)

  await wipe(cols)

  const settings = await getSettings(cols)
  // The SC did sync; blanking this read as "Last sync: never" beside the wipe time.
  assert.equal(settings.lastImportAt, synced)
  // The record describes records that no longer exist.
  assert.equal(settings.sync, null)
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

test('an ERP that has never been dressed reads back the default appearance', async () => {
  // There is always something to draw: a name (Acme ERP when the deploy named none)
  // and a logo. The shell bar never has to decide whether to render itself.
  const settings = await getSettings(cols)
  assert.deepEqual(settings.appearance, DEFAULT_APPEARANCE)
})

test('appearance is saved, and saving one part leaves the others alone', async () => {
  await updateSettings(cols, { appearance: { palette: 'plum' } })
  assert.equal((await getSettings(cols)).appearance.palette, 'plum')
  await updateSettings(cols, { appearance: { nav: 'top' } })
  const after = (await getSettings(cols)).appearance
  assert.equal(after.nav, 'top')
  assert.equal(after.palette, 'plum', 'the colour did not move when the menu did')
})

test('a theme id saves the three values it stands for, and not itself', async () => {
  await updateSettings(cols, { appearance: { theme: 'granite' } })
  const { appearance } = await getSettings(cols)
  assert.deepEqual(appearance, { palette: 'slate', logo: 'layers', nav: 'rail' })
  assert.equal(appearance.theme, undefined)
})

test('the appearance and the name are saved by the same call, independently', async () => {
  const saved = await updateSettings(cols, { displayName: 'Contoso ERP', appearance: { logo: 'orbit' } })
  assert.equal(saved.displayName, 'Contoso ERP')
  assert.equal(saved.appearance.logo, 'orbit')
  // Renaming alone must not reset the look, which is what a whole-record write would do.
  const renamed = await updateSettings(cols, { displayName: 'Fabrikam ERP' })
  assert.equal(renamed.appearance.logo, 'orbit')
})

test('a wipe keeps the appearance — it is how the ERP is dressed, not a record', async () => {
  await updateSettings(cols, { appearance: { theme: 'meridian' } })
  await wipe(cols)
  assert.equal((await getSettings(cols)).appearance.palette, 'indigo')
})

test('an appearance stored before a palette was renamed is repaired on read', async () => {
  await cols.settings.replaceOne(
    { _id: 'erp' },
    { _id: 'erp', displayName: 'Old ERP', appearance: { palette: 'chartreuse', logo: 'sigil', nav: 'sideways' } },
    { upsert: true }
  )
  assert.deepEqual((await getSettings(cols)).appearance, DEFAULT_APPEARANCE)
})

test('stock is per warehouse: each edit goes to its own source, and the total adds up', async () => {
  await importProducts(cols, [{
    sku: 'T1',
    name: 'Tote',
    listPrice: 189,
    warehouses: [
      { code: 'default', name: 'Default Source', quantity: 120 },
      { code: 'austin_dc', name: 'Austin DC', quantity: 25 },
      { code: 'denver_dc', name: 'Denver DC', quantity: 3 }
    ]
  }])
  const edited = await patchProduct(cols, 'T1', { warehouses: [{ code: 'austin_dc', quantity: 20 }, { code: 'denver_dc', quantity: 0 }, { code: 'default', quantity: 120 }] })
  assert.equal(edited.stock, 140)
  assert.deepEqual(edited.warehouses.map((w) => [w.code, w.name, w.quantity]), [['default', 'Default Source', 120], ['austin_dc', 'Austin DC', 20], ['denver_dc', 'Denver DC', 0]])
  const [event] = await pending(cols)
  assert.equal(event.event, 'be-observer.catalog_stock_update')
  // Only the changed sources, each named.
  assert.deepEqual(event.value, [
    { sku: 'T1', source: 'austin_dc', quantity: 20, outOfStock: false },
    { sku: 'T1', source: 'denver_dc', quantity: 0, outOfStock: true }
  ])
})

test('a name edit raises one product update carrying the new name and the price', async () => {
  await importProducts(cols, [{ sku: 'T1', name: 'Tote', listPrice: 189, warehouses: [] }])
  const edited = await patchProduct(cols, 'T1', { name: '  Aurora Tote ', listPrice: 199 })
  assert.equal(edited.name, 'Aurora Tote')
  const entries = await pending(cols)
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0].value, { sku: 'T1', name: 'Aurora Tote', price: 199 })
})

test('the SKU, a single stock number, an unknown warehouse, an empty name and unknown fields are refused', async () => {
  await importProducts(cols, [{ sku: 'T1', name: 'Tote', warehouses: [{ code: 'default', quantity: 1 }] }])
  await assert.rejects(patchProduct(cols, 'T1', { sku: 'T2' }), (e) => e.statusCode === 400 && /cannot be changed here/.test(e.message))
  await assert.rejects(patchProduct(cols, 'T1', { stock: 5 }), (e) => e.statusCode === 400 && /per warehouse/.test(e.message))
  await assert.rejects(patchProduct(cols, 'T1', { warehouses: [{ code: 'nowhere', quantity: 1 }] }), (e) => e.statusCode === 400 && /nowhere/.test(e.message))
  await assert.rejects(patchProduct(cols, 'T1', { name: '   ' }), { statusCode: 400 })
  await assert.rejects(patchProduct(cols, 'T1', { plant: '2000' }), { statusCode: 400 })
  assert.equal((await pending(cols)).length, 0)
})

test('a product stored before warehouses reads as the default source, and saves in the new shape', async () => {
  await cols.products.replaceOne({ _id: 'OLD' }, { _id: 'OLD', sku: 'OLD', name: 'Old', plant: '1000', listPrice: 5, stock: 7 }, { upsert: true })
  const [product] = await listProducts(cols)
  assert.deepEqual(product.warehouses, [{ code: 'default', name: 'Default Source', quantity: 7 }])
  assert.equal(product.stock, 7)
  assert.equal('plant' in product, false)
  await patchProduct(cols, 'OLD', { warehouses: [{ code: 'default', quantity: 8 }] })
  const raw = await cols.products.findOne({ _id: 'OLD' })
  assert.equal('stock' in raw, false)
  assert.equal('plant' in raw, false)
  assert.equal(raw.warehouses[0].quantity, 8)
})

test('an import with a malformed warehouse is refused', async () => {
  await assert.rejects(importProducts(cols, [{ sku: 'X', warehouses: [{ quantity: 1 }] }]), { statusCode: 400 })
  await assert.rejects(importProducts(cols, [{ sku: 'X', warehouses: [{ code: 'default', quantity: -2 }] }]), { statusCode: 400 })
})

async function importOrchard () {
  await importProducts(cols, [
    { sku: 'Orchard2', name: 'Orchard 2', type: 'configurable', listPrice: 0, warehouses: [] },
    { sku: 'Orchard2-Silver-128GB', name: 'Orchard 2-Silver-128GB', type: 'simple', parentSku: 'Orchard2', variantAttributes: [{ label: 'Color', value: 'Silver' }, { label: 'Memory', value: '128GB' }], listPrice: 799.99, warehouses: [{ code: 'default', name: 'Default Source', quantity: 10 }] },
    { sku: 'Orchard2-Black-1TB', name: 'Orchard 2-Black-1TB', type: 'simple', parentSku: 'Orchard2', variantAttributes: [{ label: 'Color', value: 'Black' }, { label: 'Memory', value: '1TB' }], listPrice: 1099, warehouses: [{ code: 'default', name: 'Default Source', quantity: 0 }] },
    { sku: 'Case', name: 'Case', listPrice: 20, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }] }
  ])
}

test('a configurable parent lists with its variants\' total stock, count and price range', async () => {
  await importOrchard()
  const rows = await listProducts(cols)
  const parent = rows.find((r) => r.sku === 'Orchard2')
  assert.deepEqual(
    { type: parent.type, stock: parent.stock, variantCount: parent.variantCount, priceRange: parent.priceRange, warehouses: parent.warehouses },
    { type: 'configurable', stock: 10, variantCount: 2, priceRange: { min: 799.99, max: 1099 }, warehouses: [] }
  )
  const standalone = rows.find((r) => r.sku === 'Case')
  assert.equal(standalone.type, 'simple')
  assert.equal(standalone.parentSku, undefined)
})

test('a parent\'s page carries its variants, and a variant\'s page names its parent and values', async () => {
  await importOrchard()
  const parent = await getProduct(cols, 'Orchard2')
  assert.deepEqual(parent.variants.map((v) => v.sku), ['Orchard2-Black-1TB', 'Orchard2-Silver-128GB'])
  const variant = await getProduct(cols, 'Orchard2-Silver-128GB')
  assert.deepEqual(variant.parent, { sku: 'Orchard2', name: 'Orchard 2' })
  assert.deepEqual(variant.variantAttributes, [{ label: 'Color', value: 'Silver' }, { label: 'Memory', value: '128GB' }])
})

test('a parent takes a name but not a price or stock; a variant takes all three', async () => {
  await importOrchard()
  await assert.rejects(patchProduct(cols, 'Orchard2', { listPrice: 5 }), (e) => e.statusCode === 400 && /belong to its variants/.test(e.message))
  await assert.rejects(patchProduct(cols, 'Orchard2', { warehouses: [] }), { statusCode: 400 })
  const renamed = await patchProduct(cols, 'Orchard2', { name: 'Orchard Two' })
  assert.equal(renamed.name, 'Orchard Two')
  const variant = await patchProduct(cols, 'Orchard2-Black-1TB', { listPrice: 999, warehouses: [{ code: 'default', quantity: 4 }] })
  assert.equal(variant.stock, 4)
  assert.equal((await getProduct(cols, 'Orchard2')).stock, 14)
})

test('an unknown product type is refused', async () => {
  await assert.rejects(importProducts(cols, [{ sku: 'K', type: 'bundle' }]), { statusCode: 400 })
})

test('a product Commerce deleted leaves the ERP; a deleted parent leaves its variants as products of their own; an unknown SKU is a 404', async () => {
  const { deleteProduct, importProducts, getProduct, listProducts } = require('../lib/products')
  const { invoke } = require('./helpers/memory-db')
  const products = require('../actions/products')
  await importProducts(cols, [
    { sku: 'PARENT', name: 'Knit', type: 'configurable' },
    { sku: 'PARENT-S', name: 'Knit S', parentSku: 'PARENT', variantAttributes: [{ label: 'Size', value: 'S' }], listPrice: 10 },
    { sku: 'PARENT-M', name: 'Knit M', parentSku: 'PARENT', variantAttributes: [{ label: 'Size', value: 'M' }], listPrice: 10 },
    { sku: 'LONE', name: 'Belt', listPrice: 5 }
  ])
  assert.deepEqual(await deleteProduct(cols, 'LONE'), { sku: 'LONE', unlinked: [] })
  assert.equal(await getProduct(cols, 'LONE'), null)
  const res = await invoke(products, cols, { method: 'DELETE', path: '/PARENT', body: { origin: { event: 'observer.catalog_product_delete_commit_after' } } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { sku: 'PARENT', unlinked: ['PARENT-M', 'PARENT-S'] })
  const listed = (await listProducts(cols)).map((p) => [p.sku, p.type, p.parentSku || null])
  assert.deepEqual(listed, [['PARENT-M', 'simple', null], ['PARENT-S', 'simple', null]])
  assert.equal((await invoke(products, cols, { method: 'DELETE', path: '/PARENT' })).statusCode, 404)
  const { recent } = require('../lib/events')
  const [entry] = await recent(cols)
  assert.equal(entry.summary, 'Product PARENT removed (deleted in Commerce); its 2 variant(s) stay as products of their own')
})

test('a product is sellable until blocked for sales; the block is the ERP\'s own, raises no event, and survives an import', async () => {
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }] }])
  assert.equal((await getProduct(cols, 'A1')).salesStatus, 'sellable')
  const blocked = await patchProduct(cols, 'A1', { salesStatus: 'blocked' })
  assert.equal(blocked.salesStatus, 'blocked')
  assert.deepEqual(await pending(cols), [])
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 12, stock: 7 }])
  assert.equal((await getProduct(cols, 'A1')).salesStatus, 'blocked')
  assert.equal((await getProduct(cols, 'A1')).listPrice, 12)
  await assert.rejects(patchProduct(cols, 'A1', { salesStatus: 'maybe' }), /salesStatus must be sellable or blocked/)
  const back = await patchProduct(cols, 'A1', { salesStatus: 'sellable' })
  assert.equal(back.salesStatus, 'sellable')
})

test('a configurable parent has no sales status of its own; its variants do', async () => {
  await importProducts(cols, [{ sku: 'P', name: 'Coat', type: 'configurable' }, { sku: 'P-S', name: 'Coat S', parentSku: 'P', listPrice: 1, warehouses: [] }])
  await assert.rejects(patchProduct(cols, 'P', { salesStatus: 'blocked' }), /belong to its variants/)
  assert.equal((await patchProduct(cols, 'P-S', { salesStatus: 'blocked' })).salesStatus, 'blocked')
})
