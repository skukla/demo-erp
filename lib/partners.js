/*
 * Business partners: the ERP's accounts (SAP's sold-to), filled by Demo Builder's import
 * and then owned here: credit limit and blocked. The ERP holds no web shop id: which of the
 * shop's companies is which customer is the integration's key map (contract version 3).
 * A default partner exists so an instance without companies still prices and orders
 * (decision 15).
 *
 * There is no stored credit USED. It existed, was written as zero and never changed
 * again, so every customer showed no exposure beside a real limit. Exposure is DERIVED
 * — see exposures — from the orders the customer has not yet been invoiced for and, from
 * contract version 14, the invoices it has not yet paid (lib/open-items).
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { emit } = require('./events')
const { BLOCKING, hasCredit } = require('./credit')
const { getSettings } = require('./settings')
const { announcing, listContracts } = require('./contracts')
const { getPriceGroup } = require('./price-groups')
const { current } = require('./spelling')
const { openItemReader, invoiceTotal } = require('./open-items')
const { dueDate, termsFor } = require('./terms')
const { today } = require('./pricing')
const { salesOrganizationsOf } = require('./sales-organizations')
const { upgradeOrderRecord } = require('./legacy')
const { cents, netOfLines } = require('./line-amounts')

const DEFAULT_PARTNER_ID = 'P000000'

/** Commerce's ids a customer stored before contract version 3 still carries. */
const COMMERCE_FIELDS = ['commerceCompanyId', 'customerGroupId', 'emailDomain', 'website']

/**
 * A stored partner in today's shape. A record written before blocking levels existed held
 * one boolean, `blocked`; it reads as All (blocked) or Open, and the boolean is gone. A
 * record written before version 3 drops the Commerce ids it held.
 */
function upgradePartner (stored) {
  if (!stored) return stored
  let partner = Object.fromEntries(Object.entries(stored).filter(([key]) => !COMMERCE_FIELDS.includes(key)))
  if (!BLOCKING.includes(partner.blocking)) {
    const { blocked, ...rest } = partner
    partner = { ...rest, blocking: blocked ? 'all' : 'open' }
  }
  // A record written before the website account existed (contract version 5) is active.
  if (!WEBSITE_ACCOUNT.includes(partner.websiteAccount)) {
    partner = { ...partner, websiteAccount: 'active' }
  }
  // A record written with one fixed `salesOrg` reads as its sales organisations: the
  // walk-in partner belongs to every one; a company set to something other than the
  // default keeps it; the default alone meant nothing was known. The next import replaces it.
  if (!Array.isArray(partner.salesOrgs)) {
    const { salesOrg, ...rest } = partner
    let salesOrgs = []
    if (partner.isDefault) salesOrgs = ['*']
    else if (salesOrg && salesOrg !== '1000') salesOrgs = [salesOrg]
    partner = { ...rest, salesOrgs, legalName: null, vatTaxId: null, resellerId: null, legalAddress: null }
  }
  return partner
}

/** A list of sales organisation codes, cleaned: strings, trimmed, unique, in order. */
function salesOrgList (value) {
  if (!Array.isArray(value)) return null
  return [...new Set(value.map((v) => String(v ?? '').trim()).filter(Boolean))]
}

/** A legal address as the import sends it, or null when nothing is known. */
function legalAddressOf (value) {
  if (!value || typeof value !== 'object') return null
  const street = Array.isArray(value.street) ? value.street.map((l) => String(l).trim()).filter(Boolean) : []
  const address = {
    street,
    city: value.city ? String(value.city) : null,
    region: value.region ? String(value.region) : null,
    postcode: value.postcode ? String(value.postcode) : null,
    countryId: value.countryId ? String(value.countryId) : null,
    telephone: value.telephone ? String(value.telephone) : null
  }
  return street.length || address.city || address.region || address.postcode || address.countryId || address.telephone ? address : null
}

/** The import's value when the row carries the field, else what the ERP had, else null. */
const carried = (row, existing, key, clean = (v) => (v === undefined || v === null || v === '' ? null : String(v))) =>
  (row[key] !== undefined ? clean(row[key]) : (existing ? existing[key] ?? null : null))

/** The two values of the website account: the web shop's own Active/Blocked switch for the company. */
const WEBSITE_ACCOUNT = ['active', 'closed']

/**
 * The website account an import carries: `websiteAccountClosed` (contract version 5), or the
 * `blocked` boolean an integration built before version 5 still sends for the same switch.
 * Undefined when the row carries neither, so the stored value stays.
 */
