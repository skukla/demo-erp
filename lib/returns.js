/*
 * Return orders (contract version 13; returns-design.md r1): what a real ERP makes when goods
 * come back — Business Central's Sales Return Order, SAP's returns order. One is made from a
 * Commerce return for THIS ERP's lines of one of its own sales orders, and moves open →
 * received → credited:
 *
 *   - created from the integration, idempotent on the Commerce return id: each line names the
 *     Commerce order line it returns, as the sales order's lines do, and no more than the
 *     invoiced quantity less what earlier returns took;
 *   - received: the goods are back, so stock goes up at the warehouse the order shipped them
 *     from (through the product's own stock edit, so the stock event goes out), and
 *     return.received is raised;
 *   - credited: a credit memo of the received lines (lib/credit-memos), naming the return.
 *
 * Kept in a collection of their own, numbered from 6000000001.
 */
const { badRequest, notFound } = require('./errors')
const { next: nextCounter, formatDocumentNumber, STARTS } = require('./counters')
const { emit } = require('./events')
const { findAll } = require('./db')
const { getOrder, orderEventPayload } = require('./orders')
const { getProduct, patchProduct } = require('./products')
const { stamp, dayOf, unitOf } = require('./fulfilment')
const { makeCreditMemo, creditMemoEvent, refuseIfInvoiceCredited, eventItems } = require('./credit-memos')
const { journalReturn } = require('./inbound')

/** The reason a line carries when the return gave none. */
const DEFAULT_REASON = 'Customer return'

/** A return order as the API answers it: the contract's fields, without the storage key. */
function view (stored) {
  const { _id: _key, ...rest } = stored
  return rest
}

async function save (cols, returnOrder) {
  await cols.returnOrders.replaceOne({ _id: returnOrder.number }, { _id: returnOrder.number, ...returnOrder }, { upsert: true })
  return view(returnOrder)
}

/** Commerce's return id, as text: present, and a whole number. */
function commerceReturnIdOf (value) {
  if (value === undefined || value === null || String(value).trim() === '') throw badRequest('A return needs its commerceReturnId.')
  const id = String(value).trim()
  if (!/^\d+$/.test(id)) throw badRequest("commerceReturnId must be Commerce's return id, a whole number.")
  return id
}

/** A line's reason: the one given, or the default when none was. */
function reasonOf (ask, id) {
  if (ask.reason === undefined || ask.reason === null) return DEFAULT_REASON
  if (typeof ask.reason !== 'string' || !ask.reason.trim()) throw badRequest(`Commerce order item ${id}: the reason must be words.`)
  return ask.reason.trim()
}

/** Invoiced quantity per sales order line: the invoice's lines, or the order's for an invoice that kept none. */
function invoicedQty (order) {
  const lines = order.invoice.lines && order.invoice.lines.length ? order.invoice.lines : order.lines
  return new Map(lines.map((l) => [l.item, Number(l.qty) || 0]))
}

/** What earlier returns of this sales order took, per sales order line. */
async function returnedQty (cols, orderNumber) {
  const taken = new Map()
  for (const r of await findAll(cols.returnOrders, { orderNumber }, { limit: 500 })) {
    for (const l of r.lines) taken.set(l.item, (taken.get(l.item) || 0) + l.qty)
  }
  return taken
}

/** The requested lines, each checked against the sales order and what is still returnable. */
async function checkedLines (cols, order, requested) {
  if (!Array.isArray(requested) || requested.length === 0) throw badRequest('A return needs at least one line.')
  const invoiced = invoicedQty(order)
  const taken = await returnedQty(cols, order.number)
  const lines = []
  for (const ask of requested) {
    const id = String(ask && ask.commerceItemId)
    const line = order.lines.find((l) => l.commerceItemId !== null && l.commerceItemId !== undefined && String(l.commerceItemId) === id)
    if (!line) throw badRequest(`Commerce order item ${id} is not on sales order ${order.number}.`)
    const qty = Number(ask.qty)
    if (!Number.isInteger(qty) || qty < 1) throw badRequest(`Commerce order item ${id}: the quantity must be a whole number of 1 or more.`)
    const of = invoiced.get(line.item) || 0
    const left = Math.max(0, of - (taken.get(line.item) || 0))
    if (qty > left) throw badRequest(`Commerce order item ${id}: ${left} ${await unitOf(cols, line.sku)} can be returned of ${of} invoiced.`)
    // A line named twice in one return counts both times.
    taken.set(line.item, (taken.get(line.item) || 0) + qty)
    lines.push({ item: line.item, sku: line.sku, qty, price: line.price, reason: reasonOf(ask, id), commerceItemId: line.commerceItemId })
  }
  return lines
}

/**
 * Make a return order from a Commerce return, or answer the one already made for it.
 *
 * @param {object} input `{ commerceReturnId, commerceReturnIncrementId?, orderNumber, lines: [{ commerceItemId, qty, reason? }], origin? }`
 * @returns {Promise<{ returnOrder: object, created: boolean }>}
 */
