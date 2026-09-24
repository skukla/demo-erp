/*
 * How the ERP is dressed, as the SC sets it: a theme in one click, or the three choices
 * underneath for anyone who wants to mix.
 *
 * A theme is a SHORTCUT that writes the three values and is not itself remembered
 * (lib/appearance.js). So the cards show as chosen when the three values happen to match
 * one — which means picking Harbour and then changing the menu simply lights no card,
 * rather than leaving a card lit that no longer describes the screen.
 *
 * Everything is shown live: `onPreview` hands the pending look up to App, which colours
 * the whole page from it. Leaving without saving unmounts this, the preview is dropped,
 * and the ERP goes back to what it had.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Button, Flex, Radio, RadioGroup, Text } from '@adobe/react-spectrum'
import { PALETTES, LOGOS, THEMES, DEFAULT_APPEARANCE } from '../design/palette'
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

export default function AppearanceSettings ({ api, saved, name, onChanged, onPreview, disabled }) {
  const [look, setLook] = useState(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Show what is being chosen, and put the ERP back when this page goes away.
  useEffect(() => { onPreview(look) }, [look, onPreview])
  useEffect(() => () => onPreview(null), [onPreview])

  const change = useCallback((patch) => { setError(null); setLook((current) => ({ ...current, ...patch })) }, [])
  const chooseTheme = useCallback((id) => {
    const { palette, logo, nav } = THEMES[id]
    change({ palette, logo, nav })
  }, [change])

  const dirty = !sameLook(look, saved)

  const save = useCallback(async () => {
    setBusy(true)
    try {
      await api.saveSettings({ appearance: look })
      // The saved look is the truth again, so the preview has nothing left to say.
      onPreview(null)
      setError(null)
      toastSaved('Appearance saved')
      await onChanged()
    } catch (e) { setError(e) }
    setBusy(false)
  }, [api, look, onChanged, onPreview])

  return (
    <Flex direction='column' gap='size-300'>
      <Text>How this ERP looks on screen. Nothing here changes its records.</Text>

      {/* The shell bar and the shape of the page beneath it, drawn from the page's own
          custom properties — which App has already set to what is being chosen. So this
          is not a rendering OF the choice, it is the choice, at a smaller size. */}
      <div className='erp-look'>
        <div className='erp-look-bar'>
          <Logo logo={look.logo} name={name} size={22} />
          <span className='erp-look-name'>{name}</span>
        </div>
        <div className={`erp-look-body erp-look-${look.nav}`}>
          <div className='erp-look-nav'><i /><i /><i /></div>
          <div className='erp-look-canvas'><i /><i /></div>
        </div>
      </div>

      <div className='erp-setting'>
        <p className='erp-field-label'>Themes</p>
        <div className='erp-theme-cards'>
          {Object.entries(THEMES).map(([id, theme]) => (
            <ThemeCard key={id} id={id} theme={theme} chosen={sameLook(look, theme)} onChoose={chooseTheme} />
          ))}
        </div>
      </div>

      <div className='erp-setting'>
        <p className='erp-field-label'>Colour</p>
        <div className='erp-swatch-row'>
          {Object.entries(PALETTES).map(([id, { label, tokens }]) => (
            <button
              key={id}
              type='button'
              className='erp-swatch'
              aria-pressed={look.palette === id}
              aria-label={label}
              title={label}
              onClick={() => change({ palette: id })}
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
              onClick={() => change({ logo: id })}
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
        onChange={(nav) => change({ nav })}
      >
        {Object.entries(NAV_LABELS).map(([id, label]) => <Radio key={id} value={id}>{label}</Radio>)}
      </RadioGroup>

      <Flex gap='size-300' alignItems='center'>
        <Button variant='primary' onPress={save} isDisabled={!dirty || busy || disabled}>Save</Button>
        <Button
          variant='secondary'
          onPress={() => change(DEFAULT_APPEARANCE)}
          isDisabled={busy || disabled || sameLook(look, DEFAULT_APPEARANCE)}
        >
          Use defaults
        </Button>
        {error && <Text>{error.message}</Text>}
      </Flex>
    </Flex>
  )
}
