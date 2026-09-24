/*
 * The ERP's selling structure, derived on read (business-structure plan): the company
 * code (this ERP), its sales organisations (one per Commerce website, from the structure
 * the mirror sent and the sales organisations partners and orders name), and its
 * warehouses (one per Commerce inventory source, under the ERP's own names). Nothing here
 * is stored except the warehouse names and the mirror's block on settings; a wipe and a
 * mirror rebuild the card identically.
 */
const { findAll } = require('./db')
const { getSettings } = require('./settings')
const { listPartners } = require('./partners')
const { listOrders } = require('./orders')

/** The one company code this ERP is (P2: fixed; two ERPs are two systems, each 1000). */
const COMPANY_CODE = '1000'

/**
 * @returns {Promise<object>} `{ companyCode, salesOrgs, warehouses, unmapped }` — see the plan
 */
async function describeStructure (cols) {
  const [settings, partners, orders, products] = await Promise.all([
    getSettings(cols),
    listPartners(cols),
    listOrders(cols),
    findAll(cols.products, {}, { limit: 5000 })
  ])
  const websites = (settings.structureMirror && settings.structureMirror.websites) || []
  const home = websites.find((w) => w.salesOrg === COMPANY_CODE) || websites[0] || null
  const store = (home && home.storeInfo) || {}

  const orgs = new Map()
  const org = (code) => {
    if (!orgs.has(code)) orgs.set(code, { code, name: null, websiteCode: null, customers: 0, orders: 0 })
    return orgs.get(code)
  }
  for (const site of websites) {
    if (!site.salesOrg) continue
    const entry = org(site.salesOrg)
    entry.name = entry.name || site.salesOrgName || site.name || site.salesOrg
    entry.websiteCode = entry.websiteCode || site.code || null
  }
  for (const partner of partners) {
    for (const code of partner.salesOrgs || []) if (code !== '*') org(code).customers += 1
  }
  for (const order of orders) org(order.salesOrg || COMPANY_CODE).orders += 1

  const houses = new Map()
  for (const product of products) {
    for (const w of product.warehouses || []) {
      if (!houses.has(w.code)) houses.set(w.code, { code: w.code, commerceName: w.name || w.code, products: 0 })
      houses.get(w.code).products += 1
    }
  }
  for (const [code, value] of Object.entries(settings.warehouses || {})) {
    if (!houses.has(code)) houses.set(code, { code, commerceName: code, products: 0 })
    houses.get(code).name = value.name
  }

  // A website that fell back to the default sales organisation while another website
  // named one: its setting was never made. One website alone needs no setting.
  const named = websites.filter((w) => w.salesOrgName || w.salesOrg !== COMPANY_CODE)
  const unmapped = websites.length > 1 && named.length > 0
    ? websites.filter((w) => w.salesOrg === COMPANY_CODE && !w.salesOrgName).map((w) => w.code)
    : []

  return {
    companyCode: {
      code: COMPANY_CODE,
      name: settings.displayName,
      currency: store.currency ?? null,
      countryId: store.countryId ?? null,
      vatNumber: store.vatNumber ?? null,
      address: store.address ?? null
    },
    salesOrgs: [...orgs.values()].map((o) => ({ ...o, name: o.name || o.code })).sort((a, b) => a.code.localeCompare(b.code)),
    warehouses: [...houses.values()].map((h) => ({ ...h, name: h.name || h.commerceName })).sort((a, b) => a.code.localeCompare(b.code)),
    unmapped
  }
}

module.exports = { COMPANY_CODE, describeStructure }
