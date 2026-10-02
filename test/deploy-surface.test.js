/*
 * Every action reaches where it is used: deployed (app.config.yaml declares it) and on the
 * ERP's own screen (actions/screen routes screen/api/<action> to it). The preview answers
 * from stand-in records, so a screen built against a route the screen action does not carry
 * looks fine there and fails deployed; this is the check that it cannot.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const contract = require('../contract/erp-contract.json')

const ACTIONS = fs.readdirSync(path.join(__dirname, '..', 'actions')).filter((a) => !a.startsWith('.'))

test('app.config.yaml declares every action', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'app.config.yaml'), 'utf-8')
  const missing = ACTIONS.filter((a) => !config.includes(`function: actions/${a}/index.js`))
  assert.deepEqual(missing, [])
  // Positive control: the check finds an action it is shown is absent.
  assert.equal(config.includes('function: actions/no-such-action/index.js'), false)
})

test('the screen carries every route of the contract', () => {
  const { handlers } = require('../actions/screen')
  assert.deepEqual(Object.keys(contract.routes).filter((name) => !handlers[name]), [])
})
