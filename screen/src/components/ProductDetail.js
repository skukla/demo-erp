/*
 * One product's page: a header that keeps the name, SKU and status in view, then cards
 * on the shared Card. Fields are edited in place; Save and Cancel appear once something
 * changed, and Save sends only what changed. The SKU is the link to Commerce, so it is
 * shown and locked.
 *
 * The master-record cards (screen-realism plan §3.7): Basic data carries the base unit,
 * the product type and the sales status, whose "Blocked for sales" switch stops every
 * shipment of the product (lib/fulfilment). Inventory prints on hand, committed (open
 * on orders that still stand) and available, and Open orders lists the orders holding
 * the stock — all read from the order lines, never stored (lib/availability).
 *
 * A configurable product (SAP's generic article) shows its variants instead of price,
 * stock and sales status, which belong to them; only its name is edited here. A variant
 * shows the values it varies on and links back to its parent.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  ActionButton, Button, ButtonGroup, Content, Flex, Grid, Heading, InlineAlert, Link, NumberField,
  Switch, Text, TextField, View, TableView, TableHeader, Column, TableBody, Row, Cell
} from '@adobe/react-spectrum'
import ChevronLeft from '@spectrum-icons/workflow/ChevronLeft'
import LockClosed from '@spectrum-icons/workflow/LockClosed'
import Card from './Card'
import Field from './Field'
import PageLoading from './PageLoading'
import { toastSaved } from './toast'
import { saveInPlace, savingField } from './saveInPlace'
import StockStatus from './StockStatus'
import { useColumnWidths } from './columnWidths'
import EditToggle from './EditToggle'
import { PriceCell, StockCell } from './ProductCells'
import { kindText, priceText, variantText, withEdit, withVariantTotals } from './productFormat'
import { moneyOptions } from '../money'

const MONEY = moneyOptions()

const VARIANT_COLUMNS = [
  { key: 'values' },
  { key: 'sku', width: 220 },
  { key: 'price', width: 130 },
  { key: 'stock', width: 100 },
  { key: 'status', width: 150 }
]

const WAREHOUSE_COLUMNS = [
  { key: 'name' },
  { key: 'code', width: 180 },
  { key: 'quantity', width: 180 },
  { key: 'status', width: 160 }
]

/* Three columns: the card is half the page wide, and the order's status is one click
   away on the order itself. */
const OPEN_ORDER_COLUMNS = [
  { key: 'number', width: 140 },
  { key: 'customer' },
  { key: 'qty', width: 95 }
]

/** Two cards side by side; a card handed `span` takes the whole row. */
function Slot ({ span, children }) {
  return <div style={span ? { gridColumn: '1 / span 2' } : undefined}>{children}</div>
}

/** What changed between the saved product and the draft, as the API takes it. */
export function changesOf (saved, draft) {
  const patch = {}
  if (draft.name.trim() !== saved.name) patch.name = draft.name.trim()
  if (saved.type === 'configurable') return patch
  if (draft.listPrice !== saved.listPrice) patch.listPrice = draft.listPrice
  if (draft.salesStatus !== saved.salesStatus) patch.salesStatus = draft.salesStatus
  const warehouses = draft.warehouses
    .filter((w) => w.quantity !== saved.warehouses.find((s) => s.code === w.code).quantity)
    .map((w) => ({ code: w.code, quantity: w.quantity }))
  if (warehouses.length > 0) patch.warehouses = warehouses
  return patch
}

function VariantsCard ({ product, onOpen, onSaveVariant }) {
  const widths = useColumnWidths('variants', VARIANT_COLUMNS)
  const [editing, setEditing] = useState(false)
  // The table redraws a row only when its item changes, so each row carries the mode.
  const rows = useMemo(() => product.variants.map((v) => ({ ...v, editing })), [product.variants, editing])
  const labels = (product.variants[0] && product.variants[0].variantAttributes || []).map((a) => a.label).filter(Boolean)
  return (
    <Card
      title='Variants'
      actions={(
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
            density='compact'
            selectionMode='none'
            onAction={(key) => onOpen(String(key))}
            {...widths.tableProps}
          >
            <TableHeader>
              <Column key='values' {...widths.columnProps('values')}>{labels.join(' · ') || 'Variant'}</Column>
              <Column key='sku' {...widths.columnProps('sku')}>SKU</Column>
              <Column key='price' {...widths.columnProps('price')} align='end'>Price</Column>
              <Column key='stock' {...widths.columnProps('stock')} align='end'>Available</Column>
              <Column key='status' {...widths.columnProps('status')}>Status</Column>
            </TableHeader>
            <TableBody items={rows}>
              {(v) => (
                <Row key={v.sku}>
                  <Cell>{variantText(v.variantAttributes) || v.name}</Cell>
                  <Cell>{v.sku}</Cell>
                  <Cell><PriceCell product={v} editing={v.editing} onSave={(patch) => onSaveVariant(v.sku, patch)} /></Cell>
                  <Cell><StockCell product={v} editing={v.editing} onSave={(patch) => onSaveVariant(v.sku, patch)} /></Cell>
                  <Cell><StockStatus available={v.available ?? v.stock} salesStatus={v.salesStatus} /></Cell>
                </Row>
              )}
            </TableBody>
          </TableView>
          )}
    </Card>
  )
}

