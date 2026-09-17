/*
 * Products: the list, and a product's own page. Choosing a row opens it; the page
 * carries its own Back.
 */
import React, { useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, Text } from '@adobe/react-spectrum'
import Frame from './Frame'
import ProductDetail from './ProductDetail'
import StockStatus from './StockStatus'
import { useLoad } from './useLoad'
import { MIN_COLUMN_WIDTH, useColumnWidths } from './columnWidths'

export const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })

export default function Products ({ api, onChanged, onNavigate }) {
  const widths = useColumnWidths('products')
  const { rows, error, reload } = useLoad(() => api.products(), [api])
  const [openSku, setOpenSku] = useState(null)

  if (openSku) {
    return (
      <ProductDetail
        api={api}
        sku={openSku}
        onBack={() => { setOpenSku(null); reload() }}
        onChanged={onChanged}
        onNavigate={onNavigate}
      />
    )
  }

  return (
    <Frame title='Products' error={error} loading={!rows}>
      <Text>Choose a product to see and edit its details, price and stock by warehouse.</Text>
      <TableView onResizeEnd={widths.onResizeEnd}
        aria-label='Products'
        density='spacious'
        overflowMode='wrap'
        marginTop='size-200'
        selectionMode='none'
        onAction={(key) => setOpenSku(String(key))}
      >
        <TableHeader>
          <Column key='sku' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('sku', 200)}>SKU</Column>
          <Column key='name' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('name')}>Name</Column>
          <Column key='listPrice' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('listPrice', 140)} align='end'>List price</Column>
          <Column key='stock' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('stock', 120)} align='end'>Stock</Column>
          <Column key='status' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('status', 160)}>Status</Column>
        </TableHeader>
        <TableBody items={rows || []}>
          {(p) => (
            <Row key={p.sku}>
              <Cell>{p.sku}</Cell>
              <Cell>{p.name}</Cell>
              <Cell>{money.format(p.listPrice)}</Cell>
              <Cell>{p.stock}</Cell>
              <Cell><StockStatus quantity={p.stock} /></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
