/*
 * The ERP's mark: four of them, and the SC picks one in Settings.
 *
 * All four are drawn in `currentColor` and nothing else, so each one takes the colour of
 * wherever it is placed — the shell bar in `--shell-ink`, a Settings card in the page's
 * own ink — and none of them can clash with a palette. None resembles a real product's
 * logo: this ERP stands in for whichever one the customer runs, so a mark that looked
 * like somebody's would be worse than no mark at all.
 *
 * `monogram` is the one that fits any name by construction: it draws the first letter of
 * whatever the ERP is called. The other three are geometric and say nothing.
 */
import React from 'react'

/* The letter is the ERP's initial, which is why this mark needs the name and the others
   do not. An empty name cannot reach here — the ERP always has one, defaulting to Acme
   ERP — but a single space would, so the letter falls back rather than drawing blank. */
function Monogram ({ name }) {
  const letter = (String(name || '').trim()[0] || 'E').toUpperCase()
  return (
    <>
      <rect x='2.5' y='2.5' width='19' height='19' rx='5' />
      <text
        x='12'
        y='12'
        fill='currentColor'
        stroke='none'
        fontSize='11.5'
        fontWeight='600'
        textAnchor='middle'
        dominantBaseline='central'
      >
        {letter}
      </text>
    </>
  )
}

/* An isometric box: the outline, and the three edges meeting at the near corner. */
const Cube = () => (
  <>
    <path d='M12 2 L22 7 L22 17 L12 22 L2 17 L2 7 Z' />
    <path d='M12 12 L2 7 M12 12 L22 7 M12 12 L12 22' />
  </>
)

/* A ring with one point on it. */
const Orbit = () => (
  <>
    <circle cx='12' cy='12' r='9' />
    <circle cx='12' cy='3' r='2.4' fill='currentColor' />
  </>
)

/* Three plates stacked, each drawn flat-on as the cube's top face is. */
const Layers = () => (
  <>
    <path d='M12 2.5 L21 6 L12 9.5 L3 6 Z' />
    <path d='M12 8.5 L21 12 L12 15.5 L3 12 Z' />
    <path d='M12 14.5 L21 18 L12 21.5 L3 18 Z' />
  </>
)

const MARKS = { monogram: Monogram, cube: Cube, orbit: Orbit, layers: Layers }

/**
 * @param {object} props `logo` — one of lib/appearance.js's LOGOS; `name` — the ERP's
 *   name, which only the monogram uses; `size` in pixels, defaulting to the shell bar's.
 */
export default function Logo ({ logo, name, size = 26 }) {
  const Mark = MARKS[logo] || MARKS.cube
  return (
    <svg
      className='erp-logo'
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinejoin='round'
      strokeLinecap='round'
      aria-hidden='true'
      focusable='false'
    >
      <Mark name={name} />
    </svg>
  )
}

export { MARKS }
