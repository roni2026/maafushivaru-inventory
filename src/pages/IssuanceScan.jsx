import { useState, useEffect, useRef } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  ScanLine, Upload, Loader, Trash2, Check, X, FileText, ChevronLeft,
  FileWarning, CheckCircle2, ArrowRight, Building2, CalendarClock, Plus,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Input, { Select } from '../components/ui/Input'
import { ocrSpaceExtract, isTooLarge, prettySize, MAX_OCR_LABEL, DEFAULT_OCR_API_KEY } from '../lib/ocrspace'
import { parseRequisitions, NON_ISSUE_REASONS } from '../lib/requisition'

const today = () => new Date().toISOString().split('T')[0]
const STAGE = { UPLOAD: 'upload', PROCESSING: 'processing', REVIEW: 'review', DONE: 'done' }

export default function IssuanceScan() {
  const navigate = useNavigate()
  const [stage, setStage]   = useState(STAGE.UPLOAD)
  const [items, setItems]   = useState([])
  const [reqs, setReqs]     = useState([])       // parsed requisitions queue
  const [idx, setIdx]       = useState(0)        // which requisition we're reviewing
  const [issuedBy, setIssuedBy] = useState('Roni')
  const [progress, setProgress] = useState({ label: '', pct: 0 })
  const [oversized, setOversized] = useState([])
  const [summary, setSummary]     = useState([])
  const [busy, setBusy]     = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock,stores(name)').eq('active', true))
      .then(({ data }) => setItems(data || []))
  }, [])

  // ── Upload + OCR + parse ────────────────────────────────────────────
  const handleFiles = async (fileList) => {
    const files = [...(fileList || [])]
    if (!files.length) return
    const ok = files.filter(f => !isTooLarge(f))
    setOversized(files.filter(f => isTooLarge(f)))
    if (!ok.length) return

    setStage(STAGE.PROCESSING)
    const collected = []
    const apiKey = (await supabase.from('settings').select('value').eq('key', 'ocr_space_api_key').maybeSingle()).data?.value || DEFAULT_OCR_API_KEY
    for (let i = 0; i < ok.length; i++) {
      const f = ok[i]
      setProgress({ label: `Reading ${f.name}…`, pct: 10 })
      try {
        const text = await ocrSpaceExtract(f, { apiKey, onProgress: p => setProgress({ label: `${f.name}: ${p.label}`, pct: p.pct }) })
        const parsed = parseRequisitions(text, items)
        parsed.forEach(p => collected.push({
          ...p, file: f.name, date: p.header.req_date || today(), issuedBy,
          lines: p.lines,
        }))
      } catch (e) {
        toast.error(`${f.name}: ${e.message}`)
      }
    }
    if (!collected.length) { toast.error('No requisition lines found. Check the scan quality.'); setStage(STAGE.UPLOAD); return }
    setReqs(collected); setIdx(0); setStage(STAGE.REVIEW)
    toast.success(`Found ${collected.length} requisition${collected.length !== 1 ? 's' : ''} · ${collected.reduce((s, r) => s + r.lines.length, 0)} lines`)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Line editing on the current requisition ─────────────────────────────────
  const cur = reqs[idx]
  const setLines = (fn) => setReqs(prev => prev.map((r, i) => i === idx ? { ...r, lines: fn(r.lines) } : r))
  const setReqDate = (d) => setReqs(prev => prev.map((r, i) => i === idx ? { ...r, date: d } : r))

  const editLine = (id, field, val) => setLines(lines => lines.map(l => {
    if (l.id !== id) return l
    const u = { ...l, [field]: val }
    if (field === 'part_number') {
      const m = items.find(it => String(it.part_number).replace(/^0+/, '') === String(val).replace(/^0+/, ''))
      u.item_id = m?.id || null; u.matched = !!m; u.item_name = m?.name || u.product; u.uom = m?.unit || u.uom; u.store = m?.stores?.name || ''
    }
    return u
  }))
  const toggleIssued = (id) => setLines(lines => lines.map(l => l.id === id
    ? { ...l, issued: !l.issued, status: !l.issued ? 'issued' : (l.reason || 'not_available'), reason: !l.issued ? '' : (l.reason || 'not_available') }
    : l))
  const setReason = (id, reason) => setLines(lines => lines.map(l => l.id === id ? { ...l, reason, status: reason, issued: false } : l))
  const delLine = (id) => setLines(lines => lines.filter(l => l.id !== id))
  const addLine = () => setLines(lines => [...lines, {
    id: Math.random().toString(36).slice(2), line_no: lines.length + 1, part_number: '', product: '',
    product_desc: '', qty: 1, uom: 'EA', price: 0, extension: 0, item_id: null, item_name: '',
    store: '', current_stock: null, matched: false, issued: true, status: 'issued', reason: '', note: '',
  }])

  // ── Save the current requisition ────────────────────────────────────────
  const confirmRequisition = async () => {
    if (!issuedBy.trim()) { toast.error('Enter who issued the items'); return }
    setBusy(true)
    const r = cur
    try {
      // 1. requisition header
      const { data: req, error: reqErr } = await supabase.from('requisitions').insert({
        req_number: r.header.req_number, req_date: r.header.req_date || null,
        required_delivery_date: r.header.required_delivery_date || null,
        req_type: r.header.req_type, purchase_type: r.header.purchase_type,
        requestor: r.header.requestor, title: r.header.title, department: r.header.department,
        source_location: r.header.source_location, destination_location: r.header.destination_location,
        subject: r.header.subject, date: r.date, source_file: r.file,
        total_lines: r.lines.length, issued_lines: r.lines.filter(l => l.issued).length,
        issued_by: issuedBy,
      }).select().single()
      if (reqErr) throw reqErr

      // 2. requisition_items (full record incl. non-issued reasons)
      await supabase.from('requisition_items').insert(r.lines.map(l => ({
        requisition_id: req.id, line_no: l.line_no, part_number: l.part_number,
        product: l.item_name || l.product, product_desc: l.product_desc, ordered_qty: Number(l.qty) || 0,
        issued_qty: l.issued ? (Number(l.qty) || 0) : 0, uom: l.uom, price: Number(l.price) || 0,
        extension: Number(l.extension) || 0, item_id: l.item_id, status: l.issued ? 'issued' : (l.reason || 'not_available'),
        note: l.note,
      })))

      // 3. issuances + stock deduction for issued, matched lines
      let logged = 0, skipped = 0
      for (const l of r.lines) {
        if (!l.issued) continue
        if (!l.item_id) { skipped++; continue }
        const { data: it } = await supabase.from('items').select('current_stock').eq('id', l.item_id).single()
        const newStock = Math.max(0, Number(it.current_stock) - Number(l.qty))
        await supabase.from('items').update({ current_stock: newStock }).eq('id', l.item_id)
        await supabase.from('issuances').insert({
          item_id: l.item_id, date: r.date, quantity_issued: Number(l.qty),
          issued_by: issuedBy, requisition_id: req.id, req_number: r.header.req_number,
          note: `Requisition ${r.header.req_number || r.file}`,
        })
        await supabase.from('stock_updates').insert({
          item_id: l.item_id, date: r.date, quantity_change: -Number(l.qty), new_quantity: newStock,
          updated_by: issuedBy, note: `Issuance · ${r.header.req_number || 'requisition'}`,
        })
        logged++
      }
      setSummary(s => [...s, { req: r.header.req_number || r.file, logged, skipped }])
      toast.success(`${r.header.req_number || r.file}: logged ${logged}${skipped ? ` · ${skipped} unmatched skipped` : ''}`)
      if (idx + 1 < reqs.length) setIdx(idx + 1)
      else setStage(STAGE.DONE)
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  const reset = () => { setReqs([]); setIdx(0); setSummary([]); setOversized([]); setStage(STAGE.UPLOAD) }

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Scan Requisition</h1>
          <p className="page-sub">OCR a requisition, confirm issued quantities, then deduct stock</p>
        </div>
        {(stage === STAGE.REVIEW || stage === STAGE.DONE) && (
          <Button variant="secondary" size="sm" onClick={reset}><ChevronLeft className="w-4 h-4" /> Start over</Button>
        )}
      </div>

      {stage === STAGE.UPLOAD && (
        <div className="space-y-4">
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4 text-sm text-blue-300">
            <p className="font-semibold mb-2">📋 How it works</p>
            <ol className="list-decimal ml-4 space-y-1.5">
              <li>Scan the requisition to <strong>PDF or photo</strong> — keep each file under <strong>{MAX_OCR_LABEL}</strong></li>
              <li>Items are matched by <strong>part number</strong> (item code) — the most reliable signal</li>
              <li><strong>Confirm or edit</strong> the issued quantity for each line</li>
              <li>For items you didn't issue, untick and pick a reason — <em>wrong code, not available, no longer needed, returned</em></li>
              <li>Multi-page &amp; multi-requisition scans are split automatically by REQ number</li>
            </ol>
          </div>
          {oversized.length > 0 && (
            <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4 text-sm text-red-300">
              <p className="font-semibold flex items-center gap-2 mb-2"><FileWarning className="w-4 h-4" /> File too large — skipped</p>
              <ul className="space-y-1">{oversized.map((f, i) => (
                <li key={i} className="flex justify-between gap-3 bg-red-950/30 rounded px-3 py-1.5">
                  <span className="font-mono truncate">{f.name}</span><span className="text-red-400 font-semibold">{prettySize(f.size)} &gt; {MAX_OCR_LABEL}</span>
                </li>))}</ul>
            </div>
          )}
          <div onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
            className="card border-2 border-dashed border-slate-600 hover:border-teal-500 cursor-pointer transition-all text-center py-14 hover:bg-teal-900/10">
            <ScanLine className="w-11 h-11 mx-auto mb-3 text-slate-500" />
            <p className="text-base font-semibold text-slate-200">Drop scanned requisitions here</p>
            <p className="text-slate-500 text-xs mt-1.5">PDF, JPG, PNG · Multiple files · Max {MAX_OCR_LABEL} each</p>
            <button className="mt-4 btn-secondary btn-sm mx-auto"><Upload className="w-4 h-4" /> Browse Files</button>
            <input ref={fileRef} type="file" accept=".pdf,image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
          </div>
        </div>
      )}

      {stage === STAGE.PROCESSING && (
        <div className="card text-center py-16">
          <Loader className="w-12 h-12 mx-auto mb-4 text-teal-400 animate-spin" />
          <p className="text-base font-semibold text-slate-100">{progress.label}</p>
          <div className="mt-5 h-2.5 bg-slate-700 rounded-full overflow-hidden max-w-xs mx-auto">
            <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      )}

      {stage === STAGE.REVIEW && cur && (
        <div className="space-y-3">
          {reqs.length > 1 && (
            <div className="text-xs text-teal-400 font-medium">Requisition {idx + 1} of {reqs.length}</div>
          )}
          {/* requisition header card */}
          <div className="card-sm grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-sm">
            <HeaderField label="REQ Number" value={cur.header.req_number} mono />
            <HeaderField label="Purchase Type" value={cur.header.purchase_type} />
            <HeaderField label="Department" value={cur.header.department} />
            <HeaderField label="Source Location" value={cur.header.source_location} />
            <HeaderField label="Requestor" value={cur.header.requestor} />
            <HeaderField label="Destination" value={cur.header.destination_location} />
            <HeaderField label="Required Delivery" value={cur.header.required_delivery_date} />
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Issue Date</p>
              <input type="date" value={cur.date} onChange={e => setReqDate(e.target.value)} className="input text-sm py-1 w-full" />
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Issued by</span>
              <input value={issuedBy} onChange={e => setIssuedBy(e.target.value)} className="input text-sm py-1 w-36" />
            </div>
            <Button variant="secondary" size="sm" onClick={addLine}><Plus className="w-4 h-4" /> Add line</Button>
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-700 text-slate-300 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-2 py-2">#</th><th className="px-2 py-2">Part #</th><th className="px-2 py-2">Product</th>
                  <th className="px-2 py-2">UOM</th><th className="px-2 py-2">Qty</th><th className="px-2 py-2">Issued?</th>
                  <th className="px-2 py-2">Reason (if not)</th><th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40">
                {cur.lines.map(l => (
                  <tr key={l.id} className={l.issued ? '' : 'bg-red-900/5'}>
                    <td className="px-2 py-1.5 text-slate-500 text-xs">{l.line_no}</td>
                    <td className="px-2 py-1.5">
                      <input className="input text-xs py-1 w-20 font-mono text-[#00AEEF]" value={l.part_number} onChange={e => editLine(l.id, 'part_number', e.target.value)} />
                    </td>
                    <td className="px-2 py-1.5 min-w-[200px]">
                      <div className="text-slate-100 text-sm">{l.matched ? l.item_name : l.product}</div>
                      {l.matched
                        ? <span className="text-[10px] text-green-400">matched{l.current_stock != null ? ` · stock ${l.current_stock}` : ''}</span>
                        : <span className="text-[10px] text-orange-400">no inventory match</span>}
                    </td>
                    <td className="px-2 py-1.5 text-slate-400 text-xs">{l.uom}</td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.01" className="input text-xs py-1 w-20" value={l.qty} onChange={e => editLine(l.id, 'qty', e.target.value)} />
                    </td>
                    <td className="px-2 py-1.5">
                      <button onClick={() => toggleIssued(l.id)}
                        className={`p-1.5 rounded-lg transition-colors ${l.issued ? 'bg-green-700/30 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
                        {l.issued ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="px-2 py-1.5">
                      {!l.issued && (
                        <select className="input text-xs py-1 w-40" value={l.reason || 'not_available'} onChange={e => setReason(l.id, e.target.value)}>
                          {NON_ISSUE_REASONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-2 py-1.5"><button onClick={() => delLine(l.id)} className="p-1 text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-slate-400">
              <Badge variant="green">{cur.lines.filter(l => l.issued && l.item_id).length} will be logged</Badge>{' '}
              <Badge variant="orange">{cur.lines.filter(l => l.issued && !l.item_id).length} unmatched</Badge>{' '}
              <Badge variant="gray">{cur.lines.filter(l => !l.issued).length} not issued</Badge>
            </div>
            <Button onClick={confirmRequisition} loading={busy} variant="success">
              <CheckCircle2 className="w-4 h-4" /> Confirm &amp; Issue {idx + 1 < reqs.length ? '— next' : ''}
            </Button>
          </div>
        </div>
      )}

      {stage === STAGE.DONE && (
        <div className="space-y-4">
          <div className="card text-center py-10">
            <CheckCircle2 className="w-14 h-14 mx-auto mb-3 text-green-400" />
            <p className="text-lg font-semibold text-slate-100">All requisitions processed</p>
            <p className="text-slate-400 text-sm mt-1">{summary.reduce((s, x) => s + x.logged, 0)} issuances logged</p>
          </div>
          <div className="card-sm space-y-1.5">
            {summary.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-mono text-slate-200">{s.req}</span>
                <span><span className="text-teal-400 font-semibold">{s.logged} logged</span>{s.skipped ? <span className="text-orange-400"> · {s.skipped} skipped</span> : null}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between gap-3">
            <Button variant="secondary" onClick={reset}><Upload className="w-4 h-4" /> Scan more</Button>
            <Button onClick={() => navigate('/issuance')}>View Issuances</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function HeaderField({ label, value, mono }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">{label}</p>
      <p className={`text-slate-200 truncate ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value || '—'}</p>
    </div>
  )
}
