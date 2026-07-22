import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase, selectAll, chunkedWrite } from '../lib/supabase'
import {
  Ship, Upload, Loader, Plus, Trash2, CheckCircle2, ChevronLeft, X,
  FileSpreadsheet, History as HistoryIcon, Search, RefreshCw, AlertTriangle,
  PackageCheck, CalendarDays, ChevronDown, ChevronRight, FlaskConical, Save,
  Printer, Mail, FileDown, Undo2, CalendarRange, PackageX, Layers, Clock, Edit2,
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
import { logBoatNoteEvent, fetchBoatNoteEvents, boatEventLabel, boatEventTone } from '../lib/boatNoteHistory'
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
  if (status === 'received')    return <Badge variant="green">in inventory</Badge>
  if (status === 'arrived')     return <Badge variant="teal">arrived</Badge>
  if (status === 'damaged')     return <Badge variant="red">damaged</Badge>
  if (status === 'short')       return <Badge variant="yellow">short</Badge>
  if (status === 'not_arrived') return <Badge variant="red">not arrived</Badge>
  if (status === 'wrong_item')  return <Badge variant="orange">wrong item</Badge>
  if (status === 'skipped')     return <Badge variant="orange">unmatched</Badge>
  return <Badge variant="gray">pending</Badge>
}

// Reusable report action bar for a boat note. "Export" first shows tick options
// for WHICH departments to include, then exports (Excel / Print / PDF).
function ReportActions({ note, getLines, size = 'sm' }) {
  const [sendOpen, setSendOpen]     = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  return (
    <>
      <button onClick={() => setExportOpen(true)} className="btn-ghost btn-sm" title="Export report (pick departments)">
        <FileSpreadsheet className="w-4 h-4" /> Export
      </button>
      <button onClick={() => setSendOpen(true)} className="btn-ghost btn-sm text-teal-400" title="Email report via Brevo">
        <Mail className="w-4 h-4" /> Send
      </button>
      {exportOpen && <ExportOptionsModal note={note} getLines={getLines} onClose={() => setExportOpen(false)} />}
      {sendOpen && <SendBoatNoteReportModal note={note} getLines={getLines} onClose={() => setSendOpen(false)} />}
    </>
  )
}

