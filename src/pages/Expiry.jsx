import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  CalendarClock, Download, RefreshCw, Search, Mail, Send, Save,
  Clock, AlertTriangle, Layers,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import {
  buildExpiryRows, EXPIRY_RANGE_DAYS, EXPIRY_THRESHOLDS, EXPIRY_SETTING_KEYS,
  thresholdForDays, expiryColorClass, expiryRowTint,
} from '../lib/expiry'
import { exportExpiringItemsExcel } from '../lib/excelExport'
import { sendExpiryReport } from '../lib/brevo'

function statusBadge(days) {
  if (days === null) return <Badge variant="gray">No date</Badge>
  if (days < 0)      return <Badge variant="red">Expired {Math.abs(days)}d</Badge>
  if (days <= 7)     return <Badge variant="red">{days}d left</Badge>
  if (days <= 15)    return <Badge variant="orange">{days}d left</Badge>
  if (days <= 30)    return <Badge variant="yellow">{days}d left</Badge>
  if (days <= 60)    return <Badge variant="blue">{days}d left</Badge>
  return                    <Badge variant="green">{days}d left</Badge>
}

const SUMMARY = [
  { key: 'exp',  label: 'Expired',     test: d => d < 0,             color: 'text-red-400' },
  { key: '7',    label: '≤ 7 days',    test: d => d >= 0 && d <= 7,  color: 'text-red-400' },
  { key: '30',   label: '≤ 1 month',   test: d => d > 7 && d <= 30,  color: 'text-yellow-400' },
  { key: '120',  label: '≤ 4 months',  test: d => d > 30 && d <= 120, color: 'text-blue-400' },
]

