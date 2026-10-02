/*
 * What the SC has picked in the Appearance panel, and the look it makes.
 *
 * A choice is `{ theme?, palette?, logo?, nav? }` — exactly the `appearance` Save sends — so the panel
 * holds what the SC asked for rather than a finished look. The look is worked out by the
 * ERP's own rule (lib/appearance.js normalizeAppearance): a theme brings its colour, mark
 * and menu, and a colour named alongside it wins. Picking a theme after a colour drops
 * that colour, so the theme's own applies; the same for a mark or a menu. The preview is therefore what Save will store.
 */
import { normalizeAppearance, THEMES } from '../design/palette.js'

export const NOTHING_PICKED = Object.freeze({})

/** A theme picked: it sets its own colour, so an earlier colour pick no longer applies. */
export function withTheme (theme) {
  return { theme, palette: THEMES[theme].palette }
}

/** A colour, mark or menu picked (`palette`, `logo`, `nav`): it wins over any theme picked before it. */
export function withPart (choice, field, value) {
  return { ...choice, [field]: value }
}

/**
 * The look a choice makes over the saved one.
 *
 * @param {{theme?: string, palette?: string}} choice what has been picked
 * @param {{palette: string, logo: string, nav: string}} saved the ERP's look now
 * @returns {{palette: string, logo: string, nav: string}}
 */
export function lookOf (choice, saved) {
  return normalizeAppearance(choice, saved)
}
