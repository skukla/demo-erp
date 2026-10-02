/*
 * Credit memos (contract version 13): the document that says the ERP owes the buyer money
 * back, numbered from 9500000001 in a range of its own.
 *
 * Two moves make one. Crediting an order's INVOICE credits all of it, once (owner O5,
 * 2026-09-24: full credit only); the invoice then reads credited, and the memo is kept on
 * the sales order (`creditMemos`). Crediting a received RETURN ORDER credits that return's
 * lines (lib/returns), and the memo is kept on the return order. Either way the
 * creditmemo.created event carries exactly the credited lines, so the subscriber credits
 * only those in Commerce. A credit memo cannot be undone, in the ERP as in Commerce.
 *
 * The ERP calculates no tax (lib/orders describeOrder): a memo carries the invoice's tax in
 * proportion to the net it credits, so a whole credit carries the invoice's own figures.
 */
const { badRequest } = require('./errors')
const { next: nextCounter, formatDocumentNumber, STARTS } = require('./counters')
const { emit } = require('./events')
const { findAll } = require('./db')
const orders = require('./orders')
const { mustExist, save, stamp } = require('./fulfilment')

const { cents, netOf, orderEventPayload, listOrders } = orders

/** "Invoice 9000000001", or what an invoice from before numbering is called. */
function invoiceName (invoice) {
  return invoice.number ? `Invoice ${invoice.number}` : "This order's invoice"
}

/** An invoice credited in whole says so, with the memo that did it. */
function refuseIfInvoiceCredited (invoice) {
  if (invoice.status === 'credited') throw badRequest(`${invoiceName(invoice)} was credited by credit memo ${invoice.creditMemo}.`)
}

/** The orderEventItem of each credited line Commerce knows. */
function eventItems (lines) {
  return lines.filter((l) => l.commerceItemId).map((l) => ({ orderItemId: Number(l.commerceItemId), qty: l.qty, sku: l.sku }))
}

/**
 * A credit memo for some lines of an order's invoice, numbered.
 *
 * @param {object} order the sales order (upgraded), with its invoice
 * @param {{ item, sku, qty, price, commerceItemId }[]} lines what is credited
 * @param {string|null} returnNumber the return order it credits, or null
 * @returns {Promise<object>} the document, in the contract's creditMemo.response shape
 */
async function makeCreditMemo (cols, order, lines, returnNumber) {
  const invoice = order.invoice
  const credited = lines.map((l) => ({ item: l.item, sku: l.sku, qty: l.qty, price: l.price, amount: cents(l.qty * l.price), commerceItemId: l.commerceItemId ?? null }))
  const net = cents(credited.reduce((sum, l) => sum + l.amount, 0))
  const invoiceNet = Number(invoice.net ?? netOf(order))
  const invoiceTax = Number(invoice.tax ?? cents(Number(order.total ?? invoiceNet) - invoiceNet))
  const tax = invoiceNet ? cents((invoiceTax * net) / invoiceNet) : 0
  return {
    number: formatDocumentNumber(await nextCounter(cols, 'creditMemo', STARTS.creditMemo)),
    createdAt: stamp(),
    orderNumber: order.number,
    invoiceNumber: invoice.number ?? null,
    returnNumber: returnNumber ?? null,
    lines: credited,
    net,
    tax,
    total: cents(net + tax)
  }
}

/**
 * The creditmemo.created value: the order's event fields without its status, the memo, the
 * return it credits (or nulls), its credited lines and its total.
 */
function creditMemoEvent (order, memo, returnOrder) {
  const { status: _status, items: _items, ...head } = orderEventPayload(order)
  return {
    ...head,
    creditMemoNumber: memo.number,
    returnNumber: returnOrder ? returnOrder.number : null,
    commerceReturnId: returnOrder ? Number(returnOrder.commerceReturnId) : null,
    items: eventItems(memo.lines),
    total: memo.total
  }
}

