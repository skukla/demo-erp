/*
 * Contract pricing. Pure over the records it is handed, so it is tested without a
 * database. A pricing condition is one of:
 *   { kind: 'contractPrice', partnerId, sku, price }              a partner's price for a product
 *   { kind: 'contractDiscount', partnerId, sku?: null, percent }  a partner's discount, all products when sku is null
 *   { kind: 'maxDiscount', partnerId?: null, sku?: null, percent } the ceiling: most specific match wins
 */

const DEFAULT_MAX_DISCOUNT = 100

/** Specificity: partner+sku beats partner beats sku beats global. */
function specificity (condition) {
  return (condition.partnerId ? 2 : 0) + (condition.sku ? 1 : 0)
}

function matches (condition, partnerId, sku) {
  const partnerOk = !condition.partnerId || condition.partnerId === partnerId
  const skuOk = !condition.sku || condition.sku === sku
  return partnerOk && skuOk
}

function mostSpecific (conditions, kind, partnerId, sku) {
  return conditions
    .filter((c) => c.kind === kind && matches(c, partnerId, sku))
    .sort((a, b) => specificity(b) - specificity(a))[0]
}

/** @returns {number} rounded to cents */
function round2 (n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * One condition as the answer to "which rule was this?": its id and the fields that say
 * who and what it covers. Commerce shows these read-only — the ERP owns the rules, so the
 * ERP is the one that can explain them (AB-25, decision 2).
 */
function appliedRule (condition) {
  if (!condition) return undefined
  const { _id, kind, partnerId = null, sku = null, price, percent } = condition
  return {
    id: _id,
    kind,
    partnerId,
    sku,
    ...(price === undefined ? {} : { price: Number(price) }),
    ...(percent === undefined ? {} : { percent: Number(percent) })
  }
}

/**
 * Price one line for a partner.
 *
 * @param {object} args `{ product, partner, conditions, qty }`
 * @returns {object} `{ sku, qty, listPrice, contractPrice, discountPercent, maxDiscountPercent, source, applied }`
 *   where `applied` names the rules that decided it: `price` or `discount` (whichever the
 *   partner's own matched) and `ceiling` when one bounds it. `{}` when the line is at list.
 */
function priceLine ({ product, partner, conditions, qty = 1 }) {
  const partnerId = partner ? partner.id : undefined
  const sku = product.sku
  const listPrice = Number(product.listPrice) || 0
  const price = mostSpecific(conditions, 'contractPrice', partnerId, sku)
  const discount = mostSpecific(conditions, 'contractDiscount', partnerId, sku)
  const ceiling = mostSpecific(conditions, 'maxDiscount', partnerId, sku)
  const maxDiscountPercent = ceiling ? Number(ceiling.percent) : DEFAULT_MAX_DISCOUNT

  let contractPrice = listPrice
  let source = 'list'
  if (price && price.partnerId === partnerId) {
    contractPrice = Number(price.price)
    source = 'contractPrice'
  } else if (discount && discount.partnerId === partnerId) {
    contractPrice = round2(listPrice * (1 - Number(discount.percent) / 100))
    source = 'contractDiscount'
  }
  // The ceiling bounds how far below list a line may go, contract included.
  const floor = round2(listPrice * (1 - maxDiscountPercent / 100))
  if (contractPrice < floor) {
    contractPrice = floor
    source = 'ceiling'
  }
  const discountPercent = listPrice > 0 ? round2(((listPrice - contractPrice) / listPrice) * 100) : 0
  // Only the partner's OWN price or discount is named: another partner's rule matched the
  // sku but never decided this line, and naming it would read as though it had.
  const applied = {
    ...(price && price.partnerId === partnerId ? { price: appliedRule(price) } : {}),
    ...(discount && discount.partnerId === partnerId ? { discount: appliedRule(discount) } : {}),
    ...(ceiling ? { ceiling: appliedRule(ceiling) } : {})
  }
  return { sku, qty, listPrice, contractPrice: round2(contractPrice), discountPercent, maxDiscountPercent, source, lineTotal: round2(contractPrice * qty), applied }
}

/**
 * Quote a set of lines.
 *
 * @returns {object} `{ partnerId, lines, total }`
 */
function quote ({ products, partner, conditions, lines }) {
  const bySku = new Map(products.map((m) => [m.sku, m]))
  const priced = []
  for (const line of lines) {
    const product = bySku.get(line.sku)
    if (!product) {
      priced.push({ sku: line.sku, qty: line.qty ?? 1, unknown: true })
      continue
    }
    priced.push(priceLine({ product, partner, conditions, qty: line.qty ?? 1 }))
  }
  const total = round2(priced.reduce((sum, l) => sum + (l.lineTotal || 0), 0))
  return { partnerId: partner ? partner.id : null, lines: priced, total }
}

module.exports = { DEFAULT_MAX_DISCOUNT, appliedRule, specificity, matches, mostSpecific, round2, priceLine, quote }
