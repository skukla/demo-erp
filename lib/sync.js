/*
 * Sync records: ask the subscriber (the Commerce integration) to send its records
 * again. The ERP knows nothing about Commerce, only that its subscriber mirrors
 * records into it, so this asks and returns; the import that follows arrives
 * through the ERP's own admin/import route and moves its last-import time.
 *
 * The subscriber answers at once and does the work in the background: a web
 * request is cut off after one minute, and a mirror can take longer.
 */
const contract = require('../contract/erp-contract.json')
const { authHeaders } = require('./events')
const { HttpError } = require('./errors')

const SYNC_TIMEOUT_MS = 20000

/**
 * The subscriber's sync address: in this workspace unless `SYNC_URL` says
 * otherwise (tests, or an integration deployed elsewhere).
 *
 * @param {object} params the action params
 * @returns {string|null} the URL, or null when the namespace is unknown (local tests)
 */
function syncUrl (params) {
  if (params && params.SYNC_URL) return String(params.SYNC_URL)
  const ns = process.env.__OW_NAMESPACE
  return ns ? `https://${ns}.adobeio-static.net${contract.sync.path}` : null
}

/**
 * @param {object} params the action params
 * @param {object} [deps] `{ fetch, headers }` for tests
 * @returns {Promise<{ started: true }>}
 * @throws {HttpError} 503 when there is no subscriber address, 502 when it refuses
 */
async function requestSync (params, deps = {}) {
  const url = syncUrl(params)
  if (!url) throw new HttpError(503, 'SYNC_UNAVAILABLE', 'This ERP has no connected integration to sync from.')
  const doFetch = deps.fetch || fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS)
  let res
  try {
    const headers = deps.headers || await authHeaders(params)
    res = await doFetch(url, { method: contract.sync.method, headers, body: '{}', signal: controller.signal })
  } catch (e) {
    throw new HttpError(502, 'SYNC_UNREACHABLE', `The connected integration did not answer: ${e.message}`)
  } finally {
    clearTimeout(timer)
  }
  if (res.status !== contract.sync.answers) {
    const detail = (await res.text()).slice(0, 200)
    throw new HttpError(502, 'SYNC_REFUSED', `The connected integration answered ${res.status}${detail ? `: ${detail}` : ''}.`)
  }
  return { started: true }
}

module.exports = { syncUrl, requestSync }
