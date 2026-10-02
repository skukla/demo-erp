/*
 * GET settings; PATCH/POST settings { appearance?, timeZone?, warehouses? };
 * GET settings/setup, PATCH settings/setup { company?, sales?, numberSeries? } — the ERP's
 * setup (lib/setup.js), each answering the whole setup;
 * POST settings/sales-organizations { code, name, currency, websiteCode? } and
 * PATCH settings/sales-organizations/:code { name?, currency?, websiteCode? } — the ERP's own
 * sales organizations (lib/sales-organizations.js), each answering the whole setup;
 * POST settings/maintenance { minutes? } starts a maintenance window (30 minutes by default),
 * DELETE settings/maintenance ends it. Answers in maintenance too: it is how the window ends.
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { updateSettings } = require('../../lib/settings')
const { describeSetup, updateSetup } = require('../../lib/setup')
const { addSalesOrganization, updateSalesOrganization } = require('../../lib/sales-organizations')
const { startMaintenance, endMaintenance } = require('../../lib/maintenance')

async function setup ({ cols, params, method, segments, body }) {
  const name = params.ERP_DISPLAY_NAME
  if (segments[0] === 'setup' && method === 'GET') return ok(await describeSetup(cols, name))
  if (segments[0] === 'setup' && method === 'PATCH') return ok(await updateSetup(cols, body, name))
  if (segments[0] !== 'sales-organizations') return
  if (method === 'POST' && !segments[1]) {
    await addSalesOrganization(cols, body)
    return ok(await describeSetup(cols, name), 201)
  }
  if (method === 'PATCH' && segments[1]) {
    await updateSalesOrganization(cols, decodeURIComponent(segments[1]), body)
    return ok(await describeSetup(cols, name))
  }
}

async function handler (ctx) {
  const { cols, params, method, segments, body, settings } = ctx
  if (segments[0] === 'maintenance') {
    if (method === 'POST') return ok({ maintenance: await startMaintenance(cols, body.minutes, params.ERP_DISPLAY_NAME) })
    if (method === 'DELETE') return ok({ maintenance: await endMaintenance(cols, params.ERP_DISPLAY_NAME) })
    return
  }
  if (segments[0]) return setup(ctx)
  if (method === 'GET') return ok(settings)
  if (method === 'PATCH' || method === 'POST' || method === 'PUT') {
    return ok(await updateSettings(cols, body, params.ERP_DISPLAY_NAME))
  }
}

exports.handler = handler
exports.openInMaintenance = true
exports.main = (params) => run(params, handler, { openInMaintenance: true })
