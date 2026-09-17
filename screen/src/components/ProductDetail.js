/*
 * One product's page: a header that keeps the name, SKU and stock status in view,
 * then cards. Fields are edited in place; Save and Cancel appear once something
 * changed, and Save sends only what changed. The SKU is the link to Commerce, so it
 * is shown and locked.
 *
 * A configurable product (SAP's generic article) shows its variants instead of
 * price and stock, which belong to them; only its name is edited here. A variant
 * shows the values it varies on and links back to its parent.
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
import EditToggle from './EditToggle'
import { PriceCell, StockCell } from './ProductCells'
import { kindText, priceText, variantText } from './productFormat'

const MONEY = { style: 'currency', currency: 'USD' }
const SUBTLE = { color: 'var(--spectrum-global-color-gray-700)' }

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

/** A label over a value that cannot be edited here. */
function Fixed ({ label, children, note }) {
  return (
    <View>
      <Text UNSAFE_style={{ fontSize: 12, ...SUBTLE }}>{label}</Text>
      <Flex alignItems='center' gap='size-100' marginTop='size-50'>{children}</Flex>
      {note && <Text UNSAFE_style={{ fontSize: 12, ...SUBTLE }}>{note}</Text>}
    </View>
  )
}

/** What changed between the saved product and the draft, as the API takes it. */
export function changesOf (saved, draft) {
  const patch = {}
  if (draft.name.trim() !== saved.name) patch.name = draft.name.trim()
  if (saved.type === 'configurable') return patch
  if (draft.listPrice !== saved.listPrice) patch.listPrice = draft.listPrice
  const warehouses = draft.warehouses
    .filter((w) => w.quantity !== saved.warehouses.find((s) => s.code === w.code).quantity)
    .map((w) => ({ code: w.code, quantity: w.quantity }))
  if (warehouses.length > 0) patch.warehouses = warehouses
  return patch
}

function VariantsCard ({ product, onOpen, onSaveVariant }) {
  const widths = useColumnWidths('variants')
  const [editing, setEditing] = useState(false)
  // The table redraws a row only when its item changes, so each row carries the mode.
  const rows = useMemo(() => product.variants.map((v) => ({ ...v, editing })), [product.variants, editing])
  const labels = (product.variants[0] && product.variants[0].variantAttributes || []).map((a) => a.label).filter(Boolean)
  return (
    <Card
      title='Variants'
      gridColumn='1 / span 2'
      aside={(
        <Flex alignItems='center' gap='size-200'>
          <Text>Total stock {product.stock}</Text>
          {product.variants.length > 0 && <EditToggle editing={editing} onChange={setEditing} />}
        </Flex>
      )}
    >
      {product.variants.length === 0
        ? <Text>Commerce lists no variants for this product.</Text>
        : (
          <TableView
            aria-label='Variants'
            density='spacious'
            selectionMode='none'
            onAction={(key) => onOpen(String(key))}
            onResizeEnd={widths.onResizeEnd}
          >
            <TableHeader>
              <Column key='values' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('values')}>{labels.join(' · ') || 'Variant'}</Column>
              <Column key='sku' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('sku', 220)}>SKU</Column>
              <Column key='price' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('price', 130)} align='end'>Price</Column>
              <Column key='stock' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('stock', 100)} align='end'>Stock</Column>
              <Column key='status' allowsResizing minWidth={MIN_COLUMN_WIDTH} defaultWidth={widths.widthOf('status', 150)}>Status</Column>
            </TableHeader>
            <TableBody items={rows}>
              {(v) => (
                <Row key={v.sku}>
                  <Cell>{variantText(v.variantAttributes) || v.name}</Cell>
                  <Cell>{v.sku}</Cell>
                  <Cell><PriceCell product={v} editing={v.editing} onSave={(patch) => onSaveVariant(v.sku, patch)} /></Cell>
                  <Cell><StockCell product={v} editing={v.editing} onSave={(patch) => onSaveVariant(v.sku, patch)} /></Cell>
                  <Cell><StockStatus quantity={v.stock} /></Cell>
                </Row>
              )}
            </TableBody>
          </TableView>
          )}
    </Card>
  )
}

function InventoryCard ({ draft, total, onQuantity }) {
  const widths = useColumnWidths('warehouses')
  return (
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
                      onChange={(q) => onQuantity(w.code, Number.isFinite(q) ? Math.round(q) : 0)}
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
  )
}

