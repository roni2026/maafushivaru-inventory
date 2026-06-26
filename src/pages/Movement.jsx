import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Zap, Snowflake, RefreshCw, Search, Gauge, PackageX, Download,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import { exportMovementExcel } from '../lib/excelExport'

// Selectable report windows — weekly / monthly / quarterly (+ half-year).
const PERIODS = [
  { value: 7,   label: 'Weekly',     long: 'Weekly report (last 7 days)' },
  { value: 30,  label: 'Monthly',    long: 'Monthly report (last 30 days)' },
  { value: 90,  label: 'Quarterly',  long: 'Quarterly report (last 90 days)' },
  { value: 180, label: 'Half-Year',  long: 'Half-year report (last 6 months)' },
]

const CAT = {
  fast:     { label: 'Fast',     badge: 'green',  color: '#22c55e', icon: Zap },
  moderate: { label: 'Moderate', badge: 'blue',   color: '#0ea5e9', icon: Gauge },
  slow:     { label: 'Slow',     badge: 'orange', color: '#f97316', icon: TrendingDown },
  dead:     { label: 'Dead',     badge: 'red',    color: '#ef4444', icon: Snowflake },
}

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-2.5 shadow-2xl text-xs">
      <p className="text-slate-200 font-medium mb-0.5">{p.name}</p>
      <p className="text-teal-400">{p.issued} {p.unit} issued · {p.perWeek}/wk</p>
    </div>
  )
}

