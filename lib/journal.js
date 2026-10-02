/*
 * The journal in words. An entry carries the event type and its data; a person reading the
 * Event Journal wants the DOCUMENT it belongs to — "Shipment 8000000003 for sales order
 * 0000001003" — not `{"SalesOrder":"0000001003"}`. Worked out on read, so the entries
 * journaled before this existed read the same way as new ones.
 *
 * Contract version 16 names each event by its type, in the ERP's words ("Sales order
 * changed", "Goods issue posted", "Billing document created (credit memo)"). An entry
 * journaled before version 16 carries a kind and the payload it was sent with, and reads by
 * the names it had then (KIND_NAMES).
 */
const { amount } = require('./credit')

/** The plain name of each kind an entry journaled before contract version 16 carries. */
const KIND_NAMES = {
  'product.price': 'Price changed',
  'product.stock': 'Stock changed',
  'order.canceled': 'Order canceled',
  'order.confirmed': 'Order confirmed',
  'order.hold': 'Credit hold',
  'order.invoiced': 'Invoice created',
  'order.shipped': 'Shipment posted',
  'partner.blocked': 'Customer block changed',
  'partner.creditLimit': 'Credit limit changed',
  'contract.changed': 'Customer prices changed',
  'creditmemo.created': 'Credit memo created',
  'return.received': 'Return received',
  'payment.posted': 'Payment posted'
}

/* An entry journaled before `kind` was recorded is named from its wire event. */
const KIND_BY_EVENT = {
  'be-observer.catalog_product_update': 'product.price',
  'be-observer.catalog_stock_update': 'product.stock',
  'be-observer.sales_order_cancel': 'order.canceled',
  'be-observer.sales_order_status_update': 'order.confirmed',
  'be-observer.sales_order_hold': 'order.hold',
  'be-observer.sales_order_invoice_create': 'order.invoiced',
  'be-observer.sales_order_shipment_create': 'order.shipped',
  'be-observer.company_status_update': 'partner.blocked',
  'be-observer.company_credit_update': 'partner.creditLimit',
  'be-observer.company_contract_update': 'contract.changed',
  'be-observer.sales_order_creditmemo_create': 'creditmemo.created',
  'be-observer.rma_status_update': 'return.received',
  'be-observer.sales_order_payment_create': 'payment.posted'
}

/**
 * Plain names for what arrives from another system, by the words in the document its origin
 * names (contract version 16), or in the event name an entry journaled before then carries.
 */
function inboundName (event) {
  const e = String(event || '').toLowerCase()
  if (!e) return 'Message received'
  // Entries journaled before 2026-09-27 by the removed Sync records path.
  if (e.startsWith('sync')) return event
  if (e.includes('stock')) return 'Stock update received'
  if (e.includes('product')) return 'Product update received'
  // A web shop's returns are often RMAs ("returned merchandise authorization"); checked before
  // "order", which an RMA event name may also carry.
  if (/(^|[._])rma([._]|$)/.test(e) || e.includes('return')) return 'Return request received'
  if (e.includes('shipment')) return 'Shipment received'
  if (e.includes('invoice')) return 'Invoice received'
  if (e.includes('order')) return 'Order received'
  if (e.includes('company') || e.includes('customer')) return 'Customer update received'
  return 'Message received'
}

const orderLink = (value) => (value && value.erpNumber ? [{ kind: 'order', number: String(value.erpNumber) }] : [])
const orderWords = (value) => (value && value.erpNumber ? `sales order ${value.erpNumber}` : 'a sales order')
const withReference = (value) => (value && value.incrementId ? ` (customer reference ${value.incrementId})` : '')

