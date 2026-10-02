/*
 * What arrived from another system, in words, for the Events log.
 *
 * A write the integration makes for a change in its own system names that system and the
 * document behind it (`origin: { system, document?, eventId? }`, contract version 16), so the
 * log can say who sent it and what it was. Only writes that carry an origin are journaled:
 * Demo Builder's fill imports in batches, and eight identical "25 products" rows would bury
 * the change someone is looking for.
 */
const { receive } = require('./events')

/** Text, trimmed and capped, or undefined when blank. */
function wordsOf (value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

/**
 * The origin a write carries: the sending system's name, the document it sent (its own
 * words, "shipment 900"), and the delivered event's id when the integration passed one on.
 * Undefined when the write names no system: then it is not a change from elsewhere.
 *
 * @param {object} body a request body
 * @returns {{ system: string, document?: string, eventId?: string }|undefined}
 */
function originOf (body) {
  const origin = body && body.origin
  const system = origin && wordsOf(origin.system, 100)
  if (!system) return undefined
  const document = wordsOf(origin.document, 200)
  const eventId = wordsOf(origin.eventId, 100)
  return { system, ...(document ? { document } : {}), ...(eventId ? { eventId } : {}) }
}

/** "name "X", price 12, stock 4" — what one product row set. */
function productChanges (row, stockNotApplied) {
  const parts = []
  if (row.name) parts.push(`name "${row.name}"`)
  if (row.listPrice !== undefined && row.listPrice !== null) parts.push(`price ${row.listPrice}`)
  if (row.stock !== undefined && row.stock !== null) {
    parts.push(
      stockNotApplied.includes(row.sku)
        ? `stock ${row.stock} not applied (it is not stocked in the default source)`
        : `stock ${row.stock}`,
    )
  }
  return parts.join(', ')
}

/** "Stock of A1: default 12, east 3" per row, or a count; a SKU the ERP does not have says so. */
function stockLines (rows, result, system) {
  const unknown = new Set((result && result.unknown) || [])
  if (rows.length === 0) return []
  if (rows.length > 3) return [`Stock of ${rows.length} products from ${system}${unknown.size ? ` (${unknown.size} not in the ERP)` : ''}`]
  return rows.map((row) => (unknown.has(row.sku)
    ? `Stock of ${row.sku} not applied (the ERP has no such product)`
    : `Stock of ${row.sku}: ${(row.warehouses || []).map((w) => `${w.code} ${w.quantity}`).join(', ')}`))
}

/**
 * Journal an import that a change in another system brought.
 *
 * @param {object} cols collections
 * @param {object} body the import body (`products`, `partners`, `stock`, `origin`)
 * @param {object} result what the import did (`products`, `partners`, `stock` counts)
 * @returns {Promise<object|undefined>} the entry, or undefined when there was no origin
 */
async function journalImport (cols, body, result) {
  const origin = originOf(body)
  if (!origin) return undefined
  const products = Array.isArray(body.products) ? body.products : []
  const partners = Array.isArray(body.partners) ? body.partners : []
  const notApplied = (result.products && result.products.stockNotApplied) || []
  const lines = []
  if (products.length === 1) {
    const verb = result.products && result.products.created ? 'created' : 'updated'
    const changes = productChanges(products[0], notApplied)
    lines.push(`Product ${products[0].sku} ${verb}${changes ? `: ${changes}` : ''}`)
  } else if (products.length > 1) {
    lines.push(`${products.length} products from ${origin.system}`)
  }
  if (partners.length === 1) lines.push(`Customer ${partners[0].id || partners[0].name} updated`)
  else if (partners.length > 1) lines.push(`${partners.length} customers from ${origin.system}`)
  lines.push(...stockLines(Array.isArray(body.stock) ? body.stock : [], result.stock, origin.system))
  return receive(cols, origin, lines.join('. ') || 'Nothing to import', {
    skus: products.map((p) => p.sku),
    partners: partners.map((p) => p.id).filter(Boolean),
  })
}

/**
 * Journal an order the ERP took, the first time only.
 *
 * @param {object} cols collections
 * @param {object} body the order body (carries `origin`)
 * @param {object} order the sales order
 */
function journalOrder (cols, body, order) {
  const origin = originOf(body)
  if (!origin) return undefined
  return receive(cols, origin, `Order ${order.purchaseOrderByCustomer} from ${origin.system} received as sales order ${order.number}`, {
    purchaseOrderByCustomer: order.purchaseOrderByCustomer,
    number: order.number,
  })
}

/**
 * Journal a product another system deleted, when the delete names its origin.
 *
 * @param {object} cols collections
 * @param {object} body the delete body (carries `origin`)
 * @param {{ sku: string, unlinked: string[] }} removed what deleteProduct did
 */
function journalDelete (cols, body, removed) {
  const origin = originOf(body)
  if (!origin) return undefined
  const variants = removed.unlinked.length > 0 ? `; its ${removed.unlinked.length} variant(s) stay as products of their own` : ''
  return receive(cols, origin, `Product ${removed.sku} removed (deleted in ${origin.system})${variants}`, { sku: removed.sku, unlinked: removed.unlinked })
}

/**
 * Journal a customer return the ERP took as a return order, the first time only.
 *
 * @param {object} cols collections
 * @param {object} body the return body (carries `origin`)
 * @param {object} returnOrder the return order (lib/returns)
 */
function journalReturn (cols, body, returnOrder) {
  const origin = originOf(body)
  if (!origin) return undefined
  return receive(cols, origin, `Return ${returnOrder.customerReturnReference} from ${origin.system} received as return order ${returnOrder.number} for sales order ${returnOrder.orderNumber}`, {
    customerReturnReference: returnOrder.customerReturnReference,
    returnNumber: returnOrder.number,
    number: returnOrder.orderNumber,
  })
}

module.exports = { originOf, journalImport, journalOrder, journalDelete, journalReturn }
