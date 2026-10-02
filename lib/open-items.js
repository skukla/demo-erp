/*
 * Open items (contract version 14, AB-26s; payment-leg-design.md): an invoice is what the
 * customer owes until it is paid, as SAP's open item and Business Central's open customer
 * ledger entry are. What is still open is DERIVED, never stored: the invoice's total, less
 * the payments posted against it (lib/payments, their own collection), less what credit
 * memos took off it. A whole-invoice credit (lib/credit-memos creditInvoice) leaves nothing
 * open; a return's credit memo lowers the open amount by its total.
 *
 * Derived rather than kept on the invoice so nothing has to stay in step: a payment is one
 * write (its own document), and an invoice stored before version 14 carries no payment data
 * yet reads correctly, open for its total. An invoice from before invoice documents were
 * kept (no number) is not an open item: no payment can name it, so counting it would hold
 * the customer's credit with no way to release it.
 *
 * It requires nothing, so lib/partners (which lib/orders requires) can read it, and so can the
 * screen's preview (preview/fakeApi.js), which then answers by the same rule as the ERP.
 */

/** The four states, in the contract's words (payments.paymentStatuses). */
const PAYMENT_STATUSES = ['open', 'partly paid', 'paid', 'credited']

/** Money, to the cent: the rounding lib/orders uses (which this module does not require). */
const cents = (value) => Math.round(value * 100) / 100

const sum = (rows, key) => cents(rows.reduce((total, r) => total + (Number(r[key]) || 0), 0))

/** What the invoice bills: its own total, or the order's for an invoice that kept none. */
function invoiceTotal (order) {
  return Number(order.invoice.total ?? order.total) || 0
}

/** The word for what is open, paid and credited. */
function statusOf (open, paid, credited) {
  if (open > 0) return paid > 0 ? 'partly paid' : 'open'
  return credited > 0 && paid === 0 ? 'credited' : 'paid'
}

/**
 * @param {object} order a sales order with a numbered invoice
 * @param {object[]} payments the payments posted against its invoice
 * @param {object[]} credits the credit memos of its returns (a whole credit reads from the invoice)
 * @returns {{ openAmount: number, paidAmount: number, paymentStatus: string, payments: string[] }}
 */
function openItemOf (order, payments, credits) {
  const paidAmount = sum(payments, 'amount')
  const numbers = payments.map((p) => p.number).sort()
  if (order.invoice.status === 'credited') return { openAmount: 0, paidAmount, paymentStatus: 'credited', payments: numbers }
  const credited = sum(credits, 'total')
  const openAmount = Math.max(0, cents(invoiceTotal(order) - credited - paidAmount))
  return { openAmount, paidAmount, paymentStatus: statusOf(openAmount, paidAmount, credited), payments: numbers }
}

/** Rows grouped by their sales order number. */
function byOrder (rows) {
  const grouped = new Map()
  for (const row of rows) grouped.set(row.orderNumber, [...(grouped.get(row.orderNumber) || []), row])
  return grouped
}

/**
 * Read the payments and return orders once, and answer each order's open item from them.
 *
 * @param {object} cols collections
 * @param {object} [filter] narrows both reads: `{ orderNumber }`, `{ partnerId }`, or all
 * @returns {Promise<(order: object) => object|null>} the open item fields of an order's
 *   invoice, or null when the order has no numbered invoice
 */
async function openItemReader (cols, filter = {}) {
  // The collection handles' own find (lib/db wrapCollection), so this module needs no require.
  const read = (collection) => collection.find(filter, { limit: 5000 }).toArray()
  const [payments, returns] = await Promise.all([read(cols.payments), read(cols.returnOrders)])
  const paid = byOrder(payments)
  const credits = byOrder(returns.filter((r) => r.creditMemo).map((r) => ({ ...r.creditMemo, orderNumber: r.orderNumber })))
  return (order) => {
    if (!order || !order.invoice || !order.invoice.number) return null
    return openItemOf(order, paid.get(order.number) || [], credits.get(order.number) || [])
  }
}

/** One order's open item, read for that order alone. */
async function openItemFor (cols, order) {
  return (await openItemReader(cols, { orderNumber: order.number }))(order)
}

module.exports = { PAYMENT_STATUSES, openItemOf, openItemReader, openItemFor, invoiceTotal }
