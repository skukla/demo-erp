/*
 * The Settings page's words for what the ERP's setup holds (lib/setup.js): the labels a
 * setting's values carry, read the same in view and in edit.
 */

/** Business Central's Credit Warnings options, by the value the ERP stores. */
export const CREDIT_WARNING_OPTIONS = [
  { id: 'both', name: 'Both warnings' },
  { id: 'creditLimit', name: 'Credit limit' },
  { id: 'overdue', name: 'Overdue balance' },
  { id: 'none', name: 'No warning' }
]

export const creditWarningText = (value) => (CREDIT_WARNING_OPTIONS.find((o) => o.id === value) || { name: value }).name

/** The payment terms offered, with the one in force kept when it is not among them. */
const TERMS = ['NET7', 'NET10', 'NET14', 'NET15', 'NET30', 'NET45', 'NET60', 'NET90']

export function paymentTermsOptions (current) {
  const all = current && !TERMS.includes(current) ? [...TERMS, current] : TERMS
  return all.map((id) => ({ id, name: paymentTermsText(id) }))
}

/** "NET30 · 30 days" */
export function paymentTermsText (terms) {
  const match = /^NET(\d+)$/.exec(terms || '')
  return match ? `${terms} · ${match[1]} days` : (terms || '—')
}

/** Each number series by the document it numbers, in the order the setup lists them. */
const SERIES = { salesOrder: 'Sales orders', shipment: 'Shipments', invoice: 'Invoices', contract: 'Price lists', creditMemo: 'Credit memos', returnOrder: 'Return orders', payment: 'Payments' }

export const seriesText = (type) => SERIES[type] || type

/** An address on lines: street lines, then "postcode city, region", then the country. */
export function addressLines (address) {
  if (!address) return []
  const place = [[address.postcode, address.city].filter(Boolean).join(' '), address.region].filter(Boolean).join(', ')
  return [...(address.street || []), place, address.countryId].filter(Boolean)
}

