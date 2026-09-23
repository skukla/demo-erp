# The ERP screen's design system — audit and recommendation

**2026-09-23.** Written because the screen does not read as one designed thing, and the
reason is structural rather than a matter of taste.

## What is actually there

Measured, not estimated — the numbers come from the stylesheet, the components, and the
rendered page.

| | Count | Should be |
|---|---|---|
| Colour literals in `theme.css` | **29 distinct** | ~10 named roles |
| Spectrum dimension tokens in components (`size-200`…) | **17 distinct**, 68 uses | one space scale |
| `UNSAFE_style` escapes in components | **17** | 0 |
| Border radii declared | **5** (0, 5, 6, 7, 8px) | 2 |
| Type styles rendered on the Products page | 7 | 6–7 is fine |
| Text colours rendered on one page | **8** | 4 |
| Surfaces rendered on one page | **7** | 4 |

Two of those rendered text colours — `#222222` and `#464646` — and one surface,
`#fdfdfd`, are **not in our palette at all**. Nobody chose them. They are Spectrum's
defaults showing through wherever the theme did not happen to override something.

## Why it does not feel cohesive

**There are four styling systems running at once, and they share no vocabulary.**

1. **Spectrum's own component styles** — the defaults, which apply everywhere we have not
   intervened.
2. **Spectrum's dimension tokens in JSX** — `marginTop='size-200'`, 17 different ones,
   chosen per call site.
3. **`theme.css`** — our overrides, 29 colour literals deep, each added in response to
   something looking wrong.
4. **`UNSAFE_style` escapes** — 17 of them, several setting font sizes (12, 13, 15px) the
   theme has never heard of.

Each was locally reasonable. Together they mean a change in one place does not propagate:
`--erp-rule` and `--spectrum-global-color-gray-300` both mean "a quiet line", hold
different values, and are used in different files. That is the whole complaint. A system
is not a list of good decisions; it is one vocabulary that every decision is expressed in.

**The theme only fixes what somebody noticed.** It is a patch list, in the order the
patches were requested — button radius, then accent, then the rail, then the head band.
Anything nobody has looked at yet is still raw Spectrum. That is why each round of fixes
reveals another inconsistency: the surface area of "not yet noticed" is the whole app.

## Recommendation

### 1. One token layer, and map Spectrum onto it

Spectrum publishes about 1,750 CSS custom properties, and it reads them for everything it
draws. Rather than overriding components one at a time, **redefine the small set of
Spectrum alias variables at the Provider root** — its grey ramp, its accent, its radii,
its type sizes. Then a Spectrum component we have never touched still comes out in our
system, and the leaks above stop by construction rather than by inspection.

Our own CSS then uses the same tokens. One vocabulary, two consumers.

### 2. The tokens

**Surfaces — four, in depth order.** Rail, canvas, card, raised. Today there are seven,
three of them accidental.

**Ink — four.** Primary, secondary, faint, accent. Today eight.

**Line — one.** Already done, and it worked; it is the model for the rest.

**Space — one scale, six steps** (4, 8, 12, 16, 24, 32). Today: 17 Spectrum tokens plus
raw pixels. Every margin in a component should name a step, and `size-*` should disappear
from JSX.

**Radius — two.** Control (6px) and surface (8px). Today five.

**Type — six roles, not sizes**: page title, section title, body, label, micro-label,
numeric. Each fixes size, weight, spacing and case together, so "the header for the grid"
is one decision in one place rather than four properties at each call site.

### 3. Component patterns, written down

The three that carry the whole screen, each defined once:

- **Page** — title, actions right, canvas, cards below.
- **Card** — surface, padding, and how a table sits inside one.
- **Grid** — head band, row, hover, the key column, numeric alignment, status badge.

### 4. Delete the escapes

All 17 `UNSAFE_style` uses become tokens or component classes. They are where the system
leaks today, and they are the reason the product detail page looks like a different
application from the order document.

## What this costs

The token layer and the Spectrum mapping are the bulk of it — most of a day. The
component sweep (space scale, escapes) is mechanical and can follow screen by screen
without a freeze.

## What needs deciding first

1. **How far to take the Spectrum remapping.** Mapping its grey ramp and accent is safe
   and high-value. Mapping its type scale changes every component's metrics and needs a
   look at each screen afterwards.
2. **Density.** Rows are 52px today, which is comfortable and not what an ERP looks like.
   SAP and Business Central both run denser. Denser reads as more professional and fits
   more on a screen; it also makes the screen busier.
3. **Whether the accent stays blue.** It is a demo tool that sits beside Adobe Commerce.
   Blue is safe; a distinct accent would make it feel like its own product.


---

# What was built, and how it is checked

**2026-09-23, the same day.** All three decisions were taken: the full remap including the
type scale, 44px rows everywhere, and a deep teal accent.

## The three files

| File | Holds |
|---|---|
| `screen/src/design/tokens.css` | The system. Every colour, space, radius, density and type role, named once. |
| `screen/src/design/spectrum-bridge.css` | Spectrum's own variables, pointed at those tokens. |
| `screen/src/design/app.css` | Our components — shell, rail, page, card, grid, status, forms — built only from tokens. |

`theme.css`, the 29-colour patch list, is gone.

## The measurement that says it worked

Sweep every page for a colour that is **not in the palette**, ignoring anything a person
cannot see:

| | Before | After |
|---|---|---|
| Colours on screen that nobody chose | 3 named, more unmeasured | **0 across all seven pages** |
| Row heights | 44 and 52, unintentionally | 44 everywhere |
| Declared radii | 5 | 3, each named |

The sweep carries a positive control — a planted magenta — so a clean result means the
check ran, not that it could not fail.

## What the sweep found that reading could not

Five leaks were invisible in the stylesheet and only showed up on screen:

1. **`--spectrum-alias-label-text-color`** — a field label sets its own colour, so the
   grey ramp never reached it.
2. **The column-resize indicator** — Spectrum's blue, 0×0 until someone drags a column
   header, at which point it would have appeared exactly once.
3. **Switch tracks, placeholders and icons** — each keeps its own alias rather than
   deriving from the ramp.
4. **Button labels** — `--spectrum-button-text-color` is declared on the button and
   differs per variant, so it cannot be set once at the root. The variant is not in the
   class list at all; it is `data-variant`.
5. **Specificity, three times.** Spectrum's rules are a class plus one or two attributes.
   A rule of ours that is correct, present in the stylesheet, and matches the element
   still loses — and the failure looks exactly like the rule being absent.

## The rule that keeps it

Nothing outside `tokens.css` writes a colour, a font size or a raw pixel value. If a
value is needed that the tokens do not have, **the missing thing is the token**.

The 17 `UNSAFE_style` escapes in the components are the remaining debt. They are where
the system can leak back in, and they are why the product detail page still reads
slightly apart from the rest.
