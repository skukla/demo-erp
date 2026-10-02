/*
 * What records stored before contract version 16 called things, and what they read as now.
 *
 * Until version 16 the ERP stored a web shop's ids under that shop's own names: an order
 * carried commerceOrderId and commerceIncrementId, each line commerceItemId, a return
 * commerceReturnId, a shipment or invoice made in the shop commerceShipmentId or
 * commerceInvoiceId, and a few stored reasons named the shop. Version 16 keeps what a real
 * ERP keeps instead: the customer's references (lib/orders, lib/returns). Deployed ERPs hold
 * months of the old records, so every read passes through here; nothing is migrated in place.
 *
 * Like the partner guard (lib/partners COMMERCE_FIELDS), this is the one place the old names
 * are spelled, so that nothing else in the ERP needs to know them.
 */

/** The old name of each reference a version 16 record keeps under its own name. */
const OLD = {
  orderId: 'commerceOrderId',
  orderNumber: 'commerceIncrementId',
  lineId: 'commerceItemId',
  returnId: 'commerceReturnId',
  returnNumber: 'commerceReturnIncrementId',
  shipmentId: 'commerceShipmentId',
  invoiceId: 'commerceInvoiceId'
}

/** Stored words that named the shop, and what they read as now. */
const REASONS = {
  'Cancelled in Commerce': 'Canceled in the web shop',
  'Canceled in Commerce': 'Canceled in the web shop',
  'Put on hold in Commerce': 'Put on hold in the web shop',
  "Customer's website account is closed in Commerce": "Customer's website account is closed"
}

const has = (record, key) => Boolean(record) && Object.prototype.hasOwnProperty.call(record, key)
const text = (value) => (value === undefined || value === null || value === '' ? null : String(value))

/** A stored reason as it reads now. */
function reasonNow (value) {
  return typeof value === 'string' && has(REASONS, value) ? REASONS[value] : value
}

/** The record without the named keys. */
function without (record, keys) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)))
}

/** A stored line (sales order, shipment, invoice, return or credit memo) as version 16 reads it. */
function upgradeLine (line) {
  if (!has(line, OLD.lineId)) return line
  return { ...without(line, [OLD.lineId]), customerLineReference: line.customerLineReference ?? text(line[OLD.lineId]) }
}

/** A shipment or invoice made in another system keeps that system's id as its external reference. */
function upgradeDocument (doc, oldKey) {
  if (!doc) return doc
  const lines = Array.isArray(doc.lines) ? { lines: doc.lines.map(upgradeLine) } : {}
  if (!has(doc, oldKey)) return { ...doc, ...lines }
  return { ...without(doc, [oldKey]), ...lines, externalReference: doc.externalReference ?? text(doc[oldKey]) }
}

/**
 * A stored sales order with its references under version 16's names. The customer's
 * reference is the shop's order number when the order kept one, else the id it was sent
 * with (an order sent without its number held nothing else).
 */
function upgradeOrderRecord (stored) {
  if (!stored) return stored
  const reference = stored.purchaseOrderByCustomer ?? text(stored[OLD.orderNumber]) ?? text(stored[OLD.orderId])
  const order = { ...without(stored, [OLD.orderId, OLD.orderNumber]), purchaseOrderByCustomer: reference ?? null }
  // Only the keys the record has: a read adds nothing that was not stored.
  if (Array.isArray(stored.lines)) order.lines = stored.lines.map(upgradeLine)
  if (Array.isArray(stored.shipments)) order.shipments = stored.shipments.map((s) => upgradeDocument(s, OLD.shipmentId))
  if (stored.invoice) order.invoice = upgradeDocument(stored.invoice, OLD.invoiceId)
  if (Array.isArray(stored.creditMemos)) order.creditMemos = stored.creditMemos.map((m) => upgradeDocument(m, OLD.invoiceId))
  if (has(stored, 'cancelReason')) order.cancelReason = reasonNow(stored.cancelReason)
  if (has(stored, 'creditReason')) order.creditReason = reasonNow(stored.creditReason)
  if (Array.isArray(stored.history)) order.history = stored.history.map((h) => (has(h, 'reason') ? { ...h, reason: reasonNow(h.reason) } : h))
  return order
}

/** A stored return order with its shop reference under version 16's name. */
function upgradeReturnRecord (stored) {
  if (!stored) return stored
  const reference = stored.customerReturnReference ?? text(stored[OLD.returnId])
  const record = { ...without(stored, [OLD.returnId, OLD.returnNumber]), customerReturnReference: reference ?? null }
  if (Array.isArray(stored.lines)) record.lines = stored.lines.map(upgradeLine)
  if (stored.creditMemo) record.creditMemo = upgradeDocument(stored.creditMemo, OLD.invoiceId)
  return record
}

/**
 * The stored order a reference names, found under either name: version 16's
 * purchaseOrderByCustomer, else an older record's order number. (Not its old id: an id and
 * another order's number can be the same digits.)
 */
async function findOrderByReference (collection, reference) {
  return (await collection.findOne({ purchaseOrderByCustomer: reference })) ||
    collection.findOne({ [OLD.orderNumber]: reference })
}

/** The stored return order a shop reference names, under either name. */
async function findReturnByReference (collection, reference) {
  return (await collection.findOne({ customerReturnReference: reference })) ||
    collection.findOne({ [OLD.returnId]: reference })
}

module.exports = { upgradeOrderRecord, upgradeReturnRecord, upgradeLine, reasonNow, findOrderByReference, findReturnByReference }
