import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { sendBrevoEmail, checkAndSendExpiryAlerts, buildTestEmail } from '../lib/brevo'
import { Settings as SettingsIcon, Save, Send, Bell, Eye, EyeOff, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'

export default function Settings() {
  const [form, setForm] = useState({
    brevo_api_key:   '',
    recipient_email: '',
    resort_name:     'Outrigger Maafushivaru Resort',
    alert_enabled:   'true',
  })
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [testSending, setTestSending] = useState(false)
  const [alertRunning, setAlertRunning] = useState(false)
  const [showKey,    setShowKey]    = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('settings').select('*')
      if (data) {
        const map = data.reduce((a,s) => ({ ...a, [s.key]: s.value || '' }), {})
        setForm(prev => ({ ...prev, ...map }))
      }
      setLoading(false)
    }
    load()
  }, [])

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  const save = async () => {
    setSaving(true)
    try {
      const rows = Object.entries(form).map(([key, value]) => ({
        key, value, updated_at: new Date().toISOString()
      }))
      const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' })
      if (error) throw error
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err.message)
    }
    setSaving(false)
  }

  const sendTest = async () => {
    if (!form.brevo_api_key) { toast.error('Enter a Brevo API key first'); return }
    if (!form.recipient_email) { toast.error('Enter a recipient email first'); return }
    setTestSending(true)
    try {
      const { subject, htmlContent, textContent } = buildTestEmail(form.resort_name)
      await sendBrevoEmail({
        apiKey: form.brevo_api_key,
        to:     form.recipient_email,
        subject, htmlContent, textContent,
      })
      toast.success(`Test email sent to ${form.recipient_email}`)
    } catch (err) {
      toast.error(err.message)
    }
    setTestSending(false)
  }

  const runAlerts = async () => {
    if (!form.brevo_api_key) { toast.error('Enter a Brevo API key first'); return }
    if (!form.recipient_email) { toast.error('Enter a recipient email first'); return }
    setAlertRunning(true)
    try {
      const results = await checkAndSendExpiryAlerts({
        supabase,
        apiKey:         form.brevo_api_key,
        recipientEmail: form.recipient_email,
        resortName:     form.resort_name,
      })
      if (results.errors.length) {
        toast.error('Some errors: ' + results.errors.join(', '))
      } else if (results.sent === 0) {
        toast('No new alerts to send today.', { icon: 'ℹ️' })
      } else {
        toast.success(`Sent alerts for ${results.sent} item(s)`)
      }
    } catch (err) {
      toast.error(err.message)
    }
    setAlertRunning(false)
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Configure integrations and system preferences</p>
      </div>

      {/* General */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <SettingsIcon className="w-5 h-5 text-teal-400" />
          <h2 className="font-display text-lg font-semibold text-slate-100">General</h2>
        </div>
        <div>
          <label className="label">Resort Name</label>
          <input className="input" value={form.resort_name} onChange={f('resort_name')} placeholder="Resort name (used in PDF headers)" />
          <p className="text-xs text-slate-500 mt-1">Appears on exported PDFs and email headers.</p>
        </div>
      </div>

      {/* Brevo Email */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Send className="w-5 h-5 text-teal-400" />
          <h2 className="font-display text-lg font-semibold text-slate-100">Brevo Email Integration</h2>
        </div>

        <div>
          <label className="label">Brevo API Key</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              className="input pr-10"
              value={form.brevo_api_key}
              onChange={f('brevo_api_key')}
              placeholder="xkeysib-..."
            />
            <button type="button" onClick={() => setShowKey(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">Get your API key from Brevo Dashboard → SMTP &amp; API → API Keys.</p>
        </div>

        <div>
          <label className="label">Recipient Email for Alerts</label>
          <input type="email" className="input" value={form.recipient_email} onChange={f('recipient_email')} placeholder="stockmanager@resort.com" />
          <p className="text-xs text-slate-500 mt-1">All expiry alerts (7d, 15d, 30d) will be sent here.</p>
        </div>

        <div>
          <label className="label">Expiry Alerts</label>
          <select className="input" value={form.alert_enabled} onChange={f('alert_enabled')}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>

        <div className="flex gap-3 flex-wrap pt-2">
          <Button onClick={sendTest} loading={testSending} variant="secondary">
            <Send className="w-4 h-4" /> Send Test Email
          </Button>
          <Button onClick={runAlerts} loading={alertRunning} variant="outline">
            <Bell className="w-4 h-4" /> Trigger Expiry Check Now
          </Button>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={save} loading={saving} size="lg">
          <Save className="w-5 h-5" /> Save Settings
        </Button>
      </div>

      {/* Info card */}
      <div className="card bg-teal-900/20 border-teal-700/40">
        <h3 className="font-semibold text-teal-300 mb-2">Scheduled Email Alerts</h3>
        <p className="text-slate-400 text-sm leading-relaxed">
          To automatically run expiry checks daily, set up a Render Cron Job or a Supabase Edge Function
          that calls the <code className="bg-slate-700 px-1 rounded text-teal-300">/api/check-alerts</code> endpoint (or equivalent).
          See the README for detailed instructions on scheduling.
        </p>
        <div className="mt-3 space-y-1 text-sm">
          <p className="text-slate-300"><strong>Alert thresholds:</strong></p>
          <ul className="text-slate-400 list-disc list-inside space-y-0.5">
            <li>30 days before expiry — 🟡 Notice</li>
            <li>15 days before expiry — 🟠 Warning</li>
            <li>7 days before expiry  — 🔴 Critical</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
