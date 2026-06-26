import { useState, useEffect, useMemo } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  ClipboardX, Plus, Search, X, RefreshCw, CheckCircle2, Mail, Clock,
  FileCheck2, Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input, { Textarea, Select } from '../components/ui/Input'
import { useSort } from '../hooks/useSort'
import { DEPARTMENTS } from '../lib/boatnote'
import { sendIssueReminder } from '../lib/brevo'

const today = () => new Date().toISOString().split('T')[0]
// Status labels surfaced to the user.
const STATUS = {
  pending_req:  { label: 'Pending Req',  badge: 'yellow' },
  req_provided: { label: 'Req Provided', badge: 'green'  },
}
const EMPTY = {
  date: today(), item_id: '', item_name: '', part_number: '', quantity: '',
  unit: 'pcs', destination_location: 'STORE', issued_to: '', note: '', deduct_stock: true,
}

export default function IssueWithoutReq() {
  const [rows, setRows]       = useState([])
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('')          // '' | 'pending_req' | 'req_provided'
  const [search, setSearch]   = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm]       = useState(EMPTY)
  const [saving, setSaving]   = useState(false)
  const [itemSearch, setItemSearch]     = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)
  const [sendingReminder, setSendingReminder] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: r }, { data: i }] = await Promise.all([
      supabase.from('manual_issues').select('*').order('date', { ascending: false }).limit(500),
      selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock').eq('active', true).order('name')),
    ])
    setRows(r || []); setItems(i || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.part_number.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 8)
  const selectItem = (it) => {
    setForm(p => ({ ...p, item_id: it.id, item_name: it.name, part_number: it.part_number, unit: it.unit }))
    setItemSearch(''); setShowItemDrop(false)
  }

  const filtered = useMemo(() => rows.filter(r => {
    if (filter && r.status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(`${r.item_name} ${r.part_number} ${r.destination_location} ${r.issued_to}`.toLowerCase().includes(q))) return false
    }
    return true
  }), [rows, filter, search])
  const { sorted, thProps } = useSort(filtered, 'date', 'desc')

  const counts = useMemo(() => ({
    pending_req:  rows.filter(r => r.status === 'pending_req').length,
    req_provided: rows.filter(r => r.status === 'req_provided').length,
  }), [rows])

  // ── Save a new manual issue ───────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.item_name.trim()) { toast.error('Enter / select an item'); return }
    if (form.quantity === '' || Number(form.quantity) <= 0) { toast.error('Enter a quantity'); return }
    setSaving(true)
    const qty = Number(form.quantity)
    const { error } = await supabase.from('manual_issues').insert({
      date: form.date, item_id: form.item_id || null, item_name: form.item_name,
      part_number: form.part_number || null, quantity: qty, unit: form.unit,
      destination_location: form.destination_location, issued_to: form.issued_to || null,
      issued_by: 'Roni', status: 'pending_req', deduct_stock: !!form.deduct_stock, note: form.note || null,
    })
    if (error) { toast.error(error.message); setSaving(false); return }

    // Optionally reduce inventory + log the movement.
    if (form.deduct_stock && form.item_id) {
      const it = items.find(i => i.id === form.item_id)
      const newStock = Number(it?.current_stock || 0) - qty
      await supabase.from('items').update({ current_stock: newStock }).eq('id', form.item_id)
      await supabase.from('stock_updates').insert({
        item_id: form.item_id, date: form.date, quantity_change: -qty, new_quantity: newStock,
        updated_by: 'Issue (no req)', note: `Issued without requisition → ${form.destination_location}${form.issued_to ? ' · ' + form.issued_to : ''}`,
      }).catch(() => {})
    }
    toast.success('Issue recorded as Pending Req')
    setShowAdd(false); setForm(EMPTY); setItemSearch(''); load(); setSaving(false)
  }

  // ── Mark an issue's requisition as provided ───────────────────────────────
  const markProvided = async (row) => {
    const req = prompt('Enter the requisition number now provided (optional):', row.req_number || '')
    if (req === null) return
    const { error } = await supabase.from('manual_issues').update({
      status: 'req_provided', req_number: req || null, req_provided_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) { toast.error(error.message); return }
    toast.success('Marked as Req Provided'); load()
  }

  const revertPending = async (row) => {
    await supabase.from('manual_issues').update({ status: 'pending_req', req_provided_at: null }).eq('id', row.id)
    toast.success('Reverted to Pending Req'); load()
  }

  const remove = async (row) => {
    if (!confirm(`Delete this entry for ${row.item_name}?`)) return
    await supabase.from('manual_issues').delete().eq('id', row.id)
    toast.success('Deleted'); load()
  }

  // ── Send a reminder email for everything still Pending Req ─────────────────
  const sendReminder = async () => {
    const pending = rows.filter(r => r.status === 'pending_req')
    if (!pending.length) { toast.error('Nothing pending — no reminder needed'); return }
    setSendingReminder(true)
    try {
      const { data: sdata } = await supabase.from('settings').select('key,value')
      const s = (sdata || []).reduce((a, x) => ({ ...a, [x.key]: x.value }), {})
      await sendIssueReminder({
        apiKey: s.brevo_api_key, senderEmail: s.brevo_sender_email,
        senderName: s.brevo_sender_name, recipientEmail: s.report_recipient_email,
        recipientName: s.report_recipient_name, resortName: s.resort_name,
        rows: pending.map(r => ({
          date: r.date, item_name: r.item_name, part_number: r.part_number,
          quantity: r.quantity, unit: r.unit, destination_location: r.destination_location, issued_to: r.issued_to,
        })),
      })
      const nowIso = new Date().toISOString()
      await supabase.from('manual_issues')
        .update({ last_reminder_at: nowIso })
        .in('id', pending.map(r => r.id))
      toast.success(`Reminder sent for ${pending.length} pending item(s)`) ; load()
    } catch (e) { toast.error(e.message) }
    setSendingReminder(false)
  }

  const selItem = items.find(i => i.id === form.item_id)
  const allDest = [...new Set([...DEPARTMENTS, form.destination_location])].filter(Boolean)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Issue Without Requisition</h1>
          <p className="page-sub">Log items issued before a requisition is provided · pending items can be emailed as a reminder</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <Button variant="secondary" onClick={sendReminder} loading={sendingReminder}>
            <Mail className="w-4 h-4" /> Email Pending Reminder
          </Button>
          <Button onClick={() => { setShowAdd(true); setForm(EMPTY); setItemSearch('') }}>
            <Plus className="w-4 h-4" /> New Issue
          </Button>
        </div>
      </div>

      {/* Status summary / filters */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <button onClick={() => setFilter(filter === 'pending_req' ? '' : 'pending_req')}
          className={`card text-left transition-all ${filter === 'pending_req' ? 'ring-2 ring-yellow-500/60' : 'hover:border-slate-600'}`}>
          <div className="flex items-center justify-between"><Clock className="w-5 h-5 text-yellow-400" /><Badge variant="yellow">Pending Req</Badge></div>
          <p className="text-2xl font-bold text-slate-100 mt-2">{counts.pending_req}</p>
          <p className="text-xs text-slate-500">Awaiting a requisition</p>
        </button>
        <button onClick={() => setFilter(filter === 'req_provided' ? '' : 'req_provided')}
          className={`card text-left transition-all ${filter === 'req_provided' ? 'ring-2 ring-green-500/60' : 'hover:border-slate-600'}`}>
          <div className="flex items-center justify-between"><FileCheck2 className="w-5 h-5 text-green-400" /><Badge variant="green">Req Provided</Badge></div>
          <p className="text-2xl font-bold text-slate-100 mt-2">{counts.req_provided}</p>
          <p className="text-xs text-slate-500">Requisition since provided</p>
        </button>
        <div className="card text-left">
          <div className="flex items-center justify-between"><ClipboardX className="w-5 h-5 text-[#00AEEF]" /><Badge variant="blue">Total</Badge></div>
          <p className="text-2xl font-bold text-slate-100 mt-2">{rows.length}</p>
          <p className="text-xs text-slate-500">All issues logged</p>
        </div>
      </div>

      {/* Search */}
      <div className="card py-3 px-4 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input text-sm pl-9" placeholder="Search item, code, destination…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {filter && <button onClick={() => setFilter('')} className="btn-ghost btn-sm">Clear: {STATUS[filter].label} ✕</button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <Table>
            <Thead><tr>
              <Th {...thProps('date')}>Date</Th>
              <Th {...thProps('part_number')}>Code</Th>
              <Th {...thProps('item_name')}>Item</Th>
              <Th {...thProps('quantity')}>Qty</Th>
              <Th {...thProps('destination_location')}>Destination</Th>
              <Th {...thProps('issued_to')}>Taken By</Th>
              <Th {...thProps('req_number')}>Req #</Th>
              <Th {...thProps('status')}>Status</Th>
              <Th>Action</Th>
            </tr></Thead>
            <Tbody>
              {sorted.length === 0 ? (
                <Tr><Td colSpan={9} className="text-center text-slate-500 py-12">No issues logged yet</Td></Tr>
              ) : sorted.map(r => (
                <Tr key={r.id} className={r.status === 'pending_req' ? 'bg-yellow-900/5' : ''}>
                  <Td className="text-slate-300 text-xs whitespace-nowrap">{r.date}</Td>
                  <Td className="font-mono text-xs text-[#00AEEF]">{r.part_number || '—'}</Td>
                  <Td className="font-medium text-slate-100">{r.item_name}</Td>
                  <Td className="text-slate-200">{r.quantity} <span className="text-slate-500 text-xs">{r.unit}</span></Td>
                  <Td><Badge variant={r.destination_location === 'ALLOWANCE' ? 'purple' : 'blue'}>{r.destination_location || '—'}</Badge></Td>
                  <Td className="text-slate-400 text-xs">{r.issued_to || '—'}</Td>
                  <Td className="text-slate-400 text-xs font-mono">{r.req_number || '—'}</Td>
                  <Td><Badge variant={STATUS[r.status]?.badge || 'gray'}>{STATUS[r.status]?.label || r.status}</Badge></Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {r.status === 'pending_req' ? (
                        <button onClick={() => markProvided(r)}
                          className="flex items-center gap-1 text-xs font-medium text-green-400 hover:text-green-300 bg-green-900/20 hover:bg-green-900/40 px-2.5 py-1.5 rounded-lg transition-colors">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Mark Provided
                        </button>
                      ) : (
                        <button onClick={() => revertPending(r)} className="text-xs text-slate-400 hover:text-yellow-300 px-2 py-1.5">Revert</button>
                      )}
                      <button onClick={() => remove(r)} className="p-1 text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <Modal isOpen onClose={() => setShowAdd(false)} title="Issue Without Requisition" size="md"
          footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save Issue</Button></>}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Date *" type="date" value={form.date} onChange={f('date')} />
              <Select label="Destination Location *" value={form.destination_location} onChange={f('destination_location')}>
                {allDest.map(d => <option key={d} value={d}>{d}</option>)}
              </Select>
            </div>

            {/* Item search / manual entry */}
            <div className="relative">
              <label className="block text-sm font-medium text-slate-300 mb-1">Item *</label>
              {selItem ? (
                <div className="input bg-slate-700/50 flex items-center gap-2">
                  <span className="font-mono text-xs text-[#00AEEF]">{selItem.part_number}</span>
                  <span className="flex-1 text-slate-100">{selItem.name}</span>
                  <span className="text-slate-400 text-xs">Stock: {selItem.current_stock} {selItem.unit}</span>
                  <button onClick={() => setForm(p => ({ ...p, item_id: '', item_name: '', part_number: '' }))}><X className="w-4 h-4 text-slate-400" /></button>
                </div>
              ) : (
                <input className="input text-sm" placeholder="Search inventory or type a new item name…"
                  value={itemSearch || form.item_name}
                  onChange={e => { setItemSearch(e.target.value); setForm(p => ({ ...p, item_name: e.target.value })); setShowItemDrop(true) }}
                  onFocus={() => setShowItemDrop(true)} />
              )}
              {showItemDrop && !selItem && itemSearch && filteredItems.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {filteredItems.map(item => (
                    <button key={item.id} onClick={() => selectItem(item)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-700 text-left text-sm">
                      <span className="font-mono text-xs text-[#00AEEF] w-20 shrink-0">{item.part_number}</span>
                      <span className="flex-1 text-slate-200 truncate">{item.name}</span>
                      <span className="text-slate-400 text-xs">{item.current_stock} {item.unit}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-1">Pick from inventory (stock can be deducted) or type a name for an unlisted item.</p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <Input label="Code Number" value={form.part_number} onChange={f('part_number')} placeholder="Item code" />
              <Input label="Quantity *" type="number" min="0" step="0.01" value={form.quantity} onChange={f('quantity')} />
              <Input label="Unit" value={form.unit} onChange={f('unit')} />
            </div>

            <Input label="Taken By (e.g. Sir / name)" value={form.issued_to} onChange={f('issued_to')} placeholder="Who received the items" />

            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={form.deduct_stock} onChange={e => setForm(p => ({ ...p, deduct_stock: e.target.checked }))} className="accent-teal-500 w-4 h-4" />
              Deduct from inventory now <span className="text-slate-500">(only applies to matched items)</span>
            </label>

            <Textarea label="Note" value={form.note} onChange={f('note')} rows={2} placeholder="Reason / context" />
          </div>
        </Modal>
      )}
    </div>
  )
}