export default function Movement() {
  const [period,  setPeriod]  = useState(30)
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [filter,  setFilter]  = useState('')     // '' | category
  const [search,  setSearch]  = useState('')
  const [store,   setStore]   = useState('')
  const [stores,  setStores]  = useState([])
  const [sortKey, setSortKey] = useState('perWeek')
  const [sortDir, setSortDir] = useState('desc')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const since = new Date(); since.setDate(since.getDate() - period)
      const sinceStr = since.toISOString().split('T')[0]
      const [{ data: items }, { data: iss }, { data: st }] = await Promise.all([
        selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock,store_id,stores(name,category)').eq('active', true)),
        selectAll(() => supabase.from('issuances').select('item_id,quantity_issued,date').gte('date', sinceStr)),
        supabase.from('stores').select('*').order('name'),
      ])
      const weeks = period / 7
      const byItem = {}
      ;(iss || []).forEach(r => {
        const m = byItem[r.item_id] || { qty: 0, txns: 0, last: null }
        m.qty += Number(r.quantity_issued)
        m.txns += 1
        if (!m.last || r.date > m.last) m.last = r.date
        byItem[r.item_id] = m
      })

      const enriched = (items || []).map(it => {
        const m = byItem[it.id] || { qty: 0, txns: 0, last: null }
        const perWeek = m.qty / weeks
        const stock = Number(it.current_stock) || 0
        const cover = perWeek > 0 ? stock / perWeek : (stock > 0 ? Infinity : 0)
        const daysSince = m.last ? Math.round((Date.now() - new Date(m.last).getTime()) / 86400000) : null
        return {
          id: it.id, name: it.name, part_number: it.part_number, unit: it.unit,
          store: it.stores?.name || '', category: it.stores?.category || '',
          stock, issued: Math.round(m.qty * 10) / 10, txns: m.txns,
          perWeek: Math.round(perWeek * 10) / 10, cover, daysSince,
        }
      })

      // Classify: dead = no movement. Movers split into tertiles by perWeek.
      const movers = enriched.filter(e => e.issued > 0).sort((a, b) => b.perWeek - a.perWeek)
      const n = movers.length
      const fastCut = Math.ceil(n / 3)
      const slowCut = Math.ceil((n * 2) / 3)
      movers.forEach((e, i) => {
        e.movement = i < fastCut ? 'fast' : i < slowCut ? 'moderate' : 'slow'
      })
      enriched.forEach(e => { if (e.issued === 0) e.movement = 'dead' })

      setStores(st || [])
      setRows(enriched)
    } catch (err) {
      toast.error('Failed to load: ' + err.message)
    }
    setLoading(false)
  }, [period])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const c = { fast: 0, moderate: 0, slow: 0, dead: 0 }
    rows.forEach(r => { c[r.movement] = (c[r.movement] || 0) + 1 })
    return c
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (store)  list = list.filter(r => r.store === store)
    if (filter) list = list.filter(r => r.movement === filter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r => r.name.toLowerCase().includes(q) || (r.part_number || '').toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey]
      if (va === Infinity) va = 1e9; if (vb === Infinity) vb = 1e9
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase() }
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    })
  }, [rows, store, filter, search, sortKey, sortDir])

  const topFast = useMemo(() => rows.filter(r => r.movement === 'fast').sort((a, b) => b.perWeek - a.perWeek).slice(0, 10), [rows])
  const topSlow = useMemo(() => rows.filter(r => r.issued > 0).sort((a, b) => a.perWeek - b.perWeek).slice(0, 10), [rows])

  const toggleSort = (k) => { if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(k); setSortDir('desc') } }
  const coverLabel = (c) => c === Infinity ? '∞' : c >= 999 ? '999+' : `${Math.round(c)}w`

  // ── Export a coloured, well-formatted movement report (current filters) ─────
  const exportReport = async () => {
    if (!filtered.length) { toast.error('Nothing to export'); return }
    setExporting(true)
    try {
      const meta = PERIODS.find(p => p.value === period) || { label: `${period}d`, long: `Last ${period} days` }
      const since = new Date(); since.setDate(since.getDate() - period)
      const rangeLabel = `${since.toLocaleDateString('en-GB')} → ${new Date().toLocaleDateString('en-GB')}`
      await exportMovementExcel(filtered, {
        periodLabel: meta.long, rangeLabel, counts,
        resortName: 'Outrigger Maafushivaru Resort',
        filename: `Movement_${meta.label}_${new Date().toISOString().split('T')[0]}.xlsx`,
      })
      toast.success('Report downloaded')
    } catch (e) { toast.error(e.message) }
    setExporting(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Item Movement</h1>
          <p className="page-sub">Fast, slow &amp; non-moving items by issuance velocity · weekly / monthly / quarterly</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setPeriod(p.value)} title={p.long}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${period === p.value ? 'bg-[#00AEEF] text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <Button onClick={exportReport} loading={exporting}><Download className="w-4 h-4" /> Export Report</Button>
        </div>
      </div>

      {/* Category cards (click to filter) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {Object.entries(CAT).map(([key, c]) => {
          const Icon = c.icon
          const active = filter === key
          return (
            <button key={key} onClick={() => setFilter(active ? '' : key)}
              className={`card text-left transition-all ${active ? 'ring-2 ring-teal-500/60 border-teal-600/60' : 'hover:border-slate-600'}`}>
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: c.color + '22', color: c.color }}>
                  <Icon className="w-4 h-4" />
                </span>
                <Badge variant={c.badge}>{c.label}</Badge>
              </div>
              <p className="text-2xl font-bold text-slate-100 mt-2">{counts[key] || 0}</p>
              <p className="text-xs text-slate-500">
                {key === 'dead' ? 'No movement in period' : key === 'fast' ? 'Highest velocity' : key === 'slow' ? 'Lowest active velocity' : 'Steady movers'}
              </p>
            </button>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card">
          <p className="font-display text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" /> Top Fast Movers (per week)</p>
          {topFast.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={topFast} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" stroke="#64748b" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={10} width={110} tickFormatter={v => v.length > 16 ? v.slice(0, 15) + '…' : v} />
                <Tooltip content={<ChartTip />} cursor={{ fill: '#1e293b55' }} />
                <Bar dataKey="perWeek" radius={[0, 4, 4, 0]}>{topFast.map((e, i) => <Cell key={i} fill={CAT.fast.color} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-slate-500 text-sm py-10 text-center">No issuance data in this period.</p>}
        </div>
        <div className="card">
          <p className="font-display text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2"><TrendingDown className="w-4 h-4 text-orange-400" /> Slowest Active Movers (per week)</p>
          {topSlow.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={topSlow} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" stroke="#64748b" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={10} width={110} tickFormatter={v => v.length > 16 ? v.slice(0, 15) + '…' : v} />
                <Tooltip content={<ChartTip />} cursor={{ fill: '#1e293b55' }} />
                <Bar dataKey="perWeek" radius={[0, 4, 4, 0]}>{topSlow.map((e, i) => <Cell key={i} fill={CAT.slow.color} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-slate-500 text-sm py-10 text-center">No issuance data in this period.</p>}
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
        {filter && <button onClick={() => setFilter('')} className="btn-ghost btn-sm">Clear: {CAT[filter].label} ✕</button>}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-9 h-9 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <Table maxHeight="calc(100vh - 280px)">
            <Thead>
              <tr>
                <Th sortable onClick={() => toggleSort('name')} sorted={sortKey === 'name' ? sortDir : undefined}>Item</Th>
                <Th sortable onClick={() => toggleSort('store')} sorted={sortKey === 'store' ? sortDir : undefined} className="hidden sm:table-cell">Store</Th>
                <Th sortable onClick={() => toggleSort('stock')} sorted={sortKey === 'stock' ? sortDir : undefined}>Stock</Th>
                <Th sortable onClick={() => toggleSort('issued')} sorted={sortKey === 'issued' ? sortDir : undefined}>Issued</Th>
                <Th sortable onClick={() => toggleSort('txns')} sorted={sortKey === 'txns' ? sortDir : undefined} className="hidden sm:table-cell">Txns</Th>
                <Th sortable onClick={() => toggleSort('perWeek')} sorted={sortKey === 'perWeek' ? sortDir : undefined}>Avg/Wk</Th>
                <Th sortable onClick={() => toggleSort('cover')} sorted={sortKey === 'cover' ? sortDir : undefined} className="hidden md:table-cell">Cover</Th>
                <Th sortable onClick={() => toggleSort('daysSince')} sorted={sortKey === 'daysSince' ? sortDir : undefined} className="hidden md:table-cell">Last</Th>
                <Th>Movement</Th>
              </tr>
            </Thead>
            <Tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-500 px-3">No items match.</td></tr>
              ) : filtered.map(r => {
                const c = CAT[r.movement]
                return (
                  <Tr key={r.id}>
                    <Td>
                      <p className="font-medium text-slate-200 text-sm leading-tight">{r.name}</p>
                      <p className="text-[11px] text-slate-500 font-mono">{r.part_number}</p>
                    </Td>
                    <Td className="hidden sm:table-cell text-slate-400 text-sm">{r.store}</Td>
                    <Td className="text-slate-300 text-sm">{r.stock} <span className="text-slate-500 text-xs">{r.unit}</span></Td>
                    <Td className="text-slate-300 text-sm">{r.issued}</Td>
                    <Td className="hidden sm:table-cell text-slate-400 text-sm">{r.txns}</Td>
                    <Td className="font-semibold text-teal-300 text-sm">{r.perWeek}</Td>
                    <Td className="hidden md:table-cell text-slate-400 text-sm">{coverLabel(r.cover)}</Td>
                    <Td className="hidden md:table-cell text-slate-500 text-xs">{r.daysSince === null ? '—' : `${r.daysSince}d ago`}</Td>
                    <Td><Badge variant={c.badge}>{c.label}</Badge></Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        </div>
      )}
    </div>
  )
}
