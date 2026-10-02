/*
 * POST admin/wipe                       remove every record (counters and settings stay)
 * POST admin/import { products, partners, stock, structure, projectName, origin? }   bulk upsert:
 *      Demo Builder fills the ERP through it, and the integration sends each change made in the
 *      web shop; `origin: { system, document? }` names who sent it, and journals it; `stock`
 *      is quantities per warehouse for products the ERP already has
 *
 * "Last import" moves only with a products import (Demo Builder's fill). A partners-only
 * or stock-only import (one change in the web shop) leaves it alone.
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { badRequest } = require('../../lib/errors')
const { wipe } = require('../../lib/admin')
const { importProducts, importStock } = require('../../lib/products')
const { importPartners, ensureDefaultPartner } = require('../../lib/partners')
const { seedPricing } = require('../../lib/seed-pricing')
const { stamp } = require('../../lib/settings')
const { journalImport } = require('../../lib/inbound')
const { seedSalesOrganizations } = require('../../lib/sales-organizations')

async function handler ({ cols, method, segments, body }) {
  if (method !== 'POST') return
  if (segments[0] === 'wipe') return ok({ wiped: await wipe(cols) })
  if (segments[0] === 'import') {
    const mirror = Array.isArray(body.products) || Array.isArray(body.partners) || Array.isArray(body.stock)
    if (!mirror && !body.seed) {
      throw badRequest('import needs a products array, a partners array, a stock array, a seed, or some of them')
    }
    const products = await importProducts(cols, body.products || [])
    const partners = await importPartners(cols, body.partners || [])
    // Stock alone moves quantities on products the ERP has; it is not an import of them.
    const stock = Array.isArray(body.stock) ? await importStock(cols, body.stock) : undefined
    await ensureDefaultPartner(cols, body.projectName)
    // The one-time setup seed of pricing from the web shop's shared catalogs (AB-44): price groups,
    // each customer's group, and the group's price lists. Sent last by the fill, so the products
    // and partners it references are already in.
    const seed = body.seed ? await seedPricing(cols, body.seed) : undefined
    // The web shop's websites and their sales organizations, replaced on every fill. The first
    // fill also seeds the ERP's own sales organizations; after that they are the ERP's.
    if (body.structure && Array.isArray(body.structure.websites)) {
      await stamp(cols, { structureMirror: { websites: body.structure.websites } })
      await seedSalesOrganizations(cols, body.structure.websites)
    }
    if (Array.isArray(body.products)) await stamp(cols, { lastImportAt: new Date().toISOString() })
    // A write a change in the web shop brought is journaled, so the Events log shows it arrived.
    // The setup seed is not such a change, so a seed-only import journals nothing.
    if (mirror) await journalImport(cols, body, { products, partners, stock })
    return ok({ products, partners, ...(stock ? { stock } : {}), ...(seed ? { seed } : {}) })
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
