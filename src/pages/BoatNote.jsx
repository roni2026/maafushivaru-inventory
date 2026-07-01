import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase, selectAll, chunkedWrite } from '../lib/supabase'
import {
  Ship, Upload, Loader, Plus, Trash2, CheckCircle2, ChevronLeft, X,
  FileSpreadsheet, History as HistoryIcon, Search, RefreshCw, AlertTriangle,
  PackageCheck, CalendarDays, ChevronDown, ChevronRight, FlaskConical, Save,
  Printer, Mail, FileDown,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import { parseBoatNoteFile, classifyOrigin, isSampleRow, DEPARTMENTS } from '../lib/boatnote'
import { useSort } from '../hooks/useSort'
import { logItemActivity, currentActor } from '../lib/activity'
import {
  exportBoatNoteExcel, boatNoteExcelBase64, printBoatNoteReport, reportFileName, CATEGORIES,
} from '../lib/boatNoteReport'
import { sendBoatNoteReport } from '../lib/brevo'

const today = () => new Date().toISOString().split('T')[0]
const cleanCode = (s) => String(s || '').replace(/^0+/, '') || ''
const rid = () => Math.random().toString(36).slice(2)

// ── Upload flow stages ────────────────────────────────────────────────────
const STAGE = { UPLOAD: 'upload', PREVIEW: 'preview' }

// Per-line outcome badge.
function StatusBadge({ status }) {
  if (status === 'received')    return <Badge variant="green">received</Badge>
  if (status === 'damaged')     return <Badge variant="red">damaged</Badge>
  if (status === 'not_arrived') return <Badge variant="red">not arrived</Badge>
  if (status === 'wrong_item')  return <Badge variant="orange">wrong item</Badge>
  if (status === 'skipped')     return <Badge variant="orange">unmatched</Badge>
  return <Badge variant="gray">pending</Badge>
}

// Reusable report action bar (Excel / Print / PDF / Send) for a boat note.
function ReportActions({ note, getLines, size = 'sm' }) {
  const [busy, setBusy] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)

  const doExcel = async () => {
    setBusy(true)
    try { await exportBoatNoteExcel(note, await getLines()) }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const doPrint = async () => {
    setBusy(true)
    try { printBoatNoteReport(note, await getLines()) }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={doExcel} disabled={busy} className="btn-ghost btn-sm" title="Export Excel report">
        <FileSpreadsheet className="w-4 h-4" /> Excel
      </button>
      <button onClick={doPrint} disabled={busy} className="btn-ghost btn-sm" title="Print / Save as PDF">
        <Printer className="w-4 h-4" /> Print
      </button>
      <button onClick={doPrint} disabled={busy} className="btn-ghost btn-sm" title="Save as PDF">
        <FileDown className="w-4 h-4" /> PDF
      </button>
      <button onClick={() => setSendOpen(true)} disabled={busy} className="btn-ghost btn-sm text-teal-400" title="Email report via Brevo">
        <Mail className="w-4 h-4" /> Send
      </button>
      {sendOpen && <SendBoatNoteReportModal note={note} getLines={getLines} onClose={() => setSendOpen(false)} />}
    </>
  )
}

// Email a boat-note report (categorised summary + Excel attachment) via Brevo.
function SendBoatNoteReportModal({ note, getLines, onClose }) {
  const [settings, setSettings] = useState({})
  const [recipient, setRecipient] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('settings').select('key,value')
      const map = (data || []).reduce((a, s) => ({ ...a, [s.key]: s.value }), {})
      setSettings(map)
      setRecipient(map.report_recipient_email || '')
      setLoading(false)
    })()
  }, [])

  const missing = !settings.brevo_api_key || !settings.brevo_sender_email

  const send = async () => {
    if (!recipient) { toast.error('Enter a recipient email'); return }
    setSending(true)
    try {
      const lines = await getLines()
      const counts = { total: lines.length }
      const known = ['received', 'damaged', 'wrong_item', 'not_arrived']
      CATEGORIES.forEach(c => {
        counts[c.key] = lines.filter(l =>
          c.key === 'pending' ? !known.includes(l.status) : l.status === c.key
        ).length
      })

      const base64 = await boatNoteExcelBase64(note, lines)
      await sendBoatNoteReport({
        apiKey: settings.brevo_api_key,
        senderEmail: settings.brevo_sender_email,
        senderName: settings.brevo_sender_name || 'Roni — Store Assistant',
        recipientEmail: recipient,
        recipientName: settings.report_recipient_name || 'Manager',
        note, counts,
        attachmentBase64: base64,
        attachmentName: reportFileName(note, 'xlsx'),
      })
      toast.success('Report emailed successfully')
      onClose()
    } catch (e) { toast.error(e.message) }
    setSending(false)
  }

  return (
    <Modal isOpen onClose={onClose} title="Send Boat Note Report" size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        {!missing && <Button onClick={send} loading={sending}><Mail className="w-4 h-4" /> Send Report</Button>}
      </>}>
      {loading ? (
        <div className="flex justify-center py-8"><Loader className="w-6 h-6 text-teal-400 animate-spin" /></div>
      ) : missing ? (
        <div className="bg-orange-900/20 border border-orange-700/30 rounded-xl p-3 text-sm text-orange-300">
          Email is not configured. Add your Brevo API key and sender email in <strong>Settings → Email Reports</strong> first.
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">Emails the categorised report (Received, Damaged, Wrong Item, Not Arrived, Pending) with the Excel file attached.</p>
          <Input label="Recipient email" type="email" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="manager@resort.com" />
          <p className="text-xs text-slate-500">From: {settings.brevo_sender_name || 'Roni'} &lt;{settings.brevo_sender_email}&gt;</p>
        </div>
      )}
    </Modal>
  )
}

