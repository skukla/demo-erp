/*
 * The journal in words. An entry carries the wire event name and its payload; a person
 * reading the Event Journal wants the DOCUMENT it belongs to — "Shipment 8000000003 for
 * sales order 0000001003" — not `{"erpNumber":"0000001003"}`. Worked out on read, so the
 * entries journaled before this existed read the same way as new ones.
 */

/** The plain name of each outbound kind, as the list shows it; the wire name stays on the detail page. */
const KIND_NAMES = {
  'product.price': 'Price changed',
  'product.stock': 'Stock changed',
  'order.cancelled': 'Order cancelled',
  'order.confirmed': 'Order confirmed',
  'order.hold': 'Credit hold',
  'order.invoiced': 'Invoice created',
  'order.shipped': 'Shipment posted',
  'partner.blocked': 'Customer block changed',
  'partner.creditLimit': 'Credit limit changed'
}

/* An entry journaled before `kind` was recorded is named from its wire event. */
const KIND_BY_EVENT = {
  'be-observer.catalog_product_update': 'product.price',
  'be-observer.catalog_stock_update': 'product.stock',
  'be-observer.sales_order_cancel': 'order.cancelled',
  'be-observer.sales_order_status_update': 'order.confirmed',
  'be-observer.sales_order_hold': 'order.hold',
  'be-observer.sales_order_invoice_create': 'order.invoiced',
  'be-observer.sales_order_shipment_create': 'order.shipped',
  'be-observer.company_status_update': 'partner.blocked',
  'be-observer.company_credit_update': 'partner.creditLimit'
}

/** Plain names for what arrives from Commerce, by the words in its wire event name. */
function inboundName (event) {
  const e = String(event || '').toLowerCase()
  if (!e) return 'From Commerce'
  if (e.startsWith('sync')) return event
  if (e.includes('stock')) return 'Stock from Commerce'
  if (e.includes('product')) return 'Product from Commerce'
  if (e.includes('shipment')) return 'Shipment from Commerce'
  if (e.includes('invoice')) return 'Invoice from Commerce'
  if (e.includes('order')) return 'Order from Commerce'
  if (e.includes('company') || e.includes('customer')) return 'Company from Commerce'
  return 'From Commerce'
}

const orderLink = (value) => (value && value.erpNumber ? [{ kind: 'order', number: String(value.erpNumber) }] : [])
const orderWords = (value) => (value && value.erpNumber ? `sales order ${value.erpNumber}` : 'a sales order')
const forCommerce = (value) => (value && value.incrementId ? ` (Commerce order ${value.incrementId})` : '')

/** The sentence and links for one outbound kind. */
function outbound (kind, value = {}) {
  switch (kind) {
    case 'order.confirmed':
      return { text: `${cap(orderWords(value))} confirmed${forCommerce(value)}`, links: orderLink(value) }
    case 'order.hold':
      return value.held
        ? { text: `${cap(orderWords(value))} put on credit hold${value.reason ? `: ${value.reason}` : ''}`, links: orderLink(value) }
        : { text: `${cap(orderWords(value))} released from credit hold`, links: orderLink(value) }
    case 'order.cancelled':
      return { text: `${cap(orderWords(value))} cancelled${value.reason ? `: ${value.reason}` : ''}`, links: orderLink(value) }
    case 'order.shipped': {
      const items = Array.isArray(value.items) ? value.items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0) : 0
      const from = value.stockSourceCode ? ` from ${value.stockSourceCode}` : ''
      return { text: `Shipment of ${items} for ${orderWords(value)}${from}`, links: orderLink(value) }
    }
    case 'order.invoiced':
      return { text: `Invoice for ${orderWords(value)}${forCommerce(value)}`, links: orderLink(value) }
    case 'product.price':
      return { text: `Price of ${value.sku || 'a product'} set to ${value.price}`, links: value.sku ? [{ kind: 'product', number: String(value.sku) }] : [] }
    case 'product.stock': {
      const rows = Array.isArray(value) ? value : [value]
      const skus = [...new Set(rows.map((r) => r && r.sku).filter(Boolean))]
      return { text: skus.length === 1 ? `Stock of ${skus[0]} changed` : `Stock of ${skus.length} products changed`, links: skus.map((sku) => ({ kind: 'product', number: sku })) }
    }
    case 'partner.blocked':
      return { text: `Customer ${value.partnerId || ''} ${value.blocked ? 'blocked' : 'unblocked'}`.trim(), links: value.partnerId ? [{ kind: 'customer', number: String(value.partnerId) }] : [] }
    case 'partner.creditLimit':
      return { text: `Credit limit of customer ${value.partnerId || ''} set to ${value.creditLimit}`, links: value.partnerId ? [{ kind: 'customer', number: String(value.partnerId) }] : [] }
    default:
      return { text: '', links: [] }
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * @param {object} entry a journal entry (lib/events)
 * @returns {{ name: string, text: string, links: Array<{kind: string, number: string}> }}
 *   `name` is the plain kind for the list, `text` the sentence, `links` the documents in it
 */
function describeEvent (entry) {
  if (!entry) return { name: '', text: '', links: [] }
  if (entry.direction === 'in') {
    const value = entry.value || {}
    const links = value.number ? [{ kind: 'order', number: String(value.number) }] : []
    return { name: inboundName(entry.event), text: entry.summary || '', links }
  }
  const kind = entry.kind || KIND_BY_EVENT[entry.event]
  const described = outbound(kind, entry.value)
  return { name: KIND_NAMES[kind] || entry.event || '', ...described }
}

module.exports = { KIND_NAMES, describeEvent, inboundName }
