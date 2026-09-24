/*
 * WCAG contrast and perceptual lightness, for the tests that hold the palettes to the
 * floor docs/design-audit.md sets: text reaches 4.5:1 against whatever it sits on, and
 * adjacent surfaces are judged on L* because contrast ratio is a TEXT measure — two
 * light surfaces sit near 1.1 on it however different they look.
 *
 * It lives in test/ rather than lib/ because nothing at runtime needs it; the palettes
 * ship as hex, already measured.
 */
const channel = (v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const parse = (hex) => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

/** Relative luminance, 0 (black) to 1 (white). */
function luminance (hex) {
  const [r, g, b] = parse(hex).map(channel)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The WCAG ratio between two colours, 1 (identical) to 21 (black on white). */
function ratio (a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Perceptual lightness, 0 to 100. A step of 3 between surfaces is visible. */
function lightness (hex) {
  const y = luminance(hex)
  return y <= 0.008856 ? y * 903.3 : 116 * y ** (1 / 3) - 16
}

module.exports = { luminance, ratio, lightness }
