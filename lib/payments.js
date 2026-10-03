/*
 * Incoming payments (contract version 14, AB-26s; payment-leg-design.md slice S1): what a
 * real ERP posts when a customer pays an invoice — Business Central's cash receipt applied
 * to the invoice, SAP's incoming payment clearing the open item. A payment is more than 0
 * and at most what is open on the invoice (lib/open-items), so a partial payment leaves the
 * rest open. Each is a document of its own, numbered from 7000000001 and kept in its own
 * collection; the invoice's open amount is worked out from them on read, so posting a
 * payment is one write and nothing on the order has to be kept in step.
 *
 * Each raises IncomingPayment.Posted, which a subscriber can turn into the customer's credit
 * given back on its side. A payment cannot be undone in the ERP; a Reset wipes them with the
 * rest.
 *
 * One payment is not posted by a person (contract version 18): an order PAID AT CHECKOUT
 * carries the web shop's payment reference (lib/checkout-payment), and posting its invoice
 * posts the payment against it (payCheckoutInvoice), so the invoice closes with nothing open.
 * That payment says where the money was taken (`paidInWebShop`) and raises NO event: the
 * money moved in the web shop, which already knows, the same rule as any move made in another
 * system (contract order.external).
 */
const { badRequest, notFound } = require('./errors')
const { next: nextCounter, formatDocumentNumber, STARTS } = require('./counters')
const { emit } = require('./events')
const { findAll } = require('./db')
const { amount: amountText } = require('./credit')
const { cents, listOrders } = require('./orders')
const { openItemFor, invoiceTotal } = require('./open-items')
const { stamp } = require('./fulfilment')

/**
 * A payment as the API answers it: the contract's fields, without the storage key. One stored
 * before contract version 18 was posted in the ERP, not paid in the web shop.
 */
function view (stored) {
  const { _id: _key, ...rest } = stored
  return { ...rest, paidInWebShop: stored.paidInWebShop ?? null }
}

/** The amount asked for, to the cent, or the refusal: a number (or numeric text) more than 0. */
function amountOf (value) {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  const rounded = Number.isFinite(number) ? cents(number) : 0
  if (!(rounded > 0)) throw badRequest('A payment needs an amount: a number more than 0.')
  return rounded
}

/** A reference is optional words (a check number, a bank reference); blank means none. */
function referenceOf (value) {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text || null
}

/** The sales order whose invoice has this number (a demo store holds at most a few hundred). */
async function orderOfInvoice (cols, invoiceNumber) {
  const order = (await listOrders(cols)).find((o) => o.invoice && o.invoice.number === invoiceNumber)
  if (!order) throw notFound(`Invoice ${invoiceNumber}`)
  return order
}

/** Why nothing can be paid on an invoice with nothing open, in its own words. */
function nothingOpen (invoiceNumber, item) {
  const why = item.paymentStatus === 'credited' ? 'was credited' : 'is paid'
  return badRequest(`Invoice ${invoiceNumber} ${why}; nothing is open on it.`)
}

/** The IncomingPayment.Posted data: the payment, the invoice it clears, its order and the customer's reference. */
function paymentEvent (order, payment) {
  return {
    Payment: payment.number,
    BillingDocument: payment.invoiceNumber,
    SalesOrder: order.number,
    PurchaseOrderByCustomer: order.purchaseOrderByCustomer ?? null,
    Customer: payment.partnerId ?? null,
    Amount: payment.amount,
    Currency: payment.currency,
    PaymentReference: payment.reference
  }
}

/**
 * Post an incoming payment against an invoice.
 *
 * @param {object} cols collections
 * @param {string} invoiceNumber the invoice paid
 * @param {{ amount: number|string, reference?: string }} input
 * @param {object} [params] action params (to deliver the event)
 * @returns {Promise<object>} the payment, in the contract's payments.response shape
 */
async function postPayment (cols, invoiceNumber, input = {}, params) {
  const order = await orderOfInvoice(cols, invoiceNumber)
  const amount = amountOf(input && input.amount)
  const item = await openItemFor(cols, order)
  if (item.openAmount === 0) throw nothingOpen(invoiceNumber, item)
  if (amount > item.openAmount) {
    throw badRequest(`Invoice ${invoiceNumber} has ${amountText(item.openAmount)} open; a payment of ${amountText(amount)} is more than that.`)
  }
  const payment = await record(cols, order, { amount, reference: referenceOf(input && input.reference), paidInWebShop: null })
  await emit(cols, 'IncomingPayment.Posted', paymentEvent(order, payment), params)
  return payment
}

/** Number a payment against the order's invoice and keep it. */
async function record (cols, order, { amount, reference, paidInWebShop }) {
  const payment = {
    number: formatDocumentNumber(await nextCounter(cols, 'payment', STARTS.payment)),
    createdAt: stamp(),
    partnerId: order.partnerId,
    orderNumber: order.number,
    invoiceNumber: order.invoice.number,
    amount,
    currency: order.currency || 'USD',
    reference,
    paidInWebShop
  }
  await cols.payments.replaceOne({ _id: payment.number }, { _id: payment.number, ...payment }, { upsert: true })
  return payment
}

/**
 * The payment of an order paid at checkout, posted with its invoice (contract version 18):
 * what the web shop captured, and never more than the invoice bills, under the gateway's
 * reference. No event is raised (see the header). An order with no payment reference posts
 * nothing.
 *
 * @param {object} cols collections
 * @param {object} order the sales order, just invoiced
 * @returns {Promise<object|null>} the payment, or null
 */
async function payCheckoutInvoice (cols, order) {
  const paid = order.payment
  if (!paid || !order.invoice || !order.invoice.number) return null
  const amount = cents(Math.min(Number(paid.amount) || 0, invoiceTotal(order)))
  if (!(amount > 0)) return null
  const { method, cardBrand, cardLastFour } = paid
  return record(cols, order, { amount, reference: paid.reference, paidInWebShop: { method, cardBrand, cardLastFour } })
}

/** Every payment, newest number first. */
async function listPayments (cols, filter = {}) {
  return (await findAll(cols.payments, filter, { limit: 1000, sort: { _id: -1 } })).map(view)
}

/** One payment, or null. */
async function getPayment (cols, number) {
  const found = await cols.payments.findOne({ _id: number })
  return found ? view(found) : null
}

/** The payments against one sales order's invoice, oldest first. */
async function paymentsOf (cols, orderNumber) {
  return (await listPayments(cols, { orderNumber })).reverse()
}

module.exports = { postPayment, payCheckoutInvoice, listPayments, getPayment, paymentsOf, paymentEvent }
