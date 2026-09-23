/*
 * Products: the list, and a product's own page. The list reads as display; after
 * Edit, name, price and single-warehouse stock edit in place. Choosing anywhere
 * else on a row opens the page, which carries its own Back.
 */
import React, { useMemo, useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, Text } from '@adobe/react-spectrum'
import Frame from './Frame'
import ProductDetail from './ProductDetail'
import StockStatus from './StockStatus'
import { useLoad } from './useLoad'
import { useColumnWidths } from './columnWidths'
import { useGridView, GridSearch } from './GridView'
import EditToggle from './EditToggle'
import { saveInPlace, savingField } from './saveInPlace'
import { NameCell, PriceCell, StockCell } from './ProductCells'
import { kindText, withAnswer, withEdit } from './productFormat'

// Room for a product name to read whole, even as an edit button.
const NAME_MIN_WIDTH = 220

const PRODUCT_COLUMNS = [
  { key: 'sku', width: 170 },
  { key: 'name', width: '2fr', minWidth: NAME_MIN_WIDTH },
  // "Configurable · 16 variants" is the longest thing this column holds.
  { key: 'kind', width: '1fr', minWidth: 190 },
  { key: 'unit', width: 110 },
  { key: 'listPrice', width: 170 },
  { key: 'stock', width: 110 },
  { key: 'status', width: 140 }
]

/* A configurable parent has no price of its own, so it sorts by the bottom of its
   range — which is the figure its row shows first. */
const priceOf = (p) => (p.type === 'configurable' ? (p.priceRange ? p.priceRange.min : 0) : (p.listPrice || 0))

const PRODUCT_GRID = {
  fields: [(p) => p.sku, (p) => p.name],
  values: {
    sku: (p) => p.sku,
    name: (p) => p.name,
    kind: (p) => kindText(p),
    unit: (p) => p.unit || '',
    listPrice: priceOf,
    stock: (p) => p.stock || 0,
    status: (p) => p.stock || 0
  },
  sort: { column: 'sku', direction: 'ascending' }
}

export default function Products ({ api, onChanged, onNavigate }) {
  const widths = useColumnWidths('products', PRODUCT_COLUMNS)
  const { rows, error, reload, updateRow } = useLoad(() => api.products(), [api])
  // The pages opened from here, newest last: Back returns to the one before.
  const [trail, setTrail] = useState([])
  const [editing, setEditing] = useState(false)
  // Variants are reached from their parent, as in SAP's generic articles. Each row
  // carries the mode: the table redraws a row only when its item changes.
  const listed = useMemo(
    () => (rows || []).filter((p) => !p.parentSku).map((p) => ({ ...p, editing })),
    [rows, editing]
  )
  const view = useGridView(listed, PRODUCT_GRID)

  function save (sku, patch) {
    const isRow = (row) => row.sku === sku
    const before = rows.find(isRow)
    return saveInPlace({
      show: () => updateRow(isRow, (row) => ({ ...withEdit(row, patch), saving: savingField(patch) })),
      send: () => api.patchProduct(sku, patch),
      settle: (answer) => { updateRow(isRow, (row) => withAnswer(row, answer)); onChanged() },
      undo: () => updateRow(isRow, () => before),
      saved: 'Product saved'
    })
  }

  if (trail.length > 0) {
    const sku = trail[trail.length - 1]
    return (
      <ProductDetail
        key={sku}
        api={api}
        sku={sku}
        backLabel={trail.length > 1 ? 'Back' : 'Products'}
        onBack={() => {
          setTrail(trail.slice(0, -1))
          if (trail.length === 1) reload()
        }}
        onOpen={(next) => setTrail([...trail, next])}
        onChanged={onChanged}
        onNavigate={onNavigate}
      />
    )
  }

  return (
    <Frame title='Products' error={error} loading={!rows} actions={<EditToggle editing={editing} onChange={setEditing} />}>
      <Text>
        {editing
          ? 'Click a name, price or stock figure to change it. Stock held in several warehouses, and a configurable product\'s price and stock, are changed on the product\'s page.'
          : 'Choose a product to open it, or Edit to change names, prices and stock here. A configurable product lists its variants, which hold the price and stock.'}
      </Text>
      <GridSearch placeholder='Product or description' view={view} />
      <TableView {...widths.tableProps} {...view.tableProps}
        aria-label='Products'
        density='spacious'
        overflowMode='wrap'
        marginTop='size-200'
        selectionMode='none'
        onAction={(key) => setTrail([String(key)])}
      >
        <TableHeader>
          <Column key='sku' {...widths.columnProps('sku')} allowsSorting>Product</Column>
          {/* One text, headed as SAP and Business Central head theirs. The ERP's
              record calls it `name`; marketing copy belongs to Commerce and is not
              mirrored here (lib/products.js). */}
          <Column key='name' {...widths.columnProps('name')} allowsSorting>Description</Column>
          <Column key='kind' {...widths.columnProps('kind')} allowsSorting>Type</Column>
          <Column key='unit' {...widths.columnProps('unit')} allowsSorting>Base unit</Column>
          <Column key='listPrice' {...widths.columnProps('listPrice')} align='end' allowsSorting>List price</Column>
          <Column key='stock' {...widths.columnProps('stock')} align='end' allowsSorting>On hand</Column>
          <Column key='status' {...widths.columnProps('status')} allowsSorting>Status</Column>
        </TableHeader>
        <TableBody items={view.items}>
          {(p) => (
            <Row key={p.sku}>
              <Cell>{p.sku}</Cell>
              <Cell><NameCell product={p} editing={p.editing} onSave={(patch) => save(p.sku, patch)} /></Cell>
              <Cell>{kindText(p)}</Cell>
              <Cell>{p.unit || 'EA'}</Cell>
              <Cell><PriceCell product={p} editing={p.editing} onSave={(patch) => save(p.sku, patch)} /></Cell>
              <Cell><StockCell product={p} editing={p.editing} onSave={(patch) => save(p.sku, patch)} /></Cell>
              <Cell><StockStatus quantity={p.stock} /></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