/** The sentence and links for one outbound kind. */
function outbound (kind, value = {}) {
  switch (kind) {
    case 'order.confirmed':
      return { text: `${cap(orderWords(value))} confirmed${withReference(value)}`, links: orderLink(value) }
    case 'order.hold':
      return value.held
        ? { text: `${cap(orderWords(value))} put on credit hold${value.reason ? `: ${value.reason}` : ''}`, links: orderLink(value) }
        : { text: `${cap(orderWords(value))} released from credit hold`, links: orderLink(value) }
    case 'order.canceled':
      return { text: `${cap(orderWords(value))} canceled${value.reason ? `: ${value.reason}` : ''}`, links: orderLink(value) }
    case 'order.shipped': {
      const items = Array.isArray(value.items) ? value.items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0) : 0
      const from = value.stockSourceCode ? ` from ${value.stockSourceCode}` : ''
      return { text: `Shipment of ${items} for ${orderWords(value)}${from}`, links: orderLink(value) }
    }
    case 'order.invoiced':
      return { text: `Invoice for ${orderWords(value)}${withReference(value)}`, links: orderLink(value) }
    case 'creditmemo.created': {
      const ofReturn = value.returnNumber ? ` (return order ${value.returnNumber})` : ''
      return { text: `Credit memo ${value.creditMemoNumber || ''} for ${orderWords(value)}${ofReturn}`, links: orderLink(value) }
    }
    case 'return.received': {
      const items = Array.isArray(value.items) ? value.items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0) : 0
      return { text: `Return order ${value.returnNumber || ''} received: ${items} back for ${orderWords(value)}`, links: orderLink(value) }
    }
    case 'payment.posted':
      return { text: `Payment ${value.paymentNumber || ''} of ${amount(value.amount, value.currency)} against invoice ${value.invoiceNumber || ''} for ${orderWords(value)}`, links: orderLink(value) }
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
    case 'contract.changed': {
      const n = Array.isArray(value.lines) ? value.lines.length : 0
      return { text: `Price list prices of customer ${value.partnerId || ''}: ${n || 'none'} in force`, links: value.partnerId ? [{ kind: 'customer', number: String(value.partnerId) }] : [] }
    }
    default:
      return { text: '', links: [] }
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** The words for each field a Product.Changed or Customer.Changed names. */
const FIELD_WORDS = {
  ProductName: 'name',
  ListPrice: 'list price',
  SalesStatus: 'sales status',
  CreditLimit: 'credit limit',
  BlockingLevel: 'blocking level',
  PaymentTerms: 'payment terms',
  PriceGroup: 'price group'
}

const fieldWords = (fields) => (Array.isArray(fields) ? fields.map((f) => FIELD_WORDS[f] || f).join(', ') : '')

/** "BillingDocument.Created" with its document type, "Product.Changed" with its fields: the name the list shows. */
function typeName (type, data = {}) {
  switch (type) {
    case 'SalesOrder.Changed': return 'Sales order changed'
    case 'OutboundDelivery.GoodsIssueStatusChanged': return 'Goods issue posted'
    case 'BillingDocument.Created': return `Billing document created (${data.BillingDocumentType === 'CreditMemo' ? 'credit memo' : 'invoice'})`
    case 'CustomerReturn.Changed': return 'Customer return changed'
    case 'IncomingPayment.Posted': return 'Incoming payment posted'
    case 'Product.Changed': return `Product changed: ${fieldWords(data.ChangedFields)}`
    case 'ProductStock.Changed': return 'Product stock changed'
    case 'Customer.Changed': return `Customer changed: ${fieldWords(data.ChangedFields)}`
    case 'PriceList.Changed': return 'Price list changed'
    default: return type || ''
  }
}

const salesOrderLink = (data) => (data && data.SalesOrder ? [{ kind: 'order', number: String(data.SalesOrder) }] : [])
const salesOrderWords = (data) => (data && data.SalesOrder ? `sales order ${data.SalesOrder}` : 'a sales order')
const customerReference = (data) => (data && data.PurchaseOrderByCustomer ? ` (customer reference ${data.PurchaseOrderByCustomer})` : '')
const quantityOf = (items) => (Array.isArray(items) ? items.reduce((sum, i) => sum + (Number(i.Quantity) || 0), 0) : 0)

/** What a SalesOrder.Changed did: the move its previous status and credit block tell apart. */
function salesOrderText (data) {
  const order = cap(salesOrderWords(data))
  const why = data.Reason ? `: ${data.Reason}` : ''
  if (data.OverallStatus === 'canceled' && data.PrevOverallStatus !== 'canceled') return `${order} canceled${why}`
  if (data.CreditBlock && !data.PrevCreditBlock) return `${order} put on credit hold${why}`
  if (!data.CreditBlock && data.PrevCreditBlock) return `${order} released from credit hold`
  if (data.OverallStatus === 'confirmed' && data.PrevOverallStatus !== 'confirmed') return `${order} confirmed${customerReference(data)}`
  return `${order} changed`
}

