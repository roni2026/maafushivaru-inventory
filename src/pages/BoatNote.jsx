import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, selectAll, chunkedWrite } from '../lib/supabase'
import {
  Ship, Upload, Loader, Plus, Trash2, CheckCircle2, ChevronLeft, X,
  FileSpreadsheet, History as HistoryIcon, Search, RefreshCw, AlertTriangle,
  PackageCheck, CalendarDays, ChevronDown, ChevronRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Input, { Select } from '../components/ui/Input'
import { parseBoatNoteFile, classifyOrigin } from '../lib/boatnote'

const today = () => new Date().toISOString().split('T')[0]
const cleanCode = (s) => String(s || '').replace(/^0+/, '') || ''

// ── Stages of the verify flow ───────────────────────────────────────
const STAGE = { UPLOAD: 'upload', EDIT: 'edit', CONFIRM: 'confirm', DONE: 'done' }

export default function BoatNote() {
  const [tab, setTab] = useState('verify')   // 'verify' | 'history'
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Boat Note Receiving</h1>
          <p className="page-sub">Upload &amp; verify incoming supplies, then post to inventory by department</p>
        </div>
        <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-xl p-1">
          <button onClick={() => setTab('verify')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'verify' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <Ship className="w-4 h-4 inline mr-1.5" />Verify
          </button>
          <button onClick={() => setTab('history')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'history' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <HistoryIcon className="w-4 h-4 inline mr-1.5" />History
          </button>
        </div>
      </div>
      {tab === 'verify' ? <VerifyFlow onPosted={() => setTab('history')} /> : <BoatNoteHistory />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
function VerifyFlow({ onPosted }) {
  const [stage, setStage]   = useState(STAGE.UPLOAD)
  const [busy, setBusy]     = useState(false)
  const [rows, setRows]     = useState([])          // editable boat-note rows
  const [items, setItems]   = useState([])          // inventory (for matching)
  const [meta, setMeta]     = useState({ label: '', note_date: today(), source_file: '', received_by: 'Roni' })
  const [pickedDepts, setPickedDepts] = useState({})
  const fileRef = useRef(null)

  // load inventory once for matching
  useEffect(() => {
    selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock,expiry_date,origin').eq('active', true))
      .then(({ data }) => setItems(data || []))
  }, [])
  const byCode = useMemo(() => {
    const m = new Map(); for (const it of items) m.set(cleanCode(it.part_number), it); return m
  }, [items])

  const enrich = (r) => {
    const match = byCode.get(cleanCode(r.part_number))
    return { ...r, item_id: match?.id || null, matched: !!match,
      matched_name: match?.name || '', matched_unit: match?.unit || r.unit }
  }

  // ── Upload + parse ──────────────────────────────────────────────────
  const handleFile = async (fileList) => {
    const file = fileList?.[0]; if (!file) return
    setBusy(true)
    try {
      const { items: parsed, depts, noteDate } = await parseBoatNoteFile(file)
      if (!parsed.length) { toast.error('No item rows found in that file'); setBusy(false); return }
      const rid = () => Math.random().toString(36).slice(2)
      setRows(parsed.map(p => enrich({ ...p, id: rid(), received_qty: p.ordered_qty })))
      setMeta(m => ({ ...m, label: file.name.replace(/\.[^.]+$/, ''), source_file: file.name, note_date: noteDate || today() }))
      const dp = {}; depts.forEach(d => { dp[d] = d === 'STORE' }); setPickedDepts(dp)
      setStage(STAGE.EDIT)
      toast.success(`Parsed ${parsed.length} items across ${depts.length} departments`)
    } catch (e) { toast.error(e.message) }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Row editing ────────────────────────────────────────────────────
  const editRow = (id, field, val) => setRows(prev => prev.map(r => {
    if (r.id !== id) return r
    const u = { ...r, [field]: val }
    return field === 'part_number' ? enrich(u) : u
  }))
  const addRow = () => setRows(prev => [...prev, enrich({
    id: Math.random().toString(36).slice(2), line_no: prev.length + 1, supplier: '', po_number: '',
    part_number: '', product_name: '', unit: 'EA', ordered_qty: 0, received_qty: 0, expiry_date: '',
    department: Object.keys(pickedDepts)[0] || 'STORE',
  })])
  const delRow = (id) => setRows(prev => prev.filter(r => r.id !== id))

  const allDepts = useMemo(() => [...new Set(rows.map(r => r.department).filter(Boolean))].sort(), [rows])
  const toggleDept = (d) => setPickedDepts(p => ({ ...p, [d]: !p[d] }))

  // rows belonging to the ticked departments → the ones we'll post
  const selectedRows = useMemo(() =>
    rows.filter(r => pickedDepts[r.department]), [rows, pickedDepts])

  const goConfirm = () => {
    if (!selectedRows.length) { toast.error('Tick at least one department with items'); return }
    setStage(STAGE.CONFIRM)
  }

  // ── Post to inventory ─────────────────────────────────────────────
  const postToInventory = async () => {
    setBusy(true)
    try {
      // 1. create boat_note header
      const postedDepts = allDepts.filter(d => pickedDepts[d])
      const { data: note, error: noteErr } = await supabase.from('boat_notes').insert({
        note_date: meta.note_date, label: meta.label,
        delivery_day: new Date(meta.note_date).toLocaleDateString('en-US', { weekday: 'long' }),
        status: 'posted', source_file: meta.source_file, departments: postedDepts,
        total_items: rows.length, posted_items: selectedRows.length, created_by: meta.received_by,
      }).select().single()
      if (noteErr) throw noteErr

      // 2. save EVERY parsed row to boat_note_items (history keeps the full note)
      const selSet = new Set(selectedRows.map(r => r.id))
      await chunkedWrite('boat_note_items', rows.map(r => ({
        boat_note_id: note.id, line_no: r.line_no, supplier: r.supplier, po_number: r.po_number,
        part_number: r.part_number, product_name: r.product_name, unit: r.unit,
        ordered_qty: Number(r.ordered_qty) || 0,
        received_qty: selSet.has(r.id) ? (Number(r.received_qty) || 0) : null,
        expiry_date: r.expiry_date || null, department: r.department,
        item_id: r.item_id, matched: r.matched,
        status: selSet.has(r.id) ? (r.matched ? 'received' : 'skipped') : 'pending',
      })), { mode: 'insert' })

      // 3. apply stock movements for matched, selected rows
      let posted = 0, unmatched = 0
      for (const r of selectedRows) {
        const qty = Number(r.received_qty) || 0
        if (!r.item_id || qty <= 0) { if (!r.item_id) unmatched++; continue }
        const inv = items.find(i => i.id === r.item_id)
        const newStock = Number(inv?.current_stock || 0) + qty
        const upd = { current_stock: newStock }
        if (r.expiry_date) upd.expiry_date = r.expiry_date
        if (!inv?.origin) upd.origin = classifyOrigin(r.product_name)
        await supabase.from('items').update(upd).eq('id', r.item_id)
        await supabase.from('stock_updates').insert({
          item_id: r.item_id, date: meta.note_date, quantity_change: qty, new_quantity: newStock,
          updated_by: meta.received_by, note: `Boat note ${meta.label}`,
        })
        await supabase.from('receiving').insert({
          item_id: r.item_id, item_name: inv?.name || r.product_name, date: meta.note_date,
          quantity_received: qty, unit: r.unit, supplier_name: r.supplier,
          received_by: meta.received_by, invoice_number: r.po_number, note: `Boat note: ${meta.label}`,
        }).catch(() => {})
        if (r.expiry_date) {
          await supabase.from('item_batches').insert({
            item_id: r.item_id, expiry_date: r.expiry_date, quantity: qty,
            note: `Boat note ${meta.label}`,
          }).catch(() => {})
        }
        posted++
      }
      toast.success(`Posted ${posted} items to inventory${unmatched ? ` · ${unmatched} unmatched recorded` : ''}`)
      setStage(STAGE.DONE)
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  const reset = () => { setRows([]); setStage(STAGE.UPLOAD); setPickedDepts({}); setMeta({ label: '', note_date: today(), source_file: '', received_by: 'Roni' }) }

  // ── RENDER ─────────────────────────────────────────────────────
  if (stage === STAGE.UPLOAD) {
    return (
      <div className="space-y-4">
        <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4 text-sm text-blue-300">
          <p className="font-semibold mb-2">📋 How it works</p>
          <ol className="list-decimal ml-4 space-y-1.5">
            <li>Upload the boat note (<strong>.xlsx</strong> or <strong>.csv</strong>) — every layout is auto-detected</li>
            <li><strong>Edit</strong> any row, fix codes, add or remove lines</li>
            <li>Tick the <strong>departments</strong> you're receiving (Store, Main Kitchen, Engineering…) and press <strong>Update</strong></li>
            <li>Adjust the <strong>quantity</strong>, add an <strong>expiry date</strong>, then <strong>Confirm</strong> — stock updates automatically</li>
          </ol>
        </div>
        <div onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files) }}
          className="card border-2 border-dashed border-slate-600 hover:border-teal-500 cursor-pointer transition-all text-center py-16 hover:bg-teal-900/10">
          {busy ? <Loader className="w-11 h-11 mx-auto mb-3 text-teal-400 animate-spin" />
                : <FileSpreadsheet className="w-11 h-11 mx-auto mb-3 text-slate-500" />}
          <p className="text-base font-semibold text-slate-200">Drop a boat note here</p>
          <p className="text-slate-500 text-xs mt-1.5">Excel (.xlsx) or CSV</p>
          <button className="mt-4 btn-secondary btn-sm mx-auto"><Upload className="w-4 h-4" /> Browse File</button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={e => handleFile(e.target.files)} />
        </div>
      </div>
    )
  }

  if (stage === STAGE.DONE) {
    return (
      <div className="card text-center py-16">
        <PackageCheck className="w-14 h-14 mx-auto mb-4 text-green-400" />
        <p className="text-lg font-semibold text-slate-100">Boat note posted to inventory</p>
        <p className="text-slate-400 text-sm mt-1">{meta.label}</p>
        <div className="flex justify-center gap-3 mt-6">
          <Button variant="secondary" onClick={reset}><Upload className="w-4 h-4" /> Verify another</Button>
          <Button onClick={onPosted}><HistoryIcon className="w-4 h-4" /> View history</Button>
        </div>
      </div>
    )
  }

  // EDIT + CONFIRM share the meta bar
  return (
    <div className="space-y-4">
      <div className="card-sm flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={stage === STAGE.CONFIRM ? () => setStage(STAGE.EDIT) : reset}>
            <ChevronLeft className="w-4 h-4" /> {stage === STAGE.CONFIRM ? 'Back to edit' : 'Start over'}
          </Button>
          <span className="text-slate-300 text-sm font-medium">{meta.label}</span>
          <Badge variant="teal">{rows.length} rows</Badge>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-slate-400" />
          <input type="date" value={meta.note_date} onChange={e => setMeta(m => ({ ...m, note_date: e.target.value }))} className="input text-sm py-1.5 w-auto" />
        </div>
      </div>

      {stage === STAGE.EDIT ? (
        <>
          {/* department picker */}
          <div className="card-sm">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Select departments to receive</p>
            <div className="flex flex-wrap gap-2">
              {allDepts.map(d => {
                const count = rows.filter(r => r.department === d).length
                const on = !!pickedDepts[d]
                return (
                  <button key={d} onClick={() => toggleDept(d)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${on ? 'bg-teal-600/20 border-teal-500 text-teal-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>
                    {on ? '✓ ' : ''}{d} <span className="opacity-60">({count})</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={addRow}><Plus className="w-4 h-4" /> Add row</Button>
            <Button onClick={goConfirm}>Update — review {selectedRows.length} items <ChevronRight className="w-4 h-4" /></Button>
          </div>

          <div className="card overflow-x-auto p-0">
            <Table>
              <Thead><tr>
                <Th>#</Th><Th>Supplier</Th><Th>PO</Th><Th>Code</Th><Th>Product</Th>
                <Th>Unit</Th><Th>Qty</Th><Th>Dept</Th><Th>Match</Th><Th></Th>
              </tr></Thead>
              <Tbody>
                {rows.map(r => (
                  <Tr key={r.id} className={pickedDepts[r.department] ? 'bg-teal-900/5' : ''}>
                    <Td className="text-slate-500 text-xs">{r.line_no}</Td>
                    <Td><input className="input text-xs py-1 min-w-[120px]" value={r.supplier} onChange={e => editRow(r.id, 'supplier', e.target.value)} /></Td>
                    <Td><input className="input text-xs py-1 w-28 font-mono" value={r.po_number} onChange={e => editRow(r.id, 'po_number', e.target.value)} /></Td>
                    <Td><input className="input text-xs py-1 w-20 font-mono text-[#00AEEF]" value={r.part_number} onChange={e => editRow(r.id, 'part_number', e.target.value)} /></Td>
                    <Td><input className="input text-xs py-1 min-w-[200px]" value={r.product_name} onChange={e => editRow(r.id, 'product_name', e.target.value)} /></Td>
                    <Td><input className="input text-xs py-1 w-16" value={r.unit} onChange={e => editRow(r.id, 'unit', e.target.value)} /></Td>
                    <Td><input type="number" className="input text-xs py-1 w-20" value={r.ordered_qty} onChange={e => editRow(r.id, 'ordered_qty', e.target.value)} /></Td>
                    <Td>
                      <select className="input text-xs py-1 w-32" value={r.department} onChange={e => editRow(r.id, 'department', e.target.value)}>
                        {[...new Set([...allDepts, r.department])].map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </Td>
                    <Td>{r.matched ? <Badge variant="green">matched</Badge> : <Badge variant="gray">new</Badge>}</Td>
                    <Td><button onClick={() => delRow(r.id)} className="p-1 text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button></Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        </>
      ) : (
        // CONFIRM
        <>
          <div className="bg-amber-900/15 border border-amber-700/30 rounded-lg p-3 text-sm text-amber-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Set the received quantity &amp; expiry, then confirm. Matched items update stock; unmatched are recorded only.
          </div>
          <div className="card overflow-x-auto p-0">
            <Table>
              <Thead><tr>
                <Th>Code</Th><Th>Product</Th><Th>Dept</Th><Th>Unit</Th><Th>Received Qty</Th><Th>Expiry Date</Th><Th>Status</Th>
              </tr></Thead>
              <Tbody>
                {selectedRows.map(r => (
                  <Tr key={r.id}>
                    <Td className="font-mono text-xs text-[#00AEEF]">{r.part_number}</Td>
                    <Td className="text-slate-100 text-sm">{r.matched ? r.matched_name : r.product_name}</Td>
                    <Td><Badge variant="blue">{r.department}</Badge></Td>
                    <Td className="text-slate-400 text-xs">{r.unit}</Td>
                    <Td><input type="number" min="0" step="0.01" className="input text-sm py-1 w-24" value={r.received_qty} onChange={e => editRow(r.id, 'received_qty', e.target.value)} /></Td>
                    <Td><input type="date" className="input text-sm py-1 w-40" value={r.expiry_date || ''} onChange={e => editRow(r.id, 'expiry_date', e.target.value)} /></Td>
                    <Td>{r.matched ? <Badge variant="green">will update</Badge> : <Badge variant="orange">unmatched</Badge>}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
          <div className="flex justify-end">
            <Button onClick={postToInventory} loading={busy} variant="success">
              <CheckCircle2 className="w-4 h-4" /> Confirm &amp; Update Inventory
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
function BoatNoteHistory() {
  const [notes, setNotes]   = useState([])
  const [loading, setLoad]  = useState(true)
  const [range, setRange]   = useState({ from: '', to: '' })
  const [expanded, setExp]  = useState(null)
  const [itemsMap, setItemsMap] = useState({})

  const load = async () => {
    setLoad(true)
    let q = supabase.from('boat_notes').select('*').order('note_date', { ascending: false }).limit(100)
    if (range.from) q = q.gte('note_date', range.from)
    if (range.to)   q = q.lte('note_date', range.to)
    const { data } = await q
    setNotes(data || []); setLoad(false)
  }
  useEffect(() => { load() }, [range.from, range.to])

  const openNote = async (id) => {
    if (expanded === id) { setExp(null); return }
    if (!itemsMap[id]) {
      const { data } = await supabase.from('boat_note_items').select('*').eq('boat_note_id', id).order('line_no')
      setItemsMap(m => ({ ...m, [id]: data || [] }))
    }
    setExp(id)
  }

  return (
    <div className="space-y-4">
      <div className="card-sm flex items-center gap-3 flex-wrap">
        <CalendarDays className="w-4 h-4 text-slate-400" />
        <label className="text-xs text-slate-400">From</label>
        <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="input text-sm py-1.5 w-auto" />
        <label className="text-xs text-slate-400">To</label>
        <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="input text-sm py-1.5 w-auto" />
        {(range.from || range.to) && <button onClick={() => setRange({ from: '', to: '' })} className="btn-ghost btn-sm"><X className="w-4 h-4" /> Clear</button>}
        <button onClick={load} className="btn-ghost btn-sm ml-auto"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : notes.length === 0 ? (
        <div className="card text-center text-slate-500 py-12">No boat notes posted yet</div>
      ) : notes.map(n => (
        <div key={n.id} className="card p-0 overflow-hidden">
          <button onClick={() => openNote(n.id)} className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-700/30 text-left">
            <div className="flex items-center gap-3 min-w-0">
              {expanded === n.id ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              <div className="min-w-0">
                <p className="font-medium text-slate-100 truncate">{n.label || 'Boat note'}</p>
                <p className="text-xs text-slate-500">{n.note_date} · {n.delivery_day}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(n.departments || []).slice(0, 4).map(d => <Badge key={d} variant="blue">{d}</Badge>)}
              <Badge variant="teal">{n.posted_items}/{n.total_items} posted</Badge>
            </div>
          </button>
          {expanded === n.id && (
            <div className="border-t border-slate-700 overflow-x-auto">
              <Table>
                <Thead><tr><Th>#</Th><Th>Code</Th><Th>Product</Th><Th>Dept</Th><Th>Unit</Th><Th>Received</Th><Th>Expiry</Th><Th>Status</Th></tr></Thead>
                <Tbody>
                  {(itemsMap[n.id] || []).map(it => (
                    <Tr key={it.id}>
                      <Td className="text-slate-500 text-xs">{it.line_no}</Td>
                      <Td className="font-mono text-xs text-[#00AEEF]">{it.part_number}</Td>
                      <Td className="text-slate-200 text-sm">{it.product_name}</Td>
                      <Td className="text-slate-400 text-xs">{it.department}</Td>
                      <Td className="text-slate-400 text-xs">{it.unit}</Td>
                      <Td className="text-slate-200">{it.received_qty ?? '—'}</Td>
                      <Td className="text-slate-400 text-xs">{it.expiry_date || '—'}</Td>
                      <Td>{it.status === 'received' ? <Badge variant="green">received</Badge> : it.status === 'skipped' ? <Badge variant="orange">unmatched</Badge> : <Badge variant="gray">pending</Badge>}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
