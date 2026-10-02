/*
 * The ERP's selling structure, as health answers it (business-structure plan): the company
 * code (this ERP, as Settings holds it: lib/setup), its sales organizations (its own, lib/
 * sales-organizations, plus any a customer or an order names that it does not hold), and its
 * warehouses (its plants, one per stock location an import named, under the ERP's own names). The counts are
 * derived on read; a wipe leaves the setup, so a wipe and a fill give the same answer.
 */
const { findAll } = require('./db')
const { getSettings } = require('./settings')
const { listPartners } = require('./partners')
const { listOrders } = require('./orders')
const { companyOf, homeWebsite, DEFAULT_COMPANY_CODE } = require('./setup')
const { salesOrganizationsOf, websitesOf } = require('./sales-organizations')

/** The sales organization an order with none sold through, and a website with no setting falls back to. */
const DEFAULT_SALES_ORG = DEFAULT_COMPANY_CODE

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
  const websites = websitesOf(settings)
  const home = homeWebsite(settings)
  const store = (home && home.storeInfo) || {}
  const company = companyOf(settings, home)

  const orgs = new Map()
  const org = (code) => {
    if (!orgs.has(code)) orgs.set(code, { code, name: null, currency: null, websiteCode: null, customers: 0, orders: 0 })
    return orgs.get(code)
  }
  for (const own of salesOrganizationsOf(settings)) {
    Object.assign(org(own.code), { name: own.name, currency: own.currency, websiteCode: own.websiteCode })
  }
  for (const partner of partners) {
    for (const code of partner.salesOrgs || []) if (code !== '*') org(code).customers += 1
  }
  for (const order of orders) org(order.salesOrg || DEFAULT_SALES_ORG).orders += 1

  const houses = new Map()
  for (const product of products) {
    for (const w of product.warehouses || []) {
      if (!houses.has(w.code)) houses.set(w.code, { code: w.code, imported: w.name || w.code, products: 0, stock: 0 })
      houses.get(w.code).products += 1
      houses.get(w.code).stock += Number(w.quantity) || 0
    }
  }
  for (const [code, value] of Object.entries(settings.warehouses || {})) {
    if (!houses.has(code)) houses.set(code, { code, imported: code, products: 0, stock: 0 })
    houses.get(code).name = value.name
  }

  // A website that fell back to the default sales organisation while another website
  // named one: its setting was never made. One website alone needs no setting.
  const named = websites.filter((w) => w.salesOrgName || w.salesOrg !== DEFAULT_SALES_ORG)
  const unmapped = websites.length > 1 && named.length > 0
    ? websites.filter((w) => w.salesOrg === DEFAULT_SALES_ORG && !w.salesOrgName).map((w) => w.code)
    : []

  return {
    companyCode: {
      code: company.code,
      name: company.name,
      currency: company.currency,
      countryId: (company.address && company.address.countryId) || store.countryId || null,
      vatNumber: company.taxId,
      address: company.address
    },
    salesOrgs: [...orgs.values()].map((o) => ({ ...o, name: o.name || o.code })).sort((a, b) => a.code.localeCompare(b.code)),
    warehouses: [...houses.values()].map(({ imported, ...h }) => ({ ...h, name: h.name || imported })).sort((a, b) => a.code.localeCompare(b.code)),
    unmapped
  }
}

module.exports = { describeStructure }
