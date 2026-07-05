import { useState, useEffect, useMemo } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  ClipboardX, Plus, Search, X, RefreshCw, CheckCircle2, Mail, Clock,
  FileCheck2, Trash2, Copy, ChefHat,
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
const KITCHENS = ['MAIN KITCHEN', 'STAFF KITCHEN']

// One blank item line for the "add multiple items" form.
const emptyLine = () => ({
  _key: Math.random().toString(36).slice(2),
  item_id: '', item_name: '', part_number: '', quantity: '', unit: 'pcs', deduct_stock: true,
})
const EMPTY_HEADER = {
  date: today(), destination_location: 'STORE', issued_to: '', note: '',
}

// Best-effort push to the "instant issued without req" Edge Function.
// Silently no-ops if the function isn't deployed yet — Realtime + the
// mobile app's own subscription still delivers the in-app alert.
async function notifyIssuedWithoutReq(batchId) {
  try {
    await supabase.functions.invoke('send-issue-reminders', { body: { mode: 'issued', batch_id: batchId } })
  } catch { /* function not deployed yet — safe to ignore */ }
}

export default function IssueWithoutReq() {
  const [rows, setRows]       = useState([])
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('')          // '' | 'pending_req' | 'req_provided'
  const [search, setSearch]   = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [header, setHeader]   = useState(EMPTY_HEADER)
  const [lines, setLines]     = useState([emptyLine()])
  const [saving, setSaving]   = useState(false)
  const [itemSearchFor, setItemSearchFor] = useState(null) // _key of line whose dropdown is open
  const [itemSearch, setItemSearch]       = useState('')
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

  // ── Header + line-item helpers ────────────────────────────────────────
  const h = k => e => setHeader(p => ({ ...p, [k]: e.target.value }))
  const setLine = (key, patch) => setLines(ls => ls.map(l => (l._key === key ? { ...l, ...patch } : l)))
  const addLine = () => setLines(ls => [...ls, emptyLine()])
  const removeLine = (key) => setLines(ls => (ls.length > 1 ? ls.filter(l => l._key !== key) : ls))
  const duplicateLine = (key) => setLines(ls => {
    const idx = ls.findIndex(l => l._key === key)
    if (idx === -1) return ls
    const copy = { ...ls[idx], _key: Math.random().toString(36).slice(2) }
    return [...ls.slice(0, idx + 1), copy, ...ls.slice(idx + 1)]
  })

  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    (i.part_number || '').toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 8)
  const selectItemForLine = (key, it) => {
    setLine(key, { item_id: it.id, item_name: it.name, part_number: it.part_number, unit: it.unit })
    setItemSearch(''); setItemSearchFor(null)
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
    pending_main:  rows.filter(r => r.status === 'pending_req' && r.destination_location === 'MAIN KITCHEN').length,
    pending_staff: rows.filter(r => r.status === 'pending_req' && r.destination_location === 'STAFF KITCHEN').length,
  }), [rows])

  // ── Save the whole batch (one date's issuance, one or more items) ─────
  const handleSave = async () => {
    const clean = lines
      .map(l => ({ ...l, item_name: l.item_name.trim(), quantity: Number(l.quantity) }))
      .filter(l => l.item_name || l.quantity)
    if (!clean.length) { toast.error('Add at least one item'); return }
    for (const l of clean) {
      if (!l.item_name) { toast.error('Every line needs an item'); return }
      if (!l.quantity || l.quantity <= 0) { toast.error(`Enter a quantity for ${l.item_name}`); return }
    }

    setSaving(true)
    const batchId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
    const payload = clean.map(l => ({
      date: header.date, item_id: l.item_id || null, item_name: l.item_name,
      part_number: l.part_number || null, quantity: l.quantity, unit: l.unit,
      destination_location: header.destination_location, issued_to: header.issued_to || null,
      issued_by: 'Roni', status: 'pending_req', deduct_stock: !!l.deduct_stock, note: header.note || null,
      batch_id: batchId,
    }))

    const { error } = await supabase.from('manual_issues').insert(payload)
    if (error) { toast.error(error.message); setSaving(false); return }

    // Optionally reduce inventory + log the movement, per matched item.
    for (const l of clean) {
      if (l.deduct_stock && l.item_id) {
        const it = items.find(i => i.id === l.item_id)
        const newStock = Number(it?.current_stock || 0) - l.quantity
        await supabase.from('items').update({ current_stock: newStock }).eq('id', l.item_id)
        await supabase.from('stock_updates').insert({
          item_id: l.item_id, date: header.date, quantity_change: -l.quantity, new_quantity: newStock,
          updated_by: 'Issue (no req)', note: `Issued without requisition → ${header.destination_location}${header.issued_to ? ' · ' + header.issued_to : ''}`,
        }).catch(() => {})
      }
    }

    // Fire the "issued without req" alert — mobile users get it instantly
    // via Realtime; this also nudges the (optional) push Edge Function.
    notifyIssuedWithoutReq(batchId)

    toast.success(`${clean.length} item${clean.length > 1 ? 's' : ''} recorded as Pending Req`)
    setShowAdd(false); setHeader(EMPTY_HEADER); setLines([emptyLine()]); setItemSearch(''); setItemSearchFor(null)
    load(); setSaving(false)
  }

  // ── Mark an issue's requisition as provided ─────────────────────────
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

  // ── Send a reminder email for everything still Pending Req ─────────────
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

  const allDest = [...new Set([...DEPARTMENTS, header.destination_location])].filter(Boolean)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Issue Without Requisition</h1>
          <p className="page-sub">
            Log items issued before a requisition is provided · add multiple items to one date's issuance ·
            Main Kitchen is reminded next day before 8:30am, Staff Kitchen before 10:30am, on the mobile app
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <Button variant="secondary" onClick={sendReminder} loading={sendingReminder}>
            <Mail className="w-4 h-4" /> Email Pending Reminder
          </Button>
          <Button onClick={() => { setShowAdd(true); setHeader(EMPTY_HEADER); setLines([emptyLine()]); setItemSearch(''); setItemSearchFor(null) }}>
            <Plus className="w-4 h-4" /> New Issue
          </Button>
        </div>
      </div>

      {/* Status summary / filters */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
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
          <div className="flex items-center justify-between"><ChefHat className="w-5 h-5 text-orange-400" /><Badge variant="orange">Main Kitchen</Badge></div>
          <p className="text-2xl font-bold text-slate-100 mt-2">{counts.pending_main}</p>
          <p className="text-xs text-slate-500">Pending · reminded before 8:30am</p>
        </div>
        <div className="card text-left">
          <div className="flex items-center justify-between"><ChefHat className="w-5 h-5 text-purple-400" /><Badge variant="purple">Staff Kitchen</Badge></div>
          <p className="text-2xl font-bold text-slate-100 mt-2">{counts.pending_staff}</p>
          <p className="text-xs text-slate-500">Pending · reminded before 10:30am</p>
        </div>
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
                  <Td><Badge variant={r.destination_location === 'ALLOWANCE' ? 'purple' : (KITCHENS.includes(r.destination_location) ? 'orange' : 'blue')}>{r.destination_location || '—'}</Badge></Td>
                  <Td className="text-slate-400 text-xs">{r.issued_to || '—'}</Td>
                  <Td className="text-slate-400 text-xs font-mono">{r.req_number || '—'}</Td>
                  <Td><Badge variant={STATUS[r.status]?.badge}>{STATUS[r.status]?.label}</Badge></Td>
                  <Td>
                    <div className="flex gap-1.5">
                      {r.status === 'pending_req' ? (
                        <button onClick={() => markProvided(r)} className="btn-ghost btn-xs" title="Mark Req Provided"><CheckCircle2 className="w-4 h-4 text-green-400" /></button>
                      ) : (
                        <button onClick={() => revertPending(r)} className="btn-ghost btn-xs" title="Revert to Pending"><Clock className="w-4 h-4 text-yellow-400" /></button>
                      )}
                      <button onClick={() => remove(r)} className="btn-ghost btn-xs" title="Delete"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}

      {/* Add modal — one date's issuance, multiple items */}
      {showAdd && (
        <Modal isOpen title="New Issue Without Requisition" onClose={() => setShowAdd(false)} size="lg"
          footer={(
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save {lines.length > 1 ? `${lines.length} Items` : 'Issue'}</Button>
            </div>
          )}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="Date" type="date" value={header.date} onChange={h('date')} />
              <Select label="Destination" value={header.destination_location} onChange={h('destination_location')}>
                {allDest.map(d => <option key={d} value={d}>{d}</option>)}
              </Select>
              <Input label="Taken By (e.g. Sir / name)" value={header.issued_to} onChange={h('issued_to')} placeholder="Who received the items" />
            </div>
            {KITCHENS.includes(header.destination_location) && (
              <p className="text-xs text-orange-300 bg-orange-900/20 border border-orange-800/40 rounded-lg px-3 py-2">
                <ChefHat className="w-3.5 h-3.5 inline mr-1" />
                {header.destination_location === 'MAIN KITCHEN'
                  ? 'The mobile app will remind Main Kitchen tomorrow before 8:30am if this is still pending.'
                  : 'The mobile app will remind Staff Kitchen tomorrow before 10:30am if this is still pending.'}
              </p>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-300">Items for this date's issuance</label>
                <button onClick={addLine} className="btn-ghost btn-sm text-teal-400"><Plus className="w-3.5 h-3.5" /> Add item</button>
              </div>

              {lines.map((line, idx) => {
                const dropdownOpen = itemSearchFor === line._key
                const opts = dropdownOpen ? filteredItems : []
                return (
                  <div key={line._key} className="border border-slate-700 rounded-xl p-3 space-y-2 bg-slate-900/40">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">Item {idx + 1}</span>
                      <div className="flex gap-1">
                        <button onClick={() => duplicateLine(line._key)} className="btn-ghost btn-xs" title="Duplicate"><Copy className="w-3.5 h-3.5" /></button>
                        {lines.length > 1 && (
                          <button onClick={() => removeLine(line._key)} className="btn-ghost btn-xs" title="Remove"><X className="w-3.5 h-3.5 text-red-400" /></button>
                        )}
                      </div>
                    </div>

                    <div className="relative">
                      <Input
                        label="Item"
                        value={dropdownOpen ? itemSearch : line.item_name}
                        onChange={e => { setItemSearch(e.target.value); setItemSearchFor(line._key); setLine(line._key, { item_name: e.target.value, item_id: '' }) }}
                        onFocus={() => { setItemSearchFor(line._key); setItemSearch(line.item_name) }}
                        placeholder="Search inventory or type a free-text item…"
                      />
                      {dropdownOpen && opts.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                          {opts.map(it => (
                            <button key={it.id} onClick={() => selectItemForLine(line._key, it)}
                              className="w-full text-left px-3 py-2 hover:bg-slate-700 text-sm text-slate-200 flex justify-between">
                              <span>{it.name}</span>
                              <span className="text-slate-500 text-xs font-mono">{it.part_number}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Input label="Quantity" type="number" value={line.quantity} onChange={e => setLine(line._key, { quantity: e.target.value })} />
                      <Input label="Unit" value={line.unit} onChange={e => setLine(line._key, { unit: e.target.value })} />
                    </div>

                    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={line.deduct_stock} onChange={e => setLine(line._key, { deduct_stock: e.target.checked })} className="accent-teal-500 w-4 h-4" />
                      Deduct from inventory now <span className="text-slate-500">(only applies to matched items)</span>
                    </label>
                  </div>
                )
              })}
            </div>

            <Textarea label="Note (applies to the whole issuance)" value={header.note} onChange={h('note')} rows={2} placeholder="Reason / context" />
          </div>
        </Modal>
      )}
    </div>
  )
}