function websiteAccountOf (row) {
  const closed = typeof row.websiteAccountClosed === 'boolean' ? row.websiteAccountClosed : row.blocked
  return typeof closed === 'boolean' ? (closed ? 'closed' : 'active') : undefined
}

/**
 * Bulk upsert from the integration's import. The web shop is the master the demo is
 * prepared in: every field the import carries (name, credit limit, website account)
 * overwrites what the ERP holds; a field it does not carry (payment terms) keeps its ERP
 * value. The shop's ids are not among the fields (contract version 3).
 *
 * The ERP's own credit block is never among them (owner, 2026-09-28): it is this ERP's
 * finance team's decision, and nothing the shop sends changes it. The shop's own
 * Active/Blocked switch for the company arrives as the separate website account.
 *
 * @param {object[]} rows `{ id, name, creditLimit?, websiteAccountClosed?, salesOrgs?, legalName?, vatTaxId?,
 *   resellerId?, legalAddress? }`
 */
async function importPartners (cols, rows) {
  // A customer the ERP creates takes the default payment terms (Settings → Sales & receivables).
  const { sales } = await getSettings(cols)
  let created = 0
  let updated = 0
  for (const row of rows) {
    if (!row || !row.id) continue
    const existing = upgradePartner(await cols.businessPartners.findOne({ _id: row.id }))
    const partner = {
      _id: row.id,
      id: row.id,
      name: row.name || existing?.name || row.id,
      // The sales organisations the company buys through (its admin's website, and every
      // website an order has since arrived from). The import's list replaces the ERP's.
      salesOrgs: salesOrgList(row.salesOrgs) ?? existing?.salesOrgs ?? [],
      legalName: carried(row, existing, 'legalName'),
      vatTaxId: carried(row, existing, 'vatTaxId'),
      resellerId: carried(row, existing, 'resellerId'),
      legalAddress: row.legalAddress !== undefined ? legalAddressOf(row.legalAddress) : (existing?.legalAddress ?? null),
      paymentTerms: existing?.paymentTerms || sales.defaultPaymentTerms,
      creditLimit: row.creditLimit !== undefined && row.creditLimit !== null ? Number(row.creditLimit) : (existing?.creditLimit ?? 50000),
      // The ERP's own credit block: never from the import.
      blocking: existing?.blocking ?? 'open',
      websiteAccount: websiteAccountOf(row) ?? existing?.websiteAccount ?? 'active',
      // The customer price group: the ERP's own, never from the import.
      priceGroup: existing?.priceGroup ?? null,
      updatedAt: new Date().toISOString()
    }
    await cols.businessPartners.replaceOne({ _id: row.id }, partner, { upsert: true })
    if (existing) updated += 1
    else created += 1
  }
  return { created, updated }
}

/** Ensure the default partner exists; it is the fallback when a quote names none. */
async function ensureDefaultPartner (cols, projectName) {
  const existing = await cols.businessPartners.findOne({ _id: DEFAULT_PARTNER_ID })
  if (existing) return existing
  const { sales } = await getSettings(cols)
  const partner = {
    _id: DEFAULT_PARTNER_ID,
    id: DEFAULT_PARTNER_ID,
    name: projectName ? `${projectName} (walk-in)` : 'Walk-in customers',
    // The walk-in account exists so any website's order has a sold-to: every sales organisation.
    salesOrgs: ['*'],
    legalName: null,
    vatTaxId: null,
    resellerId: null,
    legalAddress: null,
    paymentTerms: sales.defaultPaymentTerms,
    creditLimit: 0,
    blocking: 'open',
    websiteAccount: 'active',
    priceGroup: null,
    isDefault: true,
    updatedAt: new Date().toISOString()
  }
  await cols.businessPartners.replaceOne({ _id: DEFAULT_PARTNER_ID }, partner, { upsert: true })
  return partner
}

async function listPartners (cols, options = {}) {
  const rows = await findAll(cols.businessPartners, {}, { limit: options.limit ?? 1000, sort: { _id: 1 } })
  return rows.map(upgradePartner)
}

async function getPartner (cols, id) {
  return upgradePartner(await cols.businessPartners.findOne({ _id: id }))
}

/**
 * The partner a cart or order belongs to: the one it names by number, else the default
 * (walk-in) partner. The integration finds the number in its key map; the ERP matches
 * nothing of the web shop's.
 */
async function resolvePartner (cols, hints = {}) {
  return upgradePartner(await findPartner(cols, hints))
}

