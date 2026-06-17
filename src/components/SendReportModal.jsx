// SendReportModal.jsx
// Triggered from Reports page — fetches live data and sends email via Brevo

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { sendInventoryReport } from '../lib/brevo'
import { Mail, CheckCircle2, AlertTriangle, Loader, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './ui/Modal'
import Button from './ui/Button'

function daysLeft(d) {
  if (!d) return null
  const exp = new Date(d); exp.setHours(0,0,0,0)
  const now = new Date();  now.setHours(0,0,0,0)
  return Math.ceil((exp - now) / 86400000)
}

export default function SendReportModal({ onClose }) {
  const [step,     setStep]     = useState('preview') // preview | sending | done | error
  const [claims,   setClaims]   = useState([])
  const [expiring, setExpiring] = useState([])
  const [settings, setSettings] = useState({})
  const [errMsg,   setErrMsg]   = useState('')
  const [result,   setResult]   = useState(null)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: sRows }, { data: items }, { data: claimsData }] = await Promise.all([
        supabase.from('settings').select('key,value'),
        supabase.from('items').select('*,stores(name)').not('expiry_date', 'is', null),
        supabase.from('delivery_claims').select('*').in('status', ['pending', 'contacted']),
      ])

      const smap = (sRows || []).reduce((a, s) => ({ ...a, [s.key]: s.value }), {})
      setSettings(smap)

      // Items expiring within 30 days or already expired
      const expItems = (items || []).filter(i => {
        const d = daysLeft(i.expiry_date)
        return d !== null && d <= 30
      }).sort((a, b) => daysLeft(a.expiry_date) - daysLeft(b.expiry_date))

      setExpiring(expItems)
      setClaims(claimsData || [])
      setLoading(false)
    }
    load()
  }, [])

  const expired    = expiring.filter(i => daysLeft(i.expiry_date) < 0)
  const soonCount  = expiring.filter(i => daysLeft(i.expiry_date) >= 0).length

  const missingConfig = !settings.brevo_api_key || !settings.brevo_sender_email || !settings.report_recipient_email

  const handleSend = async () => {
    setStep('sending')
    try {
      const res = await sendInventoryReport({
        apiKey:         settings.brevo_api_key,
        senderEmail:    settings.brevo_sender_email,
        senderName:     settings.brevo_sender_name   || 'Roni — Store Assistant',
        recipientEmail: settings.report_recipient_email,
        recipientName:  settings.report_recipient_name || 'Manager',
        claims,
        expiringItems:  expiring,
      })
      setResult(res)
      setStep('done')
      toast.success('Report sent successfully!')
    } catch (err) {
      setErrMsg(err.message)
      setStep('error')
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Send Inventory Report Email"
      size="sm"
      footer={
        step === 'preview' ? (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            {missingConfig ? (
              <Button variant="secondary" onClick={() => { onClose(); window.location.href = '/settings' }}>
                ⚙️ Go to Settings
              </Button>
            ) : (
              <Button onClick={handleSend}>
                <Mail className="w-4 h-4" /> Send Report Now
              </Button>
            )}
          </>
        ) : step === 'done' || step === 'error' ? (
          <Button onClick={onClose}>Close</Button>
        ) : null
      }
    >
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" />
        </div>

      ) : step === 'sending' ? (
        <div className="text-center py-10">
          <Loader className="w-10 h-10 text-[#00AEEF] mx-auto mb-4 animate-spin" />
          <p className="font-semibold text-slate-100">Sending email report…</p>
          <p className="text-sm text-slate-400 mt-1">Building HTML and calling Brevo API</p>
        </div>

      ) : step === 'done' ? (
        <div className="text-center py-8 space-y-3">
          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
          <p className="font-semibold text-slate-100 text-lg">Report Sent!</p>
          <div className="bg-slate-700/40 rounded-xl p-4 text-sm text-left space-y-2 text-slate-300">
            <p>📬 To: <strong>{settings.report_recipient_email}</strong></p>
            <p>📋 Subject: <em className="text-slate-400 text-xs">{result?.subject}</em></p>
            <p>📦 Claims: <strong className="text-red-400">{result?.claimsCount}</strong></p>
            <p>⏰ Expiring items: <strong className="text-orange-400">{result?.expiryCount}</strong></p>
          </div>
        </div>

      ) : step === 'error' ? (
        <div className="text-center py-8 space-y-3">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
          <p className="font-semibold text-slate-100">Send Failed</p>
          <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-4 text-sm text-red-300 text-left">
            {errMsg}
          </div>
          <button onClick={() => setStep('preview')} className="btn-secondary btn-sm mx-auto mt-2">
            ← Back
          </button>
        </div>

      ) : (
        /* preview step */
        <div className="space-y-4">
          {missingConfig && (
            <div className="bg-orange-900/20 border border-orange-700/30 rounded-xl p-3 text-sm text-orange-300 flex gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Email not configured yet</p>
                <p className="mt-0.5">Go to <strong>Settings → Email Reports</strong> to add your Brevo API key, sender email, and manager's email.</p>
              </div>
            </div>
          )}

          {!missingConfig && (
            <div className="bg-slate-700/30 rounded-xl p-3 text-sm space-y-1.5">
              <p className="text-slate-300"><span className="text-slate-500">From:</span> {settings.brevo_sender_name || 'Roni'} &lt;{settings.brevo_sender_email}&gt;</p>
              <p className="text-slate-300"><span className="text-slate-500">To:</span> {settings.report_recipient_name || 'Manager'} &lt;{settings.report_recipient_email}&gt;</p>
            </div>
          )}

          <p className="text-sm font-medium text-slate-300">This email will include:</p>

          <div className="space-y-2">
            <div className={`rounded-xl border p-3 flex items-center gap-3 ${claims.length > 0 ? 'border-red-700/30 bg-red-900/10' : 'border-slate-700/40 bg-slate-700/20'}`}>
              <span className="text-2xl shrink-0">❌</span>
              <div>
                <p className="font-semibold text-slate-100">
                  {claims.length} pending delivery claim{claims.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {claims.length > 0
                    ? `From: ${[...new Set(claims.map(c => c.supplier_name))].join(', ')}`
                    : 'No pending claims — a clean section will show'}
                </p>
              </div>
            </div>

            <div className={`rounded-xl border p-3 flex items-center gap-3 ${expiring.length > 0 ? 'border-orange-700/30 bg-orange-900/10' : 'border-slate-700/40 bg-slate-700/20'}`}>
              <span className="text-2xl shrink-0">⏰</span>
              <div>
                <p className="font-semibold text-slate-100">
                  {expiring.length} item{expiring.length !== 1 ? 's' : ''} expiring within 30 days
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {expired.length > 0 && <span className="text-red-400 font-medium">{expired.length} already expired · </span>}
                  {soonCount > 0 && `${soonCount} expiring soon`}
                  {expiring.length === 0 && 'All items are within safe expiry'}
                </p>
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500 text-center">
            The email is built automatically from live database data and sent via Brevo.
          </p>
        </div>
      )}
    </Modal>
  )
}
