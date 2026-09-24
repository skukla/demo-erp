/*
 * GET shipments           every shipment, newest number first, each naming its sales order
 * GET shipments/:number   one shipment as its document shows it
 *
 * Read-only: a shipment is created and posted on its ORDER (actions/orders), because that
 * is the document the quantities belong to. This action exists so the screen can list and
 * open shipments as documents of their own.
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listShipments, getShipment } = require('../../lib/fulfilment')

async function handler ({ cols, method, segments }) {
  const number = segments[0] || null
  if (method === 'GET' && !number) return ok({ items: await listShipments(cols) })
  if (method === 'GET') {
    const shipment = await getShipment(cols, number)
    if (!shipment) throw notFound(`Shipment ${number}`)
    return ok(shipment)
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
