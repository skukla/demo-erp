/* GET products; GET products/:sku; PATCH products/:sku { listPrice?, stock? } */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listProducts, getProduct, patchProduct } = require('../../lib/products')

async function handler ({ cols, method, segments, body, params }) {
  const sku = segments[0] ? decodeURIComponent(segments[0]) : null
  if (method === 'GET' && !sku) return ok({ items: await listProducts(cols) })
  if (method === 'GET') {
    const product = await getProduct(cols, sku)
    if (!product) throw notFound(`Product ${sku}`)
    return ok(product)
  }
  if ((method === 'PATCH' || method === 'POST') && sku) {
    const product = await patchProduct(cols, sku, body, params)
    if (!product) throw notFound(`Product ${sku}`)
    return ok(product)
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
