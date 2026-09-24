/*
 * How the ERP looks: its palette, its logo, and which side the menu is on.
 *
 * The SC sets this per demo so the same mock ERP can sit beside a customer's own
 * screens without looking like the same mock every time. It is stored WITH the ERP,
 * not in a browser, so the projector, a second tab and Demo Builder's link all agree.
 *
 * One module, read by both sides: the actions validate ids against these lists, and the
 * screen reads the very same hex out of them. A palette added here reaches both without
 * a second edit — which is the whole reason the colours live in a lib/ file that looks
 * like it belongs to the server.
 *
 * ## The floor these were chosen against
 *
 * Every palette clears 4.5:1 for text on its own ground, measured rather than judged
 * (docs/design-audit.md). test/appearance.test.js holds them to it, so a palette added
 * by eye fails the suite instead of shipping. That test exists because judging colour by
 * eye is exactly what produced a top navigation nobody could read.
 */

/* The eight custom properties a palette owns. Everything else in tokens.css — the grey
   ramp, space, radii, type — is the same whatever the SC picks; only the product's own
   colour moves. The Spectrum bridge reads nothing but these, so overriding them
   re-themes controls we have never touched. */
const TOKENS = [
  '--accent', '--accent-hover', '--accent-down', '--accent-tint',
  '--accent-edge', '--accent-ink', '--shell', '--shell-ink'
]

const palette = (label, [accent, hover, down, tint, edge, ink, shell, shellInk]) => ({
  label,
  tokens: {
    '--accent': accent,
    '--accent-hover': hover,
    '--accent-down': down,
    '--accent-tint': tint,
    '--accent-edge': edge,
    '--accent-ink': ink,
    '--shell': shell,
    '--shell-ink': shellInk
  }
})

const PALETTES = {
  teal: palette('Teal', ['#0f6b68', '#0c5754', '#094543', '#e4f1f0', '#9ecdca', '#0a4b49', '#0b4341', '#eaf3f2']),
  indigo: palette('Indigo', ['#3a4da8', '#2f3f8c', '#263372', '#eaecf8', '#b3bce6', '#2a3878', '#232f66', '#eceff9']),
  slate: palette('Slate', ['#47535f', '#3a444e', '#2e363e', '#eceef0', '#b9c1c8', '#39434d', '#2b3238', '#eef0f2']),
  bronze: palette('Bronze', ['#8a5a1f', '#6f4818', '#5a3a13', '#f7efe3', '#ddc19a', '#6b4517', '#4a3113', '#f4ece1']),
  plum: palette('Plum', ['#7a3a6b', '#632f57', '#4f2646', '#f5eaf2', '#d6b3cc', '#5e2c53', '#452038', '#f3e8f0'])
}

/* Four marks, each drawn in one colour and taking it from the palette, so none of them
   can clash with a theme. `monogram` is the first letter of whatever the ERP is called,
   which is the one that fits any name by construction. Drawn in screen/src/components/Logo.js. */
const LOGOS = ['monogram', 'cube', 'orbit', 'layers']

/* Fiori's Side Navigation, or Business Central's band along the top. Both are real
   patterns rather than a compromise between them. */
const NAV_POSITIONS = ['rail', 'top']

/* Presets: one click that writes the three values below. A theme is a SHORTCUT, never a
   fourth piece of state — nothing stores which one was used, so the controls and the
   screen can never disagree about what is showing. Plum is reachable from the colour
   control alone, which is the reason the controls exist alongside the presets. */
const THEMES = {
  harbour: { label: 'Harbour', palette: 'teal', logo: 'cube', nav: 'rail' },
  meridian: { label: 'Meridian', palette: 'indigo', logo: 'orbit', nav: 'top' },
  granite: { label: 'Granite', palette: 'slate', logo: 'layers', nav: 'rail' },
  foundry: { label: 'Foundry', palette: 'bronze', logo: 'monogram', nav: 'top' }
}

const DEFAULT_APPEARANCE = { palette: 'teal', logo: 'cube', nav: 'rail' }

const FIELDS = {
  palette: (v) => Object.prototype.hasOwnProperty.call(PALETTES, v),
  logo: (v) => LOGOS.includes(v),
  nav: (v) => NAV_POSITIONS.includes(v)
}

/**
 * The appearance after a patch: a combination the screen can always draw.
 *
 * A value that is not on the list is IGNORED rather than refused. The screen only ever
 * sends ids it was handed, so an unknown one is a stale tab or a hand-made call — and
 * keeping what is already showing is the answer that cannot interrupt a demo. The same
 * rule repairs a stored record whose values no longer exist, which is what makes a
 * palette safe to rename.
 *
 * @param {object} [patch] `palette`, `logo`, `nav`, and/or `theme` (a preset id, which
 *   fills in all three; an explicit value alongside it wins)
 * @param {object} [current] the appearance now
 * @returns {{palette: string, logo: string, nav: string}} the appearance to store
 */
function normalizeAppearance (patch, current) {
  const asked = patch || {}
  const preset = THEMES[asked.theme]
  const next = {}
  for (const [field, isKnown] of Object.entries(FIELDS)) {
    const candidates = [asked[field], preset && preset[field], current && current[field], DEFAULT_APPEARANCE[field]]
    next[field] = candidates.find(isKnown)
  }
  return next
}

module.exports = { TOKENS, PALETTES, LOGOS, NAV_POSITIONS, THEMES, DEFAULT_APPEARANCE, normalizeAppearance }
