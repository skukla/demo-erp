/* GET materials; GET materials/:sku; PATCH materials/:sku { listPrice?, stock? } */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listMaterials, getMaterial, patchMaterial } = require('../../lib/materials')

async function handler ({ cols, method, segments, body }) {
  const sku = segments[0] ? decodeURIComponent(segments[0]) : null
  if (method === 'GET' && !sku) return ok({ items: await listMaterials(cols) })
  if (method === 'GET') {
    const material = await getMaterial(cols, sku)
    if (!material) throw notFound(`Material ${sku}`)
    return ok(material)
  }
  if ((method === 'PATCH' || method === 'POST') && sku) {
    const material = await patchMaterial(cols, sku, body)
    if (!material) throw notFound(`Material ${sku}`)
    return ok(material)
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
