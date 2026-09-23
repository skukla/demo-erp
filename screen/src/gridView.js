/*
 * Finding a record in a grid: the search and the sort, without React.
 *
 * Every grid on this screen had neither. A 182-product catalogue meant scrolling on
 * stage to reach a SKU, and no column could be ordered — which is the first thing
 * anyone who has used SAP or Business Central reaches for. The rules are the same on
 * every grid, so they live here once and are tested here once.
 *
 * A grid describes itself with two maps:
 * - `fields`: the accessors whose text the search box looks through;
 * - `values`: the accessor per sortable column key, returning a string or a number.
 */

/** Numbers sort as numbers; everything else by the viewer's own collation, 2 before 10. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compare (a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a ?? ''), String(b ?? ''))
}

/** Everything a row can be found by, as one lowercase string. */
function haystack (row, fields) {
  return fields
    .map((read) => read(row))
    .filter((value) => value !== null && value !== undefined && value !== '')
    .join(' ')
    .toLowerCase()
}

/**
 * The rows a grid shows: those matching the search term, in the chosen order.
 *
 * A term matches when every whitespace-separated word of it appears somewhere in the
 * row — so "acme trouser" finds the row whichever order the two were typed in.
 *
 * @param {object[]|null} rows every record the grid holds
 * @param {object} view `{ fields, values, text, sort: { column, direction } }`
 * @returns {object[]} the rows to render, never null
 */
export function applyView (rows, view = {}) {
  const { fields = [], values = {}, text = '', sort = {} } = view
  const all = rows || []
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const found = words.length === 0
    ? all
    : all.filter((row) => {
      const searchable = haystack(row, fields)
      return words.every((word) => searchable.includes(word))
    })
  const read = sort.column && values[sort.column]
  if (!read) return found
  const sorted = [...found].sort((a, b) => compare(read(a), read(b)))
  return sort.direction === 'descending' ? sorted.reverse() : sorted
}
