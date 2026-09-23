/*
 * Stand-in records for the local preview, in the shapes the real actions answer with
 * (lib/products.js `shape`, lib/partners.js, lib/orders.js, lib/events.js). They are
 * here so a screen can be looked at — and screenshotted — without a deployed action,
 * a key, or a Commerce store.
 *
 * Keep the shapes honest. A screen built against an invented shape agrees with the
 * invention and nothing else.
 */
const NAMES = [
  ['Wide-leg trouser', 89], ['Cotton poplin shirt', 34.2], ['Canvas tote', 12],
  ['Merino crew knit', 119], ['Linen blazer', 245], ['Chino short', 49.5],
  ['Rain shell', 189], ['Leather belt', 55], ['Wool overcoat', 420],
  ['Oxford shirt', 64], ['Denim jacket', 138], ['Silk scarf', 78],
  ['Running short', 42], ['Quilted gilet', 165], ['Cashmere beanie', 58],
  ['Field jacket', 210], ['Pima tee', 28], ['Corduroy trouser', 95],
  ['Packable duffel', 130], ['Suede loafer', 175]
]

const products = NAMES.map(([name, price], i) => {
  const sku = `P${String(i + 1).padStart(6, '0')}`
  const quantity = [0, 4, 18, 120, 7, 64][i % 6]
  return {
    sku,
    name,
    type: i === 3 ? 'configurable' : 'simple',
    description: `${name} — mirrored from Commerce`,
    unit: i % 7 === 0 ? 'PC' : 'EA',
    listPrice: price,
    warehouses: [{ code: 'default', name: 'Default Source', quantity }],
    stock: quantity,
    ...(i === 3 ? { priceRange: { min: 119, max: 149 }, variantCount: 3 } : {})
  }
})

const partners = [
  { id: 'P000000', name: 'Walk-in customers', salesOrg: '1000', commerceCompanyId: null, customerGroupId: null, paymentTerms: 'NET30', creditLimit: 0, blocked: false, isDefault: true },
  { id: 'C000101', name: 'Northwind Trading', salesOrg: '1000', commerceCompanyId: '4', customerGroupId: '2', paymentTerms: 'NET30', creditLimit: 50000, blocked: false },
  { id: 'C000102', name: 'Contoso Supply', salesOrg: '1000', commerceCompanyId: '7', customerGroupId: '2', paymentTerms: 'NET60', creditLimit: 120000, blocked: false },
  { id: 'C000103', name: 'Fabrikam Retail', salesOrg: '2000', commerceCompanyId: '9', customerGroupId: '3', paymentTerms: 'NET15', creditLimit: 25000, blocked: true },
  { id: 'C000104', name: 'Adventure Works', salesOrg: '2000', commerceCompanyId: '12', customerGroupId: '2', paymentTerms: 'NET30', creditLimit: 80000, blocked: false }
]

const STATUSES = ['created', 'confirmed', 'shipped', 'invoiced', 'cancelled', 'created', 'confirmed', 'shipped']
const orders = STATUSES.map((status, i) => {
  const number = String(1000 + i).padStart(10, '0')
  const lines = [
    { sku: products[i % products.length].sku, qty: (i % 4) + 1, price: products[i % products.length].listPrice },
    { sku: products[(i + 5) % products.length].sku, qty: (i % 3) + 2, price: products[(i + 5) % products.length].listPrice }
  ]
  return {
    number,
    commerceOrderId: String(700 + i),
    commerceIncrementId: `00000${300 + i}`,
    partnerId: partners[(i % 4) + 1].id,
    lines,
    currency: 'USD',
    total: lines.reduce((sum, l) => sum + l.qty * l.price, 0),
    status,
    createdAt: new Date(Date.UTC(2026, 8, 4 + i, 9, 12)).toISOString()
  }
})

const events = [
  { _id: 'e1', at: new Date(Date.UTC(2026, 8, 22, 14, 2)).toISOString(), direction: 'out', event: 'be-observer.sales_order_status_update', value: { erpNumber: '0000001001' }, delivered: true, attempts: 1 },
  { _id: 'e2', at: new Date(Date.UTC(2026, 8, 22, 13, 55)).toISOString(), direction: 'in', event: 'catalog_stock_update', summary: 'Stock for P000003 set to 18', value: { sku: 'P000003', stock: 18 } },
  { _id: 'e3', at: new Date(Date.UTC(2026, 8, 22, 13, 40)).toISOString(), direction: 'out', event: 'be-observer.catalog_product_update', value: { sku: 'P000007', price: 189 }, delivered: false, failed: true, attempts: 10, lastError: 'ingestion webhook answered 503' },
  { _id: 'e4', at: new Date(Date.UTC(2026, 8, 22, 13, 20)).toISOString(), direction: 'out', event: 'be-observer.company_credit_update', value: { companyId: '7', creditLimit: 120000 }, delivered: false, attempts: 2 },
  { _id: 'e5', at: new Date(Date.UTC(2026, 8, 22, 12, 5)).toISOString(), direction: 'in', event: 'company_updated', summary: 'Company 9 blocked', value: { companyId: '9', blocked: true } },
  { _id: 'e6', at: new Date(Date.UTC(2026, 8, 22, 11, 45)).toISOString(), direction: 'out', event: 'be-observer.sales_order_shipment_create', value: { erpNumber: '0000001002' }, delivered: true, attempts: 1 }
]

const conditions = [
  { id: 'c1', kind: 'contractPrice', partnerId: 'C000101', sku: 'P000001', price: 79 },
  { id: 'c2', kind: 'contractDiscount', partnerId: 'C000102', sku: null, percent: 12 },
  { id: 'c3', kind: 'maxDiscount', partnerId: null, sku: null, percent: 25 }
]

const settings = {
  displayName: 'Northwind ERP',
  lastImportAt: new Date(Date.UTC(2026, 8, 22, 13, 58)).toISOString(),
  lastWipeAt: null,
  sync: null
}

const health = {
  displayName: settings.displayName,
  counts: { products: products.length, businessPartners: partners.length, salesOrders: orders.length, pricingConditions: conditions.length },
  eventsPending: events.filter((e) => e.direction === 'out' && !e.delivered && !e.failed).length,
  lastImportAt: settings.lastImportAt,
  sync: null
}

const copy = (value) => JSON.parse(JSON.stringify(value))
const refuse = () => Promise.reject(new Error('The preview holds stand-in records; nothing here writes.'))

/** Everything screen/src/api.js offers, answered from the records above. */
export const fakeApi = {
  health: async () => copy(health),
  settings: async () => copy(settings),
  saveSettings: refuse,
  wipe: refuse,
  products: async () => copy(products),
  product: async (sku) => copy(products.find((p) => p.sku === sku)),
  patchProduct: refuse,
  partners: async () => copy(partners),
  patchPartner: refuse,
  conditions: async () => copy(conditions),
  saveCondition: refuse,
  deleteCondition: refuse,
  quote: refuse,
  orders: async () => copy(orders),
  order: async (number) => copy(orders.find((o) => o.number === number)),
  moveOrder: refuse,
  events: async () => ({ items: copy(events), webhookUrl: 'https://preview.example/ingestion/webhook', pending: 1, failed: 1 }),
  retryEvents: refuse,
  requeueEvents: refuse,
  sync: refuse
}
