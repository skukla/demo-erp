/*
 * Goods issue (AB-63): when a shipment is posted the goods leave the shelf, so the plant's
 * on-hand quantity falls by what the shipment carried — SAP's goods issue for an outbound
 * delivery, Business Central's posted sales shipment. Until 2026-10-03 nothing moved: on hand
 * stayed put while the order stopped committing the stock, so Available ROSE after shipping.
 *
 * Two kinds of shipment, two rules for a shortfall:
 *
 *   - posted HERE (lib/fulfilment postShipment): refused, in words, when the shipment's
 *     warehouse holds less than the shipment needs. An ERP does not issue goods it does not
 *     have; on hand never goes below zero.
 *   - posted IN ANOTHER SYSTEM (receiveExternalShipment): the goods have already left, so the
 *     ERP cannot refuse. It takes what it has, on hand stops at zero, and the journal entry
 *     says how many were missing.
 *
 * NO ProductStock.Changed is raised for a goods issue — on purpose. The integration applies
 * that event by SETTING the web shop's quantity at that source to the ERP's number, and the
 * web shop takes the same units out itself when it makes its own shipment (which the
 * integration does on OutboundDelivery.GoodsIssueStatusChanged, or which the shop did first
 * for an external shipment). With N on hand and one shipped:
 *
 *   - stock event applied AFTER the shop's shipment: shop is N-1, set to N-1. Harmless.
 *   - stock event applied BEFORE it (the two are separate deliveries; a failed or retried
 *     shipment puts it later): shop set to N-1, then its shipment takes one more: N-2. The
 *     unit is taken twice, and nothing puts it back.
 *
 * It is also an absolute number: it would overwrite whatever else the shop had done to that
 * quantity since the two last agreed. The delivery event already tells the shop exactly what
 * left and from which plant, so the stock event could only repeat it or break it. A stock
 * EDIT (lib/products patchProduct) and a return's receipt (lib/returns restock) still raise
 * it: those are changes the shop has no other way to hear of.
 *
 * Nothing here reverses a goods issue because nothing un-posts a shipment: a shipped order
 * cannot be canceled (lib/fulfilment cancelOrder). Goods come back through a return order,
 * whose receipt puts them on the shelf again.
 */
const { badRequest } = require('./errors')
const { getProduct, takeStock, DEFAULT_WAREHOUSE } = require('./products')

/**
 * The warehouse a product's units leave from: the one the shipment names; when it names none
 * (or, for a shipment posted elsewhere, one the product is not kept in), the default
 * warehouse if the product is kept there, else its first. The same fallback a return uses to
 * put goods back (lib/returns warehouseFor), so a return lands where the issue took from.
 */
function sourceOf (named, warehouses, lenient) {
  const codes = warehouses.map((w) => w.code)
  if (named && (codes.includes(named) || !lenient)) return named
  return codes.includes(DEFAULT_WAREHOUSE.code) ? DEFAULT_WAREHOUSE.code : (codes[0] || null)
}

/**
 * What posting a shipment takes from stock: one move per product (its lines summed). A
 * product this ERP does not keep, or a configurable parent, has no stock to move.
 *
 * @param {{ warehouse: string|null, lines: { item: number, sku: string, qty: number }[] }} shipment
 * @param {{ lenient?: boolean }} [options] lenient for a shipment posted in another system
 * @returns {Promise<{ sku: string, item: number, unit: string, code: string|null, qty: number, onHand: number }[]>}
 */
async function goodsMoves (cols, shipment, { lenient = false } = {}) {
  const moves = []
  for (const sku of new Set(shipment.lines.map((l) => l.sku))) {
    const product = await getProduct(cols, sku)
    if (!product || product.type === 'configurable') continue
    const lines = shipment.lines.filter((l) => l.sku === sku)
    const code = sourceOf(shipment.warehouse, product.warehouses, lenient)
    const held = product.warehouses.find((w) => w.code === code)
    moves.push({ sku, item: lines[0].item, unit: product.unit || 'EA', code, qty: lines.reduce((sum, l) => sum + l.qty, 0), onHand: held ? held.quantity : 0 })
  }
  return moves
}

const short = (move) => move.qty > move.onHand
const inWarehouse = (move) => (move.code ? ` in warehouse ${move.code}` : '')

/** Refuse a shipment posted here that needs more than its warehouse has on hand. */
function refuseIfShort (moves) {
  const move = moves.find(short)
  if (move) throw badRequest(`Item ${move.item}: ${move.onHand} ${move.unit} of ${move.sku} are on hand${inWarehouse(move)}; this shipment needs ${move.qty}.`)
}

/** Take the moves out of stock. No stock event (see the top of this file); never below zero. */
async function issueGoods (cols, moves) {
  for (const move of moves) {
    if (move.code && move.onHand > 0) await takeStock(cols, move.sku, move.code, Math.min(move.qty, move.onHand))
  }
}

/** For the journal entry of a shipment posted elsewhere: what the ERP did not have, or ''. */
function shortfallNote (moves) {
  const missing = moves.filter(short).map((m) => `${m.sku} had ${m.onHand} ${m.unit}${m.code ? ` in ${m.code}` : ''}, ${m.qty - m.onHand} fewer than shipped`)
  return missing.length ? `. On hand was short: ${missing.join('; ')}.` : ''
}

module.exports = { goodsMoves, refuseIfShort, issueGoods, shortfallNote }
