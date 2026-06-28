import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Save, RefreshCw, Eye, EyeOff, ExternalLink, Mail, Bell, BellOff } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Input, { Select } from '../components/ui/Input'
import {
  localNotifsSupported, getLocalNotifPref, permissionState,
  enableLocalNotifs, disableLocalNotifs, sendTestNotification,
} from '../lib/localNotifications'

const DEFAULTS = {
  resort_name:            'Outrigger Maafushivaru Resort',
  low_stock_threshold:    '10',
  expiry_warning_days:    '30',
  currency:               'USD',
  // Email report settings
  brevo_api_key:          '',
  brevo_sender_email:     '',
  brevo_sender_name:      'Roni — Store Assistant',
  report_recipient_email: '',
  report_recipient_name:  'Manager',
  // Order generation: per-category maximum order qty + usual order UOM
  order_max_food:         '',
  order_max_general:      '',
  order_max_beverage:     '',
  order_default_uom:      'pcs',
  // Boat note retention (auto-delete after N days)
  boat_note_retention_days: '6',
}

export default function Settings() {
  const [form,    setForm]    = useState(DEFAULTS)
  const [saving,  setSaving]  = useState(false)
  const [loading, setLoading] = useState(true)
  const [showKey, setShowKey] = useState(false)

  // Local (browser/desktop) notifications — per-device, stored in localStorage.
  const [localNotif, setLocalNotif] = useState(getLocalNotifPref())
  const [perm,       setPerm]       = useState(permissionState())

  const toggleLocalNotif = async () => {
    if (localNotif) {
      disableLocalNotifs()
      setLocalNotif(false)
      toast.success('Local notifications turned off')
      return
    }
    const { ok, reason } = await enableLocalNotifs()
    setPerm(permissionState())
    if (ok) {
      setLocalNotif(true)
      toast.success('Local notifications enabled')
    } else if (reason === 'unsupported') {
      toast.error('This browser does not support notifications')
    } else if (reason === 'denied') {
      toast.error('Permission blocked — allow notifications in your browser settings')
    } else {
      toast('Permission request dismissed', { icon: 'ℹ️' })
    }
  }

  useEffect(() => {
    supabase.from('settings').select('key,value').then(({ data }) => {
      if (data?.length) {
        const smap = data.reduce((a, s) => ({ ...a, [s.key]: s.value }), {})
        setForm(f => ({ ...f, ...smap }))
      }
      setLoading(false)
    })
  }, [])

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  const handleSave = async () => {
    setSaving(true)
    try {
      for (const [key, value] of Object.entries(form)) {
        await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' })
      }
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err.message)
    }
    setSaving(false)
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Configure your resort, thresholds, and automated email reports</p>
      </div>

      {/* ── General ─────────────────────────────────── */}
      <div className="card space-y-4">
        <p className="font-display text-base font-semibold text-slate-100 mb-1">General</p>
        <Input label="Resort Name" value={form.resort_name} onChange={f('resort_name')} />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Low Stock Warning (units)"
            type="number" min="0"
            value={form.low_stock_threshold}
            onChange={f('low_stock_threshold')}
          />
          <Input
            label="Expiry Warning (days before)"
            type="number" min="1"
            value={form.expiry_warning_days}
            onChange={f('expiry_warning_days')}
          />
        </div>
        <Select label="Currency" value={form.currency} onChange={f('currency')}>
          <option value="USD">USD ($)</option>
          <option value="EUR">EUR (€)</option>
          <option value="GBP">GBP (£)</option>
          <option value="MVR">MVR (Rf)</option>
          <option value="AED">AED (د.إ)</option>
        </Select>
      </div>

      {/* ── Orders & Boat Notes ──────────────────── */}
      <div className="card space-y-4">
        <div>
          <p className="font-display text-base font-semibold text-slate-100">Order Generation & Boat Notes</p>
          <p className="text-xs text-slate-400 mt-0.5">Cap how much of any item is ordered per category, set the usual order unit, and control boat-note retention.</p>
        </div>

        <p className="text-sm font-medium text-slate-300">Maximum order quantity per item (by category)</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input label="Beverage max" type="number" min="0" value={form.order_max_beverage} onChange={f('order_max_beverage')} placeholder="No cap" />
          <Input label="Food max"     type="number" min="0" value={form.order_max_food}     onChange={f('order_max_food')}     placeholder="No cap" />
          <Input label="General max"  type="number" min="0" value={form.order_max_general}  onChange={f('order_max_general')}  placeholder="No cap" />
        </div>
        <p className="text-xs text-slate-500">Leave blank for no limit. The generated order qty for an item is never higher than its category's max.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Usual order unit (UOM)" value={form.order_default_uom} onChange={f('order_default_uom')} placeholder="pcs" />
          <Input label="Boat note retention (days)" type="number" min="0" value={form.boat_note_retention_days} onChange={f('boat_note_retention_days')} placeholder="6" />
        </div>
        <p className="text-xs text-slate-500">Boat notes are automatically deleted this many days after their note date (0 = keep forever). You can also delete any note manually.</p>
      </div>

      {/* ── Email Reports (Brevo) ────────────────────── */}
      <div className="card space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-900/30 border border-blue-700/30 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="font-display text-base font-semibold text-slate-100">Email Reports — Brevo</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Configure Brevo to automatically send inventory reports (delivery claims + expiring items) to your manager.
              {' '}
              <a href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noreferrer"
                className="text-[#00AEEF] hover:underline inline-flex items-center gap-0.5">
                Get API key <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        </div>

        {/* Setup steps */}
        <div className="bg-slate-700/30 rounded-xl p-4 text-sm text-slate-400 space-y-2">
          <p className="font-medium text-slate-300">📋 Quick setup:</p>
          <ol className="list-decimal ml-4 space-y-1.5">
            <li>Sign up / log in at <a href="https://brevo.com" target="_blank" rel="noreferrer" className="text-[#00AEEF] hover:underline">brevo.com</a></li>
            <li>Go to <strong className="text-slate-300">Settings → API Keys</strong> → create a key → paste below</li>
            <li>Verify your sender email in Brevo <strong className="text-slate-300">(Settings → Senders)</strong></li>
            <li>Fill in your manager's email as the recipient</li>
            <li>Click <strong className="text-slate-300">Save</strong> → go to <strong className="text-slate-300">Reports</strong> → click <strong className="text-slate-300">Send Email Report</strong></li>
          </ol>
        </div>

        <div className="space-y-4">
          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Brevo API Key *
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                className="input pr-10 font-mono text-sm"
                value={form.brevo_api_key}
                onChange={f('brevo_api_key')}
                placeholder="xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <button
                type="button"
                onClick={() => setShowKey(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">Stored securely in your database. Never shared.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Sender Email * (must be verified in Brevo)"
              type="email"
              value={form.brevo_sender_email}
              onChange={f('brevo_sender_email')}
              placeholder="store@maafushivaru.com"
            />
            <Input
              label="Sender Name"
              value={form.brevo_sender_name}
              onChange={f('brevo_sender_name')}
              placeholder="Roni — Store Assistant"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Manager Email * (recipient)"
              type="email"
              value={form.report_recipient_email}
              onChange={f('report_recipient_email')}
              placeholder="manager@maafushivaru.com"
            />
            <Input
              label="Manager Name"
              value={form.report_recipient_name}
              onChange={f('report_recipient_name')}
              placeholder="e.g. Mr. Ahmed"
            />
          </div>
        </div>

        {/* Status indicator */}
        {form.brevo_api_key && form.brevo_sender_email && form.report_recipient_email ? (
          <div className="bg-green-900/20 border border-green-700/30 rounded-xl p-3 flex items-center gap-2 text-sm text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Email reports are configured. Go to <strong>Reports → Send Email Report</strong> to send.
          </div>
        ) : (
          <div className="bg-slate-700/30 border border-slate-600/40 rounded-xl p-3 flex items-center gap-2 text-sm text-slate-400">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            Not fully configured — fill in API key, sender email, and recipient email.
          </div>
        )}
      </div>

      {/* ── Local Notifications (browser / desktop) ───────────────── */}
      <div className="card space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-900/30 border border-teal-700/30 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <p className="font-display text-base font-semibold text-slate-100">Local Notifications</p>
            <p className="text-sm text-slate-400 mt-0.5">
              Get instant desktop/browser alerts for low stock, out-of-stock and expiring items —
              works <strong>alongside</strong> the Brevo email reports. This is a per-device setting.
            </p>
          </div>
        </div>

        {!localNotifsSupported() ? (
          <div className="bg-slate-700/30 border border-slate-600/40 rounded-xl p-3 text-sm text-slate-400">
            This browser does not support local notifications.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 bg-slate-700/20 border border-slate-600/40 rounded-xl p-4">
              <div className="flex items-center gap-3">
                {localNotif ? <Bell className="w-5 h-5 text-teal-400" /> : <BellOff className="w-5 h-5 text-slate-500" />}
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    {localNotif ? 'Local notifications are ON' : 'Local notifications are OFF'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Permission: <span className="text-slate-400">{perm}</span>
                  </p>
                </div>
              </div>
              <button onClick={toggleLocalNotif}
                className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${localNotif ? 'bg-teal-500' : 'bg-slate-600'}`}
                title={localNotif ? 'Disable' : 'Enable'}>
                <span className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all ${localNotif ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
            {localNotif && perm === 'granted' && (
              <button onClick={() => { if (!sendTestNotification()) toast.error('Could not send test') }}
                className="text-sm text-teal-400 hover:text-teal-300 transition-colors">
                → Send a test notification
              </button>
            )}
            {perm === 'denied' && (
              <div className="bg-orange-900/20 border border-orange-700/30 rounded-xl p-3 text-sm text-orange-300">
                Notifications are blocked for this site. Enable them in your browser's site settings, then toggle again.
              </div>
            )}
          </>
        )}
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving}>
          <Save className="w-4 h-4" /> Save Settings
        </Button>
      </div>
    </div>
  )
}