export default function ProductDetail ({ api, sku, backLabel = 'Products', onBack, onOpen, onChanged, onNavigate }) {
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
  const isParent = saved && saved.type === 'configurable'
  const total = draft ? (isParent ? saved.stock : draft.warehouses.reduce((sum, w) => sum + w.quantity, 0)) : 0

  function edit (changes) {
    setNotice(null)
    setDraft((d) => ({ ...d, ...changes }))
  }

  function setQuantity (code, quantity) {
    setNotice(null)
    setDraft((d) => ({ ...d, warehouses: d.warehouses.map((w) => (w.code === code ? { ...w, quantity } : w)) }))
  }

  // A variant changed from the parent's table: the page re-reads, because the
  // parent's total stock and price range move with it.
  async function saveVariant (variantSku, variantPatch) {
    try {
      await api.patchProduct(variantSku, variantPatch)
      const fresh = await api.product(sku)
      setSaved(fresh)
      setDraft((d) => ({ ...fresh, name: d.name }))
      setError(null)
      setNotice('Saved. The change is on its way to Commerce.')
      onChanged()
    } catch (e) {
      setError(e)
    }
  }

  async function save () {
    setSaving(true)
    try {
      const next = await api.patchProduct(sku, patch)
      // The update answers the product alone; keep what the page read with it.
      const merged = { ...saved, ...next, variants: saved.variants, parent: saved.parent, variantCount: saved.variantCount, priceRange: saved.priceRange, stock: isParent ? saved.stock : next.stock }
      setSaved(merged)
      setDraft(merged)
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
        <Text>{backLabel}</Text>
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
              <Text UNSAFE_style={SUBTLE}>
                SKU {saved.sku} · {kindText(saved)}{saved.updatedAt ? ` · Updated ${new Date(saved.updatedAt).toLocaleString()}` : ''}
              </Text>
              {saved.parent && (
                <View marginTop='size-75'>
                  <Link isQuiet onPress={() => onOpen(saved.parent.sku)}>{`Variant of ${saved.parent.name}`}</Link>
                </View>
              )}
            </View>
            <StockStatus quantity={total} />
          </Flex>

          <Grid columns={['1fr', '1fr']} gap='size-300' UNSAFE_style={{ maxWidth: 960 }}>
            <Card title='Details'>
              <Flex direction='column' gap='size-200'>
                <TextField
                  label='Name'
                  value={draft.name}
                  onChange={(name) => edit({ name })}
                  validationState={nameMissing ? 'invalid' : undefined}
                  errorMessage='A product needs a name.'
                  width='100%'
                />
                <Fixed label='SKU' note='The SKU links this product to Commerce. Change it there, then sync.'>
                  <LockClosed size='S' aria-label='Locked' />
                  <Text UNSAFE_style={{ fontSize: 15, fontWeight: 600 }}>{saved.sku}</Text>
                </Fixed>
                {saved.variantAttributes && saved.variantAttributes.length > 0 && (
                  <Fixed label='Varies on'>
                    <Flex gap='size-100' wrap>
                      {saved.variantAttributes.map((a) => (
                        <View key={a.label} backgroundColor='gray-200' borderRadius='regular' paddingX='size-100' paddingY='size-50'>
                          <Text UNSAFE_style={{ fontSize: 13 }}>{`${a.label}: ${a.value || '—'}`}</Text>
                        </View>
                      ))}
                    </Flex>
                  </Fixed>
                )}
              </Flex>
            </Card>

            <Card
              title='Pricing'
              aside={!isParent && onNavigate && contractPrices !== null && (
                // One string child: Spectrum's Link wraps a plain string and otherwise
                // demands exactly one element, so "text + arrow" as two children crashes.
                <Link isQuiet onPress={() => onNavigate('pricing')}>
                  {`${contractPrices === 1 ? '1 contract price' : `${contractPrices} contract prices`} →`}
                </Link>
              )}
            >
              {isParent
                ? (
                  <Fixed label='Price range' note='Each variant has its own price. Open a variant to change it.'>
                    <Text UNSAFE_style={{ fontSize: 15, fontWeight: 600 }}>{priceText(saved)}</Text>
                  </Fixed>
                  )
                : (
                  <NumberField
                    label='List price'
                    value={draft.listPrice}
                    minValue={0}
                    step={0.01}
                    formatOptions={MONEY}
                    onChange={(listPrice) => edit({ listPrice: Number.isFinite(listPrice) ? listPrice : 0 })}
                    width='100%'
                  />
                  )}
            </Card>

            {isParent
              ? <VariantsCard product={saved} onOpen={onOpen} onSaveVariant={saveVariant} />
              : <InventoryCard draft={draft} total={total} onQuantity={setQuantity} />}
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