/** The return orders on a sales order, oldest first. */
function returnsOf (cols, orderNumber) {
  return findAll(cols.returnOrders, { orderNumber }, { limit: 500, sort: { _id: 1 } })
}

/** The return orders on a sales order that a credit memo has already credited. */
async function creditedReturns (cols, orderNumber) {
  return (await returnsOf(cols, orderNumber)).filter((r) => r.creditMemo)
}

/**
 * Credit an order's invoice in full: refused when there is no invoice, when it was credited
 * already, when a return has credited part of it (the rest is credited by return), or while
 * a return on it is still open.
 */
async function creditInvoice (cols, number, params) {
  const order = await mustExist(cols, number)
  if (!order.invoice) throw badRequest('This order has no invoice to credit.')
  refuseIfInvoiceCredited(order.invoice)
  const returns = await returnsOf(cols, number)
  const byReturn = returns.find((r) => r.creditMemo)
  if (byReturn) throw badRequest(`Return order ${byReturn.number} credited part of this invoice (credit memo ${byReturn.creditMemo.number}); credit the rest by return.`)
  // A whole credit would leave an open return never creditable (refuseIfInvoiceCredited).
  const open = returns.find((r) => !r.creditMemo)
  if (open) throw badRequest(`Return order ${open.number} is still open on this invoice; receive and credit it, or credit by return.`)
  const invoiced = order.invoice.lines && order.invoice.lines.length ? order.invoice.lines : order.lines
  const lines = invoiced.map((l) => ({ ...l, commerceItemId: order.lines.find((x) => x.item === l.item)?.commerceItemId ?? null }))
  const memo = await makeCreditMemo(cols, order, lines, null)
  const next = await save(cols, {
    ...order,
    invoice: { ...order.invoice, status: 'credited', creditMemo: memo.number },
    creditMemos: [...(order.creditMemos || []), memo],
    history: [...order.history, { status: 'credited', at: memo.createdAt, creditMemo: memo.number }]
  })
  await emit(cols, 'creditmemo.created', creditMemoEvent(next, memo, null), params)
  return next
}

/** Every credit memo of one sales order, from its invoice and its returns, by number. */
async function creditMemosOf (cols, order) {
  const byReturn = (await creditedReturns(cols, order.number)).map((r) => r.creditMemo)
  return [...(order.creditMemos || []), ...byReturn].sort((a, b) => (a.number < b.number ? -1 : 1))
}

/** Every credit memo, from both sources, newest number first, each naming its customer and currency. */
async function listCreditMemos (cols) {
  const salesOrders = await listOrders(cols)
  const byNumber = new Map(salesOrders.map((o) => [o.number, o]))
  const returns = await findAll(cols.returnOrders, {}, { limit: 1000, sort: { _id: -1 } })
  const memos = [...salesOrders.flatMap((o) => o.creditMemos || []), ...returns.filter((r) => r.creditMemo).map((r) => r.creditMemo)]
  return memos.map((m) => {
    const order = byNumber.get(m.orderNumber) || {}
    const { lines, ...head } = m
    return { ...head, lines: lines.length, partnerId: order.partnerId ?? null, currency: order.currency ?? null }
  }).sort((a, b) => (a.number < b.number ? 1 : -1))
}

/** One credit memo as its document, or null. */
async function getCreditMemo (cols, number) {
  for (const order of await listOrders(cols)) {
    const memo = (order.creditMemos || []).find((m) => m.number === number)
    if (memo) return memo
  }
  const returns = await findAll(cols.returnOrders, {}, { limit: 1000 })
  const found = returns.find((r) => r.creditMemo && r.creditMemo.number === number)
  return found ? found.creditMemo : null
}

module.exports = { makeCreditMemo, creditMemoEvent, refuseIfInvoiceCredited, creditInvoice, creditMemosOf, listCreditMemos, getCreditMemo, eventItems }
