/*
 * Products: the ERP's products. Mirrored from whatever the integration imports, then
 * owned here: list price is the source of truth, stock is a plant quantity.
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { emit } = require('./events')

/**
 * Bulk upsert from the integration's import. Idempotent: the same SKU twice updates
 * once. Commerce is the master the demo is prepared in: every field the import carries
 * (name, list price, stock) overwrites what the ERP holds. Fields it does not carry keep
 * their ERP value. An edit made on the ERP's screen reaches Commerce through the ERP's events
 * and comes back on the next import as the same value, so the two never fight.
 *
 * @param {object} cols collections
 * @param {object[]} rows `{ sku, name, description?, unit?, listPrice?, stock? }`
 * @returns {Promise<{created:number, updated:number}>}
 */
async function importProducts (cols, rows) {
  let created = 0
  let updated = 0
  for (const row of rows) {
    if (!row || !row.sku) continue
    const existing = await cols.products.findOne({ _id: row.sku })
    const product = {
      _id: row.sku,
      sku: row.sku,
      name: row.name || existing?.name || row.sku,
      description: row.description || '',
      unit: row.unit || 'EA',
      plant: existing?.plant || '1000',
      listPrice: row.listPrice !== undefined && row.listPrice !== null ? Number(row.listPrice) : (existing?.listPrice ?? 0),
      stock: row.stock !== undefined && row.stock !== null ? Number(row.stock) : (existing?.stock ?? 0),
      updatedAt: new Date().toISOString()
    }
    await cols.products.replaceOne({ _id: row.sku }, product, { upsert: true })
    if (existing) updated += 1
    else created += 1
  }
  return { created, updated }
}

/** @returns {Promise<object[]>} products, sorted by SKU */
function listProducts (cols, options = {}) {
  return findAll(cols.products, {}, { limit: options.limit ?? 1000, sort: { _id: 1 } })
}

/** @returns {Promise<object|null>} */
function getProduct (cols, sku) {
  return cols.products.findOne({ _id: sku })
}

/**
 * Edit list price and/or stock from the screen. Each changed field raises an ERP event
 * (product update, stock update) that subscribers carry to Commerce.
 *
 * @returns {Promise<object|null>} the product after the edit, or null when unknown
 */
async function patchProduct (cols, sku, patch, params) {
  const current = await cols.products.findOne({ _id: sku })
  if (!current) return null
  const next = { ...current, updatedAt: new Date().toISOString() }
  if (patch.listPrice !== undefined) {
    const price = Number(patch.listPrice)
    if (!Number.isFinite(price) || price < 0) throw badRequest('listPrice must be a non-negative number')
    if (price !== current.listPrice) {
      next.listPrice = price
      await emit(cols, 'product.price', { sku, name: current.name, price, description: current.description || '' }, params)
    }
  }
  if (patch.stock !== undefined) {
    const stock = Number(patch.stock)
    if (!Number.isInteger(stock) || stock < 0) throw badRequest('stock must be a non-negative integer')
    if (stock !== current.stock) {
      next.stock = stock
      await emit(cols, 'product.stock', [{ sku, source: 'default', quantity: stock, outOfStock: stock <= 0 }], params)
    }
  }
  await cols.products.replaceOne({ _id: sku }, next, { upsert: true })
  return next
}

module.exports = { importProducts, listProducts, getProduct, patchProduct }