/** The changed fields of a product or customer, each with its value now. */
function changes (data, valueOf) {
  return (Array.isArray(data.ChangedFields) ? data.ChangedFields : []).map((f) => `${FIELD_WORDS[f] || f} ${valueOf(f)}`).join(', ')
}

/** The sentence and links for one outbound event of contract version 16. */
function outboundEvent (type, data = {}) {
  switch (type) {
    case 'SalesOrder.Changed':
      return { text: salesOrderText(data), links: salesOrderLink(data) }
    case 'OutboundDelivery.GoodsIssueStatusChanged': {
      const from = data.Plant ? ` from ${data.Plant}` : ''
      return { text: `Shipment ${data.OutboundDelivery || ''} of ${quantityOf(data.Items)} for ${salesOrderWords(data)}${from}`, links: salesOrderLink(data) }
    }
    case 'BillingDocument.Created':
      if (data.BillingDocumentType === 'CreditMemo') {
        const ofReturn = data.CustomerReturn ? ` (return order ${data.CustomerReturn})` : ''
        return { text: `Credit memo ${data.BillingDocument || ''} for ${salesOrderWords(data)}${ofReturn}`, links: salesOrderLink(data) }
      }
      return { text: `Invoice ${data.BillingDocument || ''} for ${salesOrderWords(data)}${customerReference(data)}`, links: salesOrderLink(data) }
    case 'CustomerReturn.Changed':
      return { text: `Return order ${data.CustomerReturn || ''} ${data.Status || 'changed'}: ${quantityOf(data.Items)} back for ${salesOrderWords(data)}`, links: salesOrderLink(data) }
    case 'IncomingPayment.Posted':
      return { text: `Payment ${data.Payment || ''} of ${amount(data.Amount, data.Currency)} against invoice ${data.BillingDocument || ''} for ${salesOrderWords(data)}`, links: salesOrderLink(data) }
    case 'Product.Changed': {
      const values = { ProductName: `"${data.ProductName}"`, ListPrice: data.ListPrice, SalesStatus: data.SalesStatus }
      return { text: `Product ${data.Product || ''}: ${changes(data, (f) => values[f])}`, links: data.Product ? [{ kind: 'product', number: String(data.Product) }] : [] }
    }
    case 'ProductStock.Changed':
      return { text: `Stock of ${data.Product || 'a product'} in ${data.Plant || 'a plant'}: ${data.PrevQuantity} to ${data.Quantity}`, links: data.Product ? [{ kind: 'product', number: String(data.Product) }] : [] }
    case 'Customer.Changed': {
      const values = { CreditLimit: data.CreditLimit, BlockingLevel: data.BlockingLevel, PaymentTerms: data.PaymentTerms, PriceGroup: data.PriceGroup ?? 'none' }
      return { text: `Customer ${data.Customer || ''}: ${changes(data, (f) => values[f])}`, links: data.Customer ? [{ kind: 'customer', number: String(data.Customer) }] : [] }
    }
    case 'PriceList.Changed': {
      const n = Array.isArray(data.Lines) ? data.Lines.length : 0
      return { text: `Price list prices of customer ${data.Customer || ''}: ${n || 'none'} in force`, links: data.Customer ? [{ kind: 'customer', number: String(data.Customer) }] : [] }
    }
    default:
      return { text: '', links: [] }
  }
}

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
    const from = entry.origin ? entry.origin.document : entry.event
    return { name: inboundName(from), text: entry.summary || '', links }
  }
  if (entry.type) return { name: typeName(entry.type, entry.data), ...outboundEvent(entry.type, entry.data) }
  const kind = entry.kind || KIND_BY_EVENT[entry.event]
  const described = outbound(kind, entry.value)
  return { name: KIND_NAMES[kind] || entry.event || '', ...described }
}

module.exports = { KIND_NAMES, describeEvent, inboundName, typeName }
