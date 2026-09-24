/*
 * GET shipments           every shipment, newest number first, each naming its sales order, its
 *                         sold-to (`partnerName`) and its warehouse by the ERP's name (`warehouseName`)
 * GET shipments/:number   one shipment as its document shows it
 *
 * Read-only: a shipment is created and posted on its ORDER (actions/orders), because that
 * is the document the quantities belong to. This action exists so the screen can list and
 * open shipments as documents of their own.
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listShipments, getShipment, warehouseOf } = require('../../lib/fulfilment')
const { listPartners } = require('../../lib/partners')
const { listProducts } = require('../../lib/products')
const { getSettings } = require('../../lib/settings')

/** The list rows, each naming its sold-to and its warehouse as the ERP calls it. */
async function listRows (cols) {
  const [rows, partners, products, settings] = await Promise.all([listShipments(cols), listPartners(cols), listProducts(cols), getSettings(cols)])
  const names = new Map(partners.map((p) => [p.id, p.name]))
  const bySku = new Map(products.map((p) => [p.sku, p]))
  return rows.map((s) => {
    const warehouse = warehouseOf(s.warehouse, bySku, settings.warehouses || {})
    return { ...s, partnerName: names.get(s.partnerId) || null, warehouseName: warehouse ? warehouse.name : null }
  })
}

async function handler ({ cols, method, segments }) {
  const number = segments[0] || null
  if (method === 'GET' && !number) return ok({ items: await listRows(cols) })
  if (method === 'GET') {
    const shipment = await getShipment(cols, number)
    if (!shipment) throw notFound(`Shipment ${number}`)
    return ok(shipment)
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
