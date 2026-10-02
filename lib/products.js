/*
 * Products: the ERP's products. Mirrored from whatever the integration imports, then
 * owned here: name and list price, and stock per warehouse. A warehouse is a plant, keyed
 * by the code the import gave it (the web shop's stock location of the same code), so a
 * stock edit reaches exactly the location it was made for.
 *
 * A configurable product is a parent, the way SAP retail keeps a generic article:
 * it holds no stock and no price of its own; its variants do, and each variant names
 * its parent and the values it varies on (Color: Silver, Memory: 128GB).
 *
 * There is ONE text, `name`, and it is what the screen heads "Description". That is
 * how both reference systems hold it: SAP's material master has a single 40-character
 * short text (MAKTX) and will not lengthen it, and Business Central's item has one
 * Description field — each keeps longer prose as a separate object (SAP sales text,
 * BC marketing text), which Microsoft's own guidance distinguishes from Description.
 * So marketing copy is the web shop's to own and the ERP does not mirror it. A second
 * `description` field lived here until 2026-09-23: nothing ever filled it, no screen
 * showed it, it rode along on every price event, and the integration dropped it.
 */
const { findAll } = require('./db')
const { registerWarehouses } = require('./settings')
const { badRequest } = require('./errors')
const { emit } = require('./events')
const { announcing, everyCustomer } = require('./contracts')

/** The plant a store with a single stock location keeps its stock in (the web shop's default location). */
const DEFAULT_WAREHOUSE = { code: 'default', name: 'Default Source' }

function quantityOf (value, code) {
  const quantity = Number(value)
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw badRequest(`quantity for warehouse ${code} must be a whole number of 0 or more`)
  }
  return quantity
}

/**
 * A bare `stock` number from the integration, onto the product's warehouses.
 *
 * A web shop's single stock figure is the quantity of its DEFAULT stock location. The
 * sync makes one warehouse per location, keyed by its code, so the number belongs on the
 * `default` warehouse and nowhere else.
 * A product with no warehouses yet gets that one; a product stocked only in other
 * sources is left alone, and says so, rather than having a default warehouse invented.
 *
 * The integration has sent `{ sku, stock }` since the stock event was wired, and the
 * import read only `warehouses` — so every stock change the shop sent was dropped without a
 * word (found 2026-09-18).
 *
 * @returns {{ warehouses: object[], applied: boolean }}
 */
