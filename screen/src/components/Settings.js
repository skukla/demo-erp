import React, { useEffect, useState } from 'react'
import { Form, TextField, Switch, Button, Text } from '@adobe/react-spectrum'
import Frame from './Frame'

export default function Settings ({ api, onChanged }) {
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { api.settings().then(setSettings).catch(setError) }, [api])
  async function save () {
    try { setSettings(await api.saveSettings({ displayName: settings.displayName, offline: settings.offline })); setError(null); onChanged() } catch (e) { setError(e) }
  }
  return (
    <Frame title='Settings' error={error} loading={!settings}>
      {settings && (
        <Form maxWidth='size-4600'>
          <TextField label='Display name' value={settings.displayName} onChange={(v) => setSettings({ ...settings, displayName: v })} description='What this ERP is called on its screen and in Demo Builder. Set at install from ERP_DISPLAY_NAME; editable here.' />
          <Switch isSelected={Boolean(settings.offline)} onChange={(v) => setSettings({ ...settings, offline: v })}>Offline (every record request answers 503)</Switch>
          <Button variant='primary' onPress={save}>Save</Button>
          <Text>Last import: {settings.lastImportAt || 'never'}. Last wipe: {settings.lastWipeAt || 'never'}.</Text>
        </Form>
      )}
    </Frame>
  )
}
