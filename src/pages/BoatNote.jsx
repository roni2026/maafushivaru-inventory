import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, selectAll, chunkedWrite } from '../lib/supabase'
import {
  Ship, Upload, Loader, Plus, Trash2, CheckCircle2, ChevronLeft, X,
  FileSpreadsheet, History as HistoryIcon, Search, RefreshCw, AlertTriangle,
  PackageCheck, CalendarDays, ChevronDown, ChevronRight, FlaskConical,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Input, { Select } from '../components/ui/Input'
import { parseBoatNoteFile, classifyOrigin, isSampleRow, DEPARTMENTS } from '../lib/boatnote'
import { useSort } from '../hooks/useSort'

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
          <button onClick={() => setTab('samples')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'samples' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <FlaskConical className="w-4 h-4 inline mr-1.5" />Samples
          </button>
        </div>
      </div>
      {tab === 'verify' ? <VerifyFlow onPosted={() => setTab('history')} />
        : tab === 'samples' ? <SamplesTab />
        : <BoatNoteHistory />}
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
      matched_name: match?.name || '', matched_unit: match?.unit || r.unit,
      is_sample: isSampleRow(r),
      receive: r.receive === undefined ? true : r.receive }
  }

  // ── Upload + parse ──────────────────────────────────────────────────
  const handleFile = async (fileList) => {
    const file = fileList?.[0]; if (!file) return
    setBusy(true)
    try {
      const { items: parsed, depts, noteDate } = await parseBoatNoteFile(file)
      if (!parsed.length) { toast.error('No item rows found in that file'); setBusy(false); return }
      const rid = () => Math.random().toString(36).slice(2)
      const enrichedRows = parsed.map(p => enrich({ ...p, id: rid(), received_qty: p.ordered_qty, receive: true }))
      setRows(enrichedRows)
      setMeta(m => ({ ...m, label: file.name.replace(/\.[^.]+$/, ''), source_file: file.name, note_date: noteDate || today() }))
      const dp = {}; depts.forEach(d => { dp[d] = d === 'STORE' }); setPickedDepts(dp)
      setStage(STAGE.EDIT)
      const sampleCount = enrichedRows.filter(r => r.is_sample).length
      toast.success(`Parsed ${parsed.length} items across ${depts.length} departments${sampleCount ? ` · ${sampleCount} sample${sampleCount !== 1 ? 's' : ''} detected` : ''}`)
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
  // Manually include/exclude an individual line (not all items on a note arrive).
  const toggleReceive = (id) => setRows(prev => prev.map(r => r.id === id ? { ...r, receive: r.receive === false } : r))

  const allDepts = useMemo(() => [...new Set(rows.map(r => r.department).filter(Boolean))].sort(), [rows])
  const toggleDept = (d) => setPickedDepts(p => ({ ...p, [d]: !p[d] }))

  // rows belonging to the ticked departments AND individually ticked to receive
  // → the ones we'll actually post. Updates live as departments / rows toggle.
  const selectedRows = useMemo(() =>
    rows.filter(r => pickedDepts[r.department] && r.receive !== false), [rows, pickedDepts])
  // Live preview of what's currently selected (used before "Update — review").
  const selectedByDept = useMemo(() => {
    const m = {}
    for (const r of selectedRows) m[r.department] = (m[r.department] || 0) + 1
    return m
  }, [selectedRows])

  // Sortable result trees (edit + confirm).
  const { sorted: sortedRows,     thProps: editTh }    = useSort(rows, null, 'asc')
  const { sorted: sortedSelected, thProps: confirmTh } = useSort(selectedRows, null, 'asc')

  // Float the currently-selected rows (ticked department + ticked to receive) to
  // the TOP of the edit list so the user can instantly see what's selected. This
  // recomputes live as departments / rows are toggled. Array sort is stable, so
  // the active column-sort order is preserved within each group.
  const displayRows = useMemo(() => {
    const isSel = (r) => !!pickedDepts[r.department] && r.receive !== false
    return [...sortedRows].sort((a, b) => (isSel(b) ? 1 : 0) - (isSel(a) ? 1 : 0))
  }, [sortedRows, pickedDepts])

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
        item_id: r.item_id, matched: r.matched, is_sample: !!r.is_sample,
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

          {/* Live selection preview — updates instantly as departments / rows toggle */}
          <div className="card-sm flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <PackageCheck className="w-4 h-4 text-teal-400" />
              <span className="text-slate-200 font-semibold">{selectedRows.length}</span>
              <span className="text-slate-400">items selected</span>
              {Object.entries(selectedByDept).map(([d, n]) => (
                <Badge key={d} variant="blue">{d} ({n})</Badge>
              ))}
              {selectedRows.filter(r => r.is_sample).length > 0 && (
                <Badge variant="purple">{selectedRows.filter(r => r.is_sample).length} sample(s)</Badge>
              )}
            </div>
            <span className="text-xs text-slate-500">Tick departments and individual rows below — the count above updates live.</span>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={addRow}><Plus className="w-4 h-4" /> Add row</Button>
            <Button onClick={goConfirm}>Update — review {selectedRows.length} items <ChevronRight className="w-4 h-4" /></Button>
          </div>

          <div className="card overflow-x-auto p-0">
            <Table>
              <Thead><tr>
                <Th title="Receive this item?">Recv</Th>
                <Th {...editTh('line_no')}>#</Th>
                <Th {...editTh('supplier')}>Supplier</Th>
                <Th {...editTh('po_number')}>PO</Th>
                <Th {...editTh('part_number')}>Code</Th>
                <Th {...editTh('product_name')}>Product</Th>
                <Th {...editTh('unit')}>Unit</Th>
                <Th {...editTh('ordered_qty')}>Qty</Th>
                <Th {...editTh('department')}>Dept</Th>
                <Th {...editTh('matched')}>Match</Th>
                <Th></Th>
              </tr></Thead>
              <Tbody>
                {displayRows.map(r => {
                  const inDept   = !!pickedDepts[r.department]
                  const selected = inDept && r.receive !== false
                  return (
                  <Tr key={r.id} className={[
                    selected ? 'bg-teal-900/5' : '',
                    r.is_sample ? 'bg-purple-900/10' : '',
                    inDept && r.receive === false ? 'opacity-50' : '',
                  ].join(' ')}>
                    <Td>
                      <input type="checkbox" checked={r.receive !== false} disabled={!inDept}
                        onChange={() => toggleReceive(r.id)}
                        title={inDept ? 'Untick if this item did not arrive' : 'Tick its department first'}
                        className="accent-teal-500 w-4 h-4 disabled:opacity-30" />
                    </Td>
                    <Td className="text-slate-500 text-xs">{r.line_no}</Td>
                    <Td><input className="input text-xs py-1 min-w-[120px]" value={r.supplier} onChange={e => editRow(r.id, 'supplier', e.target.value)} /></Td>
                    <Td><input className="input text-xs py-1 w-28 font-mono" value={r.po_number} onChange={e => editRow(r.id, 'po_number', e.target.value)} /></Td>
                    <Td><input className="input text-xs py-1 w-20 font-mono text-[#00AEEF]" value={r.part_number} onChange={e => editRow(r.id, 'part_number', e.target.value)} /></Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <input className="input text-xs py-1 min-w-[200px]" value={r.product_name} onChange={e => editRow(r.id, 'product_name', e.target.value)} />
                        {r.is_sample && <Badge variant="purple">sample</Badge>}
                      </div>
                    </Td>
                    <Td><input className="input text-xs py-1 w-16" value={r.unit} onChange={e => editRow(r.id, 'unit', e.target.value)} /></Td>
                    <Td><input type="number" className="input text-xs py-1 w-20" value={r.ordered_qty} onChange={e => editRow(r.id, 'ordered_qty', e.target.value)} /></Td>
                    <Td>
                      <select className="input text-xs py-1 w-32" value={r.department} onChange={e => editRow(r.id, 'department', e.target.value)}>
                        {[...new Set([...allDepts, ...DEPARTMENTS, r.department])].filter(Boolean).map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </Td>
                    <Td>{r.matched ? <Badge variant="green">matched</Badge> : <Badge variant="gray">new</Badge>}</Td>
                    <Td><button onClick={() => delRow(r.id)} className="p-1 text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button></Td>
                  </Tr>
                )})}
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
                <Th {...confirmTh('part_number')}>Code</Th>
                <Th {...confirmTh('product_name')}>Product</Th>
                <Th {...confirmTh('department')}>Dept</Th>
                <Th {...confirmTh('unit')}>Unit</Th>
                <Th {...confirmTh('received_qty')}>Received Qty</Th>
                <Th {...confirmTh('expiry_date')}>Expiry Date</Th>
                <Th {...confirmTh('matched')}>Status</Th>
              </tr></Thead>
              <Tbody>
                {sortedSelected.map(r => (
                  <Tr key={r.id} className={r.is_sample ? 'bg-purple-900/10' : ''}>
                    <Td className="font-mono text-xs text-[#00AEEF]">{r.part_number}</Td>
                    <Td className="text-slate-100 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        {r.matched ? r.matched_name : r.product_name}
                        {r.is_sample && <Badge variant="purple">sample</Badge>}
                      </span>
                    </Td>
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

  const [retentionDays, setRetentionDays] = useState(6)

  // Auto-purge boat notes older than the retention window (default 6 days).
  // Runs once before the first load so stale notes never linger.
  const purgeExpired = async () => {
    const { data: s } = await supabase.from('settings').select('value').eq('key', 'boat_note_retention_days').maybeSingle()
    const days = Math.max(0, Number(s?.value) || 6)
    setRetentionDays(days)
    if (days <= 0) return
    const cutoff = new Date(); cutoff.setHours(0,0,0,0); cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().split('T')[0]
    // boat_note_items cascade-delete via FK ON DELETE CASCADE.
    await supabase.from('boat_notes').delete().lt('note_date', cutoffStr)
  }

  const load = async () => {
    setLoad(true)
    await purgeExpired()
    let q = supabase.from('boat_notes').select('*').order('note_date', { ascending: false }).limit(100)
    if (range.from) q = q.gte('note_date', range.from)
    if (range.to)   q = q.lte('note_date', range.to)
    const { data } = await q
    setNotes(data || []); setLoad(false)
  }
  useEffect(() => { load() }, [range.from, range.to])

  const deleteNote = async (id, label) => {
    if (!confirm(`Delete boat note “${label || 'Boat note'}”? This removes its received items record. This cannot be undone.`)) return
    const { error } = await supabase.from('boat_notes').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setNotes(prev => prev.filter(n => n.id !== id))
    if (expanded === id) setExp(null)
    toast.success('Boat note deleted')
  }

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
        <span className="ml-auto text-[11px] text-slate-500">Notes auto-delete after {retentionDays} day{retentionDays !== 1 ? 's' : ''}</span>
        <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : notes.length === 0 ? (
        <div className="card text-center text-slate-500 py-12">No boat notes posted yet</div>
      ) : notes.map(n => (
        <div key={n.id} className="card p-0 overflow-hidden">
          <div className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-700/30">
            <button onClick={() => openNote(n.id)} className="flex items-center gap-3 min-w-0 text-left flex-1">
              {expanded === n.id ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              <div className="min-w-0">
                <p className="font-medium text-slate-100 truncate">{n.label || 'Boat note'}</p>
                <p className="text-xs text-slate-500">{n.note_date} · {n.delivery_day}</p>
              </div>
            </button>
            <div className="flex items-center gap-2 shrink-0">
              {(n.departments || []).slice(0, 4).map(d => <Badge key={d} variant="blue">{d}</Badge>)}
              <Badge variant="teal">{n.posted_items}/{n.total_items} posted</Badge>
              <button onClick={() => deleteNote(n.id, n.label)} title="Delete boat note"
                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          {expanded === n.id && (
            <div className="border-t border-slate-700 overflow-x-auto">
              <NoteItemsTable items={itemsMap[n.id] || []} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Sortable per-note items table (used inside the History accordion).
// ═════════════════════════════════════════════════════════════════════════════
function NoteItemsTable({ items }) {
  const { sorted, thProps } = useSort(items, 'line_no', 'asc')
  return (
    <Table>
      <Thead><tr>
        <Th {...thProps('line_no')}>#</Th>
        <Th {...thProps('part_number')}>Code</Th>
        <Th {...thProps('product_name')}>Product</Th>
        <Th {...thProps('department')}>Dept</Th>
        <Th {...thProps('unit')}>Unit</Th>
        <Th {...thProps('received_qty')}>Received</Th>
        <Th {...thProps('expiry_date')}>Expiry</Th>
        <Th {...thProps('status')}>Status</Th>
      </tr></Thead>
      <Tbody>
        {sorted.map(it => (
          <Tr key={it.id} className={it.is_sample ? 'bg-purple-900/10' : ''}>
            <Td className="text-slate-500 text-xs">{it.line_no}</Td>
            <Td className="font-mono text-xs text-[#00AEEF]">{it.part_number}</Td>
            <Td className="text-slate-200 text-sm">
              <span className="inline-flex items-center gap-1.5">{it.product_name}{it.is_sample && <Badge variant="purple">sample</Badge>}</span>
            </Td>
            <Td className="text-slate-400 text-xs">{it.department}</Td>
            <Td className="text-slate-400 text-xs">{it.unit}</Td>
            <Td className="text-slate-200">{it.received_qty ?? '—'}</Td>
            <Td className="text-slate-400 text-xs">{it.expiry_date || '—'}</Td>
            <Td>{it.status === 'received' ? <Badge variant="green">received</Badge> : it.status === 'skipped' ? <Badge variant="orange">unmatched</Badge> : <Badge variant="gray">pending</Badge>}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// SAMPLES — every sample that has arrived over time (item code contains "sample")
// ═════════════════════════════════════════════════════════════════════════════
function SamplesTab() {
  const [samples, setSamples] = useState([])
  const [loading, setLoad]    = useState(true)
  const [range, setRange]     = useState({ from: '', to: '' })
  const [search, setSearch]   = useState('')

  const load = async () => {
    setLoad(true)
    const { data } = await selectAll(() =>
      supabase.from('boat_note_items')
        .select('*, boat_notes(note_date,label,delivery_day)')
        .eq('is_sample', true))
    let rows = (data || []).map(r => ({
      ...r,
      note_date:    r.boat_notes?.note_date || null,
      note_label:   r.boat_notes?.label || '',
      delivery_day: r.boat_notes?.delivery_day || '',
    }))
    rows.sort((a, b) => String(b.note_date || '').localeCompare(String(a.note_date || '')))
    setSamples(rows); setLoad(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => samples.filter(s => {
    if (range.from && (s.note_date || '') < range.from) return false
    if (range.to   && (s.note_date || '') > range.to)   return false
    if (search) {
      const q = search.toLowerCase()
      if (!(`${s.product_name} ${s.part_number} ${s.supplier} ${s.po_number} ${s.note_label}`.toLowerCase().includes(q))) return false
    }
    return true
  }), [samples, range, search])

  const { sorted, thProps } = useSort(filtered, 'note_date', 'desc')

  return (
    <div className="space-y-4">
      <div className="bg-purple-900/15 border border-purple-700/30 rounded-lg p-4 text-sm text-purple-200">
        <p className="font-semibold flex items-center gap-2 mb-1"><FlaskConical className="w-4 h-4" /> Sample tracking</p>
        <p>Any boat-note line whose <strong>item code contains "sample"</strong> is logged here automatically so you can track every sample that arrives over time.</p>
      </div>

      <div className="card-sm flex items-center gap-3 flex-wrap">
        <CalendarDays className="w-4 h-4 text-slate-400" />
        <label className="text-xs text-slate-400">From</label>
        <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="input text-sm py-1.5 w-auto" />
        <label className="text-xs text-slate-400">To</label>
        <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="input text-sm py-1.5 w-auto" />
        <div className="flex items-center gap-1.5 ml-auto">
          <Search className="w-4 h-4 text-slate-400" />
          <input placeholder="Search samples…" value={search} onChange={e => setSearch(e.target.value)} className="input text-sm py-1.5 w-44" />
        </div>
        <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-slate-500 py-12">No samples recorded yet</div>
      ) : (
        <>
          <p className="text-xs text-slate-400">{filtered.length} sample{filtered.length !== 1 ? 's' : ''} received</p>
          <div className="card overflow-x-auto p-0">
            <Table>
              <Thead><tr>
                <Th {...thProps('note_date')}>Date</Th>
                <Th {...thProps('note_label')}>Boat Note</Th>
                <Th {...thProps('part_number')}>Code</Th>
                <Th {...thProps('product_name')}>Product</Th>
                <Th {...thProps('supplier')}>Supplier</Th>
                <Th {...thProps('po_number')}>PO</Th>
                <Th {...thProps('department')}>Dept</Th>
                <Th {...thProps('received_qty')}>Qty</Th>
                <Th {...thProps('status')}>Status</Th>
              </tr></Thead>
              <Tbody>
                {sorted.map(s => (
                  <Tr key={s.id}>
                    <Td className="text-slate-300 text-xs whitespace-nowrap">{s.note_date || '—'}</Td>
                    <Td className="text-slate-300 text-sm">{s.note_label || '—'}</Td>
                    <Td className="font-mono text-xs text-[#00AEEF]">{s.part_number}</Td>
                    <Td className="text-slate-100 text-sm">{s.product_name}</Td>
                    <Td className="text-slate-400 text-xs">{s.supplier || '—'}</Td>
                    <Td className="text-slate-400 text-xs font-mono">{s.po_number || '—'}</Td>
                    <Td className="text-slate-400 text-xs">{s.department || '—'}</Td>
                    <Td className="text-slate-200">{s.received_qty ?? s.ordered_qty ?? '—'}</Td>
                    <Td>{s.status === 'received' ? <Badge variant="green">received</Badge> : s.status === 'skipped' ? <Badge variant="orange">unmatched</Badge> : <Badge variant="gray">pending</Badge>}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
