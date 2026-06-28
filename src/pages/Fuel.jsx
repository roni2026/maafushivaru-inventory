import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase, selectAll, chunkedWrite } from '../lib/supabase'
import {
  Fuel as FuelIcon, Upload, Download, Plus, Trash2, RefreshCw, ScanLine,
  X, Loader, CheckCircle2, Save, Edit3, Droplet,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input, { Select } from '../components/ui/Input'
import { exportFuelExcel, fmtChitDate } from '../lib/fuelExcel'
import { parseFuelFile, parseFuelText, normFuelDate, monthKeyOf } from '../lib/fuelParse'
import { ocrSpaceExtract, DEFAULT_OCR_API_KEY, isTooLarge, prettySize, MAX_OCR_LABEL } from '../lib/ocrspace'

const today = () => new Date().toISOString().split('T')[0]
const curMonthKey = () => today().slice(0, 7)
const monthLabel = (key) => {
  if (!key) return ''
  const [y, m] = key.split('-')
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December']
  return `${names[(+m || 1) - 1]} ${y}`
}
const rid = () => Math.random().toString(36).slice(2)

export default function Fuel() {
  const [month,    setMonth]    = useState(curMonthKey())
  const [months,   setMonths]   = useState([curMonthKey()])
  const [records,  setRecords]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [exporting,setExporting]= useState(false)
  const [apiKey,   setApiKey]   = useState(DEFAULT_OCR_API_KEY)

  // add / edit modal
  const [showAdd, setShowAdd]   = useState(false)
  const [editId,  setEditId]    = useState(null)
  const [form,    setForm]      = useState({ fuel_type:'PETROL', fuel_date: today(), boat_name:'', qty:'', unit:'Ltrs' })

  // scan / import preview
  const [scanBusy, setScanBusy] = useState(false)
  const [scanProg, setScanProg] = useState(null)
  const [preview,  setPreview]  = useState(null)   // { rows, source }
  const scanInput = useRef(null)
  const fileInput = useRef(null)

  // ── load all distinct months + current month's records ──
  const loadMonths = useCallback(async () => {
    const { data } = await selectAll(() => supabase.from('dive_centre_fuel').select('month_key'))
    const set = new Set((data || []).map(r => r.month_key).filter(Boolean))
    set.add(curMonthKey())
    setMonths([...set].sort().reverse())
  }, [])

  const load = useCallback(async (mk) => {
    setLoading(true)
    try {
      const { data } = await selectAll(() =>
        supabase.from('dive_centre_fuel').select('*').eq('month_key', mk).order('fuel_date'))
      setRecords(data || [])
    } catch (err) { toast.error('Failed to load fuel: ' + err.message) }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadMonths()
    supabase.from('settings').select('key,value').eq('key', 'ocr_space_api_key')
      .then(({ data }) => { if (data?.[0]?.value) setApiKey(data[0].value) })
  }, [loadMonths])

  useEffect(() => { load(month) }, [month, load])

  const petrol = useMemo(() => records.filter(r => (r.fuel_type || '').toUpperCase() !== 'DIESEL'), [records])
  const diesel = useMemo(() => records.filter(r => (r.fuel_type || '').toUpperCase() === 'DIESEL'), [records])
  const petrolTotal = petrol.reduce((s, r) => s + Number(r.qty || 0), 0)
  const dieselTotal = diesel.reduce((s, r) => s + Number(r.qty || 0), 0)

  // ── add / edit a single entry ──
  const openAdd = (type = 'PETROL') => {
    setEditId(null)
    setForm({ fuel_type: type, fuel_date: month === curMonthKey() ? today() : `${month}-01`, boat_name:'', qty:'', unit:'Ltrs' })
    setShowAdd(true)
  }
  const openEdit = (rec) => {
    setEditId(rec.id)
    setForm({ fuel_type: rec.fuel_type, fuel_date: rec.fuel_date, boat_name: rec.boat_name, qty: String(rec.qty), unit: rec.unit || 'Ltrs' })
    setShowAdd(true)
  }
  const saveEntry = async () => {
    if (!form.boat_name.trim()) return toast.error('Enter a boat name')
    if (!form.fuel_date)        return toast.error('Pick a date')
    const qn = Number(form.qty)
    if (!isFinite(qn) || qn <= 0) return toast.error('Enter a valid quantity')
    setSaving(true)
    const payload = {
      fuel_type: form.fuel_type, fuel_date: form.fuel_date, boat_name: form.boat_name.trim(),
      qty: qn, unit: form.unit || 'Ltrs', month_key: monthKeyOf(form.fuel_date),
    }
    try {
      if (editId) {
        const { error } = await supabase.from('dive_centre_fuel').update(payload).eq('id', editId)
        if (error) throw error
        toast.success('Entry updated')
      } else {
        const { error } = await supabase.from('dive_centre_fuel').insert(payload)
        if (error) throw error
        toast.success('Entry added')
      }
      setShowAdd(false)
      await loadMonths()
      // jump to the month the entry belongs to so the user sees it
      if (payload.month_key !== month) setMonth(payload.month_key)
      else load(month)
    } catch (err) { toast.error(err.message) }
    setSaving(false)
  }

  const deleteEntry = async (rec) => {
    if (!confirm(`Delete ${rec.fuel_type} chit — ${rec.boat_name} ${rec.qty} ${rec.unit}?`)) return
    const { error } = await supabase.from('dive_centre_fuel').delete().eq('id', rec.id)
    if (error) return toast.error(error.message)
    setRecords(prev => prev.filter(r => r.id !== rec.id))
    toast.success('Deleted')
  }

  // ── upload a month sheet (xlsx / csv) ──
  const handleUpload = async (fileList) => {
    const file = fileList?.[0]; if (!file) return
    setScanBusy(true)
    try {
      const rows = await parseFuelFile(file)
      if (!rows.length) { toast.error('No fuel rows found in that file.'); setScanBusy(false); return }
      setPreview({ rows: rows.map(r => ({ ...r, id: rid() })), source: file.name })
    } catch (err) { toast.error('Could not read file: ' + err.message) }
    setScanBusy(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  // ── scan a chit photo / pdf via OCR.space ──
  const handleScan = async (fileList) => {
    const file = fileList?.[0]; if (!file) return
    if (isTooLarge(file)) { toast.error(`File too large (${prettySize(file.size)}). Max ${MAX_OCR_LABEL}.`); return }
    setScanBusy(true); setScanProg({ label: 'Starting…', pct: 5 })
    try {
      const text = await ocrSpaceExtract(file, { apiKey, onProgress: setScanProg })
      const rows = parseFuelText(text)
      if (!rows.length) {
        toast.error('No fuel chits detected. Try a clearer photo or add manually.')
      } else {
        setPreview({ rows: rows.map(r => ({ ...r, id: rid() })), source: file.name, raw: text })
      }
    } catch (err) { toast.error('OCR failed: ' + err.message) }
    setScanBusy(false); setScanProg(null)
    if (scanInput.current) scanInput.current.value = ''
  }

  // ── preview helpers ──
  const editPreviewRow = (id, field, val) => setPreview(p => ({
    ...p, rows: p.rows.map(r => r.id === id ? { ...r, [field]: val, month_key: field === 'fuel_date' ? monthKeyOf(val) : r.month_key } : r),
  }))
  const delPreviewRow = (id) => setPreview(p => ({ ...p, rows: p.rows.filter(r => r.id !== id) }))

  const confirmPreview = async () => {
    const rows = (preview?.rows || []).filter(r => r.boat_name && r.fuel_date && Number(r.qty) > 0)
    if (!rows.length) { toast.error('Nothing to save'); return }
    setSaving(true)
    try {
      const payload = rows.map(r => ({
        fuel_type: (r.fuel_type || 'PETROL').toUpperCase() === 'DIESEL' ? 'DIESEL' : 'PETROL',
        fuel_date: r.fuel_date, boat_name: String(r.boat_name).trim(),
        qty: Number(r.qty), unit: r.unit || 'Ltrs', month_key: r.month_key || monthKeyOf(r.fuel_date),
        source_file: preview.source || null,
      }))
      const { success, failed } = await chunkedWrite('dive_centre_fuel', payload, { mode: 'insert' })
      toast.success(`Added ${success} fuel entr${success !== 1 ? 'ies' : 'y'}${failed ? ` · ${failed} failed` : ''}`)
      setPreview(null)
      await loadMonths()
      const mk = payload[0]?.month_key
      if (mk && mk !== month) setMonth(mk); else load(month)
    } catch (err) { toast.error(err.message) }
    setSaving(false)
  }

  // ── export ──
  const exportExcel = async (whichMonth) => {
    setExporting(true)
    try {
      let recs = records
      if (whichMonth === 'all') {
        const { data } = await selectAll(() => supabase.from('dive_centre_fuel').select('*').order('fuel_date'))
        recs = data || []
      }
      if (!recs.length) { toast.error('No fuel records to export'); setExporting(false); return }
      await exportFuelExcel(recs, {
        filename: whichMonth === 'all'
          ? `DIVE_CENTRE_FUEL_ALL_${today()}.xlsx`
          : `DIVE_CENTRE_FUEL_${month}.xlsx`,
      })
      toast.success('Excel exported')
    } catch (err) { toast.error('Export failed: ' + err.message) }
    setExporting(false)
  }

  // ── render one fuel column table ──
  const FuelTable = ({ title, rows, total, type, accent }) => (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Droplet className={`w-4 h-4 ${accent}`} />
          <h2 className="font-display text-base font-semibold text-slate-100">{title}</h2>
          <Badge variant={type === 'DIESEL' ? 'blue' : 'yellow'}>{rows.length}</Badge>
        </div>
        <Button variant="secondary" onClick={() => openAdd(type)}><Plus className="w-4 h-4" /> Add</Button>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Thead><tr><Th>Date</Th><Th>Boat Name</Th><Th>Qty</Th><Th>Unit</Th><Th></Th></tr></Thead>
          <Tbody>
            {rows.length === 0 ? (
              <Tr><Td colSpan={5} className="text-center text-slate-500 py-6">No {type.toLowerCase()} entries this month</Td></Tr>
            ) : rows.map(r => (
              <Tr key={r.id}>
                <Td className="text-slate-300 text-sm whitespace-nowrap">{fmtChitDate(r.fuel_date)}</Td>
                <Td className="text-slate-100 text-sm">{r.boat_name}</Td>
                <Td className="text-slate-100 font-semibold">{r.qty}</Td>
                <Td className="text-slate-400 text-xs">{r.unit}</Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(r)} className="p-1 text-slate-500 hover:text-[#00AEEF]" title="Edit"><Edit3 className="w-4 h-4" /></button>
                    <button onClick={() => deleteEntry(r)} className="p-1 text-slate-500 hover:text-red-400" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
      <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-slate-700/50">
        <span className="text-xs text-slate-400 uppercase tracking-wide">Total</span>
        <span className={`text-lg font-bold ${accent}`}>{total}</span>
        <span className="text-xs text-slate-500">{rows[0]?.unit || 'Ltrs'}</span>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2"><FuelIcon className="w-6 h-6 text-[#00AEEF]" /> Dive Centre Fuel</h1>
          <p className="page-sub">Daily petrol &amp; diesel chits · scan, upload a month, edit and export</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={scanInput} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={e => handleScan(e.target.files)} />
          <input ref={fileInput} type="file" accept=".xlsx,.csv" className="hidden" onChange={e => handleUpload(e.target.files)} />
          <Button variant="secondary" onClick={() => scanInput.current?.click()} loading={scanBusy && !!scanProg}><ScanLine className="w-4 h-4" /> Scan Chit</Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()}><Upload className="w-4 h-4" /> Upload Month</Button>
          <Button variant="secondary" onClick={() => exportExcel('month')} loading={exporting}><Download className="w-4 h-4" /> Export Month</Button>
          <Button variant="secondary" onClick={() => exportExcel('all')}><Download className="w-4 h-4" /> Export All</Button>
        </div>
      </div>

      {/* Month selector + stats */}
      <div className="card-sm flex items-center gap-3 flex-wrap">
        <span className="text-xs text-slate-400 uppercase tracking-wide">Month</span>
        <select value={month} onChange={e => setMonth(e.target.value)} className="input text-sm w-auto py-1.5">
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button onClick={() => load(month)} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="text-yellow-400">Petrol: <strong>{petrolTotal}</strong> Ltrs</span>
          <span className="text-blue-400">Diesel: <strong>{dieselTotal}</strong> Ltrs</span>
          <Badge variant="teal">{records.length} entries</Badge>
        </div>
      </div>

      {scanProg && (
        <div className="card-sm">
          <div className="flex items-center gap-2 text-sm text-slate-300 mb-2"><Loader className="w-4 h-4 animate-spin" /> {scanProg.label}</div>
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-[#00AEEF] transition-all" style={{ width: `${scanProg.pct}%` }} /></div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-12 h-12 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <FuelTable title="PETROL" rows={petrol} total={petrolTotal} type="PETROL" accent="text-yellow-400" />
          <FuelTable title="DIESEL" rows={diesel} total={dieselTotal} type="DIESEL" accent="text-blue-400" />
        </div>
      )}

      {/* ── Add / Edit modal ── */}
      {showAdd && (
        <Modal isOpen onClose={() => setShowAdd(false)} title={editId ? 'Edit Fuel Entry' : 'Add Fuel Entry'} size="sm"
          footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={saveEntry} loading={saving}><Save className="w-4 h-4" /> Save</Button></>}>
          <div className="space-y-4">
            <Select label="Fuel Type" value={form.fuel_type} onChange={e => setForm(f => ({ ...f, fuel_type: e.target.value }))}>
              <option value="PETROL">Petrol</option>
              <option value="DIESEL">Diesel</option>
            </Select>
            <Input label="Date" type="date" value={form.fuel_date} onChange={e => setForm(f => ({ ...f, fuel_date: e.target.value }))} />
            <Input label="Boat Name" value={form.boat_name} onChange={e => setForm(f => ({ ...f, boat_name: e.target.value }))} placeholder="e.g. Sea Explorer" />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Quantity" type="number" min="0" step="any" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
              <Input label="Unit" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}

      {/* ── Scan / Upload preview modal ── */}
      {preview && (
        <Modal isOpen onClose={() => setPreview(null)} title={`Review ${preview.rows.length} detected fuel ${preview.rows.length === 1 ? 'entry' : 'entries'}`} size="lg"
          footer={<><Button variant="secondary" onClick={() => setPreview(null)}>Cancel</Button><Button onClick={confirmPreview} loading={saving}><CheckCircle2 className="w-4 h-4" /> Add {preview.rows.length} to Fuel Log</Button></>}>
          <p className="text-xs text-slate-400 mb-3">From <strong>{preview.source}</strong>. Edit anything before saving — rows are added to the month each date belongs to.</p>
          <div className="overflow-x-auto max-h-[55vh]">
            <Table>
              <Thead><tr><Th>Type</Th><Th>Date</Th><Th>Boat Name</Th><Th>Qty</Th><Th>Unit</Th><Th></Th></tr></Thead>
              <Tbody>
                {preview.rows.map(r => (
                  <Tr key={r.id}>
                    <Td>
                      <select value={r.fuel_type} onChange={e => editPreviewRow(r.id, 'fuel_type', e.target.value)} className="input text-xs py-1 w-auto">
                        <option value="PETROL">Petrol</option><option value="DIESEL">Diesel</option>
                      </select>
                    </Td>
                    <Td><input type="date" value={r.fuel_date} onChange={e => editPreviewRow(r.id, 'fuel_date', e.target.value)} className="input text-xs py-1 w-36" /></Td>
                    <Td><input value={r.boat_name} onChange={e => editPreviewRow(r.id, 'boat_name', e.target.value)} className="input text-xs py-1" /></Td>
                    <Td><input type="number" value={r.qty} onChange={e => editPreviewRow(r.id, 'qty', e.target.value)} className="input text-xs py-1 w-20" /></Td>
                    <Td><input value={r.unit} onChange={e => editPreviewRow(r.id, 'unit', e.target.value)} className="input text-xs py-1 w-16" /></Td>
                    <Td><button onClick={() => delPreviewRow(r.id)} className="p-1 text-slate-500 hover:text-red-400"><X className="w-4 h-4" /></button></Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        </Modal>
      )}
    </div>
  )
}
