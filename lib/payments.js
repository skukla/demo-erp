/*
 * Incoming payments (contract version 14, AB-26s; payment-leg-design.md slice S1): what a
 * real ERP posts when a customer pays an invoice — Business Central's cash receipt applied
 * to the invoice, SAP's incoming payment clearing the open item. A payment is more than 0
 * and at most what is open on the invoice (lib/open-items), so a partial payment leaves the
 * rest open. Each is a document of its own, numbered from 7000000001 and kept in its own
 * collection; the invoice's open amount is worked out from them on read, so posting a
 * payment is one write and nothing on the order has to be kept in step.
 *
 * Each raises payment.posted, which the integration turns into the company's credit given
 * back in Commerce. A payment cannot be undone in the ERP; a Reset wipes them with the rest.
 */
const { badRequest, notFound } = require('./errors')
const { next: nextCounter, formatDocumentNumber, STARTS } = require('./counters')
const { emit } = require('./events')
const { findAll } = require('./db')
const { amount: amountText } = require('./credit')
const { cents, listOrders, orderEventPayload } = require('./orders')
const { openItemFor } = require('./open-items')
const { stamp } = require('./fulfilment')

/** A payment as the API answers it: the contract's fields, without the storage key. */
function view (stored) {
  const { _id: _key, ...rest } = stored
  return rest
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

/** The payment.posted value: the order's event fields without its status, items or notice. */
function paymentEvent (order, payment) {
  const { status: _status, items: _items, notifyCustomer: _notify, ...head } = orderEventPayload(order)
  return {
    ...head,
    paymentNumber: payment.number,
    invoiceNumber: payment.invoiceNumber,
    amount: payment.amount,
    currency: payment.currency,
    partnerId: payment.partnerId,
    reference: payment.reference
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
  const payment = {
    number: formatDocumentNumber(await nextCounter(cols, 'payment', STARTS.payment)),
    createdAt: stamp(),
    partnerId: order.partnerId,
    orderNumber: order.number,
    invoiceNumber,
    amount,
    currency: order.currency || 'USD',
    reference: referenceOf(input && input.reference)
  }
  await cols.payments.replaceOne({ _id: payment.number }, { _id: payment.number, ...payment }, { upsert: true })
  await emit(cols, 'payment.posted', paymentEvent(order, payment), params)
  return payment
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

module.exports = { postPayment, listPayments, getPayment, paymentsOf, paymentEvent }
