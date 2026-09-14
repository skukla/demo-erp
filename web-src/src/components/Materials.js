import React, { useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@adobe/react-spectrum'
import Frame from './Frame'
import EditableNumber from './EditableNumber'
import { useLoad } from './useLoad'

const money = { style: 'currency', currency: 'USD' }

export default function Materials ({ api, onChanged }) {
  const { rows, error, reload } = useLoad(() => api.materials(), [api])
  const [saveError, setSaveError] = useState(null)
  async function save (sku, patch) {
    try { await api.patchMaterial(sku, patch); setSaveError(null); await reload(); onChanged() } catch (e) { setSaveError(e) }
  }
  return (
    <Frame title='Materials' error={saveError || error} loading={!rows}>
      <TableView aria-label='Materials' density='compact' overflowMode='wrap'>
        <TableHeader>
          <Column key='sku' width={180}>Material</Column>
          <Column key='name'>Description</Column>
          <Column key='plant' width={80}>Plant</Column>
          <Column key='listPrice' width={160} align='end'>List price</Column>
          <Column key='stock' width={140} align='end'>Stock</Column>
        </TableHeader>
        <TableBody items={rows || []}>
          {(m) => (
            <Row key={m.sku}>
              <Cell>{m.sku}</Cell>
              <Cell>{m.name}</Cell>
              <Cell>{m.plant}</Cell>
              <Cell><EditableNumber value={m.listPrice} step={0.01} formatOptions={money} onSave={(v) => save(m.sku, { listPrice: v })} /></Cell>
              <Cell><EditableNumber value={m.stock} onSave={(v) => save(m.sku, { stock: v })} /></Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
