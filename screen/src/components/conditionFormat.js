/*
 * How a pricing condition reads on screen.
 *
 * The record stores a `kind`; an ERP shows a CODE and a name. SAP's condition types are
 * four characters (its own examples run PR00, K007, and the customer namespace starts
 * with Z), and Business Central names its equivalents in full. These are ours, and they
 * are display only — nothing stored changes.
 */
import { money } from '../money'

const CONDITIONS = {
  contractPrice: { code: 'CP01', label: 'Contract price' },
  contractDiscount: { code: 'CD01', label: 'Contract discount' },
  maxDiscount: { code: 'MD01', label: 'Maximum discount' }
}

/** @returns {{ code: string, label: string }} the condition's code and name */
export function conditionOf (kind) {
  return CONDITIONS[kind] || { code: '—', label: kind || 'Unknown' }
}

/** "All customers" and "All products" are answers, not blanks. */
export const soldToText = (condition) => condition.partnerId || 'All customers'
export const productText = (condition) => condition.sku || 'All products'

/** A price is money; a discount and a ceiling are percentages. */
export function amountText (condition) {
  if (condition.kind === 'contractPrice') return money(condition.price)
  return `${condition.percent}%`
}
