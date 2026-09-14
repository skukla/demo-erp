const { test } = require('node:test')
const assert = require('node:assert/strict')
const { wrapCollection, isNotFound } = require('../lib/db')

test('the not-found failure the service reports becomes null; any other error passes through', async () => {
  const notFound = Object.assign(new Error('Request 1 to v1/collection/settings/findOne failed: Document not found'), { name: 'DbError' })
  assert.equal(isNotFound(notFound), true)
  assert.equal(isNotFound(new Error('Request 1 to v1/collection/settings/findOne failed: unauthorized')), false)
  const wrapped = wrapCollection({ findOne: async () => { throw notFound } })
  assert.equal(await wrapped.findOne({ _id: 'x' }), null)
  const broken = wrapCollection({ findOne: async () => { throw new Error('boom') } })
  await assert.rejects(broken.findOne({}), /boom/)
})

test('find options become cursor calls in the order sort, skip, limit', () => {
  const calls = []
  const chain = { sort: (s) => { calls.push(['sort', s]); return chain }, skip: (n) => { calls.push(['skip', n]); return chain }, limit: (n) => { calls.push(['limit', n]); return chain } }
  const wrapped = wrapCollection({ find: () => chain })
  wrapped.find({}, { limit: 5, sort: { _id: -1 } })
  assert.deepEqual(calls, [['sort', { _id: -1 }], ['limit', 5]])
})
