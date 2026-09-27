/*
 * POST admin/wipe                       remove every record (counters and settings stay)
 * POST admin/import { products, partners, stock, structure, projectName, origin? }   bulk upsert:
 *      Demo Builder fills the ERP through it, and the integration sends each Commerce change;
 *      `origin: { event }` names the Commerce event behind a change, and journals it; `stock`
 *      is quantities per warehouse for products the ERP already has
 *
 * "Last import" moves only with a products import (Demo Builder's fill). A partners-only
 * or stock-only import (one Commerce event) leaves it alone.
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { badRequest } = require('../../lib/errors')
const { wipe } = require('../../lib/admin')
const { importProducts, importStock } = require('../../lib/products')
const { importPartners, ensureDefaultPartner } = require('../../lib/partners')
const { stamp } = require('../../lib/settings')
const { journalImport } = require('../../lib/inbound')

async function handler ({ cols, method, segments, body }) {
  if (method !== 'POST') return
  if (segments[0] === 'wipe') return ok({ wiped: await wipe(cols) })
  if (segments[0] === 'import') {
    if (!Array.isArray(body.products) && !Array.isArray(body.partners) && !Array.isArray(body.stock)) {
      throw badRequest('import needs a products array, a partners array, a stock array, or some of them')
    }
    const products = await importProducts(cols, body.products || [])
    const partners = await importPartners(cols, body.partners || [])
    // Stock alone moves quantities on products the ERP has; it is not an import of them.
    const stock = Array.isArray(body.stock) ? await importStock(cols, body.stock) : undefined
    await ensureDefaultPartner(cols, body.projectName)
    // Commerce's websites and their sales organisations, replaced on every fill.
    if (body.structure && Array.isArray(body.structure.websites)) await stamp(cols, { structureMirror: { websites: body.structure.websites } })
    if (Array.isArray(body.products)) await stamp(cols, { lastImportAt: new Date().toISOString() })
    // A write a Commerce event brought is journaled, so the Events log shows it arrived.
    await journalImport(cols, body, { products, partners, stock })
    return ok({ products, partners, ...(stock ? { stock } : {}) })
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
