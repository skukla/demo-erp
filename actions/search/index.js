/* GET search?q=…: the documents that match what was typed, best first, for the shell bar. */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { search } = require('../../lib/search')

async function handler ({ cols, method, params }) {
  if (method === 'GET') return ok({ items: await search(cols, params.q) })
}

exports.handler = handler
exports.main = (params) => run(params, handler)
