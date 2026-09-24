/*
 * The eight custom properties a palette writes onto the document.
 *
 * The screen reads the very same catalog the actions validate against, so this also
 * proves the two sides cannot drift: an import that resolved to nothing would fail here.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { PALETTES, TOKENS, DEFAULT_APPEARANCE } = require('../lib/appearance')

async function load () {
  return import('../screen/src/design/palette.js')
}

test('a palette answers every token, and the same hex the catalog holds', async () => {
  const { paletteTokens } = await load()
  const tokens = paletteTokens('plum')
  assert.deepEqual(Object.keys(tokens).sort(), [...TOKENS].sort())
  assert.deepEqual(tokens, PALETTES.plum.tokens)
})

test('an id nothing knows answers the default rather than nothing at all', async () => {
  const { paletteTokens } = await load()
  assert.deepEqual(paletteTokens('chartreuse'), PALETTES[DEFAULT_APPEARANCE.palette].tokens)
  assert.deepEqual(paletteTokens(undefined), PALETTES[DEFAULT_APPEARANCE.palette].tokens)
})
