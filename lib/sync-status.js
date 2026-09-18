/*
 * What the ERP knows about the current sync, so both screens can say what is
 * happening instead of spinning. The ERP asks for a sync (`requested`); the
 * integration reports as it works (`running`, with a phase and per-type counts)
 * and how it ended (`done` or `failed`, with a reason a person can act on).
 *
 * Kept on the settings record: one sync at a time, and the latest one is what a
 * screen opened later should show.
 */
const { getSettings, stamp } = require('./settings')
const { badRequest } = require('./errors')
const { journalSync } = require('./inbound')

const STATES = ['requested', 'running', 'done', 'failed']
const PHASES = ['reading', 'partners', 'products']
const TYPES = ['partners', 'products']
const ERROR_MAX = 300

function progress (value, type) {
  const done = Number(value && value.done)
  const total = Number(value && value.total)
  if (!Number.isInteger(done) || !Number.isInteger(total) || done < 0 || total < 0 || done > total) {
    throw badRequest(`${type} progress needs whole numbers with 0 <= done <= total`)
  }
  return { done, total }
}

/**
 * Record one step of the sync.
 *
 * @param {object} cols collections
 * @param {object} patch `{ state, phase?, partners?, products?, error? }`
 * @param {string} [now] ISO time (tests)
 * @returns {Promise<object>} the sync record after the step
 */
async function recordSync (cols, patch, now = new Date().toISOString()) {
  if (!patch || !STATES.includes(patch.state)) {
    throw badRequest(`state must be one of ${STATES.join(', ')}`)
  }
  if (patch.phase !== undefined && !PHASES.includes(patch.phase)) {
    throw badRequest(`phase must be one of ${PHASES.join(', ')}`)
  }
  const current = (await getSettings(cols)).sync || {}
  let next
  if (patch.state === 'requested') {
    next = { state: 'requested', requestedAt: now, updatedAt: now }
  } else {
    // A run that starts after a finished one begins clean; the request time carries over.
    const fresh = patch.state === 'running' && current.state !== 'running'
    next = fresh
      ? { state: 'running', requestedAt: current.state === 'requested' ? current.requestedAt : undefined, startedAt: now }
      : { ...current, state: patch.state }
    next.updatedAt = now
    if (patch.phase) next.phase = patch.phase
    for (const type of TYPES) {
      if (patch[type] !== undefined) next[type] = progress(patch[type], type)
    }
    if (patch.state === 'done' || patch.state === 'failed') next.finishedAt = now
    if (patch.state === 'failed') {
      next.error = String(patch.error || 'The sync failed.').slice(0, ERROR_MAX)
    } else {
      delete next.error
    }
  }
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
  await stamp(cols, { sync: next })
  // Once per sync, when it finishes: the Events log's record that Commerce's data arrived.
  if (patch.state === 'done' && current.state !== 'done') await journalSync(cols, next)
  return next
}

module.exports = { STATES, PHASES, recordSync }
