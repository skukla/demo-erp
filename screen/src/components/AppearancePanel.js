/*
 * Appearance, from the user menu: a theme in one click, or a colour, mark or menu on its own.
 *
 * Everything is shown live: `onPreview` hands the pending look up to App, which colours the
 * whole page from it. Closing the panel without saving unmounts this, the preview is
 * dropped, and the screen goes back to what the ERP has. A refusal stays in the panel, in
 * the ERP's words, as the setup dialogs do.
 *
 * A theme card shows as chosen when the look matches it in full (palette, mark and menu);
 * so picking Meridian and then Plum lights no card, rather than leaving one lit that no
 * longer describes the screen.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, ButtonGroup, Content, Dialog, Divider, Flex, Heading, InlineAlert, Radio, RadioGroup, Text } from '@adobe/react-spectrum'
import { LOGOS, PALETTES, THEMES } from '../design/palette'
import { NOTHING_PICKED, lookOf, withPart, withTheme } from './appearanceChoice'
import Logo from './Logo'
import { toastSaved } from './toast'

const NAV_LABELS = { rail: 'Side rail', top: 'Top band' }

const sameLook = (a, b) => a.palette === b.palette && a.logo === b.logo && a.nav === b.nav

/** A theme card: the palette's colours, its mark, its name. */
function ThemeCard ({ id, theme, chosen, onChoose }) {
  const { tokens } = PALETTES[theme.palette]
  return (
    <button
      type='button'
      className='erp-theme-card'
      aria-pressed={chosen}
      onClick={() => onChoose(id)}
    >
      <span className='erp-theme-band' style={{ background: tokens['--shell'], color: tokens['--shell-ink'] }}>
        <Logo logo={theme.logo} name={theme.label} size={20} />
      </span>
      <span className='erp-theme-swatches'>
        <i style={{ background: tokens['--accent'] }} />
        <i style={{ background: tokens['--accent-edge'] }} />
        <i style={{ background: tokens['--accent-tint'] }} />
      </span>
      <span className='erp-theme-name'>{theme.label}</span>
      <span className='erp-theme-detail'>{PALETTES[theme.palette].label} · {NAV_LABELS[theme.nav]}</span>
    </button>
  )
}

/**
 * @param {object} props `api`; `name` — the ERP's name, which the monogram mark draws;
 *   `saved` — the ERP's look now; `onPreview(look|null)`;
 *   `onChanged` — reads health again after a save; `close`
 */
export default function AppearancePanel ({ api, name, saved, onPreview, onChanged, close }) {
  const [choice, setChoice] = useState(NOTHING_PICKED)
  const [refusal, setRefusal] = useState(null)
  const [saving, setSaving] = useState(false)
  // Memoised: App holds what this hands up, so a fresh object every render would loop.
  const look = useMemo(() => lookOf(choice, saved), [choice, saved])

  // Show what is being chosen, and put the screen back when the panel goes away.
  useEffect(() => { onPreview(look) }, [look, onPreview])
  useEffect(() => () => onPreview(null), [onPreview])

  const pick = useCallback((next) => { setRefusal(null); setChoice(next) }, [])

  async function save () {
    setSaving(true)
    try {
      await api.saveAppearance(choice)
      // Health carries the stored look; once it has it, the panel has nothing left to show.
      await onChanged()
      toastSaved('Appearance saved')
      close()
    } catch (e) {
      setRefusal(e.message)
      setSaving(false)
    }
  }

  return (
    // Wide enough for the four theme cards in one row, with room to read each.
    <Dialog width={840}>
      <Heading>Appearance</Heading>
      <Divider />
      <Content>
        {refusal && (
          <InlineAlert variant='negative' marginBottom='size-200'>
            <Heading>Not saved</Heading>
            <Content>{refusal}</Content>
          </InlineAlert>
        )}
        <Flex direction='column' gap='size-300'>
          <Text>How this screen looks. Nothing here changes its records.</Text>
          <div className='erp-setting'>
            <p className='erp-field-label'>Themes</p>
            <div className='erp-theme-cards'>
              {Object.entries(THEMES).map(([id, theme]) => (
                <ThemeCard key={id} id={id} theme={theme} chosen={sameLook(look, theme)} onChoose={(t) => pick(withTheme(t))} />
              ))}
            </div>
          </div>
          <div className='erp-setting'>
            <p className='erp-field-label'>Color</p>
            <div className='erp-swatch-row'>
              {Object.entries(PALETTES).map(([id, { label, tokens }]) => (
                <button
                  key={id}
                  type='button'
                  className='erp-swatch'
                  aria-pressed={look.palette === id}
                  aria-label={label}
                  title={label}
                  onClick={() => pick(withPart(choice, 'palette', id))}
                  style={{ background: tokens['--accent'] }}
                />
              ))}
            </div>
          </div>
          <div className='erp-setting'>
            <p className='erp-field-label'>Logo</p>
            <div className='erp-mark-row'>
              {LOGOS.map((id) => (
                <button
                  key={id}
                  type='button'
                  className='erp-mark'
                  aria-pressed={look.logo === id}
                  aria-label={id}
                  title={id}
                  onClick={() => pick(withPart(choice, 'logo', id))}
                >
                  {/* The monogram draws the ERP's own initial, so what is offered here is
                      what will actually appear on the shell bar. */}
                  <Logo logo={id} name={name} size={24} />
                </button>
              ))}
            </div>
          </div>
          <RadioGroup
            label='Navigation'
            orientation='horizontal'
            value={look.nav}
            onChange={(nav) => pick(withPart(choice, 'nav', nav))}
          >
            {Object.entries(NAV_LABELS).map(([id, label]) => <Radio key={id} value={id}>{label}</Radio>)}
          </RadioGroup>
        </Flex>
      </Content>
      <ButtonGroup>
        <Button variant='secondary' onPress={close} isDisabled={saving}>Cancel</Button>
        <Button variant='accent' onPress={save} isPending={saving} isDisabled={sameLook(look, saved)}>Save</Button>
      </ButtonGroup>
    </Dialog>
  )
}