async function findPartner (cols, { partnerId } = {}) {
  if (partnerId) {
    const byId = await cols.businessPartners.findOne({ _id: partnerId })
    if (byId) return byId
  }
  return cols.businessPartners.findOne({ _id: DEFAULT_PARTNER_ID })
}

/**
 * The data of a Customer.Changed event: the customer record in the ERP's words, the blocking
 * level it had before, and which fields the edit changed. What a blocking level means to a
 * subscriber (a web shop knows only blocked or not) is the subscriber's to fold.
 */
function customerData (partner, before, changedFields) {
  return {
    Customer: partner.id,
    CustomerName: partner.name,
    CreditLimit: partner.creditLimit,
    BlockingLevel: partner.blocking,
    PrevBlockingLevel: before.blocking,
    PaymentTerms: partner.paymentTerms ?? null,
    PriceGroup: partner.priceGroup ?? null,
    ChangedFields: changedFields
  }
}

/**
 * Credit limit, block, payment terms and price group edits from the screen. Any change
 * raises one Customer.Changed naming the fields that changed; the integration writes the
 * credit limit and the block onto the customer's company and keeps its ledger so a reset can
 * undo exactly these (decision 8). A price group change also raises PriceList.Changed when
 * it moves the customer's prices in force.
 */
async function patchPartner (cols, id, patch, params) {
  const current = upgradePartner(await cols.businessPartners.findOne({ _id: id }))
  if (!current) return null
  const next = { ...current, updatedAt: new Date().toISOString() }
  const changedFields = []
  if (patch.creditLimit !== undefined) {
    const limit = Number(patch.creditLimit)
    if (!Number.isFinite(limit) || limit < 0) throw badRequest('creditLimit must be a non-negative number')
    if (limit !== current.creditLimit) {
      next.creditLimit = limit
      changedFields.push('CreditLimit')
    }
  }
  if (patch.blocking !== undefined) {
    if (!BLOCKING.includes(patch.blocking)) throw badRequest(`blocking must be one of ${BLOCKING.join(', ')}`)
    if (patch.blocking !== current.blocking) {
      next.blocking = patch.blocking
      changedFields.push('BlockingLevel')
    }
  }
  if (typeof patch.paymentTerms === 'string' && patch.paymentTerms.trim() && patch.paymentTerms.trim() !== current.paymentTerms) {
    next.paymentTerms = patch.paymentTerms.trim()
    changedFields.push('PaymentTerms')
  }
  if (patch.priceGroup !== undefined) {
    next.priceGroup = await priceGroupOf(cols, patch.priceGroup)
    if (next.priceGroup !== (current.priceGroup ?? null)) changedFields.push('PriceGroup')
  }
  if (changedFields.length > 0) await emit(cols, 'Customer.Changed', customerData(next, current, changedFields), params)
  // A move into or out of a price group can move the customer's list prices (lib/contracts).
  return announcing(cols, [id], async () => {
    await cols.businessPartners.replaceOne({ _id: id }, next, { upsert: true })
    return next
  }, params)
}

/** A price group a customer may join (null leaves every group). */
async function priceGroupOf (cols, value) {
  if (value === null || value === '') return null
  const code = String(value).trim().toUpperCase()
  if (!(await getPriceGroup(cols, code))) throw badRequest(`price group ${code} is not a price group of this ERP`)
  return code
}

/**
 * Set each customer's price group from the web shop's shared-catalog membership — the
 * ONE-TIME setup seed (Demo Builder's fill, AB-44). This is the SANCTIONED exception to "a
 * partner's price group is the ERP's own, never from the import" (importPartners, above): that
 * rule guards the ONGOING mirror import, which still never touches priceGroup. The setup seed
 * may set it once. Silent — no Customer.Changed and no PriceList.Changed: the shop has the
 * prices already.
 * A row whose partner does not exist yet is skipped, not an error.
 * @param {Array<{ id: string, priceGroup: string|null }>} rows
 * @returns {Promise<number>} customers moved into a group
 */
async function seedPartnerPriceGroups (cols, rows = []) {
  let moved = 0
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id.trim() : ''
    const existing = id ? await cols.businessPartners.findOne({ _id: id }) : null
    if (!existing) continue
    const code = await priceGroupOf(cols, row.priceGroup)
    if ((existing.priceGroup ?? null) === code) continue
    await cols.businessPartners.replaceOne({ _id: id }, { ...existing, priceGroup: code, updatedAt: new Date().toISOString() }, { upsert: true })
    moved += 1
  }
  return moved
}

