/*
 * Materials: the ERP's products. Mirrored from whatever the integration imports, then
 * owned here: list price is the source of truth, stock is a plant quantity.
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { emit } = require('./outbox')

/**
 * Bulk upsert from the integration's import. Idempotent: the same SKU twice updates
 * once. ERP-owned fields (list price, stock) are kept when the record exists, so a
 * re-import does not undo edits made in the ERP.
 *
 * @param {object} cols collections
 * @param {object[]} rows `{ sku, name, description?, unit?, listPrice?, stock? }`
 * @returns {Promise<{created:number, updated:number}>}
 */
async function importMaterials (cols, rows) {
  let created = 0
  let updated = 0
  for (const row of rows) {
    if (!row || !row.sku) continue
    const existing = await cols.materials.findOne({ _id: row.sku })
    const material = {
      _id: row.sku,
      sku: row.sku,
      name: row.name || row.sku,
      description: row.description || '',
      unit: row.unit || 'EA',
      plant: existing?.plant || '1000',
      listPrice: existing?.listPrice ?? Number(row.listPrice ?? 0),
      stock: existing?.stock ?? Number(row.stock ?? 0),
      updatedAt: new Date().toISOString()
    }
    await cols.materials.replaceOne({ _id: row.sku }, material, { upsert: true })
    if (existing) updated += 1
    else created += 1
  }
  return { created, updated }
}

/** @returns {Promise<object[]>} materials, sorted by SKU */
function listMaterials (cols, options = {}) {
  return findAll(cols.materials, {}, { limit: options.limit ?? 1000, sort: { _id: 1 } })
}

/** @returns {Promise<object|null>} */
function getMaterial (cols, sku) {
  return cols.materials.findOne({ _id: sku })
}

/**
 * Edit list price and/or stock from the screen. Each changed field becomes an outbox
 * entry for the integration to carry to Commerce.
 *
 * @returns {Promise<object|null>} the material after the edit, or null when unknown
 */
async function patchMaterial (cols, sku, patch) {
  const current = await cols.materials.findOne({ _id: sku })
  if (!current) return null
  const next = { ...current, updatedAt: new Date().toISOString() }
  if (patch.listPrice !== undefined) {
    const price = Number(patch.listPrice)
    if (!Number.isFinite(price) || price < 0) throw badRequest('listPrice must be a non-negative number')
    if (price !== current.listPrice) {
      next.listPrice = price
      await emit(cols, { kind: 'material.price', sku, listPrice: price })
    }
  }
  if (patch.stock !== undefined) {
    const stock = Number(patch.stock)
    if (!Number.isInteger(stock) || stock < 0) throw badRequest('stock must be a non-negative integer')
    if (stock !== current.stock) {
      next.stock = stock
      await emit(cols, { kind: 'material.stock', sku, stock })
    }
  }
  await cols.materials.replaceOne({ _id: sku }, next, { upsert: true })
  return next
}

module.exports = { importMaterials, listMaterials, getMaterial, patchMaterial }
