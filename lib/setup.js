/*
 * The ERP's setup (AB-59), the four sections of its Settings page, shaped like Business
 * Central's setup pages. Only fields the ERP acts on:
 *
 *   - Company (Company Information): code, name, address, tax ID, currency. The seller block
 *     on every invoice (lib/fulfilment sellerOf), the company code health answers
 *     (lib/structure), and the currency money with no currency of its own is shown in.
 *   - Sales & receivables (Sales & Receivables Setup): the payment terms a new customer
 *     takes (lib/partners), the credit warnings an order's credit decision checks
 *     (lib/credit decide), and the return reason codes a return line is coded with
 *     (lib/returns).
 *   - Number series (No. Series): each document type's next number, forward only
 *     (lib/counters checkNext).
 *   - Sales organizations: lib/sales-organizations.js.
 *
 * A company field nobody has set falls back to what the last fill sent (the home website's
 * Store Information) and the name to the ERP's own, so an ERP set up before this page
 * existed reads as it did.
 */
const { badRequest } = require('./errors')
const { getSettings, stamp } = require('./settings')
const { CREDIT_WARNINGS } = require('./credit')
const { daysOf } = require('./terms')
const { numberSeries, checkNext, setNext } = require('./counters')
const { salesOrganizationsOf, websitesOf } = require('./sales-organizations')
const { textOf, requiredText, currencyOf, shortCodeOf } = require('./setup-fields')

/** The company code an ERP has until someone sets one (P2: two ERPs are two systems, each 1000). */
const DEFAULT_COMPANY_CODE = '1000'

/** The website mapped to the default sales organization, else the first: where the company's fallbacks come from. */
function homeWebsite (settings) {
  const websites = websitesOf(settings)
  return websites.find((w) => w.salesOrg === DEFAULT_COMPANY_CODE) || websites[0] || null
}

/**
 * The company as the ERP uses it: what is set, else what the website knows, else nothing.
 * @param {object} settings
 * @param {object|null} [website] the website whose Store Information stands in (the home one by default)
 * @returns {{ code: string, name: string, address: object|null, taxId: string|null, currency: string|null }}
 */
function companyOf (settings, website = homeWebsite(settings)) {
  const set = settings.company || {}
  const info = (website && website.storeInfo) || {}
  return {
    code: set.code || DEFAULT_COMPANY_CODE,
    name: set.name || settings.displayName,
    address: set.address || info.address || null,
    taxId: set.taxId || info.vatNumber || null,
    currency: set.currency || info.currency || null
  }
}

/** An address, checked: street lines, city, region, postal code, country (two letters). Empty is null. */
function addressOf (value) {
  if (value === null || value === '') return null
  if (typeof value !== 'object') throw badRequest('An address has street, city, region, postcode and countryId.')
  const lines = Array.isArray(value.street) ? value.street : String(value.street || '').split('\n')
  const country = (textOf(value.countryId) || '').toUpperCase()
  if (country && !/^[A-Z]{2}$/.test(country)) throw badRequest('A country is a two-letter code, such as US.')
  const address = {
    street: lines.map(textOf).filter(Boolean),
    city: textOf(value.city),
    region: textOf(value.region),
    postcode: textOf(value.postcode),
    countryId: country || null
  }
  return address.street.length || address.city || address.region || address.postcode || address.countryId ? address : null
}

/** A company patch over what is stored: name, code and currency cannot be emptied; tax ID and address can. */
function companyPatch (current, patch) {
  if (!patch || typeof patch !== 'object') throw badRequest('company takes code, name, address, taxId and currency.')
  const next = { ...current }
  if (patch.code !== undefined) next.code = shortCodeOf(patch.code, 'A company code is 1 to 4 letters or digits, such as 1000.')
  if (patch.name !== undefined) next.name = requiredText(patch.name, 'The company needs a name.')
  if (patch.currency !== undefined) next.currency = currencyOf(patch.currency)
  if (patch.taxId !== undefined) next.taxId = textOf(patch.taxId)
  if (patch.address !== undefined) next.address = addressOf(patch.address)
  return next
}

/** Payment terms the ERP can make a due date from: NET and a number of days. */
function termsOf (value) {
  const terms = (textOf(value) || '').toUpperCase().replace(/\s+/g, '')
  if (daysOf(terms) === null) throw badRequest('Payment terms are NET and a number of days, such as NET30.')
  return terms
}