/** An order's net amount: its lines, each less its discount, not what the web shop charged (that carries tax). */
const netOf = (order) => netOfLines(order.lines)

/* An order the customer still owes for. Both reference systems count credit exposure
   as open receivables plus open orders: an order is open until it is invoiced (a canceled
   one never counts), and from then on its invoice is an open item until it is paid. */
const OPEN = new Set(['created', 'confirmed', 'shipped'])

/**
 * An open order counts at its net; a held one is not yet the customer's to owe for, and one
 * paid at checkout (contract version 18) is owed nothing for.
 */
const isOpenOrder = (o) => OPEN.has(current(o.status)) && o.creditStatus !== 'held' && !o.payment

/**
 * Exposure per customer, in ONE pass over the stored orders, payments and return orders: the
 * net of its open orders and what is open on its invoices (lib/open-items). The Customers
 * list, the customer document, the credit check and a new order's credit decision all read
 * this, so they cannot disagree.
 *
 * @param {object} cols collections
 * @param {object} [filter] `{ partnerId }` for one customer, or every customer
 * @returns {Promise<Map<string, { openOrders: number, openItems: number }>>}
 */
async function exposures (cols, filter = {}) {
  const [orders, openItem] = await Promise.all([findAll(cols.salesOrders, filter, { limit: 5000 }), openItemReader(cols, filter)])
  const byPartner = new Map()
  for (const o of orders) {
    if (!o.partnerId) continue
    const parts = byPartner.get(o.partnerId) || { openOrders: 0, openItems: 0 }
    if (isOpenOrder(o)) parts.openOrders = cents(parts.openOrders + netOf(o))
    const item = openItem(o)
    if (item) parts.openItems = cents(parts.openItems + item.openAmount)
    byPartner.set(o.partnerId, parts)
  }
  return byPartner
}

const NONE = Object.freeze({ openOrders: 0, openItems: 0 })
const totalOf = (parts) => cents(parts.openOrders + parts.openItems)

/**
 * The customer's open items: each invoice with something still open, oldest first, with its
 * due date by the customer's payment terms (lib/terms; null when the terms name no days).
 */
async function openItemsOf (cols, partner) {
  const filter = { partnerId: partner.id }
  const [orders, openItem, settings] = await Promise.all([findAll(cols.salesOrders, filter, { limit: 500 }), openItemReader(cols, filter), getSettings(cols)])
  const terms = termsFor(partner, settings.sales.defaultPaymentTerms)
  return orders
    .map((o) => ({ o, item: openItem(o) }))
    .filter(({ item }) => item && item.openAmount > 0)
    .map(({ o, item }) => ({
      invoiceNumber: o.invoice.number,
      orderNumber: o.number,
      createdAt: o.invoice.createdAt,
      dueDate: dueDate(o.invoice.createdAt, terms),
      total: invoiceTotal(o),
      openAmount: item.openAmount,
      paymentStatus: item.paymentStatus,
      currency: o.currency || 'USD'
    }))
    .sort((a, b) => (a.invoiceNumber < b.invoiceNumber ? -1 : 1))
}

/**
 * The customer's orders, newest first, each with its net amount and credit decision.
 * Read straight from the collection: lib/orders requires this module, so this module
 * cannot require it. `header`-less records (written before shipments existed) are read
 * by their stored status word, which is also what deriveStatus would answer for them.
 */
async function ordersOf (cols, partnerId) {
  const orders = (await findAll(cols.salesOrders, { partnerId }, { limit: 500, sort: { _id: -1 } })).map(upgradeOrderRecord)
  return orders.map((o) => ({
    number: o.number,
    createdAt: o.createdAt,
    // A word stored before contract version 10 reads as today's (lib/spelling).
    status: current(o.status),
    creditStatus: o.creditStatus ?? null,
    purchaseOrderByCustomer: o.purchaseOrderByCustomer,
    currency: o.currency,
    net: netOf(o)
  }))
}

/**
 * Every customer's exposure for the Customers list, from one read (exposures), without a
 * read per row: the same rule as exposureOf. A customer with no credit relationship (the
 * walk-in account) answers null for both.
 * @returns {Promise<object[]>} the partners, each with `exposure` and `available`
 */
async function withCredit (cols, partners) {
  const exposure = await exposures(cols)
  return partners.map((p) => {
    if (!hasCredit(p)) return { ...p, exposure: null, available: null }
    const used = totalOf(exposure.get(p.id) || NONE)
    return { ...p, exposure: used, available: cents((Number(p.creditLimit) || 0) - used) }
  })
}

