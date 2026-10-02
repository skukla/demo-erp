/*
 * The ERP's sales organizations (AB-59; AB-26y step 2: the ERP owns its structure). Each is
 * a code, a name, the currency it sells in and the web shop website it serves. They are kept
 * on the settings record, so a wipe leaves them, and edited on Settings.
 *
 * The first fill seeds them from the websites Demo Builder saw, once: only while the ERP has
 * none. Until then (an ERP filled before they were kept) they read from the websites the last
 * fill sent, as they always did, and the first edit keeps that list plus the change.
 *
 * What reads them: the customer document's sales organization names (lib/partners), the
 * seller block on an invoice (lib/fulfilment), and the structure health answers
 * (lib/structure). Which sales organizations prices are published per still follows the
 * websites (lib/contracts pricingRecords): the integration can only write a price to a
 * website it maps, and a sales organization added here serves none it knows.
 */
const { badRequest, notFound } = require('./errors')
const { getSettings, stamp } = require('./settings')
const { textOf, requiredText, currencyOf, shortCodeOf } = require('./setup-fields')

const byCode = (a, b) => a.code.localeCompare(b.code)

/** The websites the last fill sent. */
function websitesOf (settings) {
  return (settings.structureMirror && settings.structureMirror.websites) || []
}

/** One sales organization per code the websites name, as the fill knows it. */
function fromWebsites (websites) {
  const orgs = new Map()
  for (const site of websites || []) {
    if (!site || !site.salesOrg || orgs.has(site.salesOrg)) continue
    orgs.set(site.salesOrg, {
      code: site.salesOrg,
      name: site.salesOrgName || site.name || site.salesOrg,
      currency: (site.storeInfo && site.storeInfo.currency) || null,
      websiteCode: site.code || null
    })
  }
  return [...orgs.values()].sort(byCode)
}

/** The ERP's sales organizations: its own once it has any, else what the last fill sent. */
function salesOrganizationsOf (settings) {
  const own = settings.salesOrganizations
  return Array.isArray(own) && own.length ? [...own].sort(byCode) : fromWebsites(websitesOf(settings))
}

/** The first fill's websites become the ERP's sales organizations, when it has none of its own. */
async function seedSalesOrganizations (cols, websites) {
  const settings = await getSettings(cols)
  if ((settings.salesOrganizations || []).length) return
  const seeded = fromWebsites(websites)
  if (seeded.length) await stamp(cols, { salesOrganizations: seeded })
}

const CODE_REFUSAL = 'A sales organization code is 1 to 4 letters or digits, such as 2000.'

/** A web shop website code (letters, digits and underscores), or null for none. */
function websiteOf (value) {
  const code = textOf(value)
  if (code === null) return null
  if (!/^[a-z0-9_]+$/i.test(code)) throw badRequest('A website code is letters, digits and underscores, such as base.')
  return code.toLowerCase()
}

/** The fields of a sales organization, checked: the code is the caller's. */
function fieldsOf (body, current = {}) {
  return {
    name: body.name !== undefined ? requiredText(body.name, 'A sales organization needs a name.') : current.name,
    currency: body.currency !== undefined ? currencyOf(body.currency) : current.currency,
    websiteCode: body.websiteCode !== undefined ? websiteOf(body.websiteCode) : (current.websiteCode ?? null)
  }
}

/** A website serves one sales organization. */
function refuseSharedWebsite (list, org) {
  const other = org.websiteCode && list.find((o) => o.code !== org.code && o.websiteCode === org.websiteCode)
  if (other) throw badRequest(`Website ${org.websiteCode} is served by sales organization ${other.code}.`)
}

/**
 * Add a sales organization.
 * @param {object} body `{ code, name, currency, websiteCode? }`
 * @returns {Promise<object[]>} the sales organizations after it
 */
async function addSalesOrganization (cols, body = {}) {
  const list = salesOrganizationsOf(await getSettings(cols))
  const code = shortCodeOf(body.code, CODE_REFUSAL)
  if (list.some((o) => o.code === code)) throw badRequest(`Sales organization ${code} exists already.`)
  if (body.name === undefined) throw badRequest('A sales organization needs a name.')
  if (body.currency === undefined) throw badRequest('A currency is a three-letter code, such as USD.')
  const org = { code, ...fieldsOf(body) }
  refuseSharedWebsite(list, org)
  const next = [...list, org].sort(byCode)
  await stamp(cols, { salesOrganizations: next })
  return next
}

/**
 * Change a sales organization's name, currency or website; its code is fixed, since orders
 * and customers carry it.
 * @returns {Promise<object[]>} the sales organizations after it
 */
async function updateSalesOrganization (cols, code, body = {}) {
  const list = salesOrganizationsOf(await getSettings(cols))
  const current = list.find((o) => o.code === String(code))
  if (!current) throw notFound(`Sales organization ${code}`)
  if (body.code !== undefined && String(body.code).trim().toUpperCase() !== current.code) {
    throw badRequest(`A sales organization keeps its code: orders and customers carry ${current.code}.`)
  }
  const org = { code: current.code, ...fieldsOf(body, current) }
  refuseSharedWebsite(list, org)
  const next = list.map((o) => (o.code === org.code ? org : o))
  await stamp(cols, { salesOrganizations: next })
  return next
}

module.exports = { salesOrganizationsOf, seedSalesOrganizations, addSalesOrganization, updateSalesOrganization, websitesOf }