/** Return reason codes: each a code (letters and digits, up to ten) and a description, none twice. */
function returnReasonsOf (value) {
  if (!Array.isArray(value) || value.length === 0) throw badRequest('The ERP needs at least one return reason.')
  const reasons = value.map((r) => ({
    code: (textOf(r && r.code) || '').toUpperCase(),
    description: requiredText(r && r.description, 'Each return reason needs a description.')
  }))
  for (const r of reasons) {
    if (!/^[A-Z0-9]{1,10}$/.test(r.code)) throw badRequest('A return reason code is 1 to 10 letters or digits, such as DAMAGED.')
  }
  // The first of two that match, as it was written.
  const twice = (key) => reasons.find((r, i) => reasons.some((o, j) => j > i && o[key].toLowerCase() === r[key].toLowerCase()))
  const code = twice('code')
  if (code) throw badRequest(`Return reason ${code.code} is listed twice.`)
  const description = twice('description')
  if (description) throw badRequest(`Two return reasons are described as ${description.description}.`)
  return reasons
}

/** A sales and receivables patch over what is stored. */
function salesPatch (current, patch) {
  if (!patch || typeof patch !== 'object') throw badRequest('sales takes defaultPaymentTerms, creditWarnings, returnReasons and defaultReturnReason.')
  const next = { ...current }
  if (patch.defaultPaymentTerms !== undefined) next.defaultPaymentTerms = termsOf(patch.defaultPaymentTerms)
  if (patch.creditWarnings !== undefined) {
    if (!CREDIT_WARNINGS.includes(patch.creditWarnings)) throw badRequest(`Credit warnings are one of ${CREDIT_WARNINGS.join(', ')}.`)
    next.creditWarnings = patch.creditWarnings
  }
  if (patch.returnReasons !== undefined) next.returnReasons = returnReasonsOf(patch.returnReasons)
  if (patch.defaultReturnReason !== undefined) next.defaultReturnReason = (textOf(patch.defaultReturnReason) || '').toUpperCase()
  if (!next.returnReasons.some((r) => r.code === next.defaultReturnReason)) {
    throw badRequest(`The default return reason ${next.defaultReturnReason || '(none)'} is not one of the return reasons.`)
  }
  return next
}

/** Each series' next number, checked before anything is written. */
async function numbersOf (cols, patch) {
  if (!patch || typeof patch !== 'object') throw badRequest('numberSeries takes { [type]: { next } }.')
  const checked = []
  for (const [type, value] of Object.entries(patch)) {
    const wanted = value && typeof value === 'object' ? value.next : value
    // eslint-disable-next-line no-await-in-loop -- one read per series named
    checked.push([type, await checkNext(cols, type, wanted)])
  }
  return checked
}

/**
 * The setup page's view: the four sections as the ERP uses them.
 * @returns {Promise<{ company: object, sales: object, numberSeries: object[], salesOrganizations: object[] }>}
 */
async function describeSetup (cols, defaultName) {
  const settings = await getSettings(cols, defaultName)
  return {
    company: companyOf(settings),
    sales: settings.sales,
    numberSeries: await numberSeries(cols),
    salesOrganizations: salesOrganizationsOf(settings)
  }
}

/**
 * Change one or more sections. Every field is checked before any is kept, so a refusal
 * leaves the setup as it was.
 * @param {object} patch `{ company?, sales?, numberSeries? }`
 * @returns {Promise<object>} the setup after the change (describeSetup)
 */
async function updateSetup (cols, patch = {}, defaultName) {
  const current = await getSettings(cols, defaultName)
  const fields = {}
  if (patch.company !== undefined) fields.company = companyPatch(current.company, patch.company)
  if (patch.sales !== undefined) fields.sales = salesPatch(current.sales, patch.sales)
  const numbers = patch.numberSeries !== undefined ? await numbersOf(cols, patch.numberSeries) : []
  if (Object.keys(fields).length) await stamp(cols, fields)
  for (const [type, wanted] of numbers) {
    // eslint-disable-next-line no-await-in-loop -- one write per series moved
    await setNext(cols, type, wanted)
  }
  return describeSetup(cols, defaultName)
}

module.exports = { DEFAULT_COMPANY_CODE, companyOf, homeWebsite, describeSetup, updateSetup }
