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
import { MIN_COLUMN_WIDTH, useColumnWidths } from './columnWidths'
import EditToggle from './EditToggle'
import { NameCell, PriceCell, StockCell } from './ProductCells'
import { kindText } from './productFormat'

// Room for a product name to read whole, even as an edit button.
const NAME_MIN_WIDTH = 220

export default function Products ({ api, onChanged, onNavigate }) {
  const widths = useColumnWidths('products')
  const { rows, error, reload } = useLoad(() => api.products(), [api])
  // The pages opened from here, newest last: Back returns to the one before.
  const [trail, setTrail] = useState([])
  const [saveError, setSaveError] = useState(null)
  const [editing, setEditing] = useState(false)
  // Variants are reached from their parent, as in SAP's generic articles. Each row
  // carries the mode: the table redraws a row only when its item changes.
  const listed = useMemo(
    () => (rows || []).filter((p) => !p.parentSku).map((p) => ({ ...p, editing })),
    [rows, editing]
  )

  async function save (sku, patch) {
    try {
      await api.patchProduct(sku, patch)
      setSaveError(null)
      await reload()
      onChanged()
    } catch (e) {
      setSaveError(e)
    }
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
    <Frame title='Products' error={saveError || error} loading={!rows} actions={<EditToggle editing={editing} onChange={setEditing} />}>
      <Text>
        {editing
          ? 'Click a name, price or stock figure to change it. Stock held in several warehouses, and a configurable product\'s price and stock, are changed on the product\'s page.'
          : 'Choose a product to open it, or Edit to change names, prices and stock here. A configurable product lists its variants, which hold the price and stock.'}
      </Text>
      <TableView onResizeEnd={widths.onResizeEnd}
        aria-label='Products'
        density='spacious'
        overflowMode='wrap'
        marginTop='size-200'
        selectionMode='none'
        onAction={(key) => setTrail([String(key)])}
      >
        <TableHeader>
          <Column key='sku' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('sku', 170)}>SKU</Column>
          <Column key='name' allowsResizing minWidth={NAME_MIN_WIDTH} defaultWidth={widths.widthOf('name', '1fr')}>Name</Column>
          <Column key='kind' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('kind', 190)}>Type</Column>
          <Column key='listPrice' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('listPrice', 170)} align='end'>List price</Column>
          <Column key='stock' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('stock', 90)} align='end'>Stock</Column>
          <Column key='status' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('status', 130)}>Status</Column>
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
