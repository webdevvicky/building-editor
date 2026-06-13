// ConnectErpDialog — modal for linking this project to an ERP cloud project.
//
// "Connect" flow:
//   1. User fills in ERP URL, Editor Project ID, API key.
//   2. On "Connect": calls getValidAccessToken (token exchange) to validate
//      the credentials against the live ERP before storing anything.
//   3. On success: calls setCloudConn to persist on the IDB project record,
//      calls onConnected(conn), fires a success toast.
//   4. On failure: shows inline error — credentials are NOT saved.
//
// "Disconnect" clears the stored connection and fires onDisconnected().
//
// Props:
//   open          boolean
//   onClose       () => void
//   projectId     string
//   existingConn  { erpUrl, editorProjectId, apiKey } | null
//   onConnected   (conn) => void
//   onDisconnected () => void

import { useState, useEffect } from 'react'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'
import { Field } from './ui/Field.jsx'
import { toast } from './ui/Toast'
import { getValidAccessToken } from '../projects/cloudConn.js'
import { setCloudConn, clearCloudConn } from '../projects/cloudConn.js'
import './ConnectErpDialog.css'

export default function ConnectErpDialog({
  open,
  onClose,
  projectId,
  existingConn,
  onConnected,
  onDisconnected,
}) {
  const [erpUrl, setErpUrl]                 = useState('')
  const [editorProjectId, setEditorProjectId] = useState('')
  const [apiKey, setApiKey]                 = useState('')

  const [testState, setTestState] = useState('idle') // 'idle' | 'testing' | 'ok' | 'error'
  const [testError, setTestError] = useState(null)
  const [saving, setSaving]       = useState(false)

  // Pre-fill form when opening with an existing connection.
  useEffect(() => {
    if (!open) return
    if (existingConn) {
      setErpUrl(existingConn.erpUrl)
      setEditorProjectId(existingConn.editorProjectId)
      setApiKey(existingConn.apiKey)
    } else {
      setErpUrl('')
      setEditorProjectId('')
      setApiKey('')
    }
    setTestState('idle')
    setTestError(null)
  }, [open, existingConn])

  function handleClose() {
    if (saving) return
    onClose()
  }

  async function handleConnect() {
    if (!erpUrl.trim() || !editorProjectId.trim() || !apiKey.trim()) {
      toast.error('All three fields are required.')
      return
    }

    const conn = {
      erpUrl: erpUrl.trim().replace(/\/$/, ''),
      editorProjectId: editorProjectId.trim(),
      apiKey: apiKey.trim(),
    }

    setTestState('testing')
    setTestError(null)

    try {
      await getValidAccessToken(conn)
    } catch (err) {
      setTestState('error')
      setTestError(err?.message ?? 'Connection test failed.')
      return
    }

    // Credentials are valid — persist and notify.
    setSaving(true)
    try {
      await setCloudConn(projectId, conn)
      setTestState('ok')
      toast.success('Connected to ERP cloud.')
      onConnected?.(conn)
      onClose()
    } catch (err) {
      setTestState('error')
      setTestError(`Could not save connection: ${err?.message ?? String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect() {
    setSaving(true)
    try {
      await clearCloudConn(projectId)
      toast.info('Disconnected from ERP cloud.')
      onDisconnected?.()
      onClose()
    } catch (err) {
      toast.error(`Disconnect failed: ${err?.message ?? String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const busy = testState === 'testing' || saving

  const footer = (
    <>
      <Button variant="ghost" onClick={handleClose} disabled={busy}>
        Cancel
      </Button>
      <Button
        variant="primary"
        onClick={handleConnect}
        disabled={busy || !erpUrl.trim() || !editorProjectId.trim() || !apiKey.trim()}
      >
        {testState === 'testing' ? 'Connecting…' : 'Connect'}
      </Button>
    </>
  )

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Connect to ERP cloud"
      width={480}
      footer={footer}
    >
      {/* Inline status */}
      {testState === 'testing' && (
        <div className="erp-dialog__status erp-dialog__status--testing" role="status">
          <span className="erp-dialog__status-dot" aria-hidden="true" />
          <span className="erp-dialog__status-text">Testing connection…</span>
        </div>
      )}
      {testState === 'error' && (
        <div className="erp-dialog__status erp-dialog__status--error" role="alert">
          <span className="erp-dialog__status-dot" aria-hidden="true" />
          <span className="erp-dialog__status-text">{testError}</span>
        </div>
      )}
      {testState === 'ok' && (
        <div className="erp-dialog__status erp-dialog__status--connected" role="status">
          <span className="erp-dialog__status-dot" aria-hidden="true" />
          <span className="erp-dialog__status-text">Connection verified.</span>
        </div>
      )}

      <div style={{ marginTop: testState !== 'idle' ? 'var(--space-4)' : 0 }}>
        <Field label="ERP URL" required>
          <input
            type="url"
            value={erpUrl}
            onChange={(e) => { setErpUrl(e.target.value); setTestState('idle') }}
            placeholder="https://erp.example.com"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </Field>

        <Field label="Editor Project ID" required hint="The UUID assigned by the ERP to this floor-plan project.">
          <input
            type="text"
            value={editorProjectId}
            onChange={(e) => { setEditorProjectId(e.target.value); setTestState('idle') }}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </Field>

        <Field label="API Key" required hint="Generated in ERP → Settings → Editor Integrations.">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setTestState('idle') }}
            placeholder="••••••••••••••••"
            autoComplete="new-password"
            disabled={busy}
          />
        </Field>

        <p className="erp-dialog__hint">
          Your API key is stored locally in this browser only and is never
          transmitted to any server other than the ERP URL above.
        </p>
      </div>

      {/* Disconnect section — only shown when already connected */}
      {existingConn && (
        <div className="erp-dialog__disconnect-row">
          <span className="erp-dialog__disconnect-label">
            Currently connected to {existingConn.erpUrl}
          </span>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDisconnect}
            disabled={busy}
          >
            Disconnect
          </Button>
        </div>
      )}
    </Modal>
  )
}
