/*
 * What arrived from Commerce, in words, for the Events log.
 *
 * The integration names the Commerce event behind each write (`origin: { event }`),
 * so the log can say which change brought it. Only writes that carry an origin are
 * journaled: a sync imports in batches, and eight identical "25 products" rows would
 * bury the change someone is looking for — the sync journals itself once, when it
 * finishes (sync-status.js).
 */
const { receive } = require('./events')

/** The Commerce event an integration write names, or undefined. */
function originEvent (body) {
  const event = body && body.origin && body.origin.event
  return typeof event === 'string' && event.trim() ? event.trim() : undefined
}

/** The delivered event's own id, when the integration passed it on. */
function originEventId (body) {
  const id = body && body.origin && body.origin.eventId
  return typeof id === 'string' && id.trim() ? id.trim().slice(0, 100) : undefined
}

/** "name "X", price 12, stock 4" — what one Commerce product row set. */
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

/**
 * Journal an import that a Commerce event brought.
 *
 * @param {object} cols collections
 * @param {object} body the import body (`products`, `partners`, `origin`)
 * @param {object} result what the import did (`products`, `partners` counts)
 * @returns {Promise<object|undefined>} the entry, or undefined when there was no origin
 */
async function journalImport (cols, body, result) {
  const event = originEvent(body)
  if (!event) return undefined
  const products = Array.isArray(body.products) ? body.products : []
  const partners = Array.isArray(body.partners) ? body.partners : []
  const notApplied = (result.products && result.products.stockNotApplied) || []
  const lines = []
  if (products.length === 1) {
    const verb = result.products && result.products.created ? 'created' : 'updated'
    const changes = productChanges(products[0], notApplied)
    lines.push(`Product ${products[0].sku} ${verb}${changes ? `: ${changes}` : ''}`)
  } else if (products.length > 1) {
    lines.push(`${products.length} products from Commerce`)
  }
  if (partners.length === 1) lines.push(`Business partner ${partners[0].id || partners[0].name} updated`)
  else if (partners.length > 1) lines.push(`${partners.length} business partners from Commerce`)
  return receive(cols, event, lines.join('. ') || 'Nothing to import', {
    skus: products.map((p) => p.sku),
    partners: partners.map((p) => p.id).filter(Boolean),
  }, originEventId(body))
}

/**
 * Journal a Commerce order the ERP took, the first time only.
 *
 * @param {object} cols collections
 * @param {object} body the order body (carries `origin`)
 * @param {object} order the sales order
 */
function journalOrder (cols, body, order) {
  const event = originEvent(body)
  if (!event) return undefined
  const commerce = order.commerceIncrementId || order.commerceOrderId
  return receive(cols, event, `Commerce order ${commerce} received as sales order ${order.number}`, {
    commerceOrderId: order.commerceOrderId,
    number: order.number,
  }, originEventId(body))
}

/**
 * Journal a finished sync, once.
 *
 * @param {object} cols collections
 * @param {object} sync the sync record as it finished
 */
function journalSync (cols, sync) {
  const products = sync.products ? sync.products.total : 0
  const partners = sync.partners ? sync.partners.total : 0
  return receive(cols, 'Sync from Commerce', `Synced ${products} products and ${partners} business partners`, {})
}

module.exports = { originEvent, journalImport, journalOrder, journalSync }