// Pick which departments to export, then export as Excel / Print / PDF.
function ExportOptionsModal({ note, getLines, onClose }) {
  const [lines, setLines]   = useState(null)
  const [picked, setPicked] = useState([])   // empty = all departments
  const [busy, setBusy]     = useState(false)

  useEffect(() => { (async () => { setLines(await getLines()) })() }, [])

  const depts = useMemo(
    () => [...new Set((lines || []).map(l => l.department).filter(Boolean))].sort(),
    [lines]
  )
  const toggle = (d) => setPicked(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d])
  const filtered = useMemo(
    () => picked.length ? (lines || []).filter(l => picked.includes(l.department)) : (lines || []),
    [lines, picked]
  )

  const run = async (fn) => {
    if (!filtered.length) { toast.error('No lines for the selected departments'); return }
    setBusy(true)
    try {
      const scoped = picked.length
        ? { ...note, label: `${note.label || note.note_date || 'Boat Note'} · ${picked.join(', ')}` }
        : note
      await fn(scoped, filtered)
      onClose()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal isOpen onClose={onClose} title="Export boat note" size="sm"
      footer={<Button variant="secondary" onClick={onClose}>Cancel</Button>}>
      {lines === null ? (
        <div className="flex justify-center py-8"><Loader className="w-6 h-6 text-teal-400 animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" /> Departments to export
            </p>
            {depts.length === 0 ? (
              <p className="text-xs text-slate-500">No departments on this note — the whole note will be exported.</p>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setPicked([])}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${!picked.length ? 'bg-teal-600/20 border-teal-500 text-teal-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>
                  {!picked.length ? '✓ ' : ''}All
                </button>
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
            <p className="text-xs text-slate-500 mt-2">{filtered.length} line{filtered.length !== 1 ? 's' : ''} selected.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => run(exportBoatNoteExcel)}><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
            <Button variant="secondary" disabled={busy} onClick={() => run((n, l) => printBoatNoteReport(n, l))}><Printer className="w-4 h-4" /> Print</Button>
            <Button variant="secondary" disabled={busy} onClick={() => run((n, l) => printBoatNoteReport(n, l))}><FileDown className="w-4 h-4" /> PDF</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// Email a boat-note report (categorised summary + Excel attachment) via Brevo.
function SendBoatNoteReportModal({ note, getLines, onClose }) {
  const [settings, setSettings] = useState({})
  const [recipient, setRecipient] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [allLines, setAllLines] = useState([])
  const [picked, setPicked] = useState([])   // empty = all departments

  useEffect(() => {
    (async () => {
      const [{ data }, ls] = await Promise.all([
        supabase.from('settings').select('key,value'),
        getLines(),
      ])
      const map = (data || []).reduce((a, s) => ({ ...a, [s.key]: s.value }), {})
      setSettings(map)
      setRecipient(map.report_recipient_email || '')
      setAllLines(ls || [])
      setLoading(false)
    })()
  }, [])

  const depts = useMemo(() => [...new Set(allLines.map(l => l.department).filter(Boolean))].sort(), [allLines])
  const toggleDept = (d) => setPicked(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d])
  const scopedLines = useMemo(() => picked.length ? allLines.filter(l => picked.includes(l.department)) : allLines, [allLines, picked])

  const missing = !settings.brevo_api_key || !settings.brevo_sender_email

  const send = async () => {
    if (!recipient) { toast.error('Enter a recipient email'); return }
    setSending(true)
    try {
      // Never send "not posted" (arrived, not yet in inventory) lines.
      const lines = scopedLines.filter(l => !(l.status === 'arrived' && !l.posted_to_inventory))
      const sendNote = picked.length ? { ...note, label: `${note.label || note.note_date || 'Boat Note'} · ${picked.join(', ')}` } : note
      const counts = { total: lines.length }
      const known = ['received', 'arrived', 'damaged', 'wrong_item', 'not_arrived', 'short']
      CATEGORIES.filter(c => c.key !== 'arrived').forEach(c => {
        counts[c.key] = lines.filter(l =>
          c.key === 'pending' ? !known.includes(l.status) : l.status === c.key
        ).length
      })

      const base64 = await boatNoteExcelBase64(sendNote, lines)
      await sendBoatNoteReport({
        apiKey: settings.brevo_api_key,
        senderEmail: settings.brevo_sender_email,
        senderName: settings.brevo_sender_name || 'Roni — Store Assistant',
        recipientEmail: recipient,
        recipientName: settings.report_recipient_name || 'Manager',
        note: sendNote, counts,
        attachmentBase64: base64,
        attachmentName: reportFileName(sendNote, 'xlsx'),
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
          {depts.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> Departments to include
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setPicked([])}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${!picked.length ? 'bg-teal-600/20 border-teal-500 text-teal-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>
                  {!picked.length ? '✓ ' : ''}All
                </button>
                {depts.map(d => {
                  const on = picked.includes(d)
                  return (
                    <button key={d} onClick={() => toggleDept(d)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${on ? 'bg-teal-600/20 border-teal-500 text-teal-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>
                      {on ? '✓ ' : ''}{d}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-slate-500 mt-2">{scopedLines.length} line{scopedLines.length !== 1 ? 's' : ''} will be sent.</p>
            </div>
          )}
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
          <button onClick={() => setTab('weekly')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'weekly' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <CalendarRange className="w-4 h-4 inline mr-1.5" />Weekly Log
          </button>
          <button onClick={() => setTab('returns')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'returns' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <Undo2 className="w-4 h-4 inline mr-1.5" />Returns
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
        : tab === 'weekly' ? <WeeklyIssuesTab />
        : tab === 'returns' ? <ReturnsTab />
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
      .then(({ data }) => setItems(data || [])).catch(() => {})
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

      // Record the weekly upload in the note's persistent history, with a
      // snapshot of the ORIGINAL lines so we can always see what was there.
      logBoatNoteEvent(note.id, 'uploaded', {
        actor: meta.received_by,
        detail: `Uploaded ${rows.length} line(s)${allDepts.length ? ` · ${allDepts.join(', ')}` : ''}`,
        snapshot: {
          note_date: safeDate, label: note.label, departments: allDepts,
          items: rows.map(r => ({
            line_no: r.line_no, part_number: r.part_number, product_name: r.product_name,
            unit: r.unit, ordered_qty: Number(r.ordered_qty) || 0, department: r.department || null,
            supplier: r.supplier || null, po_number: r.po_number || null, is_sample: !!r.is_sample,
          })),
        },
      })
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
  const [statusFilter, setStatusFilter] = useState('all')  // all | pending | partially_delivered | delivered | cancelled
  const [confirmingId, setConfirmingId] = useState(null)
  const [updatingId, setUpdatingId] = useState(null)

  useEffect(() => {
    // Include inactive items too — they must still be matchable so receiving
    // a delivery for a deactivated item reactivates it automatically.
    selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock,expiry_date,origin,active'))
      .then(({ data }) => setInventory(data || [])).catch(() => {})
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
    if (!confirm(`Are you sure? Deleting this will remove ALL the relevant data for this boat note — its history, received/not-arrived/weekly/returns/samples records for this note, and its change log. Stock already received into inventory is NOT reversed. This cannot be undone.`)) return
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

  // Two-step flow:
  //   1) Confirm Arrived  — marks pending lines as arrived (no stock change)
  //   2) Update Inventory — posts only arrived / good damaged-short lines
  //                         into Batch Expiry. Idempotent via posted_to_inventory.
  const confirmDelivery = async (n) => {
    if (!confirm(`Confirm arrival for "${n.label || n.note_date}"? Pending lines will be marked arrived. Inventory is NOT updated yet — use Update Inventory for that.`)) return
    setConfirmingId(n.id)
    try {
      const actor = await currentActor()
      const { data, error } = await supabase.rpc('confirm_boat_note', { p_boat_note_id: n.id, p_actor: actor })
      if (error) throw error
      setNotes(list => list.map(x => x.id === n.id ? {
        ...x,
        status: data?.status || x.status,
        posted_items: data?.posted_items ?? x.posted_items,
        total_items: data?.total_items ?? x.total_items,
      } : x))
      if (itemsMap[n.id]) await loadItems(n.id)
      toast.success(`Arrival confirmed · ${data?.arrived_now || 0} new line(s) marked arrived`)
    } catch (err) { toast.error(err.message) } finally { setConfirmingId(null) }
  }

  const updateInventory = async (n) => {
    if (!confirm(`Update inventory for "${n.label || n.note_date}"? Only the not-yet-posted quantity of confirmed items is added. Clicking twice never doubles; if you increased a received qty, only the extra is added.`)) return
    setUpdatingId(n.id)
    try {
      const actor = await currentActor()
      const { data, error } = await supabase.rpc('update_boat_note_inventory', { p_boat_note_id: n.id, p_actor: actor })
      if (error) throw error
      setNotes(list => list.map(x => x.id === n.id ? {
        ...x,
        status: data?.status || x.status,
        posted_items: data?.posted_items ?? x.posted_items,
        total_items: data?.total_items ?? x.total_items,
      } : x))
      if (itemsMap[n.id]) await loadItems(n.id)
      const posted = data?.posted_now ?? 0
      const qty = data?.qty_posted_now ?? 0
      const skipped = data?.skipped_already ?? 0
      toast.success(posted > 0
        ? `Inventory updated · +${qty} unit(s) across ${posted} line(s)${skipped ? ` · ${skipped} already up to date` : ''}`
        : `Nothing new to post${skipped ? ` · ${skipped} already in inventory` : ''}`)
    } catch (err) { toast.error(err.message) } finally { setUpdatingId(null) }
  }

  const STATUS_LABEL = { pending: 'Pending', partially_delivered: 'Partially Delivered', delivered: 'Delivered', cancelled: 'Cancelled', draft: 'Pending', verified: 'Pending', posted: 'Delivered' }
  const STATUS_TONE  = { pending: 'orange', partially_delivered: 'yellow', delivered: 'green', cancelled: 'red', draft: 'orange', verified: 'orange', posted: 'green' }
  const STATUS_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'partially_delivered', label: 'Partially Delivered' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'cancelled', label: 'Cancelled' },
  ]
  const visibleNotes = statusFilter === 'all' ? notes : notes.filter(n => {
    const norm = n.status === 'draft' || n.status === 'verified' ? 'pending' : n.status === 'posted' ? 'delivered' : n.status
    return norm === statusFilter
  })

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

      {/* Boat Note Dashboard filters: Pending / Delivered / Partially
          Delivered / Cancelled -- same status vocabulary the DB and
          Android app use. */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map(s => (
          <button key={s.key} onClick={() => setStatusFilter(s.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === s.key ? 'border-[#00AEEF] bg-[#00AEEF]/10 text-[#00AEEF]' : 'border-slate-600 text-slate-400 hover:border-slate-500'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : visibleNotes.length === 0 ? (
        <div className="card text-center text-slate-500 py-12">No boat notes match this filter</div>
      ) : visibleNotes.map(n => {
        const normStatus = n.status === 'draft' || n.status === 'verified' ? 'pending' : n.status === 'posted' ? 'delivered' : n.status
        const canConfirm = normStatus === 'pending' || normStatus === 'partially_delivered'
        return (
        <div key={n.id} className="card p-0 overflow-hidden">
          <div className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-700/30">
            <button onClick={() => openNote(n.id)} className="flex items-center gap-3 min-w-0 text-left flex-1">
              {expanded === n.id ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              <div className="min-w-0">
                <p className="font-medium text-slate-100 truncate">{n.label || 'Boat note'}</p>
                <p className="text-xs text-slate-500">{n.note_date} · {n.delivery_day}{n.note_number ? ` · #${n.note_number}` : ''}</p>
              </div>
            </button>
            <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
              <Badge variant={STATUS_TONE[n.status] || 'gray'}>{STATUS_LABEL[n.status] || n.status}</Badge>
              <Badge variant="teal">{n.posted_items || 0}/{n.total_items} in inventory</Badge>
              {canConfirm && (
                <button onClick={() => confirmDelivery(n)} disabled={confirmingId === n.id || updatingId === n.id}
                  className="btn-secondary btn-sm disabled:opacity-50" title="Mark remaining pending lines as arrived (no stock change)">
                  <CheckCircle2 className="w-4 h-4" /> {confirmingId === n.id ? 'Confirming…' : 'Confirm Arrived'}
                </button>
              )}
              {(canConfirm || normStatus === 'delivered' || normStatus === 'partially_delivered') && (
                <button onClick={() => updateInventory(n)} disabled={updatingId === n.id || confirmingId === n.id}
                  className="btn-primary btn-sm disabled:opacity-50" title="Post confirmed arrived items into inventory (safe to press more than once)">
                  <PackageCheck className="w-4 h-4" /> {updatingId === n.id ? 'Updating…' : 'Update Inventory'}
                </button>
              )}
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
            <>
              <NoteItemsTable
                items={itemsMap[n.id] || []}
                onReceive={(line) => setReceiving({ note: n, line })}
                onIssue={(line) => setIssuing({ note: n, line })}
              />
              <NoteHistoryPanel noteId={n.id} />
            </>
          )}
        </div>
      )})}

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
          note={issuing.note}
          line={issuing.line}
          inventory={inventory}
          onClose={() => setIssuing(null)}
          onDone={(patch, postedDelta = 0) => { onReceived(issuing.note.id, issuing.line.id, patch, postedDelta); setIssuing(null) }}
        />
      )}
    </div>
  )
}

// Persistent per-note change history: what was originally uploaded and every
// later update (received / not arrived / wrong / damaged / short), with who & when.
function NoteHistoryPanel({ noteId }) {
  const [events, setEvents] = useState(null)
  const [showSnapshot, setShowSnapshot] = useState(false)

  useEffect(() => { (async () => { setEvents(await fetchBoatNoteEvents(noteId)) })() }, [noteId])

  const uploaded = useMemo(() => (events || []).find(e => e.event_type === 'uploaded'), [events])
  const snapshotItems = uploaded?.snapshot?.items || []

  const fmt = (ts) => { try { return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return ts } }

  return (
    <div className="border-t border-slate-700 bg-slate-800/30 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
          <HistoryIcon className="w-3.5 h-3.5 text-teal-400" /> Boat note history
        </p>
        {snapshotItems.length > 0 && (
          <button onClick={() => setShowSnapshot(v => !v)} className="text-xs text-teal-400 hover:text-teal-300">
            {showSnapshot ? 'Hide original' : `View original upload (${snapshotItems.length})`}
          </button>
        )}
      </div>

      {events === null ? (
        <div className="flex justify-center py-4"><Loader className="w-5 h-5 text-teal-400 animate-spin" /></div>
      ) : events.length === 0 ? (
        <p className="text-xs text-slate-500 py-1">No history recorded for this note yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map(e => (
            <li key={e.id} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 shrink-0"><Badge variant={boatEventTone(e.event_type)}>{boatEventLabel(e.event_type)}</Badge></span>
              <div className="min-w-0">
                <p className="text-slate-300">
                  {e.product_name ? <span className="text-slate-100">{e.product_name}</span> : null}
                  {e.qty != null ? <span className="text-slate-400"> · {e.qty}</span> : null}
                  {e.detail ? <span className="text-slate-400">{e.product_name ? ' — ' : ''}{e.detail}</span> : null}
                </p>
                <p className="text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" />{fmt(e.created_at)}{e.actor ? ` · ${e.actor}` : ''}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showSnapshot && snapshotItems.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-700">
          <Table>
            <Thead><tr><Th>#</Th><Th>Code</Th><Th>Product</Th><Th>Dept</Th><Th>Unit</Th><Th>Ordered</Th></tr></Thead>
            <Tbody>
              {snapshotItems.map((it, i) => (
                <Tr key={i}>
                  <Td className="text-slate-500 text-xs">{it.line_no}</Td>
                  <Td className="font-mono text-xs text-[#00AEEF]">{it.part_number}</Td>
                  <Td className="text-slate-200 text-sm">{it.product_name}</Td>
                  <Td className="text-slate-400 text-xs">{it.department || '—'}</Td>
                  <Td className="text-slate-400 text-xs">{it.unit}</Td>
                  <Td className="text-slate-300 text-xs">{it.ordered_qty}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
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
            {sorted.map(it => {
              // Damaged / wrong item / short lines are highlighted in red so a
              // delivery problem is obvious at a glance.
              const isProblem = ['damaged', 'wrong_item', 'short'].includes(it.status)
              return (
              <Tr key={it.id} className={isProblem ? 'bg-red-900/30 border-l-4 border-red-500' : it.is_sample ? 'bg-purple-900/10' : ''}>
                <Td className={`text-xs ${isProblem ? 'text-red-300' : 'text-slate-500'}`}>{it.line_no}</Td>
                <Td className="font-mono text-xs text-[#00AEEF]">{it.part_number}</Td>
                <Td className={`text-sm ${isProblem ? 'text-red-200 font-medium' : 'text-slate-200'}`}>
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
                  {it.status === 'received' || it.posted_to_inventory ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-green-400 inline-flex items-center gap-1" title={`${it.posted_qty ?? it.received_qty ?? ''} in inventory`}><CheckCircle2 className="w-3.5 h-3.5" /> in inventory</span>
                      <button onClick={() => onReceive(it)} title="Adjust received qty — re-run Update Inventory to add only the extra"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-[#00AEEF] hover:bg-[#00AEEF]/10"><Edit2 className="w-4 h-4" /></button>
                    </div>
                  ) : it.status === 'arrived' ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-teal-300 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> arrived</span>
                      <button onClick={() => onIssue(it)} title="Change to not arrived / problem"
                        className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-900/20"><AlertTriangle className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => onReceive(it)}><PackageCheck className="w-4 h-4" /> Confirm Arrived</Button>
                      <button onClick={() => onIssue(it)} title="Not arrived / wrong item"
                        className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-900/20"><AlertTriangle className="w-4 h-4" /></button>
                    </div>
                  )}
                </Td>
              </Tr>
              )
            })}
          </Tbody>
        </Table>
      </div>
    </div>
  )
}

// ── Receive ONE item into inventory, with one or more expiry batches ─────────
function ReceiveItemModal({ note, line, inventory, onClose, onDone }) {
  const isAdjust = line.posted_to_inventory || line.status === 'received'
  const alreadyPosted = Number(line.posted_qty ?? line.received_qty ?? 0)
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
    if (!itemId) { toast.error('Pick the inventory item this line maps to'); return }
    if (totalQty <= 0) { toast.error('Enter the arrived quantity'); return }
    setBusy(true)
    try {
      const dated = batches.filter(b => b.expiry_date && Number(b.quantity) > 0)
      const earliest = dated.map(b => b.expiry_date).sort()[0] || null
      const actor = note.created_by || (await currentActor())

      // Confirm arrival only — stock is added later via Update Inventory
      // (idempotent). We only link the inventory item + record qty/expiry.
      const upd = { active: true }
      if (!invItem?.origin) upd.origin = classifyOrigin(line.product_name)
      const { error: uErr } = await supabase.from('items').update(upd).eq('id', itemId)
      if (uErr) throw uErr

      const patch = {
        received_qty: totalQty,
        expiry_date: earliest,
        status: 'arrived',
        matched: true,
        item_id: itemId,
        received_by: actor,
        received_at: new Date().toISOString(),
        // store multi-batch detail in note field if more than one expiry
        note: dated.length > 1
          ? `Batches: ${dated.map(b => `${b.quantity}@${b.expiry_date}`).join(', ')}`
          : (line.note || null),
      }
      const { error: lErr } = await supabase.from('boat_note_items').update(patch).eq('id', line.id)
      if (lErr) throw lErr

      logBoatNoteEvent(note.id, 'arrived', {
        boatNoteItemId: line.id, actor,
        partNumber: line.part_number, productName: line.product_name, department: line.department,
        qty: totalQty,
        detail: `Confirmed arrived · linked to ${invItem?.name || 'inventory'}${earliest ? ` · expiry ${earliest}` : ''} · stock not updated yet`,
      })

      const extra = Math.max(0, totalQty - alreadyPosted)
      toast.success(isAdjust
        ? `Received qty set to ${totalQty} ${line.unit || ''} · Update Inventory will add ${extra > 0 ? `the extra ${extra}` : 'nothing (already posted)'}`
        : `Marked arrived · ${totalQty} ${line.unit || ''} (use Update Inventory to post stock)`)
      onDone(patch, 0)
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <Modal isOpen onClose={onClose} title={isAdjust ? 'Adjust received quantity' : 'Confirm item arrived'} size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="success" loading={busy} onClick={post}><CheckCircle2 className="w-4 h-4" /> {isAdjust ? 'Save new qty' : 'Confirm Arrived'} {totalQty || ''}</Button>
      </>}>
      {isAdjust && (
        <div className="mb-3 flex items-center gap-2 bg-[#00AEEF]/10 border border-[#00AEEF]/30 rounded-lg px-3 py-2 text-xs text-[#7dd3fc]">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {alreadyPosted} already in inventory. Set the new total received — pressing Update Inventory afterwards adds only the extra, never doubles.
        </div>
      )}
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
              {invItem.active === false && <div className="text-amber-400 text-xs mt-1 font-medium">Currently inactive — receiving will reactivate it</div>}
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
                  <span className="text-sm text-slate-200 truncate">{i.name}{i.active === false ? <span className="text-amber-400"> (inactive)</span> : ''}</span>
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
            Total arrived: <span className="text-slate-200 font-semibold">{totalQty || 0}</span> {line.unit}
            {batches.length > 1 ? ` across ${batches.filter(b => Number(b.quantity) > 0).length} batches` : ''}.
            Leave the date blank for items with no expiry.
          </p>
        </div>
      </div>
    </Modal>
  )
}

// ── Flag a line as NOT ARRIVED or WRONG ITEM, with a note ────────────────────
function IssueItemModal({ note: boatNote, line, inventory = [], onClose, onDone }) {
  const initKind = ['wrong_item', 'damaged', 'not_arrived', 'short'].includes(line.status) ? line.status : 'not_arrived'
  const [kind, setKind] = useState(initKind)
  const [note, setNote] = useState(line.note || '')
  const [qty,  setQty]  = useState(String(line.damaged_qty ?? line.short_qty ?? line.wrong_qty ?? ''))
  const [logReturn, setLogReturn] = useState(false)
  const [busy, setBusy] = useState(false)

  const LABELS = { not_arrived: 'not arrived', wrong_item: 'wrong item', damaged: 'damaged', short: 'short' }
  // Only DAMAGED and SHORT ask "how many is the problem" (e.g. 3 cases damaged);
  // the rest of the delivery is then received into inventory automatically.
  // NOT ARRIVED and WRONG ITEM are recorded straight away with no quantity.
  const needsQty = kind === 'damaged' || kind === 'short'
  const qtyLabel = kind === 'damaged' ? 'How many are damaged? (e.g. 3 cases)'
                 : kind === 'short' ? 'How many are short?' : 'Quantity'
  const canReturn = kind === 'wrong_item' || kind === 'damaged'

  const ordered = Number(line.ordered_qty) || 0
  const affected = Number(qty) || 0
  // For damaged/short the remainder (ordered − affected) is the good stock that
  // still gets received into inventory.
  const goodQty = needsQty ? Math.max(0, ordered - affected) : 0
  const invItem = useMemo(() => inventory.find(i => i.id === line.item_id) || null, [inventory, line.item_id])

  const btn = (k, label, active) =>
    <button key={k} onClick={() => setKind(k)}
      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${kind === k ? active : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}>
      {label}
    </button>

  const save = async () => {
    const n = Number(qty)
    if (needsQty && (!n || n <= 0)) { toast.error('Enter how many are affected'); return }
    if (needsQty && n > ordered) { toast.error(`Only ${ordered} ${line.unit || ''} were ordered`); return }
    // A wrong item must be explained -- record WHY it is wrong.
    if (kind === 'wrong_item' && !note.trim()) { toast.error('Please write a note explaining why it is the wrong item'); return }
    setBusy(true)
    try {
      const actor = boatNote?.created_by || (await currentActor())
      let receivedGood = 0

      const patch = {
        status: kind,
        note: note.trim() || null,
        damaged_qty: kind === 'damaged' ? n : null,
        wrong_qty:   kind === 'wrong_item' ? n : null,
        short_qty:   kind === 'short' ? n : null,
      }

      // For damaged / short: record the good remainder as arrived qty.
      // Inventory is only updated later via Update Inventory (idempotent).
      if (needsQty && goodQty > 0) {
        receivedGood = goodQty
        patch.received_qty = goodQty
        patch.received_by = actor
        patch.received_at = new Date().toISOString()
        if (line.item_id) {
          await supabase.from('items').update({ active: true }).eq('id', line.item_id).catch(() => {})
        }
      }

      const { error } = await supabase.from('boat_note_items').update(patch).eq('id', line.id)
      if (error) throw error

      if (logReturn && canReturn) {
        await supabase.from('item_returns').insert({
          boat_note_item_id: line.id, item_id: line.item_id || null,
          part_number: line.part_number || null, product_name: line.product_name || null,
          supplier: line.supplier || null, po_number: line.po_number || null,
          unit: line.unit || 'EA', qty: (needsQty ? n : line.ordered_qty) || 0,
          reason: kind, status: 'awaiting_return', created_by: actor,
          replacement_part_number: line.part_number || null,
          replacement_product_name: line.product_name || null,
          replacement_qty: (needsQty ? n : line.ordered_qty) || 0,
        }).catch(() => {})
      }

      // Persistent boat-note history entry.
      if (boatNote?.id) {
        logBoatNoteEvent(boatNote.id, kind, {
          boatNoteItemId: line.id, actor,
          partNumber: line.part_number, productName: line.product_name, department: line.department,
          qty: needsQty ? n : null,
          detail: needsQty
            ? `${LABELS[kind]} ${n} ${line.unit || ''}${receivedGood ? ` · ${receivedGood} good to post later` : ''}${note.trim() ? ` · ${note.trim()}` : ''}`
            : `${LABELS[kind]}${note.trim() ? ` · ${note.trim()}` : ''}`,
        })
      }

      toast.success(`Marked as ${LABELS[kind]}${receivedGood ? ` · ${receivedGood} good pending inventory update` : ''}${logReturn && canReturn ? ' + return logged' : ''}`)
      onDone(patch, receivedGood ? 1 : 0)
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
        <div className="grid grid-cols-2 gap-2">
          {btn('not_arrived', 'Not arrived', 'bg-red-600/20 border-red-500 text-red-300')}
          {btn('short',       'Short',       'bg-amber-600/20 border-amber-500 text-amber-300')}
          {btn('wrong_item',  'Wrong item',  'bg-orange-600/20 border-orange-500 text-orange-300')}
          {btn('damaged',     'Damaged',     'bg-red-600/20 border-red-500 text-red-300')}
        </div>
        {!needsQty && (
          <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-400">
            {kind === 'not_arrived' ? 'Recorded as not arrived — no quantity needed.' : 'Recorded as a wrong item — no quantity needed, but please note below WHY it is wrong (e.g. wrong size / brand / product).'}
          </div>
        )}
        {needsQty && (
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{qtyLabel}</label>
            <input type="number" min="0.01" step="0.01" value={qty} onChange={e => setQty(e.target.value)}
              placeholder={`e.g. 3  (of ${line.ordered_qty} ${line.unit})`}
              className="input w-full mt-1.5 text-sm" />
            {affected > 0 && (
              <p className="text-xs text-slate-500 mt-1.5">
                {affected} {line.unit} {kind}{goodQty > 0
                  ? <> · the remaining <span className="text-green-400 font-semibold">{goodQty} {line.unit}</span> will be received into inventory{!line.item_id ? ' (once matched)' : ''}.</>
                  : ' · nothing left to receive.'}
              </p>
            )}
          </div>
        )}
        {canReturn && (
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={logReturn} onChange={e => setLogReturn(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800 text-teal-500 focus:ring-teal-500" />
            Log a return to the supplier for these units
          </label>
        )}
        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Note{kind === 'wrong_item' && <span className="text-red-400 normal-case"> * required — why is it wrong?</span>}
          </label>
          <textarea rows={3} value={note} onChange={e => setNote(e.target.value)}
            placeholder={kind === 'not_arrived' ? 'e.g. supplier to redeliver Thursday' : kind === 'short' ? 'e.g. ordered 10, only 7 arrived' : 'e.g. sent 1.5L bottles instead of 500mL'}
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
  const [expandedDate, setExpandedDate] = useState(null)

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
      delivery_day: r.boat_notes?.delivery_day || '',
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

  // Group outstanding lines by boat-note date (same shape as boat notes list).
  const byDate = useMemo(() => {
    const map = new Map()
    for (const r of filtered) {
      const key = r.note_date || 'unknown'
      if (!map.has(key)) map.set(key, { date: key, labels: new Set(), items: [] })
      const g = map.get(key)
      if (r.note_label) g.labels.add(r.note_label)
      g.items.push(r)
    }
    return [...map.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="bg-red-900/15 border border-red-700/30 rounded-lg p-4 text-sm text-red-200">
        <p className="font-semibold flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4" /> Not arrived — by boat note date</p>
        <p>Every boat-note line marked <strong>not arrived</strong> or <strong>wrong item</strong>, grouped under the boat note date just like the boat note list. Confirmed arrived items stay on the boat note until you run <strong>Update Inventory</strong>.</p>
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
      ) : byDate.length === 0 ? (
        <div className="card text-center text-slate-500 py-12">Nothing outstanding 🎉</div>
      ) : (
        <>
          <p className="text-xs text-slate-400">{filtered.length} outstanding line{filtered.length !== 1 ? 's' : ''} across {byDate.length} date{byDate.length !== 1 ? 's' : ''}</p>
          {byDate.map(group => {
            const open = expandedDate === group.date
            return (
              <div key={group.date} className="card p-0 overflow-hidden">
                <button onClick={() => setExpandedDate(open ? null : group.date)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-700/30 text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                    <div className="min-w-0">
                      <p className="font-medium text-slate-100">{group.date || 'Unknown date'}</p>
                      <p className="text-xs text-slate-500 truncate">{[...group.labels].join(' · ') || 'Boat note'}</p>
                    </div>
                  </div>
                  <Badge variant="red">{group.items.length} not arrived</Badge>
                </button>
                {open && (
                  <div className="border-t border-slate-700 overflow-x-auto">
                    <Table>
                      <Thead><tr>
                        <Th>Boat Note</Th>
                        <Th>Store / Dept</Th>
                        <Th>Code</Th>
                        <Th>Product</Th>
                        <Th>Ordered</Th>
                        <Th>Problem</Th>
                        <Th>Note</Th>
                        <Th></Th>
                      </tr></Thead>
                      <Tbody>
                        {group.items.map(r => (
                          <Tr key={r.id}>
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
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

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
        .or('status.eq.received,posted_to_inventory.eq.true'))
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

// ═══════════════════════════════════════════════════════════════════════════
// WEEKLY LOG — every delivery problem (damaged / not arrived / wrong / short),
// grouped by ISO week so you can review any past week at any time.
// ═══════════════════════════════════════════════════════════════════════════
const ISSUE_CATS = [
  { key: 'not_arrived', label: 'Not Arrived', badge: 'red',    qtyField: null },
  { key: 'short',       label: 'Short',       badge: 'yellow', qtyField: 'short_qty' },
  { key: 'damaged',     label: 'Damaged',     badge: 'red',    qtyField: 'damaged_qty' },
  { key: 'wrong_item',  label: 'Wrong Item',  badge: 'orange', qtyField: 'wrong_qty' },
]
const ISSUE_LABEL = Object.fromEntries(ISSUE_CATS.map(c => [c.key, c.label]))

function isoWeek(dateStr) {
  if (!dateStr) return { key: '0000-Unknown', label: 'Unknown week' }
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00')
  if (isNaN(d)) return { key: '0000-Unknown', label: 'Unknown week' }
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7)
  return { key: `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, label: `Week ${week} · ${t.getUTCFullYear()}` }
}
const issueQtyOf = (r) => r.damaged_qty ?? r.short_qty ?? r.wrong_qty ?? null
// The KIND of problem (Damaged / Short / Wrong Item) so the quantity is never
// confused with a quantity issued to a department.
const problemTypeOf = (r) => {
  if (r.damaged_qty != null && r.damaged_qty !== '') return 'Damaged'
  if (r.short_qty   != null && r.short_qty   !== '') return 'Short'
  if (r.wrong_qty   != null && r.wrong_qty   !== '') return 'Wrong Item'
  if (r.status === 'damaged')    return 'Damaged'
  if (r.status === 'short')      return 'Short'
  if (r.status === 'wrong_item') return 'Wrong Item'
  if (r.status === 'not_arrived') return 'Not Arrived'
  return ''
}

function WeeklyIssuesTab() {
  const [rows, setRows]   = useState([])
  const [loading, setLoad]= useState(true)
  const [catF, setCatF]   = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen]   = useState({})

  const load = async () => {
    setLoad(true)
    const { data } = await selectAll(() =>
      supabase.from('boat_note_items')
        .select('*, boat_notes(note_date,label,delivery_day)')
        .in('status', ['not_arrived', 'wrong_item', 'damaged', 'short']))
    const list = (data || []).map(r => ({
      ...r,
      note_date: r.boat_notes?.note_date || (r.received_at ? String(r.received_at).slice(0, 10) : null),
      note_label: r.boat_notes?.label || '',
    }))
    setRows(list); setLoad(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => rows.filter(r =>
    (!catF || r.status === catF) &&
    (!search || `${r.product_name} ${r.part_number} ${r.supplier} ${r.po_number}`.toLowerCase().includes(search.toLowerCase()))
  ), [rows, catF, search])

  const weeks = useMemo(() => {
    const map = new Map()
    for (const r of filtered) {
      const w = isoWeek(r.note_date)
      if (!map.has(w.key)) map.set(w.key, { ...w, items: [] })
      map.get(w.key).items.push(r)
    }
    return [...map.values()].sort((a, b) => b.key.localeCompare(a.key))
  }, [filtered])

  const countBy = (items, k) => items.filter(i => i.status === k).length
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }))

  const exportCsv = () => {
    const h = ['Week', 'Date', 'Boat Note', 'Status', 'Code', 'Product', 'Dept', 'Unit', 'Ordered', 'Problem Qty', 'Problem Type', 'Supplier', 'PO', 'Note']
    const lines = weeks.flatMap(w => w.items.map(r => [
      w.label, r.note_date || '', r.note_label || '', ISSUE_LABEL[r.status] || r.status,
      r.part_number || '', r.product_name || '', r.department || '', r.unit || '',
      r.ordered_qty ?? '', issueQtyOf(r) ?? '', problemTypeOf(r), r.supplier || '', r.po_number || '', (r.note || '').replace(/\n/g, ' '),
    ]))
    const csv = [h, ...lines].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `weekly_delivery_issues.csv`; a.click()
    toast.success('Weekly log exported')
  }

  const totals = ISSUE_CATS.map(c => ({ ...c, n: filtered.filter(r => r.status === c.key).length }))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={catF} onChange={e => setCatF(e.target.value)} className="input text-sm w-auto">
          <option value="">All problems</option>
          {ISSUE_CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9 text-sm" placeholder="Search item, supplier, PO…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={exportCsv} className="btn-secondary btn-sm"><FileDown className="w-4 h-4" /> Export</button>
        <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {totals.map(t => (
          <button key={t.key} onClick={() => setCatF(catF === t.key ? '' : t.key)}
            className={`card-sm text-center ${catF === t.key ? 'ring-2 ring-teal-500' : ''}`}>
            <p className="text-2xl font-bold text-slate-100">{t.n}</p>
            <p className="text-slate-500 text-xs mt-1">{t.label}</p>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : weeks.length === 0 ? (
        <div className="card text-center py-16 text-slate-500"><CalendarRange className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="font-medium">No delivery problems logged</p></div>
      ) : weeks.map(w => (
        <div key={w.key} className="card p-0 overflow-hidden">
          <button onClick={() => toggle(w.key)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/30 transition-colors">
            <div className="flex items-center gap-2">
              {open[w.key] ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              <span className="font-semibold text-slate-100">{w.label}</span>
              <span className="text-xs text-slate-500">({w.items.length} item{w.items.length !== 1 ? 's' : ''})</span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {ISSUE_CATS.map(c => countBy(w.items, c.key) > 0 && (
                <Badge key={c.key} variant={c.badge}>{c.label}: {countBy(w.items, c.key)}</Badge>
              ))}
            </div>
          </button>
          {open[w.key] && (
            <div className="border-t border-slate-700/50 overflow-x-auto">
              <Table>
                <Thead><tr>
                  <Th>Date</Th><Th>Status</Th><Th>Code</Th><Th>Product</Th><Th>Dept</Th>
                  <Th>Ordered</Th><Th>Problem Qty</Th><Th>Problem Type</Th><Th>Supplier</Th><Th>PO</Th><Th>Note</Th>
                </tr></Thead>
                <Tbody>
                  {w.items.map(r => (
                    <Tr key={r.id}>
                      <Td className="text-slate-400 text-xs whitespace-nowrap">{r.note_date || '—'}</Td>
                      <Td><StatusBadge status={r.status} /></Td>
                      <Td className="font-mono text-xs text-slate-300">{r.part_number || '—'}</Td>
                      <Td className="font-medium text-slate-100 max-w-xs truncate">{r.product_name}</Td>
                      <Td className="text-slate-400 text-xs">{r.department || '—'}</Td>
                      <Td className="text-slate-300">{r.ordered_qty} <span className="text-slate-500 text-xs">{r.unit}</span></Td>
                      <Td className="text-amber-400 font-semibold">{issueQtyOf(r) ?? '—'}</Td>
                      <Td className="text-slate-400 text-xs">{problemTypeOf(r) || '—'}</Td>
                      <Td className="text-slate-400 text-xs max-w-[10rem] truncate">{r.supplier || '—'}</Td>
                      <Td className="font-mono text-xs text-slate-400">{r.po_number || '—'}</Td>
                      <Td className="text-slate-500 text-xs max-w-xs truncate">{r.note || '—'}</Td>
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

// ═══════════════════════════════════════════════════════════════════════════
// RETURNS — wrong / damaged items sent back to the supplier, and the (sometimes
// changed) replacement that comes back. Update replacements intelligently.
// ═══════════════════════════════════════════════════════════════════════════
const RETURN_STATUS = {
  awaiting_return: { label: 'Awaiting return', badge: 'yellow' },
  returned:        { label: 'Returned',        badge: 'orange' },
  replaced:        { label: 'Replaced',         badge: 'green' },
  changed:         { label: 'Replaced (changed)', badge: 'purple' },
  closed:          { label: 'Closed',           badge: 'gray' },
}

function ReturnsTab() {
  const [rows, setRows]     = useState([])
  const [loading, setLoad]  = useState(true)
  const [statusF, setStatusF] = useState('')
  const [search, setSearch] = useState('')
  const [replacing, setReplacing] = useState(null)  // return row being resolved

  const load = async () => {
    setLoad(true)
    const { data } = await selectAll(() =>
      supabase.from('item_returns').select('*').order('created_at', { ascending: false }))
    setRows(data || []); setLoad(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => rows.filter(r =>
    (!statusF || r.status === statusF) &&
    (!search || `${r.product_name} ${r.part_number} ${r.supplier} ${r.po_number}`.toLowerCase().includes(search.toLowerCase()))
  ), [rows, statusF, search])

  const markReturned = async (r) => {
    const { error } = await supabase.from('item_returns').update({ status: 'returned' }).eq('id', r.id)
    if (error) return toast.error(error.message)
    toast.success('Marked as returned'); load()
  }
  const closeReturn = async (r) => {
    if (!confirm('Close this return (no replacement expected)?')) return
    await supabase.from('item_returns').update({ status: 'closed', resolved_at: new Date().toISOString() }).eq('id', r.id)
    toast.success('Return closed'); load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={statusF} onChange={e => setStatusF(e.target.value)} className="input text-sm w-auto">
          <option value="">All statuses</option>
          {Object.entries(RETURN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9 text-sm" placeholder="Search item, supplier, PO…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16 text-slate-500"><Undo2 className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="font-medium">No returns logged</p><p className="text-sm mt-1">Flag a wrong/damaged item on the History tab and tick "Log a return".</p></div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <Thead><tr>
              <Th>Logged</Th><Th>Reason</Th><Th>Code</Th><Th>Product</Th><Th>Qty</Th>
              <Th>Supplier</Th><Th>PO</Th><Th>Status</Th><Th>Replacement</Th><Th></Th>
            </tr></Thead>
            <Tbody>
              {filtered.map(r => {
                const st = RETURN_STATUS[r.status] || { label: r.status, badge: 'gray' }
                return (
                  <Tr key={r.id}>
                    <Td className="text-slate-400 text-xs whitespace-nowrap">{String(r.created_at || '').slice(0, 10)}</Td>
                    <Td><Badge variant={r.reason === 'damaged' ? 'red' : 'orange'}>{r.reason === 'wrong_item' ? 'wrong item' : r.reason}</Badge></Td>
                    <Td className="font-mono text-xs text-slate-300">{r.part_number || '—'}</Td>
                    <Td className="font-medium text-slate-100 max-w-xs truncate">{r.product_name}</Td>
                    <Td className="text-slate-300">{r.qty} <span className="text-slate-500 text-xs">{r.unit}</span></Td>
                    <Td className="text-slate-400 text-xs max-w-[10rem] truncate">{r.supplier || '—'}</Td>
                    <Td className="font-mono text-xs text-slate-400">{r.po_number || '—'}</Td>
                    <Td><Badge variant={st.badge}>{st.label}</Badge></Td>
                    <Td className="text-xs text-slate-400 max-w-[12rem] truncate">
                      {r.replacement_product_name && (r.status === 'replaced' || r.status === 'changed')
                        ? <span>{r.changed && <span className="text-purple-400 font-semibold">CHANGED → </span>}{r.replacement_part_number} · {r.replacement_product_name} × {r.replacement_qty}</span>
                        : '—'}
                    </Td>
                    <Td>
                      <div className="flex gap-1 justify-end">
                        {r.status === 'awaiting_return' && (
                          <button onClick={() => markReturned(r)} className="btn-ghost btn-sm text-xs" title="Mark as sent back"><Undo2 className="w-3.5 h-3.5" /></button>
                        )}
                        {(r.status === 'awaiting_return' || r.status === 'returned') && (
                          <button onClick={() => setReplacing(r)} className="btn-secondary btn-sm text-xs"><PackageCheck className="w-3.5 h-3.5" /> Replacement</button>
                        )}
                        {r.status !== 'closed' && (
                          <button onClick={() => closeReturn(r)} className="btn-ghost btn-sm text-xs" title="Close"><X className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        </div>
      )}

      {replacing && <ReplacementModal ret={replacing} onClose={() => setReplacing(null)} onDone={() => { setReplacing(null); load() }} />}
    </div>
  )
}

// Records the replacement that came back. Pre-fills with the original item and
// auto-detects when a DIFFERENT (changed) item was sent instead.
function ReplacementModal({ ret, onClose, onDone }) {
  const [part, setPart] = useState(ret.replacement_part_number || ret.part_number || '')
  const [name, setName] = useState(ret.replacement_product_name || ret.product_name || '')
  const [qty,  setQty]  = useState(String(ret.replacement_qty ?? ret.qty ?? ''))
  const [busy, setBusy] = useState(false)

  const changed = (part.trim() !== (ret.part_number || '').trim()) ||
                  (name.trim().toLowerCase() !== (ret.product_name || '').trim().toLowerCase())

  const save = async () => {
    const n = Number(qty)
    if (!n || n <= 0) { toast.error('Enter the replacement quantity'); return }
    setBusy(true)
    try {
      const patch = {
        status: changed ? 'changed' : 'replaced',
        changed,
        replacement_part_number: part.trim() || null,
        replacement_product_name: name.trim() || null,
        replacement_qty: n,
        resolved_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('item_returns').update(patch).eq('id', ret.id)
      if (error) throw error
      toast.success(changed ? 'Replacement recorded (item changed)' : 'Replacement recorded')
      onDone()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <Modal isOpen onClose={onClose} title="Record replacement" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}><PackageCheck className="w-4 h-4" /> Save</Button></>}>
      <div className="space-y-4">
        <div className="bg-slate-700/30 rounded-lg p-3 text-xs text-slate-400">
          Original: <span className="font-mono text-[#00AEEF]">{ret.part_number || '—'}</span> · {ret.product_name} × {ret.qty} {ret.unit}
        </div>
        <Input label="Replacement code" value={part} onChange={e => setPart(e.target.value)} placeholder="Item code that came back" />
        <Input label="Replacement product" value={name} onChange={e => setName(e.target.value)} placeholder="Product name" />
        <Input label="Replacement quantity" type="number" min="0.01" step="0.01" value={qty} onChange={e => setQty(e.target.value)} />
        {changed && (
          <div className="bg-purple-900/30 border border-purple-700/40 rounded-lg p-3 text-sm text-purple-300">
            This differs from the original — it will be recorded as a <strong>changed</strong> replacement.
          </div>
        )}
      </div>
    </Modal>
  )
}
