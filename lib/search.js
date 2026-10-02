/*
 * One search across every document the ERP holds: a number, a SKU, a customer's name.
 * Return orders, credit memos and payments are found by their own numbers and their sales order's.
 * The shell bar asks it as you type, so it answers a short list, best first: an exact
 * number wins over a name that merely contains the words.
 */
const { listOrders } = require('./orders')
const { listShipments, listInvoices } = require('./fulfilment')
const { listProducts } = require('./products')
const { listPartners } = require('./partners')
const { listReturns } = require('./returns')
const { listCreditMemos } = require('./credit-memos')
const { listPayments } = require('./payments')

const LIMIT = 12

const norm = (s) => String(s || '').toLowerCase().trim()

/** 2 = exact, 1 = starts with or contains, 0 = no match. */
function score (fields, needle) {
  let best = 0
  for (const field of fields) {
    const value = norm(field)
    if (!value) continue
    if (value === needle) return 2
    if (value.includes(needle)) best = 1
  }
  return best
}

/**
 * A document found by another document's number never outranks that document: a return
 * order's own number is exact for it, but only "contains" for the credit memo naming it.
 */
function ownFirst (own, related, needle) {
  return Math.max(score(own, needle), Math.min(1, score(related, needle)))
}

/**
 * @param {object} cols collections
 * @param {string} q what was typed
 * @returns {Promise<Array<{kind: string, number: string, title: string, subtitle: string}>>}
 */
async function search (cols, q) {
  const needle = norm(q)
  if (needle.length < 2) return []
  const [orders, shipments, invoices, products, partners, returns, memos, payments] = await Promise.all([
    listOrders(cols), listShipments(cols), listInvoices(cols), listProducts(cols), listPartners(cols), listReturns(cols), listCreditMemos(cols), listPayments(cols)
  ])
  const names = new Map(partners.map((p) => [p.id, p.name]))
  const hits = []
  const add = (rank, row) => { if (rank > 0) hits.push({ rank, ...row }) }
  for (const o of orders) {
    add(score([o.number, o.purchaseOrderByCustomer, names.get(o.partnerId)], needle), {
      kind: 'order', number: o.number, title: `Sales Order ${o.number}`, subtitle: [names.get(o.partnerId), o.purchaseOrderByCustomer ? `Ref ${o.purchaseOrderByCustomer}` : null].filter(Boolean).join(' · ')
    })
  }
  for (const s of shipments) {
    add(score([s.number, s.orderNumber], needle), { kind: 'shipment', number: s.number, title: `Shipment ${s.number}`, subtitle: `for sales order ${s.orderNumber}` })
  }
  for (const i of invoices) {
    if (!i.number) continue
    add(score([i.number, i.orderNumber], needle), { kind: 'invoice', number: i.number, title: `Invoice ${i.number}`, subtitle: `for sales order ${i.orderNumber}` })
  }
  for (const r of returns) {
    add(ownFirst([r.number, r.customerReturnReference], [r.orderNumber], needle), { kind: 'return', number: r.number, title: `Return Order ${r.number}`, subtitle: `for sales order ${r.orderNumber}` })
  }
  for (const m of memos) {
    add(ownFirst([m.number], [m.orderNumber, m.invoiceNumber, m.returnNumber], needle), { kind: 'creditMemo', number: m.number, title: `Credit Memo ${m.number}`, subtitle: `for sales order ${m.orderNumber}` })
  }
  for (const p of payments) {
    add(ownFirst([p.number, p.reference], [p.invoiceNumber, p.orderNumber], needle), { kind: 'payment', number: p.number, title: `Payment ${p.number}`, subtitle: `for invoice ${p.invoiceNumber}` })
  }
  for (const p of products) {
    add(score([p.sku, p.name], needle), { kind: 'product', number: p.sku, title: p.name, subtitle: p.sku })
  }
  for (const p of partners) {
    add(score([p.id, p.name], needle), { kind: 'customer', number: p.id, title: p.name, subtitle: p.id })
  }
  return hits
    .sort((a, b) => b.rank - a.rank || a.title.localeCompare(b.title))
    .slice(0, LIMIT)
    .map(({ rank, ...row }) => row)
}

module.exports = { search, LIMIT }