// Broad department/store selector (chips). Tick one or more; empty = all.
function DeptFilter({ depts, picked, onToggle, onAll }) {
  if (!depts.length) return null
  return (
    <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-slate-700 bg-slate-800/40">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide mr-1">Store / Dept</span>
      <button onClick={onAll}
        className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${!picked.length ? 'bg-teal-600/20 border-teal-500 text-teal-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>
        All
      </button>
      {depts.map(d => {
        const on = picked.includes(d)
        return (
          <button key={d} onClick={() => onToggle(d)}
            className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${on ? 'bg-teal-600/20 border-teal-500 text-teal-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>
            {on ? '✓ ' : ''}{d}
          </button>
        )
      })}
    </div>
  )
}

export default function BoatNote() {
  const [tab, setTab] = useState('upload')   // 'upload' | 'history' | 'samples'
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Boat Note Receiving</h1>
          <p className="page-sub">Upload a boat note to keep it in history, then receive each item into inventory one by one</p>
        </div>
        <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-xl p-1">
          <button onClick={() => setTab('upload')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'upload' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <Ship className="w-4 h-4 inline mr-1.5" />Upload
          </button>
          <button onClick={() => setTab('history')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'history' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <HistoryIcon className="w-4 h-4 inline mr-1.5" />History
          </button>
          <button onClick={() => setTab('received')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'received' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <PackageCheck className="w-4 h-4 inline mr-1.5" />Received
          </button>
          <button onClick={() => setTab('notarrived')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'notarrived' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <AlertTriangle className="w-4 h-4 inline mr-1.5" />Not Arrived
          </button>
          <button onClick={() => setTab('samples')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'samples' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <FlaskConical className="w-4 h-4 inline mr-1.5" />Samples
          </button>
        </div>
      </div>
      {tab === 'upload' ? <UploadFlow onSaved={() => setTab('history')} />
        : tab === 'samples' ? <SamplesTab />
        : tab === 'notarrived' ? <NotArrivedTab />
        : tab === 'received' ? <ReceivedTab />
        : <BoatNoteHistory />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// UPLOAD — parse a file and save the WHOLE note to history instantly.
// No department picking, no per-item confirm. Items go in as "pending" and are
// received into inventory later, one by one, from the History tab.
// ════════════════════════════════════════════════════════════════════════════
function UploadFlow({ onSaved }) {
  const [stage, setStage] = useState(STAGE.UPLOAD)
  const [busy, setBusy]   = useState(false)
  const [rows, setRows]   = useState([])
  const [items, setItems] = useState([])
  const [meta, setMeta]   = useState({ label: '', note_date: today(), source_file: '', received_by: 'Roni' })
  const fileRef = useRef(null)

  useEffect(() => {
    selectAll(() => supabase.from('items').select('id,name,part_number').eq('active', true))
      .then(({ data }) => setItems(data || []))
  }, [])
  const byCode = useMemo(() => {
    const m = new Map(); for (const it of items) m.set(cleanCode(it.part_number), it); return m
  }, [items])
  const enrich = (r) => {
    const match = byCode.get(cleanCode(r.part_number))
    return { ...r, item_id: match?.id || null, matched: !!match, is_sample: isSampleRow(r) }
  }

  const handleFile = async (fileList) => {
    const file = fileList?.[0]; if (!file) return
    setBusy(true)
    try {
      const { items: parsed, noteDate } = await parseBoatNoteFile(file)
      if (!parsed.length) { toast.error('No item rows found in that file'); setBusy(false); return }
      setRows(parsed.map(p => enrich({ ...p, id: rid() })))
      setMeta(m => ({ ...m, label: file.name.replace(/\.[^.]+$/, ''), source_file: file.name, note_date: noteDate || today() }))
      setStage(STAGE.PREVIEW)
      const sampleCount = parsed.filter(p => isSampleRow(p)).length
      toast.success(`Parsed ${parsed.length} items${sampleCount ? ` · ${sampleCount} sample(s)` : ''}`)
    } catch (e) { toast.error(e.message) }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const editRow = (id, field, val) => setRows(prev => prev.map(r => {
    if (r.id !== id) return r
    const u = { ...r, [field]: val }
    return field === 'part_number' ? enrich(u) : u
  }))
  const addRow = () => setRows(prev => [...prev, enrich({
    id: rid(), line_no: prev.length + 1, supplier: '', po_number: '',
    part_number: '', product_name: '', unit: 'EA', ordered_qty: 0, expiry_date: '',
    department: 'STORE',
  })])
  const delRow = (id) => setRows(prev => prev.filter(r => r.id !== id))

  const allDepts = useMemo(() => [...new Set(rows.map(r => r.department).filter(Boolean))].sort(), [rows])
  const { sorted, thProps } = useSort(rows, null, 'asc')

  const saveToHistory = async () => {
    if (!rows.length) { toast.error('Nothing to save'); return }
    setBusy(true)
    try {
      const safeDate = (meta.note_date && /^\d{4}-\d{2}-\d{2}$/.test(meta.note_date)) ? meta.note_date : today()
      let dayName = ''
      try { dayName = new Date(safeDate).toLocaleDateString('en-US', { weekday: 'long' }) } catch { dayName = '' }
      const { data: note, error: noteErr } = await supabase.from('boat_notes').insert({
        note_date: safeDate, label: meta.label || `Boat note ${safeDate}`,
        delivery_day: dayName, status: 'posted', source_file: meta.source_file,
        departments: allDepts, total_items: rows.length, posted_items: 0, created_by: meta.received_by,
      }).select().single()
      if (noteErr) throw noteErr

      const buildItemRows = (withSample) => rows.map(r => {
        const base = {
          boat_note_id: note.id, line_no: r.line_no, supplier: r.supplier, po_number: r.po_number,
          part_number: r.part_number, product_name: r.product_name, unit: r.unit,
          ordered_qty: Number(r.ordered_qty) || 0, received_qty: null,
          expiry_date: r.expiry_date || null, department: r.department || null,
          item_id: r.item_id, matched: r.matched, status: 'pending',
        }
        if (withSample) base.is_sample = !!r.is_sample
        return base
      })
      let res = await chunkedWrite('boat_note_items', buildItemRows(true), { mode: 'insert' })
      if (res.failed && (res.errors || []).some(e => /is_sample|column/i.test(e || ''))) {
        res = await chunkedWrite('boat_note_items', buildItemRows(false), { mode: 'insert' })
      }
      if (res.failed) toast(`Saved note, but ${res.failed} line(s) failed to record.`, { icon: '⚠️' })
      else toast.success('Boat note saved to history')
      onSaved?.()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  const reset = () => { setRows([]); setStage(STAGE.UPLOAD); setMeta({ label: '', note_date: today(), source_file: '', received_by: 'Roni' }) }

  if (stage === STAGE.UPLOAD) {
    return (
      <div className="space-y-4">
        <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4 text-sm text-blue-300">
          <p className="font-semibold mb-2">📋 How it works</p>
          <ol className="list-decimal ml-4 space-y-1.5">
            <li>Upload the boat note (<strong>.xlsx</strong> or <strong>.csv</strong>) — it is saved to <strong>History</strong> straight away</li>
            <li>It stays in History so you can <strong>sort &amp; review</strong> it any time</li>
            <li>From History, <strong>receive each item</strong> into inventory one by one — set the quantity and add <strong>one or more expiry dates</strong></li>
            <li>Delete the whole boat note whenever you want</li>
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

  // PREVIEW — review parsed rows, then save the whole note to history.
  return (
    <div className="space-y-4">
      <div className="card-sm flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={reset}><ChevronLeft className="w-4 h-4" /> Start over</Button>
          <input className="input text-sm py-1.5 w-56" value={meta.label}
            onChange={e => setMeta(m => ({ ...m, label: e.target.value }))} placeholder="Boat note label" />
          <Badge variant="teal">{rows.length} rows</Badge>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-slate-400" />
          <input type="date" value={meta.note_date} onChange={e => setMeta(m => ({ ...m, note_date: e.target.value }))} className="input text-sm py-1.5 w-auto" />
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={addRow}><Plus className="w-4 h-4" /> Add row</Button>
        <Button onClick={saveToHistory} loading={busy} variant="success">
          <Save className="w-4 h-4" /> Save to history
        </Button>
      </div>

      <div className="card overflow-x-auto p-0">
        <Table>
          <Thead><tr>
            <Th {...thProps('line_no')}>#</Th>
            <Th {...thProps('supplier')}>Supplier</Th>
            <Th {...thProps('po_number')}>PO</Th>
            <Th {...thProps('part_number')}>Code</Th>
            <Th {...thProps('product_name')}>Product</Th>
            <Th {...thProps('unit')}>Unit</Th>
            <Th {...thProps('ordered_qty')}>Qty</Th>
            <Th {...thProps('department')}>Dept</Th>
            <Th {...thProps('matched')}>Match</Th>
            <Th></Th>
          </tr></Thead>
          <Tbody>
            {sorted.map(r => (
              <Tr key={r.id} className={r.is_sample ? 'bg-purple-900/10' : ''}>
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
                  <select className="input text-xs py-1 w-32" value={r.department || ''} onChange={e => editRow(r.id, 'department', e.target.value)}>
                    {[...new Set([...allDepts, ...DEPARTMENTS, r.department])].filter(Boolean).map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Td>
                <Td>{r.matched ? <Badge variant="green">matched</Badge> : <Badge variant="gray">new</Badge>}</Td>
                <Td><button onClick={() => delRow(r.id)} className="p-1 text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button></Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// HISTORY — every saved boat note, sortable. Expand a note to receive its items
// into inventory one by one (each with multiple expiry batches), or delete it.
// ════════════════════════════════════════════════════════════════════════════
function BoatNoteHistory() {
  const [notes, setNotes]   = useState([])
  const [loading, setLoad]  = useState(true)
  const [range, setRange]   = useState({ from: '', to: '' })
  const [expanded, setExp]  = useState(null)
  const [itemsMap, setItemsMap] = useState({})
  const [inventory, setInventory] = useState([])
  const [receiving, setReceiving] = useState(null)   // boat_note_item being received
  const [issuing, setIssuing]     = useState(null)   // boat_note_item being flagged not-arrived/wrong

  useEffect(() => {
    selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock,expiry_date,origin').eq('active', true))
      .then(({ data }) => setInventory(data || []))
  }, [])

  const load = useCallback(async () => {
    setLoad(true)
    let q = supabase.from('boat_notes').select('*').order('note_date', { ascending: false }).limit(100)
    if (range.from) q = q.gte('note_date', range.from)
    if (range.to)   q = q.lte('note_date', range.to)
    const { data } = await q
    setNotes(data || []); setLoad(false)
  }, [range.from, range.to])
  useEffect(() => { load() }, [load])

  const loadItems = async (id) => {
    const { data } = await supabase.from('boat_note_items').select('*').eq('boat_note_id', id).order('line_no')
    setItemsMap(m => ({ ...m, [id]: data || [] }))
  }
  const openNote = async (id) => {
    if (expanded === id) { setExp(null); return }
    if (!itemsMap[id]) await loadItems(id)
    setExp(id)
  }

  const del = async (n) => {
    if (!confirm(`Delete boat note "${n.label || n.note_date}"? This removes the note and its lines from history. Stock already received is NOT reversed.`)) return
    const { error } = await supabase.from('boat_notes').delete().eq('id', n.id)
    if (error) { toast.error(error.message); return }
    setNotes(list => list.filter(x => x.id !== n.id))
    if (expanded === n.id) setExp(null)
    toast.success('Boat note deleted')
  }

  // Called after a line changes (received, or flagged not-arrived/wrong).
  const onReceived = (noteId, lineId, patch, postedDelta) => {
    setItemsMap(m => ({ ...m, [noteId]: (m[noteId] || []).map(it => it.id === lineId ? { ...it, ...patch } : it) }))
    if (postedDelta) {
      setNotes(list => list.map(n => n.id === noteId ? { ...n, posted_items: (n.posted_items || 0) + postedDelta } : n))
    }
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
        <div className="card text-center text-slate-500 py-12">No boat notes yet — upload one to get started</div>
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
            <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
              <Badge variant="teal">{n.posted_items || 0}/{n.total_items} received</Badge>
              <ReportActions note={n} getLines={async () => {
                const { data } = await selectAll(() => supabase.from('boat_note_items').select('*').eq('boat_note_id', n.id).order('line_no'))
                return data || []
              }} />
              <button onClick={() => del(n)} className="btn-ghost btn-sm text-red-400" title="Delete boat note">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          {expanded === n.id && (
            <NoteItemsTable
              items={itemsMap[n.id] || []}
              onReceive={(line) => setReceiving({ note: n, line })}
              onIssue={(line) => setIssuing({ note: n, line })}
            />
          )}
        </div>
      ))}

      {receiving && (
        <ReceiveItemModal
          note={receiving.note}
          line={receiving.line}
          inventory={inventory}
          onClose={() => setReceiving(null)}
          onDone={(patch, postedDelta) => { onReceived(receiving.note.id, receiving.line.id, patch, postedDelta); setReceiving(null) }}
        />
      )}

      {issuing && (
        <IssueItemModal
          line={issuing.line}
          onClose={() => setIssuing(null)}
          onDone={(patch) => { onReceived(issuing.note.id, issuing.line.id, patch, 0); setIssuing(null) }}
        />
      )}
    </div>
  )
}

// Sortable per-note items table with department/store filter + per-line actions
// (Receive into inventory, or flag as not-arrived / wrong item).
function NoteItemsTable({ items, onReceive, onIssue }) {
  const [picked, setPicked] = useState([])   // selected departments (empty = all)
  const depts = useMemo(() => [...new Set(items.map(i => i.department).filter(Boolean))].sort(), [items])
  const filtered = useMemo(() => picked.length ? items.filter(i => picked.includes(i.department)) : items, [items, picked])
  const { sorted, thProps } = useSort(filtered, 'line_no', 'asc')
  const toggle = (d) => setPicked(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d])

  return (
    <div className="border-t border-slate-700">
      <DeptFilter depts={depts} picked={picked} onToggle={toggle} onAll={() => setPicked([])} />
      <div className="overflow-x-auto">
        <Table>
          <Thead><tr>
            <Th {...thProps('line_no')}>#</Th>
            <Th {...thProps('part_number')}>Code</Th>
            <Th {...thProps('product_name')}>Product</Th>
            <Th {...thProps('department')}>Dept</Th>
            <Th {...thProps('unit')}>Unit</Th>
            <Th {...thProps('ordered_qty')}>Ordered</Th>
            <Th {...thProps('received_qty')}>Received</Th>
            <Th {...thProps('expiry_date')}>Expiry</Th>
            <Th {...thProps('status')}>Status</Th>
            <Th></Th>
          </tr></Thead>
          <Tbody>
            {sorted.map(it => (
              <Tr key={it.id} className={it.is_sample ? 'bg-purple-900/10' : ''}>
                <Td className="text-slate-500 text-xs">{it.line_no}</Td>
                <Td className="font-mono text-xs text-[#00AEEF]">{it.part_number}</Td>
                <Td className="text-slate-200 text-sm">
                  <span className="inline-flex items-center gap-1.5">{it.product_name}{it.is_sample && <Badge variant="purple">sample</Badge>}</span>
                  {it.note && <p className="text-xs text-amber-400/80 mt-0.5">⚠ {it.note}</p>}
                </Td>
                <Td className="text-slate-400 text-xs">{it.department}</Td>
                <Td className="text-slate-400 text-xs">{it.unit}</Td>
                <Td className="text-slate-400 text-xs">{it.ordered_qty}</Td>
                <Td className="text-slate-200">{it.received_qty ?? '—'}</Td>
                <Td className="text-slate-400 text-xs">{it.expiry_date || '—'}</Td>
                <Td><StatusBadge status={it.status} /></Td>
                <Td>
                  {it.status === 'received' ? (
                    <span className="text-xs text-green-400 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> done</span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => onReceive(it)}><PackageCheck className="w-4 h-4" /> Receive</Button>
                      <button onClick={() => onIssue(it)} title="Not arrived / wrong item"
                        className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-900/20"><AlertTriangle className="w-4 h-4" /></button>
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  )
}

// ── Receive ONE item into inventory, with one or more expiry batches ─────────
function ReceiveItemModal({ note, line, inventory, onClose, onDone }) {
  const [itemId, setItemId] = useState(line.item_id || '')
  const [search, setSearch] = useState('')
  const [batches, setBatches] = useState([
    { id: rid(), expiry_date: line.expiry_date || '', quantity: line.received_qty ?? line.ordered_qty ?? '' },
  ])
  const [busy, setBusy] = useState(false)

  const invItem = useMemo(() => inventory.find(i => i.id === itemId) || null, [inventory, itemId])
  const matches = useMemo(() => {
    if (itemId) return []
    const q = search.trim().toLowerCase()
    const base = q
      ? inventory.filter(i => `${i.name} ${i.part_number}`.toLowerCase().includes(q))
      : inventory.filter(i => cleanCode(i.part_number) === cleanCode(line.part_number))
    return base.slice(0, 12)
  }, [inventory, itemId, search, line.part_number])

  const totalQty = useMemo(() => batches.reduce((s, b) => s + (Number(b.quantity) || 0), 0), [batches])

  const setBatch = (id, field, val) => setBatches(prev => prev.map(b => b.id === id ? { ...b, [field]: val } : b))
  const addBatch = () => setBatches(prev => [...prev, { id: rid(), expiry_date: '', quantity: '' }])
  const delBatch = (id) => setBatches(prev => prev.length > 1 ? prev.filter(b => b.id !== id) : prev)

  const post = async () => {
    if (!itemId) { toast.error('Pick the inventory item to receive into'); return }
    if (totalQty <= 0) { toast.error('Enter a received quantity'); return }
    setBusy(true)
    try {
      const dated = batches.filter(b => b.expiry_date && Number(b.quantity) > 0)
      const earliest = dated.map(b => b.expiry_date).sort()[0] || null
      const newStock = Number(invItem?.current_stock || 0) + totalQty

      const upd = { current_stock: newStock }
      if (earliest) upd.expiry_date = earliest
      if (!invItem?.origin) upd.origin = classifyOrigin(line.product_name)
      const { error: uErr } = await supabase.from('items').update(upd).eq('id', itemId)
      if (uErr) throw uErr

      await supabase.from('stock_updates').insert({
        item_id: itemId, date: note.note_date, quantity_change: totalQty, new_quantity: newStock,
        updated_by: note.created_by || 'Roni', note: `Boat note ${note.label || note.note_date}`,
      })
      await supabase.from('receiving').insert({
        item_id: itemId, item_name: invItem?.name || line.product_name, date: note.note_date,
        quantity_received: totalQty, unit: line.unit, supplier_name: line.supplier,
        received_by: note.created_by || 'Roni', invoice_number: line.po_number, note: `Boat note: ${note.label || note.note_date}`,
      }).catch(() => {})

      // One inventory batch per expiry (multiple expiry supported).
      for (const b of dated) {
        await supabase.from('item_batches').insert({
          item_id: itemId, expiry_date: b.expiry_date, quantity: Number(b.quantity) || 0,
          note: `Boat note ${note.label || note.note_date}`,
        }).catch(() => {})
      }
      // If no dated batches but qty given, still record a no-expiry batch.
      if (!dated.length) {
        await supabase.from('item_batches').insert({
          item_id: itemId, expiry_date: null, quantity: totalQty,
          note: `Boat note ${note.label || note.note_date}`,
        }).catch(() => {})
      }

      const actor = note.created_by || (await currentActor())
      const patch = {
        received_qty: totalQty, expiry_date: earliest, status: 'received', matched: true, item_id: itemId,
        received_by: actor, received_at: new Date().toISOString(),
      }
      const { error: lErr } = await supabase.from('boat_note_items').update(patch).eq('id', line.id)
      if (lErr) throw lErr

      // Per-item activity trail.
      logItemActivity(itemId, 'received', `Received ${totalQty} ${line.unit || ''} · Boat note ${note.label || note.note_date}`)

      // Bump the note's received counter.
      await supabase.from('boat_notes').update({ posted_items: (note.posted_items || 0) + 1 }).eq('id', note.id).catch(() => {})

      toast.success(`Received ${totalQty} ${line.unit || ''} into ${invItem?.name || 'inventory'}`)
      onDone(patch, 1)
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <Modal isOpen onClose={onClose} title="Receive item into inventory" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="success" loading={busy} onClick={post}><CheckCircle2 className="w-4 h-4" /> Receive {totalQty || ''}</Button>
      </>}>
      <div className="space-y-4">
        <div className="bg-slate-700/30 rounded-lg p-3">
          <p className="text-sm text-slate-100 font-medium">{line.product_name}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Code <span className="font-mono text-[#00AEEF]">{line.part_number || '—'}</span> · ordered {line.ordered_qty} {line.unit} · {line.supplier || 'no supplier'}
          </p>
        </div>

        {/* Inventory item link */}
        {invItem ? (
          <div className="flex items-center justify-between gap-2 bg-green-900/15 border border-green-700/30 rounded-lg px-3 py-2">
            <div className="text-sm">
              <span className="text-green-300 font-medium">{invItem.name}</span>
              <span className="text-slate-500 ml-2 font-mono text-xs">{invItem.part_number}</span>
              <span className="text-slate-400 ml-2 text-xs">stock {Number(invItem.current_stock || 0)}</span>
            </div>
            <button onClick={() => { setItemId(''); setSearch('') }} className="text-xs text-slate-400 hover:text-slate-200">Change</button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-amber-900/15 border border-amber-700/30 rounded-lg px-3 py-2 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" /> No matched item — pick the inventory item to receive into.
            </div>
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-400" />
              <input className="input text-sm py-1.5 flex-1" placeholder="Search inventory by name or code…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-700">
              {matches.length === 0 ? (
                <p className="text-xs text-slate-500 p-3">No matching items.</p>
              ) : matches.map(i => (
                <button key={i.id} onClick={() => setItemId(i.id)} className="w-full text-left px-3 py-2 hover:bg-slate-700/40 flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-200 truncate">{i.name}</span>
                  <span className="font-mono text-xs text-[#00AEEF] shrink-0">{i.part_number}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Multiple expiry batches */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Quantity &amp; expiry</p>
            <Button size="sm" variant="secondary" onClick={addBatch}><Plus className="w-4 h-4" /> Add expiry</Button>
          </div>
          <div className="space-y-2">
            {batches.map((b, idx) => (
              <div key={b.id} className="flex items-center gap-2">
                <input type="number" min="0" step="0.01" className="input text-sm py-1.5 w-28" placeholder="Qty"
                  value={b.quantity} onChange={e => setBatch(b.id, 'quantity', e.target.value)} />
                <input type="date" className="input text-sm py-1.5 flex-1"
                  value={b.expiry_date} onChange={e => setBatch(b.id, 'expiry_date', e.target.value)} />
                <button onClick={() => delBatch(b.id)} disabled={batches.length === 1}
                  className="p-1.5 text-slate-500 hover:text-red-400 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Total to receive: <span className="text-slate-200 font-semibold">{totalQty || 0}</span> {line.unit}
            {batches.length > 1 ? ` across ${batches.filter(b => Number(b.quantity) > 0).length} batches` : ''}.
            Leave the date blank for items with no expiry.
          </p>
        </div>
      </div>
    </Modal>
  )
}

// ── Flag a line as NOT ARRIVED or WRONG ITEM, with a note ────────────────────
function IssueItemModal({ line, onClose, onDone }) {
  const [kind, setKind] = useState(['wrong_item', 'damaged', 'not_arrived'].includes(line.status) ? line.status : 'not_arrived')
  const [note, setNote] = useState(line.note || '')
  const [busy, setBusy] = useState(false)

  const LABELS = { not_arrived: 'not arrived', wrong_item: 'wrong item', damaged: 'damaged' }

  const save = async () => {
    setBusy(true)
    try {
      const patch = { status: kind, note: note.trim() || null }
      const { error } = await supabase.from('boat_note_items').update(patch).eq('id', line.id)
      if (error) throw error
      toast.success(`Marked as ${LABELS[kind]}`)
      onDone(patch)
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <Modal isOpen onClose={onClose} title="Report a delivery problem" size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} onClick={save}><AlertTriangle className="w-4 h-4" /> Save</Button>
      </>}>
      <div className="space-y-4">
        <div className="bg-slate-700/30 rounded-lg p-3">
          <p className="text-sm text-slate-100 font-medium">{line.product_name}</p>
          <p className="text-xs text-slate-400 mt-0.5">Code <span className="font-mono text-[#00AEEF]">{line.part_number || '—'}</span> · {line.department || '—'} · ordered {line.ordered_qty} {line.unit}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => setKind('not_arrived')}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${kind === 'not_arrived' ? 'bg-red-600/20 border-red-500 text-red-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>
            Not arrived
          </button>
          <button onClick={() => setKind('wrong_item')}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${kind === 'wrong_item' ? 'bg-orange-600/20 border-orange-500 text-orange-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>
            Wrong item
          </button>
          <button onClick={() => setKind('damaged')}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${kind === 'damaged' ? 'bg-red-600/20 border-red-500 text-red-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>
            Damaged
          </button>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Note</label>
          <textarea rows={3} value={note} onChange={e => setNote(e.target.value)}
            placeholder={kind === 'not_arrived' ? 'e.g. 2 cases short — supplier to redeliver Thursday' : 'e.g. sent 1.5L bottles instead of 500mL'}
            className="input w-full mt-1.5 text-sm" />
        </div>
      </div>
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// NOT ARRIVED — every line flagged not-arrived / wrong item, across all notes,
// filterable by store/department so you can see exactly what is outstanding.
// ════════════════════════════════════════════════════════════════════════════
function NotArrivedTab() {
  const [rows, setRows]     = useState([])
  const [loading, setLoad]  = useState(true)
  const [range, setRange]   = useState({ from: '', to: '' })
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState([])

  const load = async () => {
    setLoad(true)
    const { data } = await selectAll(() =>
      supabase.from('boat_note_items')
        .select('*, boat_notes(note_date,label,delivery_day)')
        .in('status', ['not_arrived', 'wrong_item']))
    let list = (data || []).map(r => ({
      ...r,
      note_date:  r.boat_notes?.note_date || null,
      note_label: r.boat_notes?.label || '',
    }))
    list.sort((a, b) => String(b.note_date || '').localeCompare(String(a.note_date || '')))
    setRows(list); setLoad(false)
  }
  useEffect(() => { load() }, [])

  const resolve = async (r) => {
    if (!confirm('Move this line back to "pending" (problem resolved)?')) return
    const { error } = await supabase.from('boat_note_items').update({ status: 'pending' }).eq('id', r.id)
    if (error) { toast.error(error.message); return }
    setRows(list => list.filter(x => x.id !== r.id))
    toast.success('Moved back to pending')
  }

  const depts = useMemo(() => [...new Set(rows.map(r => r.department).filter(Boolean))].sort(), [rows])
  const toggle = (d) => setPicked(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d])

  const filtered = useMemo(() => rows.filter(r => {
    if (picked.length && !picked.includes(r.department)) return false
    if (range.from && (r.note_date || '') < range.from) return false
    if (range.to   && (r.note_date || '') > range.to)   return false
    if (search) {
      const q = search.toLowerCase()
      if (!(`${r.product_name} ${r.part_number} ${r.supplier} ${r.note_label} ${r.note}`.toLowerCase().includes(q))) return false
    }
    return true
  }), [rows, picked, range, search])

  const { sorted, thProps } = useSort(filtered, 'note_date', 'desc')

  return (
    <div className="space-y-4">
      <div className="bg-red-900/15 border border-red-700/30 rounded-lg p-4 text-sm text-red-200">
        <p className="font-semibold flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4" /> Outstanding deliveries</p>
        <p>Every boat-note line marked <strong>not arrived</strong> or <strong>wrong item</strong>. Filter by store / department to see what is still outstanding for each store.</p>
      </div>

      <div className="card-sm flex items-center gap-3 flex-wrap">
        <CalendarDays className="w-4 h-4 text-slate-400" />
        <label className="text-xs text-slate-400">From</label>
        <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="input text-sm py-1.5 w-auto" />
        <label className="text-xs text-slate-400">To</label>
        <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="input text-sm py-1.5 w-auto" />
        <div className="flex items-center gap-1.5 ml-auto">
          <Search className="w-4 h-4 text-slate-400" />
          <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="input text-sm py-1.5 w-44" />
        </div>
        <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {depts.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide mr-1">Store / Dept</span>
          <button onClick={() => setPicked([])}
            className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${!picked.length ? 'bg-teal-600/20 border-teal-500 text-teal-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>All</button>
          {depts.map(d => {
            const on = picked.includes(d)
            return (
              <button key={d} onClick={() => toggle(d)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${on ? 'bg-teal-600/20 border-teal-500 text-teal-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>
                {on ? '✓ ' : ''}{d}
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-slate-500 py-12">Nothing outstanding 🎉</div>
      ) : (
        <>
          <p className="text-xs text-slate-400">{filtered.length} outstanding line{filtered.length !== 1 ? 's' : ''}</p>
          <div className="card overflow-x-auto p-0">
            <Table>
              <Thead><tr>
                <Th {...thProps('note_date')}>Date</Th>
                <Th {...thProps('note_label')}>Boat Note</Th>
                <Th {...thProps('department')}>Store / Dept</Th>
                <Th {...thProps('part_number')}>Code</Th>
                <Th {...thProps('product_name')}>Product</Th>
                <Th {...thProps('ordered_qty')}>Ordered</Th>
                <Th {...thProps('status')}>Problem</Th>
                <Th>Note</Th>
                <Th></Th>
              </tr></Thead>
              <Tbody>
                {sorted.map(r => (
                  <Tr key={r.id}>
                    <Td className="text-slate-300 text-xs whitespace-nowrap">{r.note_date || '—'}</Td>
                    <Td className="text-slate-300 text-sm">{r.note_label || '—'}</Td>
                    <Td><Badge variant="blue">{r.department || '—'}</Badge></Td>
                    <Td className="font-mono text-xs text-[#00AEEF]">{r.part_number}</Td>
                    <Td className="text-slate-100 text-sm">{r.product_name}</Td>
                    <Td className="text-slate-400 text-xs">{r.ordered_qty} {r.unit}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td className="text-slate-400 text-xs max-w-[220px]">{r.note || '—'}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => resolve(r)}><CheckCircle2 className="w-4 h-4" /> Resolve</Button></Td>
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

// ════════════════════════════════════════════════════════════════════════════
// SAMPLES — every sample that has arrived over time (item code contains "sample")
// ════════════════════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════════════════════
// RECEIVED — every boat-note line confirmed into inventory, across all notes,
// shown distinctly and cleanly. Searchable, filterable by store/dept, and
// exportable (Excel / Print / PDF / Send).
// ═════════════════════════════════════════════════════════════════════════════
function ReceivedTab() {
  const [rows, setRows]     = useState([])
  const [loading, setLoad]  = useState(true)
  const [range, setRange]   = useState({ from: '', to: '' })
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState([])

  const load = async () => {
    setLoad(true)
    const { data } = await selectAll(() =>
      supabase.from('boat_note_items')
        .select('*, boat_notes(note_date,label,delivery_day)')
        .eq('status', 'received'))
    let list = (data || []).map(r => ({
      ...r,
      note_date:  r.boat_notes?.note_date || null,
      note_label: r.boat_notes?.label || '',
    }))
    if (range.from) list = list.filter(r => (r.note_date || '') >= range.from)
    if (range.to)   list = list.filter(r => (r.note_date || '') <= range.to)
    list.sort((a, b) => String(b.received_at || b.note_date || '').localeCompare(String(a.received_at || a.note_date || '')))
    setRows(list); setLoad(false)
  }
  useEffect(() => { load() }, [range.from, range.to])

  const depts = useMemo(() => [...new Set(rows.map(r => r.department).filter(Boolean))].sort(), [rows])
  const toggle = (d) => setPicked(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d])

  const filtered = useMemo(() => {
    let list = picked.length ? rows.filter(r => picked.includes(r.department)) : rows
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        (r.product_name || '').toLowerCase().includes(q) ||
        (r.part_number || '').toLowerCase().includes(q) ||
        (r.supplier || '').toLowerCase().includes(q))
    }
    return list
  }, [rows, picked, search])

  const { sorted, thProps } = useSort(filtered, 'received_at', 'desc')

  const totalQty = filtered.reduce((s, r) => s + (Number(r.received_qty) || 0), 0)

  // Report over the currently filtered received lines.
  const virtualNote = { label: 'Received Items', note_date: today(), created_by: 'Roni' }

  return (
    <div className="space-y-4">
      <div className="card-sm flex items-center gap-3 flex-wrap">
        <CalendarDays className="w-4 h-4 text-slate-400" />
        <label className="text-xs text-slate-400">From</label>
        <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="input text-sm py-1.5 w-auto" />
        <label className="text-xs text-slate-400">To</label>
        <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="input text-sm py-1.5 w-auto" />
        {(range.from || range.to) && <button onClick={() => setRange({ from: '', to: '' })} className="btn-ghost btn-sm"><X className="w-4 h-4" /> Clear</button>}
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input placeholder="Search item, code, supplier…" value={search} onChange={e => setSearch(e.target.value)} className="input pl-9 text-sm py-1.5 w-56" />
        </div>
      </div>

      <div className="card-sm flex items-center gap-2 flex-wrap">
        <ReportActions note={virtualNote} getLines={async () => filtered} />
        <span className="text-xs text-slate-500 ml-auto">{filtered.length} items · {totalQty} units received</span>
      </div>

      {depts.length > 0 && <DeptFilter depts={depts} picked={picked} onToggle={toggle} onAll={() => setPicked([])} />}

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : sorted.length === 0 ? (
        <div className="card text-center text-slate-500 py-12">No received items yet — confirm items from a boat note to see them here.</div>
      ) : (
        <div className="card overflow-x-auto">
          <Table>
            <Thead><tr>
              <Th {...thProps('part_number')}>Code</Th>
              <Th {...thProps('product_name')}>Product</Th>
              <Th {...thProps('department')}>Dept</Th>
              <Th {...thProps('received_qty')}>Received</Th>
              <Th {...thProps('unit')}>Unit</Th>
              <Th {...thProps('expiry_date')}>Expiry</Th>
              <Th {...thProps('supplier')}>Supplier</Th>
              <Th {...thProps('note_date')}>Boat Note</Th>
              <Th {...thProps('received_by')}>Received By</Th>
              <Th {...thProps('received_at')}>Received At</Th>
            </tr></Thead>
            <Tbody>
              {sorted.map(r => (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs text-[#00AEEF]">{r.part_number}</Td>
                  <Td className="text-slate-100 text-sm">{r.product_name}</Td>
                  <Td className="text-slate-400 text-xs">{r.department || '—'}</Td>
                  <Td className="font-bold text-green-400">{r.received_qty}</Td>
                  <Td className="text-slate-400 text-xs">{r.unit}</Td>
                  <Td className="text-slate-400 text-xs">{r.expiry_date || '—'}</Td>
                  <Td className="text-slate-300 text-sm">{r.supplier || '—'}</Td>
                  <Td className="text-slate-400 text-xs">{r.note_label || r.note_date || '—'}</Td>
                  <Td className="text-slate-400 text-xs">{r.received_by || '—'}</Td>
                  <Td className="text-slate-400 text-xs whitespace-nowrap">{r.received_at ? new Date(r.received_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </div>
  )
}
