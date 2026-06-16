import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { sendWhatsAppMessage, buildTestWhatsApp } from '../lib/whatsapp'
import { Settings as SettingsIcon, Save, RefreshCw, Send, Bell, Shield, Phone, Moon, Sun, TestTube } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { useTheme } from '../hooks/useTheme'

const SECTIONS = ['General','Email Alerts','WhatsApp','Low Stock','User Roles','Theme']

function Section({ title, children }) {
  return (
    <div className="card space-y-4">
      <h2 className="font-display text-base font-semibold text-slate-100 border-b border-slate-700 pb-3">{title}</h2>
      {children}
    </div>
  )
}

export default function Settings() {
  const { isDark, toggle } = useTheme()

  const [settings, setSettings] = useState({
    resort_name:            'Outrigger Maafushivaru Resort',
    expiry_threshold_days:  '7',
    secondary_threshold_days:'15',
    alert_email:            '',
    brevo_api_key:          '',
    brevo_sender_email:     '',
    brevo_sender_name:      'Inventory System',
    twilio_account_sid:     '',
    twilio_auth_token:      '',
    twilio_whatsapp_from:   'whatsapp:+14155238886',
    whatsapp_recipient:     '',
    whatsapp_alerts_enabled:'false',
    low_stock_alerts_enabled:'true',
    admin_emails:           '',
  })
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [testingWA,  setTestingWA]  = useState(false)
  const [testingEmail,setTestingEmail]=useState(false)
  const [activeSection, setActiveSection] = useState('General')

  const set = (k, v) => setSettings(p => ({ ...p, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('settings').select('*')
    if (data) {
      const map = {}; data.forEach(r => { map[r.key] = r.value })
      setSettings(prev => ({ ...prev, ...map }))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const rows = Object.entries(settings).map(([key, value]) => ({ key, value: value||'' }))
      for (const row of rows) {
        await supabase.from('settings').upsert(row, { onConflict: 'key' })
      }
      toast.success('Settings saved')
    } catch(err) { toast.error(err.message) }
    setSaving(false)
  }

  const testWhatsApp = async () => {
    setTestingWA(true)
    try {
      await sendWhatsAppMessage({
        accountSid: settings.twilio_account_sid,
        authToken:  settings.twilio_auth_token,
        from:       settings.twilio_whatsapp_from,
        to:         settings.whatsapp_recipient,
        body:       buildTestWhatsApp(settings.resort_name),
      })
      toast.success('✅ Test WhatsApp message sent!')
    } catch(err) { toast.error('WhatsApp test failed: ' + err.message) }
    setTestingWA(false)
  }

  const testEmail = async () => {
    if (!settings.brevo_api_key||!settings.alert_email) { toast.error('Configure Brevo API key and alert email first'); return }
    setTestingEmail(true)
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': settings.brevo_api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender:  { name: settings.brevo_sender_name||'Inventory System', email: settings.brevo_sender_email||settings.alert_email },
          to:      [{ email: settings.alert_email }],
          subject: `✅ Test Email – ${settings.resort_name}`,
          htmlContent: `<p>This is a test email from the ${settings.resort_name} Inventory System. Email alerts are configured correctly!</p>`,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success('✅ Test email sent!')
    } catch(err) { toast.error('Email test failed: ' + err.message) }
    setTestingEmail(false)
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="page-title">Settings</h1><p className="page-sub">Configure alerts, integrations and system preferences</p></div>
        <Button onClick={save} loading={saving}><Save className="w-4 h-4" /> Save All Settings</Button>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 flex-wrap border-b border-slate-700 pb-0">
        {SECTIONS.map(s=>(
          <button key={s} onClick={()=>setActiveSection(s)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${activeSection===s?'border-teal-500 text-teal-400':'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {s}
          </button>
        ))}
      </div>

      {activeSection==='General'&&(
        <Section title="General Settings">
          <Input label="Resort Name" value={settings.resort_name} onChange={e=>set('resort_name',e.target.value)} helperText="Used in all reports, PDFs, and alerts." />
        </Section>
      )}

      {activeSection==='Email Alerts'&&(
        <Section title="Email Alerts (Brevo)">
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3 text-sm text-blue-300">
            Uses <strong>Brevo</strong> (free tier supports 300 emails/day). Get your API key at brevo.com → Settings → API Keys.
          </div>
          <Input label="Brevo API Key" type="password" value={settings.brevo_api_key} onChange={e=>set('brevo_api_key',e.target.value)} placeholder="xkeysib-…" />
          <Input label="Alert Recipient Email" type="email" value={settings.alert_email} onChange={e=>set('alert_email',e.target.value)} placeholder="manager@resort.com" helperText="Who receives expiry and low-stock alert emails." />
          <Input label="Sender Email" type="email" value={settings.brevo_sender_email} onChange={e=>set('brevo_sender_email',e.target.value)} placeholder="inventory@resort.com" />
          <Input label="Sender Name" value={settings.brevo_sender_name} onChange={e=>set('brevo_sender_name',e.target.value)} placeholder="Inventory System" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Critical Expiry Threshold (days)" type="number" min="1" value={settings.expiry_threshold_days} onChange={e=>set('expiry_threshold_days',e.target.value)} helperText="Default: 7 days." />
            <Input label="Warning Threshold (days)" type="number" min="1" value={settings.secondary_threshold_days} onChange={e=>set('secondary_threshold_days',e.target.value)} helperText="Default: 15 days." />
          </div>
          <div className="pt-2">
            <Button variant="secondary" onClick={testEmail} loading={testingEmail}>
              <Send className="w-4 h-4" /> Send Test Email
            </Button>
          </div>
        </Section>
      )}

      {activeSection==='WhatsApp'&&(
        <Section title="WhatsApp Alerts (Twilio)">
          <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-3 text-sm text-green-300">
            Sends WhatsApp messages via Twilio. Create a free account at twilio.com → get Account SID, Auth Token, and join the WhatsApp Sandbox.
          </div>
          <div className="flex items-center gap-3 p-3 bg-slate-700/30 rounded-lg">
            <span className="text-sm text-slate-300">WhatsApp Alerts</span>
            <button onClick={()=>set('whatsapp_alerts_enabled', settings.whatsapp_alerts_enabled==='true'?'false':'true')}
              className={`relative w-12 h-6 rounded-full transition-colors ${settings.whatsapp_alerts_enabled==='true'?'bg-green-600':'bg-slate-600'}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${settings.whatsapp_alerts_enabled==='true'?'left-7':'left-1'}`} />
            </button>
            <span className="text-sm text-slate-400">{settings.whatsapp_alerts_enabled==='true'?'Enabled':'Disabled'}</span>
          </div>
          <Input label="Twilio Account SID" type="password" value={settings.twilio_account_sid} onChange={e=>set('twilio_account_sid',e.target.value)} placeholder="ACxxxxxxxxxxxxxxxx" />
          <Input label="Twilio Auth Token" type="password" value={settings.twilio_auth_token} onChange={e=>set('twilio_auth_token',e.target.value)} placeholder="Your auth token" />
          <Input label="From Number (WhatsApp Sandbox)" value={settings.twilio_whatsapp_from} onChange={e=>set('twilio_whatsapp_from',e.target.value)} placeholder="whatsapp:+14155238886" helperText="Default Twilio sandbox number — don't change unless you have a dedicated number." />
          <Input label="Recipient WhatsApp Number" value={settings.whatsapp_recipient} onChange={e=>set('whatsapp_recipient',e.target.value)} placeholder="+9601234567" helperText="Include country code. e.g. +9601234567 for Maldives." />
          <div className="pt-2">
            <Button variant="secondary" onClick={testWhatsApp} loading={testingWA}>
              <Phone className="w-4 h-4" /> Send Test WhatsApp
            </Button>
          </div>
        </Section>
      )}

      {activeSection==='Low Stock'&&(
        <Section title="Low Stock Alerts">
          <div className="flex items-center gap-3 p-3 bg-slate-700/30 rounded-lg">
            <Bell className="w-5 h-5 text-teal-400" />
            <span className="text-sm text-slate-300 flex-1">Low Stock Email Alerts</span>
            <button onClick={()=>set('low_stock_alerts_enabled', settings.low_stock_alerts_enabled==='true'?'false':'true')}
              className={`relative w-12 h-6 rounded-full transition-colors ${settings.low_stock_alerts_enabled==='true'?'bg-teal-600':'bg-slate-600'}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${settings.low_stock_alerts_enabled==='true'?'left-7':'left-1'}`} />
            </button>
            <span className="text-sm text-slate-400">{settings.low_stock_alerts_enabled==='true'?'On':'Off'}</span>
          </div>
          <p className="text-slate-400 text-sm">When enabled, a daily email digest is sent if any items are at or below their minimum stock level. The email is triggered when you run the "Generate Report" action on the Reports page.</p>
          <div className="bg-slate-700/30 rounded-lg p-3 text-sm text-slate-400">
            <strong className="text-slate-300">Note:</strong> Make sure your Brevo API key and alert email are configured in the <strong>Email Alerts</strong> tab for this to work.
          </div>
        </Section>
      )}

      {activeSection==='User Roles'&&(
        <Section title="User Roles & Access Control">
          <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-3 text-sm text-yellow-300">
            <Shield className="w-4 h-4 inline mr-1.5 mb-0.5" />
            <strong>Admin emails</strong> have full access (add/delete items, Settings). All other signed-in users have staff access (view + issue only).
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Admin Emails</label>
            <textarea
              className="input min-h-[100px] resize-none font-mono text-sm"
              value={settings.admin_emails}
              onChange={e=>set('admin_emails',e.target.value)}
              placeholder="Enter one email per line or comma-separated:&#10;admin@resort.com&#10;manager@resort.com"
            />
            <p className="text-slate-500 text-xs mt-1">One email per line. Signed-in users NOT on this list will have read-only + issuance access only.</p>
          </div>
          <div className="bg-slate-700/30 rounded-lg p-3 text-sm text-slate-400">
            <strong className="text-slate-300">Your email:</strong> {' '}
            <span className="text-teal-400 font-mono text-xs">(check Supabase Auth → Users for your email)</span>
          </div>
        </Section>
      )}

      {activeSection==='Theme'&&(
        <Section title="Appearance">
          <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-xl border border-slate-700/40">
            <div className="flex items-center gap-3">
              {isDark ? <Moon className="w-5 h-5 text-blue-400" /> : <Sun className="w-5 h-5 text-yellow-400" />}
              <div>
                <p className="text-sm font-medium text-slate-200">{isDark ? 'Dark Mode' : 'Light Mode'}</p>
                <p className="text-xs text-slate-500">{isDark ? 'Dark background, easy on the eyes' : 'Light background for bright environments'}</p>
              </div>
            </div>
            <button onClick={toggle}
              className={`relative w-14 h-7 rounded-full transition-colors ${isDark?'bg-blue-700':'bg-yellow-500'}`}>
              <span className={`absolute top-1.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${isDark?'left-8':'left-1.5'}`} />
            </button>
          </div>
          <p className="text-slate-500 text-sm">Theme preference is saved in your browser and is per-device. It does not affect other users.</p>
        </Section>
      )}

      {/* Save button */}
      <div className="flex justify-end">
        <Button onClick={save} loading={saving}><Save className="w-4 h-4" /> Save All Settings</Button>
      </div>
    </div>
  )
}
