/*
 * One search across every document the ERP holds: a number, a SKU, a customer's name.
 * The shell bar asks it as you type, so it answers a short list, best first: an exact
 * number wins over a name that merely contains the words.
 */
const { listOrders } = require('./orders')
const { listShipments, listInvoices } = require('./fulfilment')
const { listProducts } = require('./products')
const { listPartners } = require('./partners')

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
 * @param {object} cols collections
 * @param {string} q what was typed
 * @returns {Promise<Array<{kind: string, number: string, title: string, subtitle: string}>>}
 */
async function search (cols, q) {
  const needle = norm(q)
  if (needle.length < 2) return []
  const [orders, shipments, invoices, products, partners] = await Promise.all([
    listOrders(cols), listShipments(cols), listInvoices(cols), listProducts(cols), listPartners(cols)
  ])
  const names = new Map(partners.map((p) => [p.id, p.name]))
  const hits = []
  const add = (rank, row) => { if (rank > 0) hits.push({ rank, ...row }) }
  for (const o of orders) {
    add(score([o.number, o.commerceIncrementId, o.commerceOrderId, names.get(o.partnerId)], needle), {
      kind: 'order', number: o.number, title: `Sales Order ${o.number}`, subtitle: [names.get(o.partnerId), o.commerceIncrementId ? `Commerce ${o.commerceIncrementId}` : null].filter(Boolean).join(' · ')
    })
  }
  for (const s of shipments) {
    add(score([s.number, s.orderNumber], needle), { kind: 'shipment', number: s.number, title: `Shipment ${s.number}`, subtitle: `for sales order ${s.orderNumber}` })
  }
  for (const i of invoices) {
    if (!i.number) continue
    add(score([i.number, i.orderNumber], needle), { kind: 'invoice', number: i.number, title: `Invoice ${i.number}`, subtitle: `for sales order ${i.orderNumber}` })
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
