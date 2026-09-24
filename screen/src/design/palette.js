/*
 * The palette, applied.
 *
 * tokens.css declares every colour the screen uses and the default values for the eight
 * the SC can change. Those eight are re-declared at runtime on <html>, where an inline
 * custom property beats the stylesheet's :root — so a palette change re-colours the page
 * without rebuilding anything, Spectrum's own controls included: the bridge points
 * Spectrum's variables at these same eight (design/spectrum-bridge.css).
 *
 * The catalog is lib/appearance.js, the one the actions validate against. The hex lives
 * there rather than here so a palette cannot exist on one side and not the other.
 */
import { PALETTES, TOKENS, LOGOS, NAV_POSITIONS, THEMES, DEFAULT_APPEARANCE } from '../../../lib/appearance.js'

/**
 * The eight custom properties for a palette.
 *
 * An id nothing knows answers the default rather than an empty object: the ERP
 * normalizes what it stores, so this can only be reached by a screen running ahead of
 * the actions it is talking to, and a demo that keeps its colours is better than one
 * that loses them mid-sentence.
 *
 * @param {string} id a key of PALETTES
 * @returns {Record<string, string>} custom property name to hex
 */
export function paletteTokens (id) {
  const found = PALETTES[id] || PALETTES[DEFAULT_APPEARANCE.palette]
  return found.tokens
}

/**
 * Put a palette on the document. Every property is written every time, so switching
 * palettes never leaves one value behind from the last.
 *
 * @param {string} id a key of PALETTES
 */
export function applyPalette (id) {
  const tokens = paletteTokens(id)
  for (const name of TOKENS) {
    document.documentElement.style.setProperty(name, tokens[name])
  }
}

/* The screen's one door to the catalog: everything on this side imports the lists from
   here, so there is a single place to look when asking what the actions will accept. */
export { PALETTES, TOKENS, LOGOS, NAV_POSITIONS, THEMES, DEFAULT_APPEARANCE }