/** On hand, committed and available in one line, the way an ERP's stock overview reads them. */
function StockLine ({ stock, committed, available }) {
  return (
    <Text>
      {`On hand ${stock} · Committed ${committed ?? 0} · Available ${available ?? stock}`}
    </Text>
  )
}

function InventoryCard ({ draft, saved, total, onQuantity }) {
  const widths = useColumnWidths('warehouses', WAREHOUSE_COLUMNS)
  // Available follows the draft's on-hand figures, so an edit shows its effect before Save.
  const available = total - (saved.committed ?? 0)
  return (
    <Card title='Inventory' actions={<StockLine stock={total} committed={saved.committed} available={available} />}>
      {draft.warehouses.length === 0
        ? <Text>Commerce reports no stock for this product in any warehouse.</Text>
        : (
          <TableView {...widths.tableProps} aria-label='Stock by warehouse' density='compact' selectionMode='none'>
            <TableHeader>
              <Column key='name' {...widths.columnProps('name')}>Warehouse</Column>
              <Column key='code' {...widths.columnProps('code')}>Code</Column>
              <Column key='quantity' {...widths.columnProps('quantity')}>On hand</Column>
              <Column key='status' {...widths.columnProps('status')}>Status</Column>
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
      <Text UNSAFE_className='erp-subtle'>
        A warehouse here is a Commerce inventory source. Committed is what open orders still have to ship; it is read from the orders, not stored.
      </Text>
    </Card>
  )
}

/** The orders that hold this product's stock, newest first; a row opens the order. */
function OpenOrdersCard ({ orders, onNavigate }) {
  const widths = useColumnWidths('product-open-orders', OPEN_ORDER_COLUMNS)
  const rows = orders || []
  return (
    <Card title='Open orders' actions={<Text>{rows.length === 1 ? '1 order' : `${rows.length} orders`}</Text>}>
      {rows.length === 0
        ? <Text>No open order holds this product.</Text>
        : (
          <TableView
            {...widths.tableProps}
            aria-label='Open orders for this product'
            density='compact'
            overflowMode='wrap'
            selectionMode='none'
            UNSAFE_className={onNavigate ? 'erp-rows-open' : undefined}
            onAction={(key) => onNavigate && onNavigate('orders', { open: String(key) })}
          >
            <TableHeader>
              <Column key='number' {...widths.columnProps('number')}>Sales order</Column>
              <Column key='customer' {...widths.columnProps('customer')}>Customer</Column>
              <Column key='qty' {...widths.columnProps('qty')} align='end'>Open qty</Column>
            </TableHeader>
            <TableBody items={rows.map((o) => ({ ...o, key: o.number }))}>
              {(o) => (
                <Row key={o.number}>
                  <Cell><span className='erp-key'>{o.number}</span></Cell>
                  <Cell>{o.customer || '—'}</Cell>
                  <Cell>{o.qty}</Cell>
                </Row>
              )}
            </TableBody>
          </TableView>
          )}
    </Card>
  )
}

/** Base unit, product type and the sales status: the fields an ERP's basic-data view opens on. */
function BasicDataCard ({ saved, draft, isParent, onEdit }) {
  return (
    <Card title='Basic data'>
      <Flex direction='column' gap='size-200'>
        <Flex gap='size-400' wrap>
          <Field label='Base unit'>{saved.unit || 'EA'}</Field>
          <Field label='Product type'>{isParent ? 'Generic article (configurable)' : (saved.parentSku ? 'Variant' : 'Finished good')}</Field>
        </Flex>
        {isParent
          ? <Text UNSAFE_className='erp-subtle'>Sales status is set on each variant: the variants are what sell.</Text>
          : (
            <Field label='Sales status'>
              <Switch isSelected={draft.salesStatus === 'blocked'} onChange={(on) => onEdit({ salesStatus: on ? 'blocked' : 'sellable' })}>
                Blocked for sales
              </Switch>
              <Text UNSAFE_className='erp-subtle'>
                {draft.salesStatus === 'blocked' ? 'No shipment of this product can be created or posted until it is sellable again.' : 'Sellable. Block it and every shipment of it is refused in the ERP; Commerce is not told.'}
              </Text>
            </Field>
            )}
      </Flex>
    </Card>
  )
}

export default function ProductDetail ({ api, sku, backLabel = 'Products', onBack, onOpen, onChanged, onNavigate }) {
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  const [contractPrices, setContractPrices] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

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
    setDraft((d) => ({ ...d, ...changes }))
  }

  function setQuantity (code, quantity) {
    setDraft((d) => ({ ...d, warehouses: d.warehouses.map((w) => (w.code === code ? { ...w, quantity } : w)) }))
  }

  // A variant changed from the parent's table; the parent's total stock and price
  // range are worked out again from its variants.
  function saveVariant (variantSku, variantPatch) {
    const before = saved.variants.find((v) => v.sku === variantSku)
    const setVariant = (change) => setSaved((parent) => withVariantTotals(
      parent, parent.variants.map((v) => (v.sku === variantSku ? change(v) : v))
    ))
    return saveInPlace({
      show: () => setVariant((v) => ({ ...withEdit(v, variantPatch), saving: savingField(variantPatch) })),
      send: () => api.patchProduct(variantSku, variantPatch),
      settle: (answer) => { setVariant((v) => ({ ...v, ...answer, saving: undefined })); onChanged() },
      undo: () => setVariant(() => before),
      saved: 'Variant saved'
    })
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
      toastSaved('Product saved')
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
              <Text UNSAFE_className='erp-subtle'>
                SKU {saved.sku} · {kindText(saved)}{saved.updatedAt ? ` · Updated ${new Date(saved.updatedAt).toLocaleString()}` : ''}
              </Text>
              {saved.parent && (
                <View marginTop='size-75'>
                  <Link isQuiet onPress={() => onOpen(saved.parent.sku)}>{`Variant of ${saved.parent.name}`}</Link>
                </View>
              )}
            </View>
            <StockStatus available={total - (saved.committed ?? 0)} salesStatus={isParent ? undefined : saved.salesStatus} />
          </Flex>

          <Grid columns={['1fr', '1fr']} gap='size-300' UNSAFE_style={{ maxWidth: 960 }}>
            <Slot>
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
                  <Field label='SKU'>
                    <Flex alignItems='center' gap='size-100'>
                      <LockClosed size='S' aria-label='Locked' />
                      <Text UNSAFE_style={{ fontSize: 15, fontWeight: 600 }}>{saved.sku}</Text>
                    </Flex>
                    <Text UNSAFE_className='erp-field-label'>The SKU links this product to Commerce. Change it there, then sync.</Text>
                  </Field>
                  {saved.variantAttributes && saved.variantAttributes.length > 0 && (
                    <Field label='Varies on'>
                      <Flex gap='size-100' wrap>
                        {saved.variantAttributes.map((a) => (
                          <View key={a.label} backgroundColor='gray-200' borderRadius='regular' paddingX='size-100' paddingY='size-50'>
                            <Text UNSAFE_style={{ fontSize: 13 }}>{`${a.label}: ${a.value || '—'}`}</Text>
                          </View>
                        ))}
                      </Flex>
                    </Field>
                  )}
                </Flex>
              </Card>
            </Slot>

            <Slot>
              <Card
                title='Pricing'
                actions={!isParent && onNavigate && contractPrices !== null && (
                  // One string child: Spectrum's Link wraps a plain string and otherwise
                  // demands exactly one element, so "text + arrow" as two children crashes.
                  <Link isQuiet onPress={() => onNavigate('pricing')}>
                    {`${contractPrices === 1 ? '1 contract price' : `${contractPrices} contract prices`} →`}
                  </Link>
                )}
              >
                {isParent
                  ? (
                    <Field label='Price range'>
                      <Text UNSAFE_style={{ fontSize: 15, fontWeight: 600 }}>{priceText(saved)}</Text>
                      <Text UNSAFE_className='erp-field-label'>Each variant has its own price. Open a variant to change it.</Text>
                    </Field>
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
            </Slot>

            <Slot><BasicDataCard saved={saved} draft={draft} isParent={isParent} onEdit={edit} /></Slot>
            <Slot><OpenOrdersCard orders={saved.openOrders} onNavigate={onNavigate} /></Slot>

            <Slot span>
              {isParent
                ? <VariantsCard product={saved} onOpen={onOpen} onSaveVariant={saveVariant} />
                : <InventoryCard draft={draft} saved={saved} total={total} onQuantity={setQuantity} />}
            </Slot>
          </Grid>

          <Flex justifyContent='end' alignItems='center' gap='size-200' marginTop='size-300' UNSAFE_style={{ maxWidth: 960 }}>
            {dirty && (
              <ButtonGroup>
                <Button variant='secondary' onPress={() => setDraft(saved)} isDisabled={saving}>Cancel</Button>
                {/* The label changes at once; Spectrum shows its spinner only after a second. */}
                <Button variant='accent' onPress={save} isPending={saving} isDisabled={nameMissing}>{saving ? 'Saving…' : 'Save'}</Button>
              </ButtonGroup>
            )}
          </Flex>
        </>
      )}
    </>
  )
}