function withDefaultStock (existing, stock) {
  const quantity = quantityOf(stock, DEFAULT_WAREHOUSE.code)
  const current = existing ? warehousesOf(existing) : []
  if (current.length === 0) return { warehouses: [{ ...DEFAULT_WAREHOUSE, quantity }], applied: true }
  if (!current.some((w) => w.code === DEFAULT_WAREHOUSE.code)) return { warehouses: current, applied: false }
  return {
    warehouses: current.map((w) => (w.code === DEFAULT_WAREHOUSE.code ? { ...w, quantity } : w)),
    applied: true
  }
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

const TYPES = new Set(['simple', 'configurable'])

/* Sellable, or blocked for sales: SAP's distribution-chain sales status (X-plant material
   status), Business Central's Blocked item. The ERP's own decision — an import never resets
   it — and a blocked product ships nothing (lib/fulfilment). */
const SALES_STATUSES = ['sellable', 'blocked']

function salesStatusOf (product) {
  return SALES_STATUSES.includes(product.salesStatus) ? product.salesStatus : 'sellable'
}

function isParent (product) {
  return product.type === 'configurable'
}

/** The product as the screen and the API see it: `stock` is the total across warehouses. */
function shape (product) {
  const parent = isParent(product)
  const warehouses = parent ? [] : warehousesOf(product)
  return {
    sku: product.sku,
    name: product.name,
    type: parent ? 'configurable' : 'simple',
    ...(product.parentSku ? { parentSku: product.parentSku, variantAttributes: product.variantAttributes || [] } : {}),
    unit: product.unit || 'EA',
    // A parent has no sales status of its own: its variants are what sell.
    ...(parent ? {} : { salesStatus: salesStatusOf(product) }),
    listPrice: product.listPrice ?? 0,
    warehouses,
    stock: warehouses.reduce((sum, w) => sum + w.quantity, 0),
    updatedAt: product.updatedAt
  }
}

/** The stored form: no derived totals, nothing retired. */
function stored (product) {
  const { stock, ...rest } = shape(product)
  return { _id: product.sku, ...rest }
}

/** A parent as a list shows it: stock and price range from its variants. */
function withVariants (parent, variants) {
  const prices = variants.map((v) => v.listPrice)
  return {
    ...parent,
    stock: variants.reduce((sum, v) => sum + v.stock, 0),
    variantCount: variants.length,
    priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null
  }
}

function cleanVariantAttributes (list) {
  if (list === undefined) return []
  if (!Array.isArray(list)) throw badRequest('variantAttributes must be a list')
  return list.map((row) => ({ label: String(row && row.label || '').trim(), value: String(row && row.value || '').trim() }))
}

/**
 * Bulk upsert from the integration's import. Idempotent: the same SKU twice updates
 * once. The web shop is the master the demo is prepared in: every field the import carries
 * (name, list price, warehouses) overwrites what the ERP holds. Fields it does not carry
 * keep their ERP value. An edit made on the ERP's screen reaches the shop through the
 * ERP's events and comes back on the next import as the same value, so the two never fight.
 *
 * @param {object} cols collections
 * @param {object[]} rows `{ sku, name, type?, parentSku?, variantAttributes?, unit?, listPrice?, warehouses?: [{ code, name, quantity }] }`
 * @returns {Promise<{created:number, updated:number}>}
 */
async function importProducts (cols, rows) {
  let created = 0
  let updated = 0
  // SKUs whose single stock figure had nowhere to land (see withDefaultStock).
  const stockNotApplied = []
  // Every source the import names is a warehouse the ERP knows by name from now on.
  await registerWarehouses(cols, rows.flatMap((row) => (row && Array.isArray(row.warehouses) ? row.warehouses : [])))
  for (const row of rows) {
    if (!row || !row.sku) continue
    const existing = await cols.products.findOne({ _id: row.sku })
    const type = row.type || existing?.type || 'simple'
    if (!TYPES.has(type)) throw badRequest(`type must be simple or configurable, not ${type}`)
    const product = stored({
      sku: row.sku,
      name: row.name || existing?.name || row.sku,
      type,
      parentSku: row.parentSku || undefined,
      variantAttributes: row.parentSku ? cleanVariantAttributes(row.variantAttributes) : undefined,
      unit: row.unit || 'EA',
      listPrice: row.listPrice !== undefined && row.listPrice !== null ? Number(row.listPrice) : (existing?.listPrice ?? 0),
      // The import carries no sales status; the ERP's own stands across imports.
      salesStatus: existing?.salesStatus,
      warehouses: warehousesFor(row, existing, stockNotApplied),
      updatedAt: new Date().toISOString()
    })
    await cols.products.replaceOne({ _id: row.sku }, product, { upsert: true })
    if (existing) updated += 1
    else created += 1
  }
  return { created, updated, ...(stockNotApplied.length > 0 ? { stockNotApplied } : {}) }
}

/**
 * Stock alone, per warehouse, from the web shop's stock locations: the minute refresh sends
 * the SKUs whose quantity changed in a source, each with its full warehouse list. Only
 * products the ERP already has are touched (a SKU it does not know is reported, not
 * invented), and nothing else on the product moves — so this is not an import of the
 * product and does not count as one (the last-import time stays where the mirror put it).
 *
 * @param {object[]} rows `{ sku, warehouses: [{ code, name?, quantity }] }`
 * @returns {Promise<{ updated: number, unknown: string[] }>}
 */
async function importStock (cols, rows) {
  let updated = 0
  const unknown = []
  await registerWarehouses(cols, rows.flatMap((row) => (row && Array.isArray(row.warehouses) ? row.warehouses : [])))
  for (const row of rows) {
    if (!row || !row.sku) continue
    const existing = await cols.products.findOne({ _id: row.sku })
    if (!existing) { unknown.push(row.sku); continue }
    const product = stored({ ...existing, sku: row.sku, warehouses: cleanWarehouses(row.warehouses), updatedAt: new Date().toISOString() })
    await cols.products.replaceOne({ _id: row.sku }, product, { upsert: true })
    updated += 1
  }
  return { updated, unknown }
}

/** An imported row's warehouses: a full list, a bare stock number, or what it had. */
function warehousesFor (row, existing, stockNotApplied) {
  if (row.warehouses !== undefined) return cleanWarehouses(row.warehouses)
  if (row.stock !== undefined && row.stock !== null) {
    const { warehouses, applied } = withDefaultStock(existing, row.stock)
    if (!applied) stockNotApplied.push(row.sku)
    return warehouses
  }
  return existing ? warehousesOf(existing) : []
}

/**
 * @returns {Promise<object[]>} every product, sorted by SKU; a parent carries its
 *   variants' total stock, their count and their price range
 */
async function listProducts (cols, options = {}) {
  const rows = (await findAll(cols.products, {}, { limit: options.limit ?? 1000, sort: { _id: 1 } })).map(shape)
  const variantsOf = new Map()
  for (const row of rows) {
    if (!row.parentSku) continue
    if (!variantsOf.has(row.parentSku)) variantsOf.set(row.parentSku, [])
    variantsOf.get(row.parentSku).push(row)
  }
  return rows.map((row) => (row.type === 'configurable' ? withVariants(row, variantsOf.get(row.sku) || []) : row))
}

/**
 * @returns {Promise<object|null>} the product; a parent also carries `variants`, a
 *   variant carries `parent` ({ sku, name })
 */
async function getProduct (cols, sku) {
  const found = await cols.products.findOne({ _id: sku })
  if (!found) return null
  const product = shape(found)
  if (product.type === 'configurable') {
    const variants = (await findAll(cols.products, { parentSku: sku }, { limit: 1000, sort: { _id: 1 } })).map(shape)
    return { ...withVariants(product, variants), variants }
  }
  if (product.parentSku) {
    const parent = await cols.products.findOne({ _id: product.parentSku })
    return { ...product, parent: parent ? { sku: parent.sku, name: parent.name } : { sku: product.parentSku, name: product.parentSku } }
  }
  return product
}

const EDITABLE = new Set(['name', 'listPrice', 'warehouses', 'salesStatus'])

/**
 * The data of a Product.Changed event: the whole product record in the ERP's words, and
 * which of its fields the edit changed (AB-60: a name change is not a price change).
 */
function productData (product, changedFields) {
  return {
    Product: product.sku,
    ProductName: product.name,
    ProductType: product.type,
    ParentProduct: product.parentSku ?? null,
    BaseUnit: product.unit,
    ListPrice: product.listPrice,
    SalesStatus: product.salesStatus ?? null,
    ChangedFields: changedFields
  }
}

/**
 * Edit name, list price, warehouse quantities and/or the sales status from the screen. A
 * changed name, price or sales status raises one Product.Changed naming the fields that
 * changed; each changed quantity raises one ProductStock.Changed for its plant. The SKU is
 * the key every other system knows the product by and cannot change here.
 *
 * @param {object} patch `{ name?, listPrice?, warehouses?: [{ code, quantity }], salesStatus? }`
 * @returns {Promise<object|null>} the product after the edit, or null when unknown
 */
async function patchProduct (cols, sku, patch, params) {
  const found = await cols.products.findOne({ _id: sku })
  if (!found) return null
  for (const key of Object.keys(patch || {})) {
    if (key === 'sku') throw badRequest('The SKU links this product to the web shop and cannot be changed here. Change it in the web shop and sync.')
    if (key === 'stock') throw badRequest('Stock is per warehouse: send warehouses [{ code, quantity }].')
    if (!EDITABLE.has(key)) throw badRequest(`${key} cannot be edited`)
  }
  const current = shape(found)
  if (current.type === 'configurable' && (patch.listPrice !== undefined || patch.warehouses !== undefined || patch.salesStatus !== undefined)) {
    throw badRequest("A configurable product's price, stock and sales status belong to its variants. Open a variant to change them.")
  }
  const next = { ...current, updatedAt: new Date().toISOString() }

  const changedFields = []
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : ''
    if (!name) throw badRequest('name cannot be empty')
    if (name !== current.name) { next.name = name; changedFields.push('ProductName') }
  }
  if (patch.listPrice !== undefined) {
    const price = Number(patch.listPrice)
    if (!Number.isFinite(price) || price < 0) throw badRequest('listPrice must be a non-negative number')
    if (price !== current.listPrice) { next.listPrice = price; changedFields.push('ListPrice') }
  }

  if (patch.salesStatus !== undefined) {
    if (!SALES_STATUSES.includes(patch.salesStatus)) throw badRequest(`salesStatus must be ${SALES_STATUSES.join(' or ')}`)
    if (patch.salesStatus !== current.salesStatus) changedFields.push('SalesStatus')
    next.salesStatus = patch.salesStatus
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
        stockChanges.push({ Product: sku, Plant: code, Quantity: quantity, PrevQuantity: warehouse.quantity })
      }
    }
    next.warehouses = [...byCode.values()]
  }

  if (changedFields.length > 0) {
    await emit(cols, 'Product.Changed', productData(next, changedFields), params)
  }
  for (const change of stockChanges) {
    await emit(cols, 'ProductStock.Changed', change, params)
  }
  const store = () => cols.products.replaceOne({ _id: sku }, stored(next), { upsert: true })
  // A fixed customer price the maximum discount holds up is held at list × (1 − ceiling), so a
  // list price change can move it across that floor: announce each customer whose prices
  // in force it moved (lib/contracts). Discounts follow the list price by themselves.
  if (next.listPrice !== current.listPrice) await announcing(cols, await everyCustomer(cols), store, params)
  else await store()
  return shape(next)
}

/**
 * Remove a product the way the web shop removed it. Deleting a configurable product there
 * leaves its children as products of their own, so a parent's variants stay
 * and stop naming it. Answers what went, or null when the ERP never had the SKU (a
 * redelivered delete is then nothing to do, not an error).
 *
 * @returns {Promise<{ sku: string, unlinked: string[] }|null>}
 */
async function deleteProduct (cols, sku) {
  const found = await cols.products.findOne({ _id: sku })
  if (!found) return null
  const unlinked = []
  for (const variant of await findAll(cols.products, { parentSku: sku }, { limit: 1000 })) {
    const { parentSku, variantAttributes, ...rest } = variant
    await cols.products.replaceOne({ _id: variant._id }, { ...rest, updatedAt: new Date().toISOString() }, { upsert: true })
    unlinked.push(variant.sku)
  }
  await cols.products.deleteMany({ _id: sku })
  return { sku, unlinked: unlinked.sort() }
}

module.exports = {
  deleteProduct, SALES_STATUSES,
  importStock, DEFAULT_WAREHOUSE, importProducts, listProducts, getProduct, patchProduct }
