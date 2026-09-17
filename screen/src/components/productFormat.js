/* How products read on screen: money, price ranges, variant values, kinds. */
export const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })

/** "$799.99" or "$799.99 – $1,099.00"; a parent with no variants has no price. */
export function priceText (product) {
  if (product.type !== 'configurable') return money.format(product.listPrice)
  const range = product.priceRange
  if (!range) return '—'
  return range.min === range.max ? money.format(range.min) : `${money.format(range.min)} – ${money.format(range.max)}`
}

/** "Silver · 128GB" */
export function variantText (attributes) {
  return (attributes || []).map((a) => a.value).filter(Boolean).join(' · ')
}

/** "Configurable · 16 variants", "Variant", or "Simple" */
export function kindText (product) {
  if (product.type === 'configurable') {
    return `Configurable · ${product.variantCount === 1 ? '1 variant' : `${product.variantCount || 0} variants`}`
  }
  return product.parentSku ? 'Variant' : 'Simple'
}
