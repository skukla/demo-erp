/*
 * Which move a return order or an invoice offers in its state. Pure, with no dependencies,
 * so the screen's buttons (screen/src) and Home's cues (lib/work) read the same rule — as
 * an order's buttons and cues both read lib/orders `abilities` — and a cue can never count
 * a document whose button is not there.
 *
 * A return order is open, received, then credited (lib/returns): open offers Receive,
 * received offers its credit memo. An invoice offers its whole-invoice credit until it is
 * credited (lib/credit-memos); the ERP's other refusals (an open return on it, a return
 * that credited part of it) are answered in words when the button is pressed.
 */

/** @returns {{ receive: boolean, credit: boolean }} */
function returnMoves (returnOrder) {
  const status = returnOrder && returnOrder.status
  return { receive: status === 'open', credit: status === 'received' }
}

/** True for a numbered invoice not yet credited. */
function canCreditInvoice (invoice) {
  return Boolean(invoice && invoice.number && invoice.status !== 'credited')
}

module.exports = { returnMoves, canCreditInvoice }
