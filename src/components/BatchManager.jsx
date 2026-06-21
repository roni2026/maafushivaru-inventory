import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Layers, Plus, Trash2, CalendarClock } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from './ui/Badge'

function daysUntil(d) {
  if (!d) return null
  const e = new Date(d); e.setHours(0, 0, 0, 0)
  const n = new Date(); n.setHours(0, 0, 0, 0)
  return Math.ceil((e - n) / 86400000)
}
function badge(days) {
  if (days === null) return <Badge variant="gray">No date</Badge>
  if (days < 0)      return <Badge variant="red">Expired {Math.abs(days)}d</Badge>
  if (days <= 7)     return <Badge variant="red">{days}d</Badge>
  if (days <= 15)    return <Badge variant="orange">{days}d</Badge>
  if (days <= 30)    return <Badge variant="yellow">{days}d</Badge>
  if (days <= 60)    return <Badge variant="blue">{days}d</Badge>
  return                    <Badge variant="green">{days}d</Badge>
}

const EMPTY = { expiry_date: '', quantity: '', batch_code: '', note: '' }

// Manage multiple expiry dates (batches) — each with its own quantity — for one item.
export default function BatchManager({ itemId, unit = 'pcs' }) {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('item_batches').select('*').eq('item_id', itemId)
      .order('expiry_date', { ascending: true, nullsFirst: false })
    if (!error) setBatches(data || [])
    setLoading(false)
  }, [itemId])

  useEffect(() => { load() }, [load])

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  const addBatch = async () => {
    if (!form.expiry_date) { toast.error('Pick an expiry date'); return }
    if (form.quantity === '' || Number(form.quantity) < 0) { toast.error('Enter a quantity'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('item_batches').insert({
        item_id: itemId,
        expiry_date: form.expiry_date,
        quantity: Number(form.quantity),
        batch_code: form.batch_code || null,
        note: form.note || null,
      })
      if (error) throw error
      toast.success('Batch added')
      setForm(EMPTY)
      load()
    } catch (err) { toast.error(err.message) }
    setSaving(false)
  }

  const updateQty = async (id, quantity) => {
    const q = Number(quantity)
    setBatches(prev => prev.map(b => b.id === id ? { ...b, quantity: q } : b))
    const { error } = await supabase.from('item_batches').update({ quantity: q }).eq('id', id)
    if (error) toast.error(error.message)
  }

  const delBatch = async (id) => {
    const { error } = await supabase.from('item_batches').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setBatches(prev => prev.filter(b => b.id !== id))
    toast.success('Batch removed')
  }

  const total = batches.reduce((s, b) => s + Number(b.quantity || 0), 0)

  return (
    <div className="card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
          <Layers className="w-4 h-4 text-teal-400" /> Expiry Batches
        </h2>
        {batches.length > 0 && (
          <span className="text-xs text-slate-400">Total across batches: <strong className="text-teal-300">{total} {unit}</strong></span>
        )}
      </div>
      <p className="text-slate-500 text-xs mb-4">Track the same item under several expiry dates, each with its own quantity.</p>

      {/* Add form */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        <div className="col-span-1">
          <label className="block text-[11px] text-slate-500 mb-1">Expiry date *</label>
          <input type="date" className="input text-sm py-1.5" value={form.expiry_date} onChange={f('expiry_date')} />
        </div>
        <div className="col-span-1">
          <label className="block text-[11px] text-slate-500 mb-1">Quantity *</label>
          <input type="number" min="0" step="0.01" className="input text-sm py-1.5" value={form.quantity} onChange={f('quantity')} placeholder="0" />
        </div>
        <div className="col-span-1">
          <label className="block text-[11px] text-slate-500 mb-1">Batch code</label>
          <input className="input text-sm py-1.5" value={form.batch_code} onChange={f('batch_code')} placeholder="optional" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-[11px] text-slate-500 mb-1">Note</label>
          <input className="input text-sm py-1.5" value={form.note} onChange={f('note')} placeholder="optional" />
        </div>
        <div className="col-span-2 sm:col-span-1 flex items-end">
          <button onClick={addBatch} disabled={saving}
            className="btn-secondary btn-sm w-full justify-center disabled:opacity-50">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-slate-500 text-sm text-center py-4">Loading batches…</p>
      ) : batches.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-sm">
          <CalendarClock className="w-7 h-7 mx-auto mb-2 text-slate-600" />
          No batches yet — add one above to track multiple expiry dates.
        </div>
      ) : (
        <div className="space-y-1.5">
          {batches.map(b => {
            const d = daysUntil(b.expiry_date)
            return (
              <div key={b.id} className="flex items-center gap-2 bg-slate-700/30 rounded-lg px-3 py-2 flex-wrap">
                <span className="text-sm text-slate-200 font-medium w-28 shrink-0">{b.expiry_date || '—'}</span>
                {badge(d)}
                {b.batch_code && <span className="text-xs font-mono text-slate-500">#{b.batch_code}</span>}
                <div className="flex-1" />
                <div className="flex items-center gap-1.5">
                  <input type="number" min="0" step="0.01" value={b.quantity}
                    onChange={e => updateQty(b.id, e.target.value)}
                    className="input text-sm py-1 w-24 text-teal-300 font-semibold" />
                  <span className="text-xs text-slate-500 w-8">{unit}</span>
                  <button onClick={() => delBatch(b.id)} className="p-1.5 text-slate-500 hover:text-red-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {b.note && <p className="w-full text-xs text-slate-500 mt-0.5">{b.note}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
