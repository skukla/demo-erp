/*
 * Products: the list, and a product's own page. Name, price and single-warehouse
 * stock edit in place; choosing anywhere else on a row opens the page, which
 * carries its own Back.
 */
import React, { useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, Text } from '@adobe/react-spectrum'
import Frame from './Frame'
import ProductDetail from './ProductDetail'
import StockStatus from './StockStatus'
import { useLoad } from './useLoad'
import { MIN_COLUMN_WIDTH, useColumnWidths } from './columnWidths'
import EditableText from './EditableText'
import { PriceCell, StockCell } from './ProductCells'
import { kindText } from './productFormat'

export default function Products ({ api, onChanged, onNavigate }) {
  const widths = useColumnWidths('products')
  const { rows, error, reload } = useLoad(() => api.products(), [api])
  // The pages opened from here, newest last: Back returns to the one before.
  const [trail, setTrail] = useState([])
  const [saveError, setSaveError] = useState(null)

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

  // Variants are reached from their parent, as in SAP's generic articles.
  const listed = (rows || []).filter((p) => !p.parentSku)
  return (
    <Frame title='Products' error={saveError || error} loading={!rows}>
      <Text>Click a name, price or stock figure to change it here, or anywhere else on a row to open the product. A configurable product's price and stock belong to its variants.</Text>
      <TableView onResizeEnd={widths.onResizeEnd}
        aria-label='Products'
        density='spacious'
        overflowMode='wrap'
        marginTop='size-200'
        selectionMode='none'
        onAction={(key) => setTrail([String(key)])}
      >
        <TableHeader>
          <Column key='sku' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('sku', 200)}>SKU</Column>
          <Column key='name' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('name')}>Name</Column>
          <Column key='kind' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('kind', 200)}>Type</Column>
          <Column key='listPrice' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('listPrice', 200)} align='end'>List price</Column>
          <Column key='stock' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('stock', 110)} align='end'>Stock</Column>
          <Column key='status' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('status', 150)}>Status</Column>
        </TableHeader>
        <TableBody items={listed}>
          {(p) => (
            <Row key={p.sku}>
              <Cell>{p.sku}</Cell>
              <Cell><EditableText label='Name' value={p.name} onSave={(name) => save(p.sku, { name })} /></Cell>
              <Cell>{kindText(p)}</Cell>
              <Cell><PriceCell product={p} onSave={(patch) => save(p.sku, patch)} /></Cell>
              <Cell><StockCell product={p} onSave={(patch) => save(p.sku, patch)} /></Cell>
              <Cell><StockStatus quantity={p.stock} /></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