async function createReturn (cols, input = {}) {
  const commerceReturnId = commerceReturnIdOf(input.commerceReturnId)
  const existing = await cols.returnOrders.findOne({ commerceReturnId })
  if (existing) return { returnOrder: view(existing), created: false }
  if (!input.orderNumber) throw badRequest('A return names the sales order it returns (orderNumber).')
  const order = await getOrder(cols, String(input.orderNumber))
  if (!order) throw badRequest(`Sales order ${input.orderNumber} is not in this ERP.`)
  if (!order.invoice) throw badRequest(`Sales order ${order.number} has no invoice; nothing on it can be returned.`)
  refuseIfInvoiceCredited(order.invoice)
  const lines = await checkedLines(cols, order, input.lines)
  const number = formatDocumentNumber(await nextCounter(cols, 'returnOrder', STARTS.returnOrder))
  const at = stamp()
  const returnOrder = await save(cols, {
    number,
    commerceReturnId,
    commerceReturnIncrementId: input.commerceReturnIncrementId ? String(input.commerceReturnIncrementId) : null,
    orderNumber: order.number,
    partnerId: order.partnerId,
    status: 'open',
    lines,
    creditMemo: null,
    history: [{ status: 'open', at }],
    createdAt: at,
    receivedAt: null
  })
  await journalReturn(cols, input, returnOrder)
  return { returnOrder, created: true }
}

/** Every return order, newest first. */
async function listReturns (cols) {
  return (await findAll(cols.returnOrders, {}, { limit: 500, sort: { _id: -1 } })).map(view)
}

async function getReturn (cols, number) {
  const found = await cols.returnOrders.findOne({ _id: number })
  return found ? view(found) : null
}

async function mustExist (cols, number) {
  const found = await getReturn(cols, number)
  if (!found) throw notFound(`Return order ${number}`)
  return found
}

/** The sales order a return order returns from. */
async function orderOf (cols, returnOrder) {
  const order = await getOrder(cols, returnOrder.orderNumber)
  if (!order) throw badRequest(`Sales order ${returnOrder.orderNumber} is no longer in this ERP.`)
  return order
}

/**
 * The warehouse a returned line goes back to: the one a posted shipment of that line came
 * from, when the product is stocked there; else the default source; else the product's first.
 */
function warehouseFor (order, item, product) {
  const codes = (product.warehouses || []).map((w) => w.code)
  const shipment = order.shipments.find((s) => s.status === 'posted' && codes.includes(s.warehouse) && s.lines.some((l) => l.item === item))
  if (shipment) return shipment.warehouse
  return codes.includes('default') ? 'default' : (codes[0] || null)
}

/** Put the returned goods back, one stock edit per product, so the stock event goes out. */
async function restock (cols, order, lines, params) {
  for (const sku of new Set(lines.map((l) => l.sku))) {
    const product = await getProduct(cols, sku)
    if (!product) continue
    const back = new Map()
    for (const l of lines.filter((x) => x.sku === sku)) {
      const code = warehouseFor(order, l.item, product)
      if (code) back.set(code, (back.get(code) || 0) + l.qty)
    }
    const warehouses = [...back].map(([code, qty]) => ({ code, quantity: product.warehouses.find((w) => w.code === code).quantity + qty }))
    if (warehouses.length) await patchProduct(cols, sku, { warehouses }, params)
  }
}

/** Receive the goods of an open return order: all its lines. */
async function receiveReturn (cols, number, params) {
  const stored = await mustExist(cols, number)
  if (stored.status !== 'open') throw badRequest(`Return order ${number} was received on ${dayOf(stored.receivedAt)}.`)
  const order = await orderOf(cols, stored)
  await restock(cols, order, stored.lines, params)
  const at = stamp()
  const next = await save(cols, { ...stored, status: 'received', receivedAt: at, history: [...stored.history, { status: 'received', at }] })
  const { notifyCustomer: _notify, status: _status, items: _items, ...head } = orderEventPayload(order)
  await emit(cols, 'return.received', {
    commerceReturnId: Number(next.commerceReturnId),
    returnNumber: next.number,
    ...head,
    status: next.status,
    items: eventItems(next.lines)
  }, params)
  return next
}

/** Credit a received return order's lines with a credit memo naming it. */
async function creditReturn (cols, number, params) {
  const stored = await mustExist(cols, number)
  if (stored.creditMemo) throw badRequest(`Return order ${number} was credited by credit memo ${stored.creditMemo.number}.`)
  if (stored.status !== 'received') throw badRequest(`Receive return order ${number} before crediting it.`)
  const order = await orderOf(cols, stored)
  refuseIfInvoiceCredited(order.invoice)
  const memo = await makeCreditMemo(cols, order, stored.lines, stored.number)
  const next = await save(cols, {
    ...stored,
    status: 'credited',
    creditMemo: memo,
    history: [...stored.history, { status: 'credited', at: memo.createdAt, creditMemo: memo.number }]
  })
  await emit(cols, 'creditmemo.created', creditMemoEvent(order, memo, next), params)
  return next
}

module.exports = { createReturn, listReturns, getReturn, receiveReturn, creditReturn }
