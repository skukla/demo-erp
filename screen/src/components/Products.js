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
import EditToggle from './EditToggle'
import { saveInPlace, savingField } from './saveInPlace'
import { NameCell, PriceCell, StockCell } from './ProductCells'
import { kindText, withAnswer, withEdit } from './productFormat'

// Room for a product name to read whole, even as an edit button.
const NAME_MIN_WIDTH = 220

const PRODUCT_COLUMNS = [
  { key: 'sku', width: 170 },
  { key: 'name', width: '1fr', minWidth: NAME_MIN_WIDTH },
  { key: 'kind', width: 190 },
  { key: 'listPrice', width: 170 },
  { key: 'stock', width: 90 },
  { key: 'status', width: 130 }
]

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
      <TableView {...widths.tableProps}
        aria-label='Products'
        density='spacious'
        overflowMode='wrap'
        marginTop='size-200'
        selectionMode='none'
        onAction={(key) => setTrail([String(key)])}
      >
        <TableHeader>
          <Column key='sku' {...widths.columnProps('sku')}>SKU</Column>
          <Column key='name' {...widths.columnProps('name')}>Name</Column>
          <Column key='kind' {...widths.columnProps('kind')}>Type</Column>
          <Column key='listPrice' {...widths.columnProps('listPrice')} align='end'>List price</Column>
          <Column key='stock' {...widths.columnProps('stock')} align='end'>Stock</Column>
          <Column key='status' {...widths.columnProps('status')}>Status</Column>
        </TableHeader>
        <TableBody items={listed}>
          {(p) => (
            <Row key={p.sku}>
              <Cell>{p.sku}</Cell>
              <Cell><NameCell product={p} editing={p.editing} onSave={(patch) => save(p.sku, patch)} /></Cell>
              <Cell>{kindText(p)}</Cell>
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
