/*
 * One product's page: a header that keeps the name, SKU and stock status in view,
 * then Details, Pricing and Inventory as cards. Fields are edited in place; Save and
 * Cancel appear once something changed, and Save sends only what changed. The SKU is
 * the link to Commerce, so it is shown and locked.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  ActionButton, Button, ButtonGroup, Content, Flex, Grid, Heading, InlineAlert, Link, NumberField,
  Text, TextField, View, TableView, TableHeader, Column, TableBody, Row, Cell
} from '@adobe/react-spectrum'
import ChevronLeft from '@spectrum-icons/workflow/ChevronLeft'
import LockClosed from '@spectrum-icons/workflow/LockClosed'
import PageLoading from './PageLoading'
import StockStatus from './StockStatus'
import { MIN_COLUMN_WIDTH, useColumnWidths } from './columnWidths'

const MONEY = { style: 'currency', currency: 'USD' }

function Card ({ title, aside, children, gridColumn }) {
  return (
    <View gridColumn={gridColumn} backgroundColor='gray-50' borderRadius='medium' borderWidth='thin' borderColor='gray-200' padding='size-300'>
      <Flex justifyContent='space-between' alignItems='baseline' marginBottom='size-150'>
        <Heading level={3} margin={0}>{title}</Heading>
        {aside}
      </Flex>
      {children}
    </View>
  )
}

/** What changed between the saved product and the draft, as the API takes it. */
export function changesOf (saved, draft) {
  const patch = {}
  if (draft.name.trim() !== saved.name) patch.name = draft.name.trim()
  if (draft.listPrice !== saved.listPrice) patch.listPrice = draft.listPrice
  const warehouses = draft.warehouses
    .filter((w) => w.quantity !== saved.warehouses.find((s) => s.code === w.code).quantity)
    .map((w) => ({ code: w.code, quantity: w.quantity }))
  if (warehouses.length > 0) patch.warehouses = warehouses
  return patch
}

