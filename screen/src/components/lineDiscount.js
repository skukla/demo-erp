/*
 * The discount on a document's lines (contract version 17): the amount the customer's web
 * shop took off a line, which the sales order, its invoice and its credit memos carry. The
 * column and the total are shown only when a line has one, the way Totals leaves the Tax row
 * out when there is no tax: a document with no promotion on it reads as it always did.
 */
export const DISCOUNT_COLUMN = { key: 'discount', label: 'Discount', width: 106, align: 'end', holds: 'amount' }

const discountOf = (line) => Number(line && line.discount) || 0

/** What the lines' discounts come to, to the cent. */
export function discountTotal (lines) {
  return Math.round((lines || []).reduce((sum, l) => sum + discountOf(l), 0) * 100) / 100
}

/**
 * The columns with Discount before the net amount when a line carries a discount; the same
 * columns when none does. A table whose columns can change must be keyed on them (Spectrum
 * builds its column model once): key it on `discountTotal(lines) > 0` too.
 *
 * @param {{ key: string }[]} columns the table's columns, `amount` among them
 * @param {{ discount?: number }[]} lines the document's lines
 */
export function withDiscountColumn (columns, lines) {
  if (!(discountTotal(lines) > 0)) return columns
  const at = columns.findIndex((c) => c.key === 'amount')
  return [...columns.slice(0, at), DISCOUNT_COLUMN, ...columns.slice(at)]
}
