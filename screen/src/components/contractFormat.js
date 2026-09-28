/*
 * How a customer price list reads on screen (the record is `contract`, the name the
 * integration calls). The words follow Business Central's sales price lists: Draft, Active,
 * Inactive, applies to a customer or a customer price group, an agreed price or a line
 * discount per product from a quantity. The status says more than the stored word when the calendar
 * matters: an active contract outside its dates prices nothing (lib/contract-prices), and
 * the screen says so rather than showing a green "Active" that does nothing.
 */
import { money } from '../money.js'
import { validityText } from './pricingRuleFormat.js'

/** @returns {{ text: string, variant: string }} the status on a day (YYYY-MM-DD) */
export function contractStatus (contract, today) {
  if (contract.status === 'draft') return { text: 'Draft', variant: 'neutral' }
  if (contract.status === 'inactive') return { text: 'Inactive', variant: 'notice' }
  if (contract.startingDate && today < contract.startingDate) return { text: 'Active · not yet started', variant: 'info' }
  if (contract.endingDate && today > contract.endingDate) return { text: 'Active · ended', variant: 'neutral' }
  return { text: 'Active', variant: 'positive' }
}

const LINE_KINDS = { price: 'Agreed price', discount: 'Line discount' }

/** "Agreed price" or "Line discount". */
export const lineKindText = (kind) => LINE_KINDS[kind] || kind

/** An agreed price is money; a line discount a percentage. */
export const lineAmountText = (line) => (line.kind === 'price' ? money(line.price) : `${line.percent}%`)

/** The list's term, as the pricing rules show validity: "1 Jan 2026 → 31 Dec 2026", "from 1 Jan 2026", "always". */
export const termText = (contract) => validityText({ validFrom: contract.startingDate, validTo: contract.endingDate })

/** A line's own dates; a line with none prices for as long as its list does. */
export function lineDatesText (line) {
  if (!line.startingDate && !line.endingDate) return 'As the list'
  return validityText({ validFrom: line.startingDate, validTo: line.endingDate })
}

/** "Customer C1 · Acme" or "Price group RETAIL · Retail shops", from maps of id → name. */
export function appliesToText (contract, customerNames, groupNames) {
  if (contract.appliesTo === 'priceGroup') {
    const name = groupNames && groupNames.get(contract.priceGroup)
    return name ? `Price group ${contract.priceGroup} · ${name}` : `Price group ${contract.priceGroup}`
  }
  const name = customerNames && customerNames.get(contract.partnerId)
  return name ? `Customer ${contract.partnerId} · ${name}` : `Customer ${contract.partnerId}`
}