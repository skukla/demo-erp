/*
 * The ERP's appearance: which palette, which logo, which side the menu is on.
 *
 * The SC personalises this per demo, so the same mock ERP can sit beside a customer's
 * own screens without looking like the same mock every time. It is stored with the ERP
 * rather than in a browser, so the projector, a second tab and Demo Builder's link all
 * show the same thing.
 *
 * The palettes are held to docs/design-audit.md's floor HERE rather than by eye. Judging
 * colour by eye is what produced a top navigation nobody could read.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ratio } = require('./helpers/contrast')
const {
  PALETTES, LOGOS, NAV_POSITIONS, THEMES, DEFAULT_APPEARANCE, TOKENS, normalizeAppearance
} = require('../lib/appearance')

test('the default appearance names things that exist', () => {
  assert.ok(PALETTES[DEFAULT_APPEARANCE.palette], 'palette')
  assert.ok(LOGOS.includes(DEFAULT_APPEARANCE.logo), 'logo')
  assert.ok(NAV_POSITIONS.includes(DEFAULT_APPEARANCE.nav), 'nav')
})

test('every palette defines every token the screen overrides, and no others', () => {
  for (const [id, palette] of Object.entries(PALETTES)) {
    assert.deepEqual(Object.keys(palette.tokens).sort(), [...TOKENS].sort(), `palette ${id}`)
  }
})

test('every theme is a shortcut to values that exist', () => {
  for (const [id, theme] of Object.entries(THEMES)) {
    assert.ok(PALETTES[theme.palette], `${id} palette`)
    assert.ok(LOGOS.includes(theme.logo), `${id} logo`)
    assert.ok(NAV_POSITIONS.includes(theme.nav), `${id} nav`)
  }
})

test('every palette clears the contrast floor: 4.5 for text on its own ground', () => {
  for (const [id, { tokens }] of Object.entries(PALETTES)) {
    // White sits on --accent (the accent button); --accent-ink sits on --accent-tint
    // (badges, quiet panels); --shell-ink sits on --shell (the bar and the rail).
    assert.ok(ratio('#ffffff', tokens['--accent']) >= 4.5, `${id}: white on accent`)
    assert.ok(ratio(tokens['--accent-ink'], tokens['--accent-tint']) >= 4.5, `${id}: ink on tint`)
    assert.ok(ratio(tokens['--shell-ink'], tokens['--shell']) >= 4.5, `${id}: shell ink on shell`)
  }
})

test('a valid patch is taken', () => {
  const next = normalizeAppearance({ palette: 'slate', nav: 'top' }, DEFAULT_APPEARANCE)
  assert.equal(next.palette, 'slate')
  assert.equal(next.nav, 'top')
  assert.equal(next.logo, DEFAULT_APPEARANCE.logo, 'what was not asked about does not move')
})

test('a theme id is expanded into the three values and is not itself stored', () => {
  const [id, theme] = Object.entries(THEMES)[1]
  const next = normalizeAppearance({ theme: id }, DEFAULT_APPEARANCE)
  assert.deepEqual(next, { palette: theme.palette, logo: theme.logo, nav: theme.nav })
  assert.equal(next.theme, undefined, 'the preset is a shortcut, not a fourth piece of state')
})

test('an explicit value beats the theme it is sent with', () => {
  const [id, theme] = Object.entries(THEMES)[0]
  const other = NAV_POSITIONS.find((n) => n !== theme.nav)
  assert.equal(normalizeAppearance({ theme: id, nav: other }, DEFAULT_APPEARANCE).nav, other)
})

test('a value that is not on the list is ignored, and the rest of the patch still lands', () => {
  // The screen only ever sends ids it was given, so an unknown one is a stale tab or a
  // hand-made call. Keeping the current value is the answer that cannot break a demo.
  const next = normalizeAppearance({ palette: 'chartreuse', nav: 'top' }, DEFAULT_APPEARANCE)
  assert.equal(next.palette, DEFAULT_APPEARANCE.palette)
  assert.equal(next.nav, 'top')
})

test('nothing at all answers the current appearance unchanged', () => {
  const current = { palette: 'plum', logo: 'orbit', nav: 'top' }
  assert.deepEqual(normalizeAppearance(undefined, current), current)
  assert.deepEqual(normalizeAppearance({}, current), current)
  assert.deepEqual(normalizeAppearance(null, current), current)
})

test('a broken stored appearance is repaired rather than carried forward', () => {
  // Whatever is on disk, the screen must be handed a combination it can draw.
  const next = normalizeAppearance({}, { palette: 'gone', logo: 'gone', nav: 'sideways' })
  assert.deepEqual(next, DEFAULT_APPEARANCE)
})
