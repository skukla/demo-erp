/*
 * The checks a setup field passes before the ERP keeps it (lib/setup.js,
 * lib/sales-organizations.js): each answers the cleaned value or refuses in words the
 * Settings screen shows as they stand.
 */
const { badRequest } = require('./errors')

/** Text as given, trimmed; empty is null. */
function textOf (value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' && typeof value !== 'number') throw badRequest('A setup field takes text.')
  const text = String(value).trim()
  return text || null
}

/** Text that must be there. */
function requiredText (value, refusal) {
  const text = textOf(value)
  if (!text) throw badRequest(refusal)
  return text
}

/** A currency: three letters (ISO 4217), upper case. */
function currencyOf (value) {
  const code = (textOf(value) || '').toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) throw badRequest('A currency is a three-letter code, such as USD.')
  return code
}

/** A short code of letters and digits, upper case: a company code or a sales organization (SAP keeps both to four). */
function shortCodeOf (value, refusal) {
  const code = (textOf(value) || '').toUpperCase()
  if (!/^[A-Z0-9]{1,4}$/.test(code)) throw badRequest(refusal)
  return code
}

module.exports = { textOf, requiredText, currencyOf, shortCodeOf }
