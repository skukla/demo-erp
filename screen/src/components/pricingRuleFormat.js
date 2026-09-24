/*
 * How a pricing rule reads on screen.
 *
 * SAP calls these condition records and Business Central calls them sales prices and
 * sales line discounts. "Condition" is the more authentic word and it explains nothing
 * to anyone who has not used SAP — which, in a room, is most people. The screen says
 * what each rule DOES and carries the code beside it, so an SAP user recognises the
 * shape and everyone else can read it.
 *
 * The record still stores `kind`. Nothing here changes what is saved.
 */
import { money } from '../money'

const RULES = {
  contractPrice: { code: 'CP01', label: 'Agreed price' },
  contractDiscount: { code: 'CD01', label: 'Customer discount' },
  maxDiscount: { code: 'MD01', label: 'Discount limit' }
}

/** @returns {{ code: string, label: string }} what the rule does, and its code */
export function ruleOf (kind) {
  return RULES[kind] || { code: '—', label: kind || 'Unknown' }
}

/** "Agreed price · CP01" — the meaning first, the code as the ERP texture. */
export function ruleText (kind) {
  const rule = ruleOf(kind)
  return rule.code === '—' ? rule.label : `${rule.label} · ${rule.code}`
}

/* "All customers" and "All products" are answers, not blanks. A customer is named as
   well as numbered: C000101 tells a room nothing. The product stays its number — a SKU
   is the identifier a pricing agreement is actually written against, and naming it
   would mean pulling the whole catalogue to label a handful of rows. */
export const customerText = (rule, names) => {
  if (!rule.partnerId) return 'All customers'
  const name = names && names.get(rule.partnerId)
  return name ? `${rule.partnerId} · ${name}` : rule.partnerId
}
export const productText = (rule) => rule.sku || 'All products'

/** An agreed price is money; a discount and a limit are percentages. */
export function amountText (rule) {
  if (rule.kind === 'contractPrice') return money(rule.price)
  return `${rule.percent}%`
}

/* Validity reads as a date range with open ends left open: "1 Oct 2026 → 31 Dec 2026",
   "from 1 Oct 2026", "until 31 Dec 2026", or "always". */
const day = (iso) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

export function validityText (rule) {
  if (rule.validFrom && rule.validTo) return `${day(rule.validFrom)} → ${day(rule.validTo)}`
  if (rule.validFrom) return `from ${day(rule.validFrom)}`
  if (rule.validTo) return `until ${day(rule.validTo)}`
  return 'always'
}

/** Active · Scheduled · Expired on a day (YYYY-MM-DD), the way lib/pricing decides it. */
export function statusOf (rule, today) {
  if (rule.validFrom && today < rule.validFrom) return { text: 'Scheduled', variant: 'info' }
  if (rule.validTo && today > rule.validTo) return { text: 'Expired', variant: 'neutral' }
  return { text: 'Active', variant: 'positive' }
}

export const todayIso = () => new Date().toISOString().slice(0, 10)
