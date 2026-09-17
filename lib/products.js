/*
 * Products: the ERP's products. Mirrored from whatever the integration imports, then
 * owned here: name and list price, and stock per warehouse. A warehouse is one of
 * the store's inventory sources (Commerce multi-source inventory), keyed by its code,
 * so a stock edit reaches exactly the source it was made for.
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { emit } = require('./events')

/** What a store with a single source calls it (Commerce's own default). */
const DEFAULT_WAREHOUSE = { code: 'default', name: 'Default Source' }

function quantityOf (value, code) {
  const quantity = Number(value)
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw badRequest(`quantity for warehouse ${code} must be a whole number of 0 or more`)
  }
  return quantity
}

/** Validate an imported warehouse list: codes present, quantities whole, one row per code. */
function cleanWarehouses (list) {
  if (!Array.isArray(list)) throw badRequest('warehouses must be a list')
  const byCode = new Map()
  for (const row of list) {
    const code = row && typeof row.code === 'string' ? row.code.trim() : ''
    if (!code) throw badRequest('every warehouse needs a code')
    byCode.set(code, { code, name: (row.name && String(row.name).trim()) || code, quantity: quantityOf(row.quantity, code) })
  }
  return [...byCode.values()]
}

/**
 * A stored product's warehouses. A record written before warehouses existed held one
 * `stock` number; it reads as the default source until the next sync replaces it.
 */
function warehousesOf (product) {
  if (Array.isArray(product.warehouses)) return product.warehouses
  return [{ ...DEFAULT_WAREHOUSE, quantity: Number(product.stock ?? 0) }]
}

/** The product as the screen and the API see it: `stock` is the total across warehouses. */
function shape (product) {
  const warehouses = warehousesOf(product)
  return {
    sku: product.sku,
    name: product.name,
    description: product.description || '',
    unit: product.unit || 'EA',
    listPrice: product.listPrice ?? 0,
    warehouses,
    stock: warehouses.reduce((sum, w) => sum + w.quantity, 0),
    updatedAt: product.updatedAt
  }
}

/** The stored form: no derived total, nothing retired. */
function stored (product) {
  const { stock, ...rest } = shape(product)
  return { _id: product.sku, ...rest }
}

/**
 * Bulk upsert from the integration's import. Idempotent: the same SKU twice updates
 * once. Commerce is the master the demo is prepared in: every field the import carries
 * (name, list price, warehouses) overwrites what the ERP holds. Fields it does not carry
 * keep their ERP value. An edit made on the ERP's screen reaches Commerce through the
 * ERP's events and comes back on the next import as the same value, so the two never fight.
 *
 * @param {object} cols collections
 * @param {object[]} rows `{ sku, name, description?, unit?, listPrice?, warehouses?: [{ code, name, quantity }] }`
 * @returns {Promise<{created:number, updated:number}>}
 */
async function importProducts (cols, rows) {
  let created = 0
  let updated = 0
  for (const row of rows) {
    if (!row || !row.sku) continue
    const existing = await cols.products.findOne({ _id: row.sku })
    const product = stored({
      sku: row.sku,
      name: row.name || existing?.name || row.sku,
      description: row.description || '',
      unit: row.unit || 'EA',
      listPrice: row.listPrice !== undefined && row.listPrice !== null ? Number(row.listPrice) : (existing?.listPrice ?? 0),
      warehouses: row.warehouses !== undefined ? cleanWarehouses(row.warehouses) : (existing ? warehousesOf(existing) : []),
      updatedAt: new Date().toISOString()
    })
    await cols.products.replaceOne({ _id: row.sku }, product, { upsert: true })
    if (existing) updated += 1
    else created += 1
  }
  return { created, updated }
}

/** @returns {Promise<object[]>} products, sorted by SKU */
async function listProducts (cols, options = {}) {
  const rows = await findAll(cols.products, {}, { limit: options.limit ?? 1000, sort: { _id: 1 } })
  return rows.map(shape)
}

/** @returns {Promise<object|null>} */
async function getProduct (cols, sku) {
  const found = await cols.products.findOne({ _id: sku })
  return found ? shape(found) : null
}

const EDITABLE = new Set(['name', 'listPrice', 'warehouses'])

/**
 * Edit name, list price and/or warehouse quantities from the screen. A changed name or
 * price raises one product update; changed quantities raise one stock update naming
 * each source. Subscribers carry both to Commerce. The SKU is the link to Commerce and
 * cannot change here.
 *
 * @param {object} patch `{ name?, listPrice?, warehouses?: [{ code, quantity }] }`
 * @returns {Promise<object|null>} the product after the edit, or null when unknown
 */
async function patchProduct (cols, sku, patch, params) {
  const found = await cols.products.findOne({ _id: sku })
  if (!found) return null
  for (const key of Object.keys(patch || {})) {
    if (key === 'sku') throw badRequest('The SKU links this product to Commerce and cannot be changed here. Change it in Commerce and sync.')
    if (key === 'stock') throw badRequest('Stock is per warehouse: send warehouses [{ code, quantity }].')
    if (!EDITABLE.has(key)) throw badRequest(`${key} cannot be edited`)
  }
  const current = shape(found)
  const next = { ...current, updatedAt: new Date().toISOString() }

  let productChanged = false
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : ''
    if (!name) throw badRequest('name cannot be empty')
    if (name !== current.name) { next.name = name; productChanged = true }
  }
  if (patch.listPrice !== undefined) {
    const price = Number(patch.listPrice)
    if (!Number.isFinite(price) || price < 0) throw badRequest('listPrice must be a non-negative number')
    if (price !== current.listPrice) { next.listPrice = price; productChanged = true }
  }

  const stockChanges = []
  if (patch.warehouses !== undefined) {
    if (!Array.isArray(patch.warehouses)) throw badRequest('warehouses must be a list')
    const byCode = new Map(current.warehouses.map((w) => [w.code, w]))
    for (const edit of patch.warehouses) {
      const code = edit && edit.code
      const warehouse = byCode.get(code)
      if (!warehouse) throw badRequest(`This product has no stock in warehouse ${code}.`)
      const quantity = quantityOf(edit.quantity, code)
      if (quantity !== warehouse.quantity) {
        byCode.set(code, { ...warehouse, quantity })
        stockChanges.push({ sku, source: code, quantity, outOfStock: quantity <= 0 })
      }
    }
    next.warehouses = [...byCode.values()]
  }

  if (productChanged) {
    await emit(cols, 'product.price', { sku, name: next.name, price: next.listPrice, description: next.description }, params)
  }
  if (stockChanges.length > 0) {
    await emit(cols, 'product.stock', stockChanges, params)
  }
  await cols.products.replaceOne({ _id: sku }, stored(next), { upsert: true })
  return shape(next)
}

module.exports = { DEFAULT_WAREHOUSE, importProducts, listProducts, getProduct, patchProduct }
