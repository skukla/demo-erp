/*
 * The outbox: everything that changed in the ERP that Commerce should hear about.
 * The ERP knows nothing of Commerce; the integration drains this queue and
 * acknowledges each entry (decision 7 of the plan).
 */
const { findAll } = require('./db')
const { randomUUID } = require('crypto')

/** @returns {Promise<object>} the entry written */
async function emit (cols, event) {
  const entry = { _id: randomUUID(), at: new Date().toISOString(), acked: false, ...event }
  await cols.outbox.replaceOne({ _id: entry._id }, entry, { upsert: true })
  return entry
}

/** Pending entries, oldest first. */
function pending (cols, limit = 200) {
  return findAll(cols.outbox, { acked: false }, { limit, sort: { at: 1 } })
}

/** Mark entries delivered. Unknown ids are ignored. */
async function ack (cols, ids) {
  let count = 0
  for (const id of ids) {
    const entry = await cols.outbox.findOne({ _id: id })
    if (!entry || entry.acked) continue
    await cols.outbox.replaceOne({ _id: id }, { ...entry, acked: true, ackedAt: new Date().toISOString() }, { upsert: true })
    count += 1
  }
  return count
}

module.exports = { emit, pending, ack }