export default function Expiry() {
  const [rows,     setRows]    = useState([])
  const [loading,  setLoading] = useState(true)
  const [search,   setSearch]  = useState('')
  const [store,    setStore]   = useState('')
  const [stores,   setStores]  = useState([])
  const [settings, setSettings]= useState({})
  const [toggles,  setToggles] = useState({})    // { '3m': true, ... }
  const [savingTog,setSavingTog]=useState(false)
  const [sending,  setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: items }, { data: batches }, { data: st }, { data: setRows_ }] = await Promise.all([
        selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock,expiry_date,store_id,stores(name,category)').eq('active', true)),
        selectAll(() => supabase.from('item_batches').select('id,item_id,expiry_date,quantity,batch_code')),
        supabase.from('stores').select('*').order('name'),
        supabase.from('settings').select('key,value'),
      ])
      const batchesByItem = {}
      ;(batches || []).forEach(b => { (batchesByItem[b.item_id] = batchesByItem[b.item_id] || []).push(b) })
      const expiryRows = buildExpiryRows(items || [], batchesByItem, EXPIRY_RANGE_DAYS)
      setRows(expiryRows)
      setStores(st || [])
      const smap = (setRows_ || []).reduce((a, s) => ({ ...a, [s.key]: s.value }), {})
      setSettings(smap)
      setToggles(Object.fromEntries(EXPIRY_THRESHOLDS.map(t => [t.key, smap[EXPIRY_SETTING_KEYS[t.key]] === 'true'])))
    } catch (err) {
      toast.error('Failed to load: ' + err.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const c = {}
    SUMMARY.forEach(s => { c[s.key] = rows.filter(r => s.test(r.days)).length })
    return c
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (store)  list = list.filter(r => r.store === store)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r => r.name.toLowerCase().includes(q) || (r.part_number || '').toLowerCase().includes(q))
    }
    return list   // already sorted shortest → longest in buildExpiryRows
  }, [rows, store, search])

  // ── Download styled Excel ──────────────────────────────────────────────────
  const handleDownload = async () => {
    if (!filtered.length) { toast.error('Nothing to export'); return }
    try {
      await exportExpiringItemsExcel(filtered, {
        resortName: settings.resort_name || 'Outrigger Maafushivaru Resort',
        date: new Date().toLocaleDateString(),
        rangeLabel: '4 months',
        filename: `Expiry_Report_${new Date().toISOString().split('T')[0]}.xlsx`,
      })
      toast.success(`Exported ${filtered.length} item(s)`)
    } catch (err) { toast.error('Export failed: ' + err.message) }
  }

  // ── Save reminder schedule toggles ─────────────────────────────────────────
  const saveToggles = async () => {
    setSavingTog(true)
    try {
      const updates = EXPIRY_THRESHOLDS.map(t => ({ key: EXPIRY_SETTING_KEYS[t.key], value: toggles[t.key] ? 'true' : 'false' }))
      updates.push({ key: 'expiry_email_enabled', value: Object.values(toggles).some(Boolean) ? 'true' : 'false' })
      const { error } = await supabase.from('settings').upsert(updates, { onConflict: 'key' })
      if (error) throw error
      toast.success('Reminder schedule saved')
    } catch (err) { toast.error(err.message) }
    setSavingTog(false)
  }

  // Rows that fall within the widest enabled reminder window.
  const enabledDays = useMemo(() => {
    const ds = EXPIRY_THRESHOLDS.filter(t => t.key !== 'after' && toggles[t.key]).map(t => t.days)
    return ds.length ? Math.max(...ds) : 0
  }, [toggles])
  const includeAfter = !!toggles.after

  const dueRows = useMemo(() =>
    rows.filter(r => (r.days >= 0 && r.days <= enabledDays) || (r.days < 0 && includeAfter)),
    [rows, enabledDays, includeAfter])

  // ── Send reminder email now ────────────────────────────────────────────────
  const sendNow = async () => {
    const anyOn = Object.values(toggles).some(Boolean)
    if (!anyOn) { toast.error('Tick at least one reminder window first'); return }
    if (!dueRows.length) { toast.error('No items fall within the selected windows'); return }
    if (!settings.brevo_api_key || !settings.brevo_sender_email || !settings.report_recipient_email) {
      toast.error('Configure Brevo in Settings → Email Reports first'); return
    }
    setSending(true)
    try {
      const labels = EXPIRY_THRESHOLDS.filter(t => toggles[t.key]).map(t => t.label)
      await sendExpiryReport({
        apiKey: settings.brevo_api_key,
        senderEmail: settings.brevo_sender_email,
        senderName: settings.brevo_sender_name,
        recipientEmail: settings.report_recipient_email,
        recipientName: settings.report_recipient_name,
        rows: dueRows,
        thresholdLabels: labels,
        resortName: settings.resort_name,
      })
      // Best-effort dedupe log
      try {
        const log = dueRows.map(r => ({
          item_id: r.item_id, batch_id: r.batch_id || null,
          threshold: thresholdForDays(r.days) || 'after',
          expiry_date: r.expiry_date, recipient: settings.report_recipient_email,
        }))
        await supabase.from('expiry_email_log').insert(log)
      } catch { /* logging is non-critical */ }
      toast.success(`Reminder sent — ${dueRows.length} item(s)`)
    } catch (err) { toast.error('Send failed: ' + err.message) }
    setSending(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Item Expiry</h1>
          <p className="page-sub">Items expiring within 4 months · shortest → longest · active items only</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <Button size="sm" onClick={handleDownload}><Download className="w-4 h-4" /> Download Excel</Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {SUMMARY.map(s => (
          <div key={s.key} className="card">
            <p className={`text-2xl font-bold ${s.color}`}>{counts[s.key] || 0}</p>
            <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Email reminder schedule ─────────────────────────────────────── */}
      <div className="card space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-900/30 border border-blue-700/30 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1">
            <p className="font-display text-sm font-semibold text-slate-100">Expiry Email Reminders (Brevo)</p>
            <p className="text-xs text-slate-400 mt-0.5">Choose when to be reminded. Tick the lead times, save, then send now or let scheduled runs use these settings.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {EXPIRY_THRESHOLDS.map(t => {
            const on = !!toggles[t.key]
            return (
              <button key={t.key} onClick={() => setToggles(p => ({ ...p, [t.key]: !p[t.key] }))}
                className={`rounded-lg border px-3 py-2.5 text-left transition-all ${on ? 'border-teal-500/60 bg-teal-900/20' : 'border-slate-600 bg-slate-700/30 hover:border-slate-500'}`}>
                <div className="flex items-center justify-between">
                  <Clock className={`w-3.5 h-3.5 ${on ? 'text-teal-400' : 'text-slate-500'}`} />
                  <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold ${on ? 'bg-teal-500 text-white' : 'bg-slate-600 text-slate-400'}`}>{on ? '✓' : ''}</span>
                </div>
                <p className={`text-xs font-semibold mt-1.5 ${on ? 'text-teal-300' : 'text-slate-300'}`}>{t.label}</p>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <p className="text-xs text-slate-500">
            {dueRows.length > 0
              ? <><strong className="text-slate-300">{dueRows.length}</strong> item(s) currently match the ticked windows.</>
              : 'No items currently match the ticked windows.'}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={saveToggles} loading={savingTog}><Save className="w-4 h-4" /> Save</Button>
            <Button size="sm" onClick={sendNow} loading={sending} disabled={!dueRows.length}><Send className="w-4 h-4" /> Send now</Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card py-3 px-4 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input text-sm pl-9" placeholder="Search item or part #…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={store} onChange={e => setStore(e.target.value)} className="input text-sm w-auto">
          <option value="">All Stores</option>
          {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <span className="text-xs text-slate-500">{filtered.length} row(s)</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-9 h-9 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-14 text-slate-500">
          <CalendarClock className="w-10 h-10 mx-auto mb-3 text-slate-600" />
          <p className="font-medium text-slate-300">Nothing expiring within 4 months</p>
          <p className="text-sm mt-1">Add expiry dates or batches to items to see them here.</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <Table maxHeight="calc(100vh - 300px)">
            <Thead>
              <tr>
                <Th>Part #</Th>
                <Th>Item Name</Th>
                <Th className="hidden sm:table-cell">Store</Th>
                <Th className="hidden md:table-cell">Batch</Th>
                <Th>Stock</Th>
                <Th>Expiry</Th>
                <Th>Days</Th>
                <Th>Status</Th>
              </tr>
            </Thead>
            <Tbody>
              {filtered.map(r => (
                <Tr key={r.key} className={expiryRowTint(r.days)}>
                  <Td className="font-mono text-xs text-slate-400">{r.part_number || '—'}</Td>
                  <Td>
                    <span className="font-medium text-slate-200 text-sm">{r.name}</span>
                    {r.source === 'batch' && <Layers className="w-3 h-3 inline ml-1.5 text-slate-500" title="From batch" />}
                  </Td>
                  <Td className="hidden sm:table-cell text-slate-400 text-sm">{r.store}</Td>
                  <Td className="hidden md:table-cell text-slate-500 text-xs">{r.batch_code || '—'}</Td>
                  <Td className="text-slate-300 text-sm">{r.current_stock} <span className="text-slate-500 text-xs">{r.unit}</span></Td>
                  <Td className="text-slate-300 text-sm whitespace-nowrap">{r.expiry_date}</Td>
                  <Td className={`text-sm font-bold ${expiryColorClass(r.days)}`}>{r.days < 0 ? `+${Math.abs(r.days)}` : r.days}</Td>
                  <Td>{statusBadge(r.days)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </div>
  )
}
