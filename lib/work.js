/*
 * Home's work list: what is waiting for someone in this ERP, counted from the documents
 * themselves. Nothing here is stored — each cue is the number of documents on which the
 * matching move is open right now, decided by the same `abilities` the documents' own
 * buttons read (lib/orders), so a cue can never disagree with the document it opens.
 *
 * SAP's credit guidance describes this surface: "credit personnel can call and process
 * overview lists of the blocked orders and deliveries" (plan §3.1). Fiori calls it an
 * overview page; Business Central a Role Center. Counts of records are not work and are
 * not here — they stayed on Settings.
 */
const { listOrders, abilities, netOf, cents } = require('./orders')
const { listPartners } = require('./partners')
const { pending, failed } = require('./events')

const { CUES } = require('./cues')

/** Which cue an order counts toward, from its abilities — the screen's filters use the same keys. */
function orderCues (order) {
  const can = abilities(order)
  return {
    toConfirm: can.confirm,
    onHold: can.release,
    toShip: can.ship,
    toInvoice: can.invoice
  }
}

/** The five documents most recently written to, any kind, newest first. */
function recentDocuments (orders, limit = 5) {
  const rows = []
  for (const order of orders) {
    const last = (order.history || []).reduce((at, h) => (h.at > at ? h.at : at), order.createdAt || '')
    rows.push({ kind: 'order', number: order.number, at: last, title: `Sales Order ${order.number}` })
    for (const s of order.shipments || []) {
      rows.push({ kind: 'shipment', number: s.number, at: s.postedAt || s.createdAt, title: `Shipment ${s.number}` })
    }
    if (order.invoice && order.invoice.number) {
      rows.push({ kind: 'invoice', number: order.invoice.number, at: order.invoice.createdAt, title: `Invoice ${order.invoice.number}` })
    }
  }
  return rows.filter((r) => r.at).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit)
}

/**
 * @returns {Promise<{ counts: object, openValue: { amount: number, currency: string|null }, recent: object[] }>}
 *   `counts` has one number per cue key; `openValue` is the net of every order not yet
 *   invoiced or cancelled, in the one currency the orders share (null when they differ)
 */
async function workList (cols) {
  const [orders, partners, waiting, dead] = await Promise.all([listOrders(cols), listPartners(cols), pending(cols), failed(cols)])
  const counts = { toConfirm: 0, onHold: 0, toShip: 0, toInvoice: 0, toPost: 0, blockedCustomers: 0, eventsFailed: dead.length, eventsPending: waiting.length }
  let amount = 0
  const currencies = new Set()
  for (const order of orders) {
    const cues = orderCues(order)
    for (const key of Object.keys(cues)) if (cues[key]) counts[key] += 1
    counts.toPost += (order.shipments || []).filter((s) => s.status !== 'posted').length
    if (order.header !== 'cancelled' && !order.invoice) {
      amount += netOf(order)
      currencies.add(order.currency || 'USD')
    }
  }
  counts.blockedCustomers = partners.filter((p) => p.blocking && p.blocking !== 'open').length
  return {
    counts,
    openValue: { amount: cents(amount), currency: currencies.size === 1 ? [...currencies][0] : null },
    recent: recentDocuments(orders)
  }
}

module.exports = { CUES, orderCues, recentDocuments, workList }
