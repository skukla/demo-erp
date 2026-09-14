/*
 * POST admin/wipe                       remove every record (counters and settings stay)
 * POST admin/import { products, partners, projectName }   bulk upsert from the integration
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { badRequest } = require('../../lib/errors')
const { wipe } = require('../../lib/admin')
const { importProducts } = require('../../lib/products')
const { importPartners, ensureDefaultPartner } = require('../../lib/partners')
const { stamp } = require('../../lib/settings')

async function handler ({ cols, method, segments, body }) {
  if (method !== 'POST') return
  if (segments[0] === 'wipe') return ok({ wiped: await wipe(cols) })
  if (segments[0] === 'import') {
    if (!Array.isArray(body.products) && !Array.isArray(body.partners)) {
      throw badRequest('import needs a products array, a partners array, or both')
    }
    const products = await importProducts(cols, body.products || [])
    const partners = await importPartners(cols, body.partners || [])
    await ensureDefaultPartner(cols, body.projectName)
    await stamp(cols, { lastImportAt: new Date().toISOString() })
    return ok({ products, partners })
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler, { allowOffline: true })
exports.allowOffline = true
