/*
 * GET products                   every product with `committed` and `available` (lib/availability)
 * GET products/:sku              the product, plus its `openOrders` — each order holding it, with the customer named
 * PATCH products/:sku            { name?, listPrice?, warehouses?, salesStatus? }
 * DELETE products/:sku { origin? }   the product was deleted in the web shop; its variants stay as products of their own
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listProducts, getProduct, patchProduct, deleteProduct } = require('../../lib/products')
const { listOrders } = require('../../lib/orders')
const { listPartners } = require('../../lib/partners')
const { committedBySku, openOrdersFor, withAvailability, withAvailabilityAll, promiseLine } = require('../../lib/availability')
const { journalDelete } = require('../../lib/inbound')

/** One product as its page shows it: committed, available, and the orders behind them. */
async function describeProduct (cols, product) {
  const [orders, partners] = await Promise.all([listOrders(cols), listPartners(cols)])
  const names = new Map(partners.map((p) => [p.id, p.name]))
  const skus = product.type === 'configurable' ? (product.variants || []).map((v) => v.sku) : [product.sku]
  const openOrders = openOrdersFor(orders, skus).map((row) => ({ ...row, customer: names.get(row.partnerId) || null }))
  return { ...withAvailability(product, committedBySku(orders)), openOrders }
}

async function handler ({ cols, method, segments, body, params }) {
  const sku = segments[0] ? decodeURIComponent(segments[0]) : null
  if (method === 'GET' && !sku) {
    const [rows, orders] = await Promise.all([listProducts(cols), listOrders(cols)])
    return ok({ items: withAvailabilityAll(rows, committedBySku(orders)) })
  }
  // Available-to-promise (AB-19): the live question a synced stock number cannot answer —
  // "can I have this quantity, and by when". Batch, for a whole cart. Ships today what is
  // available now; the shortfall after the product's lead time.
  if (method === 'POST' && segments[0] === 'availability') {
    const lines = Array.isArray(body && body.lines) ? body.lines : []
    const [rows, orders] = await Promise.all([listProducts(cols), listOrders(cols)])
    const committed = committedBySku(orders)
    const bySku = new Map(rows.map((p) => [p.sku, p]))
    const today = new Date()
    const answers = lines.map((line) => {
      const product = bySku.get(line.sku)
      if (!product) return { sku: line.sku, unknown: true }
      const { available } = withAvailability(product, committed)
      return promiseLine({ sku: product.sku, available, requested: line.qty, leadTimeDays: product.leadTimeDays, today })
    })
    return ok({ lines: answers })
  }
  if (method === 'GET') {
    const product = await getProduct(cols, sku)
    if (!product) throw notFound(`Product ${sku}`)
    return ok(await describeProduct(cols, product))
  }
  if ((method === 'PATCH' || method === 'POST') && sku) {
    const product = await patchProduct(cols, sku, body, params)
    if (!product) throw notFound(`Product ${sku}`)
    return ok(await describeProduct(cols, product))
  }
  if (method === 'DELETE' && sku) {
    const removed = await deleteProduct(cols, sku)
    if (!removed) throw notFound(`Product ${sku}`)
    await journalDelete(cols, body || {}, removed)
    return ok(removed)
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
