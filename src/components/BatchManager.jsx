import { useState, useEffect, useCallback } from 'react'
import { Layers, Plus, Trash2, Pencil, X, Check, CalendarClock, AlertTriangle, FlaskConical } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from './ui/Badge'
import { addStockBatches, fetchItemBatches, upsertItemBatch, deleteItemBatch, wasteFromBatch } from '../lib/batchStock'
import { daysUntil, batchStatus, expiryBadgeVariant } from '../lib/expiry'

function badge(days) {
  if (days === null) return <Badge variant="gray">No date</Badge>
  const variant = expiryBadgeVariant(days)
  const label = days === null ? 'No date' : days < 0 ? `Expired ${Math.abs(days)}d ago` : `${days}d left`
  return <Badge variant={variant}>{label}</Badge>
}

function statusBadge(status) {
  const variant = status === 'Expired' ? 'red' : status === 'Expiring Soon' ? 'orange' : 'green'
  return <Badge variant={variant}>{status}</Badge>
}

const EMPTY = { expiry_date: '', quantity: '', batch_code: '', note: '' }

// Full Batch Expiry management for one item — the SAME feature and the
// SAME data (item_batches, via shared RPCs) used by the Android app.
// Add / Edit / Delete batches here. Quantity, Remaining Quantity, Expiry
// and Status are always shown so nothing needs the old single-expiry field.
export default function BatchManager({ itemId, unit = 'pcs', item, onStockChanged }) {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY)
  const [wastingId, setWastingId] = useState(null)
  const [wasteQty, setWasteQty] = useState('')
  const [wasteReason, setWasteReason] = useState('Expired')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setBatches(await fetchItemBatches(itemId))
    } catch (err) { toast.error(err.message) }
    setLoading(false)
  }, [itemId])

  useEffect(() => { load() }, [load])

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  const addBatch = async () => {
    if (!form.expiry_date) { toast.error('Pick an expiry date'); return }
    if (form.quantity === '' || Number(form.quantity) <= 0) { toast.error('Enter a quantity'); return }
    setSaving(true)
    try {
      const result = await addStockBatches(item || { id: itemId, current_stock: 0 }, [{
        quantity: Number(form.quantity),
        expiry_date: form.expiry_date,
        batch_code: form.batch_code,
        note: form.note,
      }])
      if (result.wastedBatches > 0) {
        toast.error(`Already expired — ${result.wastedQty} ${unit} moved to Waste Log instead of inventory`)
      } else {
        toast.success(`Added ${result.addedQty} ${unit} to stock`)
      }
      setForm(EMPTY)
      await load()
      onStockChanged?.()
    } catch (err) { toast.error(err.message) }
    setSaving(false)
  }

  const startEdit = (b) => {
    setEditingId(b.id)
    setEditForm({ expiry_date: b.expiry_date || '', quantity: String(b.quantity), batch_code: b.batch_code || '', note: b.note || '' })
  }
  const cancelEdit = () => { setEditingId(null); setEditForm(EMPTY) }

  const saveEdit = async (b) => {
    if (editForm.quantity === '' || Number(editForm.quantity) < 0) { toast.error('Enter a valid quantity'); return }
    setSaving(true)
    try {
      await upsertItemBatch({
        batchId: b.id,
        itemId,
        expiryDate: editForm.expiry_date || null,
        quantity: Number(editForm.quantity),
        batchCode: editForm.batch_code,
        note: editForm.note,
      })
      toast.success('Batch updated — inventory synced')
      cancelEdit()
      await load()
      onStockChanged?.()
    } catch (err) { toast.error(err.message) }
    setSaving(false)
  }

  const delBatch = async (id) => {
    if (!window.confirm('Delete this batch? Inventory quantity will update automatically.')) return
    try {
      await deleteItemBatch(id)
      setBatches(prev => prev.filter(b => b.id !== id))
      toast.success('Batch removed — inventory synced')
      onStockChanged?.()
    } catch (err) { toast.error(err.message) }
  }

  // Deduct a specific quantity from THIS batch only (never touches any
  // other batch) -- e.g. spoilage/damage found in one particular batch, or
  // a manual correction, without affecting batches with a different expiry.
  const startWaste = (b) => { setWastingId(b.id); setWasteQty(''); setWasteReason('Expired') }
  const cancelWaste = () => { setWastingId(null); setWasteQty('') }

  const confirmWaste = async (b) => {
    const qty = Number(wasteQty)
    const remaining = Number(b.remaining_quantity ?? b.quantity ?? 0)
    if (!qty || qty <= 0) { toast.error('Enter a valid quantity'); return }
    if (qty > remaining) { toast.error(`Only ${remaining} ${unit} remaining in this batch`); return }
    setSaving(true)
    try {
      await wasteFromBatch({ item: item || { id: itemId }, batch: b, quantity: qty, reason: wasteReason })
      toast.success(`Wasted ${qty} ${unit} from this batch — inventory synced`)
      cancelWaste()
      await load()
      onStockChanged?.()
    } catch (err) { toast.error(err.message) }
    setSaving(false)
  }

  const totalRemaining = batches.reduce((s, b) => s + Number(b.remaining_quantity ?? b.quantity ?? 0), 0)

  return (
    <div className="card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
          <Layers className="w-4 h-4 text-teal-400" /> Batch Expiry
        </h2>
        {batches.length > 0 && (
          <span className="text-xs text-slate-400">Inventory = SUM(remaining): <strong className="text-teal-300">{totalRemaining} {unit}</strong></span>
        )}
      </div>
      <p className="text-slate-500 text-xs mb-1">Every batch of stock with its own expiry date. Inventory quantity always equals the sum of remaining batch quantities — add, edit or delete a batch and stock updates instantly.</p>
      <p className="text-amber-400/80 text-xs mb-4 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3 shrink-0" /> A batch dated in the past is sent straight to the Waste Log and is not added to inventory.
      </p>

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
            <Plus className="w-4 h-4" /> Add Batch
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-slate-500 text-sm text-center py-4">Loading batches…</p>
      ) : batches.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-sm">
          <CalendarClock className="w-7 h-7 mx-auto mb-2 text-slate-600" />
          No batches yet — add one above to track stock with an expiry date.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-slate-500 uppercase">
                <th className="py-1.5 pr-2">Expiry</th>
                <th className="py-1.5 pr-2">Days Left</th>
                <th className="py-1.5 pr-2">Status</th>
                <th className="py-1.5 pr-2">Quantity</th>
                <th className="py-1.5 pr-2">Remaining</th>
                <th className="py-1.5 pr-2">Batch Code</th>
                <th className="py-1.5 pr-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map(b => {
                const d = daysUntil(b.expiry_date)
                const status = batchStatus(d)
                const isEditing = editingId === b.id
                const isWasting = wastingId === b.id
                return (
                  <tr key={b.id} className="border-t border-slate-700/40">
                    {isWasting ? (
                      <>
                        <td className="py-1.5 pr-2 text-slate-200 font-medium">{b.expiry_date || '—'}</td>
                        <td className="py-1.5 pr-2">{badge(d)}</td>
                        <td className="py-1.5 pr-2">{statusBadge(status)}</td>
                        <td className="py-1.5 pr-2 text-slate-300">{Number(b.quantity)} {unit}</td>
                        <td className="py-1.5 pr-2">
                          <input type="number" min="0.01" max={Number(b.remaining_quantity ?? b.quantity)} step="0.01"
                            className="input text-sm py-1 w-20" placeholder={`≤ ${Number(b.remaining_quantity ?? b.quantity)}`}
                            value={wasteQty} onChange={e => setWasteQty(e.target.value)} autoFocus />
                        </td>
                        <td className="py-1.5 pr-2">
                          <select className="input text-sm py-1" value={wasteReason} onChange={e => setWasteReason(e.target.value)}>
                            <option>Expired</option><option>Damaged</option><option>Contamination</option><option>Over-Production</option><option>Other</option>
                          </select>
                        </td>
                        <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                          <button onClick={() => confirmWaste(b)} disabled={saving} title="Confirm waste" className="p-1.5 text-red-400 hover:text-red-300"><Check className="w-4 h-4" /></button>
                          <button onClick={cancelWaste} className="p-1.5 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                        </td>
                      </>
                    ) : isEditing ? (
                      <>
                        <td className="py-1.5 pr-2"><input type="date" className="input text-sm py-1 w-36" value={editForm.expiry_date} onChange={e => setEditForm(p => ({ ...p, expiry_date: e.target.value }))} /></td>
                        <td className="py-1.5 pr-2 text-slate-500">—</td>
                        <td className="py-1.5 pr-2">—</td>
                        <td className="py-1.5 pr-2"><input type="number" min="0" step="0.01" className="input text-sm py-1 w-24" value={editForm.quantity} onChange={e => setEditForm(p => ({ ...p, quantity: e.target.value }))} /></td>
                        <td className="py-1.5 pr-2 text-slate-500">{b.remaining_quantity ?? b.quantity}</td>
                        <td className="py-1.5 pr-2"><input className="input text-sm py-1 w-24" value={editForm.batch_code} onChange={e => setEditForm(p => ({ ...p, batch_code: e.target.value }))} /></td>
                        <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                          <button onClick={() => saveEdit(b)} disabled={saving} className="p-1.5 text-emerald-400 hover:text-emerald-300"><Check className="w-4 h-4" /></button>
                          <button onClick={cancelEdit} className="p-1.5 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-1.5 pr-2 text-slate-200 font-medium">{b.expiry_date || '—'}</td>
                        <td className="py-1.5 pr-2">{badge(d)}</td>
                        <td className="py-1.5 pr-2">{statusBadge(status)}</td>
                        <td className="py-1.5 pr-2 text-slate-300">{Number(b.quantity)} {unit}</td>
                        <td className="py-1.5 pr-2 text-teal-300 font-semibold">{Number(b.remaining_quantity ?? b.quantity)} {unit}</td>
                        <td className="py-1.5 pr-2 text-xs font-mono text-slate-500">{b.batch_code || '—'}</td>
                        <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                          <button onClick={() => startWaste(b)} title="Waste from this batch" className="p-1.5 text-slate-500 hover:text-orange-400 transition-colors"><FlaskConical className="w-4 h-4" /></button>
                          <button onClick={() => startEdit(b)} className="p-1.5 text-slate-500 hover:text-teal-300 transition-colors"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => delBatch(b.id)} className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
