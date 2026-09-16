/*
 * Runtime web-action request and response helpers.
 *
 * Adapted from agilent-erp-mock by Nishant Kapoor (Apache-2.0), see NOTICE: the body parser
 * with its base64 fallback and the scrubbing of Runtime's own keys are from there.
 */

/** Keys Runtime and the IMS annotation add beside the caller's fields. */
const PLUMBING = new Set(['LOG_LEVEL', 'ERP_DISPLAY_NAME', 'ERP_SCREEN_KEY', 'EVENTS_WEBHOOK_URL', '__ims_oauth_s2s', '__ims_env'])

/**
 * The request body as a plain object: a JSON string body (raw or base64), else the
 * caller's own parameters with Runtime's plumbing removed.
 *
 * @param {object} params the action params
 * @returns {object} the body
 */
function body (params) {
  if (params && typeof params.__ow_body === 'string' && params.__ow_body.length) {
    try {
      return JSON.parse(params.__ow_body)
    } catch (e) {
      try {
        return JSON.parse(Buffer.from(params.__ow_body, 'base64').toString('utf-8'))
      } catch (e2) {
        return {}
      }
    }
  }
  const out = {}
  for (const key of Object.keys(params || {})) {
    if (key.startsWith('__ow_') || key.startsWith('__ims_') || PLUMBING.has(key)) continue
    out[key] = params[key]
  }
  return out
}

/** @returns {string[]} the path segments after the action name, e.g. ['4711', 'status'] */
function segments (params) {
  const path = (params && params.__ow_path) || ''
  return path.split('/').filter(Boolean)
}

/** @returns {string} the HTTP method, upper case, GET by default */
function method (params) {
  return String((params && params.__ow_method) || 'get').toUpperCase()
}

/** @returns {object} the query parameters (Runtime merges them into params; this reads the string form when present) */
function query (params) {
  if (params && typeof params.__ow_query === 'string' && params.__ow_query.length) {
    return Object.fromEntries(new URLSearchParams(params.__ow_query))
  }
  return body(params)
}

/** @returns {object} a JSON web-action response */
function ok (data, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: data }
}

/** @returns {object} a JSON error response with a machine code and a sentence */
function fail (statusCode, code, message, extra = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: { status: 'ERROR', errorCode: code, errorMessage: message, ...extra }
  }
}

/** @returns {string[]} the names of the required fields that are absent or empty */
function missing (obj, required) {
  return required.filter((f) => {
    const v = obj ? obj[f] : undefined
    return v === undefined || v === null || v === ''
  })
}

module.exports = { body, segments, method, query, ok, fail, missing }
