/*
 * Warehouses: the plants stock lives in, one per Commerce inventory source (SAP's plant /
 * storage location; Business Central's location). The ERP masters the stock in each, so it
 * shows them as their own master data rather than only inside a product. The SC gives each
 * its own name here — the Commerce source code and the stock are the ERP's to read, the name
 * is the ERP's to set. Derived on read from the products and the ERP's saved warehouse names
 * (lib/structure describeStructure), so a wipe and a refill rebuild the list identically.
 */
import React, { useState } from 'react'
import { TableView, TableHeader, Column, TableBody, Row, Cell, Text } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'
import EditableText from './EditableText'
import { toastSaved, toastFailed } from './toast'

export default function Warehouses ({ api, onChanged }) {
  const { rows, error, reload } = useLoad(async () => {
    const health = await api.health()
    return (health.structure && health.structure.warehouses) || []
  }, [api])
  const [renaming, setRenaming] = useState(null)
  const [actionError, setActionError] = useState(null)

  async function rename (code, name) {
    setRenaming(code)
    try {
      await api.renameWarehouse(code, name)
      setActionError(null)
      toastSaved('Warehouse renamed')
      await reload()
      onChanged()
    } catch (e) {
      setActionError(e)
      toastFailed(`Not saved: ${e.message}`)
    }
    setRenaming(null)
  }

  return (
    <Frame title='Warehouses' error={actionError || error} loading={!rows}>
      {rows && rows.length === 0
        ? <Text>None yet — loading demo data brings the Commerce inventory sources in as warehouses.</Text>
        : (
          <TableView aria-label='Warehouses' density='compact' overflowMode='wrap'>
            <TableHeader>
              <Column key='code' width={220}>Commerce source</Column>
              <Column key='name' width='1fr' minWidth={220}>Name</Column>
              <Column key='products' width={130} align='end'>Products</Column>
              <Column key='stock' width={130} align='end'>In stock</Column>
            </TableHeader>
            <TableBody items={(rows || []).map((w) => ({ ...w, id: w.code }))}>
              {(w) => (
                <Row key={w.code}>
                  <Cell><span className='erp-key'>{w.code}</span></Cell>
                  <Cell><EditableText label={`Name of ${w.code}`} value={w.name} isSaving={renaming === w.code} onSave={(name) => rename(w.code, name)} /></Cell>
                  <Cell>{w.products}</Cell>
                  <Cell>{w.stock ?? 0}</Cell>
                </Row>
              )}
            </TableBody>
          </TableView>
          )}
    </Frame>
  )
}