/** Open orders plus open items — what the credit check measures against the limit. */
async function exposureOf (cols, partnerId) {
  return totalOf((await exposures(cols, { partnerId })).get(partnerId) || NONE)
}

/**
 * What a new order's credit decision reads (lib/credit decide): the customer's exposure, what
 * is overdue (open items whose due date is before the ERP's today), and the credit warnings
 * Settings says to check.
 * @returns {Promise<{ exposure: number, overdue: number, warnings: string }>}
 */
async function creditStanding (cols, partner) {
  const settings = await getSettings(cols)
  const warnings = settings.sales.creditWarnings
  if (!partner) return { exposure: 0, overdue: 0, warnings }
  const [exposure, items] = await Promise.all([exposureOf(cols, partner.id), openItemsOf(cols, partner)])
  const day = today(settings.timeZone)
  const overdue = cents(items.filter((i) => i.dueDate && i.dueDate.slice(0, 10) < day).reduce((sum, i) => sum + i.openAmount, 0))
  return { exposure, overdue, warnings }
}

/**
 * A customer as its own document shows it, which is more than the record holds: the
 * credit picture, the customer's own sales orders, and the pricing agreed with it.
 *
 * Credit is null for the walk-in account — a customer with no company behind it — because
 * there is no credit relationship to describe; the screen leaves the card out rather
 * than showing a limit of zero. Exposure is never stored: it is worked out on read
 * (exposures) as the net of every open order plus what is open on every invoice, so raising
 * an order, invoicing it or paying it moves it without anything having to be kept in step.
 *
 * @param {object} cols collections
 * @param {object} partner the stored partner
 * @returns {Promise<object>} the partner, plus `credit` ({ limit, exposure, openOrders, openItems,
 *   available, held } or null), `openItems` (its unpaid invoices, oldest first; openItemsOf),
 *   `orders` (newest first, each with `net`), `conditions` (this customer's only) and `contracts`:
 *   the price lists that apply to it, its own then its price group's, each newest first
 */
async function describePartner (cols, partner) {
  const [rows, parts, openItems, conditions, own, group] = await Promise.all([
    ordersOf(cols, partner.id),
    exposures(cols, { partnerId: partner.id }),
    openItemsOf(cols, partner),
    findAll(cols.pricingConditions, { partnerId: partner.id }, { limit: 1000 }),
    listContracts(cols, { partnerId: partner.id }),
    partner.priceGroup ? listContracts(cols, { priceGroup: partner.priceGroup }) : []
  ])
  const contracts = [...own, ...group]
  // Open orders and open items, apart and together. The count of held orders is SAP's
  // "blocked documents" work list, for this customer.
  const { openOrders, openItems: openItemsAmount } = parts.get(partner.id) || NONE
  const exposure = cents(openOrders + openItemsAmount)
  const held = rows.filter((o) => o.creditStatus === 'held' && o.status !== 'canceled').length
  const limit = Number(partner.creditLimit) || 0
  return {
    ...partner,
    // What each sales organization is called (the ERP's own, on Settings), for the document.
    salesOrgNames: await salesOrgNames(cols),
    credit: hasCredit(partner) ? { limit, exposure, openOrders, openItems: openItemsAmount, available: cents(limit - exposure), held } : null,
    openItems,
    orders: rows,
    conditions,
    contracts
  }
}

/**
 * Add a sales organisation to a partner when an order arrives through it (SAP's extension
 * of the customer to a sales area, made automatic). The walk-in partner already has all.
 */
async function widenSalesOrgs (cols, partnerId, salesOrg) {
  if (!partnerId || !salesOrg) return
  const stored = upgradePartner(await cols.businessPartners.findOne({ _id: partnerId }))
  if (!stored || stored.salesOrgs.includes('*') || stored.salesOrgs.includes(salesOrg)) return
  await cols.businessPartners.replaceOne({ _id: partnerId }, { ...stored, salesOrgs: [...stored.salesOrgs, salesOrg] }, { upsert: true })
}

/** code → name for the ERP's sales organizations (Settings; lib/sales-organizations). */
async function salesOrgNames (cols) {
  const names = {}
  for (const org of salesOrganizationsOf(await getSettings(cols))) names[org.code] = org.name
  return names
}

module.exports = { DEFAULT_PARTNER_ID, BLOCKING, widenSalesOrgs, salesOrgNames, importPartners, seedPartnerPriceGroups, ensureDefaultPartner, listPartners, getPartner, resolvePartner, patchPartner, describePartner, exposureOf, creditStanding, withCredit, upgradePartner }