export default function ProductDetail ({ api, sku, onBack, onChanged, onNavigate }) {
  const widths = useColumnWidths('warehouses')
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  const [contractPrices, setContractPrices] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    api.product(sku).then((p) => { setSaved(p); setDraft(p) }).catch(setError)
    api.conditions()
      .then((data) => setContractPrices((data.items || []).filter((c) => c.kind === 'contractPrice' && c.sku === sku).length))
      .catch(() => setContractPrices(null))
  }, [api, sku])

  const patch = useMemo(() => (saved && draft ? changesOf(saved, draft) : {}), [saved, draft])
  const dirty = Object.keys(patch).length > 0
  const nameMissing = Boolean(draft && !draft.name.trim())
  const total = draft ? draft.warehouses.reduce((sum, w) => sum + w.quantity, 0) : 0

  function setQuantity (code, quantity) {
    setNotice(null)
    setDraft((d) => ({ ...d, warehouses: d.warehouses.map((w) => (w.code === code ? { ...w, quantity } : w)) }))
  }

  async function save () {
    setSaving(true)
    try {
      const next = await api.patchProduct(sku, patch)
      setSaved(next)
      setDraft(next)
      setError(null)
      setNotice('Saved. The change is on its way to Commerce.')
      onChanged()
    } catch (e) {
      setError(e)
    }
    setSaving(false)
  }

  return (
    <>
      <ActionButton isQuiet onPress={onBack} marginBottom='size-150'>
        <ChevronLeft />
        <Text>Products</Text>
      </ActionButton>

      {error && (
        <InlineAlert variant='negative' marginBottom='size-200'>
          <Heading>That did not work</Heading>
          <Content>{error.message}</Content>
        </InlineAlert>
      )}

      {!draft && !error && <PageLoading label='Loading product' />}

      {draft && (
        <>
          <Flex justifyContent='space-between' alignItems='start' wrap gap='size-200' marginBottom='size-300'>
            <View>
              <Heading level={1} marginY={0}>{saved.name}</Heading>
              <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-700)' }}>
                SKU {saved.sku}{saved.updatedAt ? ` · Updated ${new Date(saved.updatedAt).toLocaleString()}` : ''}
              </Text>
            </View>
            <StockStatus quantity={saved.stock} />
          </Flex>

          <Grid columns={['1fr', '1fr']} gap='size-300' UNSAFE_style={{ maxWidth: 960 }}>
            <Card title='Details'>
              <Flex direction='column' gap='size-150'>
                <TextField
                  label='Name'
                  value={draft.name}
                  onChange={(name) => { setNotice(null); setDraft({ ...draft, name }) }}
                  validationState={nameMissing ? 'invalid' : undefined}
                  errorMessage='A product needs a name.'
                  width='100%'
                />
                <View>
                  <Text UNSAFE_style={{ fontSize: 12, color: 'var(--spectrum-global-color-gray-700)' }}>SKU</Text>
                  <Flex alignItems='center' gap='size-100' marginTop='size-50'>
                    <LockClosed size='S' aria-label='Locked' />
                    <Text UNSAFE_style={{ fontSize: 15, fontWeight: 600 }}>{saved.sku}</Text>
                  </Flex>
                  <Text UNSAFE_style={{ fontSize: 12, color: 'var(--spectrum-global-color-gray-700)' }}>
                    The SKU links this product to Commerce. Change it there, then sync.
                  </Text>
                </View>
              </Flex>
            </Card>

            <Card
              title='Pricing'
              aside={onNavigate && contractPrices !== null && (
                // One string child: Spectrum's Link wraps a plain string and otherwise
                // demands exactly one element, so "text + arrow" as two children crashes.
                <Link isQuiet onPress={() => onNavigate('pricing')}>
                  {`${contractPrices === 1 ? '1 contract price' : `${contractPrices} contract prices`} →`}
                </Link>
              )}
            >
              <NumberField
                label='List price'
                value={draft.listPrice}
                minValue={0}
                step={0.01}
                formatOptions={MONEY}
                onChange={(listPrice) => { setNotice(null); setDraft({ ...draft, listPrice: Number.isFinite(listPrice) ? listPrice : 0 }) }}
                width='100%'
              />
            </Card>

            <Card title='Inventory' gridColumn='1 / span 2' aside={<Text>Total {total}</Text>}>
              {draft.warehouses.length === 0
                ? <Text>Commerce reports no stock for this product in any warehouse.</Text>
                : (
                  <TableView onResizeEnd={widths.onResizeEnd} aria-label='Stock by warehouse' density='spacious' selectionMode='none'>
                    <TableHeader>
                      <Column key='name' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('name')}>Warehouse</Column>
                      <Column key='code' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('code', 180)}>Code</Column>
                      <Column key='quantity' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('quantity', 180)}>Quantity</Column>
                      <Column key='status' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('status', 160)}>Status</Column>
                    </TableHeader>
                    <TableBody items={draft.warehouses.map((w) => ({ ...w, key: w.code }))}>
                      {(w) => (
                        <Row key={w.code}>
                          <Cell>{w.name}</Cell>
                          <Cell>{w.code}</Cell>
                          <Cell>
                            <NumberField
                              aria-label={`Quantity in ${w.name}`}
                              value={w.quantity}
                              minValue={0}
                              step={1}
                              isQuiet
                              onChange={(q) => setQuantity(w.code, Number.isFinite(q) ? Math.round(q) : 0)}
                              width='size-1600'
                            />
                          </Cell>
                          <Cell><StockStatus quantity={w.quantity} /></Cell>
                        </Row>
                      )}
                    </TableBody>
                  </TableView>
                  )}
            </Card>
          </Grid>

          <Flex justifyContent='end' alignItems='center' gap='size-200' marginTop='size-300' UNSAFE_style={{ maxWidth: 960 }}>
            {notice && <Text>{notice}</Text>}
            {dirty && (
              <ButtonGroup>
                <Button variant='secondary' onPress={() => setDraft(saved)} isDisabled={saving}>Cancel</Button>
                <Button variant='accent' onPress={save} isPending={saving} isDisabled={nameMissing}>Save</Button>
              </ButtonGroup>
            )}
          </Flex>
        </>
      )}
    </>
  )
}
