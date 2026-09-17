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

/** A product row with an edit applied before the ERP answers; quantities merge by warehouse. */
export function withEdit (product, patch) {
  if (!patch.warehouses) return { ...product, ...patch }
  const quantities = new Map(patch.warehouses.map((w) => [w.code, w.quantity]))
  const warehouses = product.warehouses.map((w) => (quantities.has(w.code) ? { ...w, quantity: quantities.get(w.code) } : w))
  return { ...product, warehouses, stock: warehouses.reduce((sum, w) => sum + w.quantity, 0) }
}

/**
 * A row after the ERP answered its save. The answer is the product alone, so a parent
 * keeps the totals it was listed with.
 */
export function withAnswer (row, answer) {
  if (row.type !== 'configurable') return { ...row, ...answer, saving: undefined }
  return { ...row, name: answer.name, updatedAt: answer.updatedAt, saving: undefined }
}

/** A parent's totals from its variants, as the ERP lists them (lib/products withVariants). */
export function withVariantTotals (parent, variants) {
  const prices = variants.map((v) => v.listPrice)
  return {
    ...parent,
    variants,
    stock: variants.reduce((sum, v) => sum + v.stock, 0),
    variantCount: variants.length,
    priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null
  }
}
