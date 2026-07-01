import { useState, useEffect, useMemo } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  BarChart2, Download, RefreshCw, Mail, Package, TrendingUp, AlertTriangle,
  Undo2, Trash2, Building2, LayoutDashboard,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import SendReportModal from '../components/SendReportModal'

function daysUntil(d) {
  if (!d) return null
  const exp = new Date(d); exp.setHours(0, 0, 0, 0)
  const now = new Date();  now.setHours(0, 0, 0, 0)
  return Math.ceil((exp - now) / 86400000)
}
function isoWeek(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00')
  if (isNaN(d)) return '—'
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const w = Math.ceil((((t - ys) / 86400000) + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`
}
const money = (n) => `$${Number(n || 0).toFixed(2)}`

// All available report views.
const REPORTS = [
  { key: 'overview',  label: 'Overview',        icon: LayoutDashboard },
  { key: 'inventory', label: 'Inventory & Value', icon: Package },
  { key: 'movement',  label: 'Item Movement',   icon: TrendingUp },
  { key: 'delivery',  label: 'Delivery Issues', icon: AlertTriangle },
  { key: 'returns',   label: 'Returns',         icon: Undo2 },
  { key: 'waste',     label: 'Waste',           icon: Trash2 },
  { key: 'suppliers', label: 'Suppliers',       icon: Building2 },
]
const ISSUE_LABEL = { not_arrived: 'Not Arrived', short: 'Short', damaged: 'Damaged', wrong_item: 'Wrong Item' }
const PIE = ['#00AEEF', '#14b8a6', '#f97316', '#a855f7', '#eab308', '#ef4444', '#64748b']

export default function Reports() {
  const [report, setReport] = useState('overview')
  const [items, setItems]         = useState([])
  const [issuances, setIssuances] = useState([])
  const [stores, setStores]       = useState([])
  const [bnIssues, setBnIssues]   = useState([])
  const [returns, setReturns]     = useState([])
  const [waste, setWaste]         = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [showEmail, setShowEmail] = useState(false)

  const load = async () => {
    setLoading(true)
    const since = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
    // Tables added in later migrations may not exist yet — never let one failure
    // blank the whole report.
    const safe = (q) => Promise.resolve(q).then(r => r || { data: [] }).catch(() => ({ data: [] }))
    const [i, s, iss, bn, ret, w, sup] = await Promise.all([
      safe(selectAll(() => supabase.from('items').select('id, part_number, name, store_id, current_stock, min_stock, unit, unit_cost, expiry_date, supplier, origin, stores(name,category)').eq('active', true))),
      safe(supabase.from('stores').select('*')),
      safe(selectAll(() => supabase.from('issuances').select('item_id, quantity_issued, date').gte('date', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]))),
      safe(selectAll(() => supabase.from('boat_note_items').select('*, boat_notes(note_date)').in('status', ['not_arrived', 'wrong_item', 'damaged', 'short']))),
      safe(selectAll(() => supabase.from('item_returns').select('*').gte('created_at', since))),
      safe(supabase.from('waste_log').select('*, items(name, part_number, unit)').gte('date', since)),
      safe(supabase.from('suppliers').select('*')),
    ])
    setItems(i.data || [])
    setStores(s.data || [])
    setIssuances(iss.data || [])
    setBnIssues(bn.data || [])
    setReturns(ret.data || [])
    setWaste(w.data || [])
    setSuppliers(sup.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // ── Shared computed stats ─────────────────────────────────────────────────
  const expiring = useMemo(() => items
    .filter(i => { const d = daysUntil(i.expiry_date); return d !== null && d <= 30 })
    .sort((a, b) => daysUntil(a.expiry_date) - daysUntil(b.expiry_date)), [items])
  const lowStock   = useMemo(() => items.filter(i => Number(i.current_stock) <= Number(i.min_stock)), [items])
  const totalValue = useMemo(() => items.reduce((s, i) => s + Number(i.current_stock) * Number(i.unit_cost || 0), 0), [items])

  const issuanceByDay = useMemo(() => {
    const map = {}
    for (let d = 13; d >= 0; d--) {
      const dt = new Date(); dt.setDate(dt.getDate() - d)
      const k = dt.toISOString().split('T')[0]
      map[k] = { date: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), qty: 0 }
    }
    ;(issuances || []).forEach(iss => { if (map[iss.date]) map[iss.date].qty += Number(iss.quantity_issued) })
    return Object.values(map)
  }, [issuances])

  const topItems = useMemo(() => {
    const map = {}
    ;(issuances || []).forEach(iss => { map[iss.item_id] = (map[iss.item_id] || 0) + Number(iss.quantity_issued) })
    return Object.entries(map).map(([id, qty]) => ({ item: items.find(i => i.id === id), qty }))
      .filter(r => r.item).sort((a, b) => b.qty - a.qty).slice(0, 20)
  }, [issuances, items])

  const neverIssued = useMemo(() => {
    const issued = new Set((issuances || []).map(i => i.item_id))
    return items.filter(i => !issued.has(i.id))
  }, [issuances, items])

  const byStore = useMemo(() => stores.map(s => ({
    name: s.name,
    items: items.filter(i => i.store_id === s.id).length,
    value: items.filter(i => i.store_id === s.id).reduce((t, i) => t + Number(i.current_stock) * Number(i.unit_cost || 0), 0),
  })), [stores, items])

  const byCategory = useMemo(() => {
    const map = {}
    items.forEach(i => {
      const c = i.stores?.category || 'Uncategorised'
      map[c] = map[c] || { name: c, items: 0, value: 0 }
      map[c].items++; map[c].value += Number(i.current_stock) * Number(i.unit_cost || 0)
    })
    return Object.values(map).sort((a, b) => b.value - a.value)
  }, [items])

  // Delivery issues by week + type
  const issuesByWeek = useMemo(() => {
    const map = {}
    ;(bnIssues || []).forEach(r => {
      const wk = isoWeek(r.boat_notes?.note_date)
      map[wk] = map[wk] || { week: wk, not_arrived: 0, short: 0, damaged: 0, wrong_item: 0, total: 0 }
      if (map[wk][r.status] !== undefined) map[wk][r.status]++
      map[wk].total++
    })
    return Object.values(map).sort((a, b) => b.week.localeCompare(a.week))
  }, [bnIssues])
  const issuesByType = useMemo(() => Object.keys(ISSUE_LABEL).map(k => ({
    name: ISSUE_LABEL[k], value: (bnIssues || []).filter(r => r.status === k).length,
  })).filter(d => d.value > 0), [bnIssues])

  const returnsSummary = useMemo(() => {
    const by = {}
    ;(returns || []).forEach(r => { by[r.status] = (by[r.status] || 0) + 1 })
    return by
  }, [returns])

  const wasteByReason = useMemo(() => {
    const map = {}
    ;(waste || []).forEach(w => {
      map[w.reason] = map[w.reason] || { name: w.reason || 'Other', count: 0, qty: 0, value: 0 }
      map[w.reason].count++; map[w.reason].qty += Number(w.quantity || 0)
      map[w.reason].value += Number(w.quantity || 0) * Number(w.unit_cost || 0)
    })
    return Object.values(map).sort((a, b) => b.value - a.value)
  }, [waste])
  const wasteTotalValue = useMemo(() => wasteByReason.reduce((s, r) => s + r.value, 0), [wasteByReason])

  const supplierBreakdown = useMemo(() => {
    const local = items.filter(i => i.origin === 'local')
    const foreign = items.filter(i => i.origin === 'foreign')
    const unset = items.filter(i => !i.origin)
    const val = (list) => list.reduce((s, i) => s + Number(i.current_stock) * Number(i.unit_cost || 0), 0)
    return { local, foreign, unset, localVal: val(local), foreignVal: val(foreign) }
  }, [items])

  // ── CSV export for the ACTIVE report ──────────────────────────────────────
  const downloadCsv = (rows, name) => {
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${name}_${new Date().toISOString().split('T')[0]}.csv`; a.click()
    toast.success('Exported')
  }
  const exportCurrent = () => {
    if (report === 'delivery') {
      downloadCsv([['Week', 'Date', 'Status', 'Code', 'Product', 'Dept', 'Ordered', 'Issue Qty', 'Supplier', 'PO', 'Note'],
        ...bnIssues.map(r => [isoWeek(r.boat_notes?.note_date), r.boat_notes?.note_date || '', ISSUE_LABEL[r.status] || r.status,
          r.part_number, r.product_name, r.department, r.ordered_qty, r.damaged_qty ?? r.short_qty ?? r.wrong_qty ?? '', r.supplier, r.po_number, r.note])], 'delivery_issues')
    } else if (report === 'returns') {
      downloadCsv([['Logged', 'Reason', 'Status', 'Code', 'Product', 'Qty', 'Supplier', 'PO', 'Changed', 'Replacement Code', 'Replacement Product', 'Replacement Qty'],
        ...returns.map(r => [String(r.created_at || '').slice(0, 10), r.reason, r.status, r.part_number, r.product_name, r.qty, r.supplier, r.po_number, r.changed ? 'YES' : '', r.replacement_part_number || '', r.replacement_product_name || '', r.replacement_qty ?? ''])], 'returns')
    } else if (report === 'waste') {
      downloadCsv([['Date', 'Code', 'Item', 'Reason', 'Qty', 'Unit', 'Unit Cost', 'Total'],
        ...waste.map(w => [w.date, w.items?.part_number, w.items?.name, w.reason, w.quantity, w.items?.unit, w.unit_cost || 0, (Number(w.quantity) * Number(w.unit_cost || 0)).toFixed(2)])], 'waste')
    } else if (report === 'movement') {
      downloadCsv([['Code', 'Item', 'Store', 'Total Issued (30d)'], ...topItems.map(t => [t.item.part_number, t.item.name, t.item.stores?.name, t.qty])], 'movement')
    } else if (report === 'suppliers') {
      downloadCsv([['Supplier', 'Origin', 'Contact', 'Email', 'Phone'], ...suppliers.map(s => [s.name, s.origin || '', s.contact_name || s.contact_person || '', s.email || '', s.phone || ''])], 'suppliers')
    } else {
      downloadCsv([['Part #', 'Name', 'Store', 'Category', 'Supplier', 'Origin', 'Stock', 'Unit', 'Min', 'Unit Cost', 'Value', 'Expiry', 'Days Left'],
        ...items.map(i => [i.part_number, i.name, i.stores?.name, i.stores?.category, i.supplier || '', i.origin || '', i.current_stock, i.unit, i.min_stock, i.unit_cost || 0, (Number(i.current_stock) * Number(i.unit_cost || 0)).toFixed(2), i.expiry_date || '', daysUntil(i.expiry_date) ?? ''])], 'inventory')
    }
  }

  const Stat = ({ value, label, tone = 'teal' }) => (
    <div className={`card-sm text-center border ${{
      teal: 'border-teal-700/30 bg-teal-900/10', red: 'border-red-700/30 bg-red-900/10',
      orange: 'border-orange-700/30 bg-orange-900/10', blue: 'border-sky-700/30 bg-sky-900/10',
      purple: 'border-purple-700/30 bg-purple-900/10', slate: 'border-slate-700/40',
    }[tone]}`}>
      <p className={`text-2xl font-bold ${{ teal: 'text-teal-400', red: 'text-red-400', orange: 'text-orange-400', blue: 'text-sky-400', purple: 'text-purple-400', slate: 'text-slate-200' }[tone]}`}>{value}</p>
      <p className="text-slate-400 text-xs mt-1">{label}</p>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">Full inventory, movement, delivery, returns, waste & supplier reporting</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={exportCurrent} className="btn-secondary btn-sm"><Download className="w-4 h-4" /> Export CSV</button>
          <Button onClick={() => setShowEmail(true)}><Mail className="w-4 h-4" /> Send Email Report</Button>
        </div>
      </div>

      {/* Report selector */}
      <div className="flex gap-1.5 flex-wrap">
        {REPORTS.map(r => {
          const Icon = r.icon
          return (
            <button key={r.key} onClick={() => setReport(r.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${report === r.key ? 'bg-teal-600 border-teal-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-100'}`}>
              <Icon className="w-4 h-4" />{r.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          {/* ── OVERVIEW ────────────────────────────────────────────────── */}
          {report === 'overview' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat value={items.length} label="Total Items" tone="blue" />
                <Stat value={lowStock.length} label="Low Stock" tone="red" />
                <Stat value={expiring.length} label="Expiring ≤30d" tone="orange" />
                <Stat value={money(totalValue)} label="Total Value" tone="teal" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat value={bnIssues.length} label="Open Delivery Issues" tone="red" />
                <Stat value={returns.length} label="Returns (90d)" tone="purple" />
                <Stat value={money(wasteTotalValue)} label="Waste Value (90d)" tone="orange" />
                <Stat value={suppliers.length} label="Suppliers" tone="slate" />
              </div>
              <div className="card">
                <p className="font-display text-base font-semibold text-slate-100 mb-4">Issuance — Last 14 Days</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={issuanceByDay} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                    <Bar dataKey="qty" name="Units Issued" fill="#00AEEF" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* ── INVENTORY & VALUE ───────────────────────────────────────── */}
          {report === 'inventory' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat value={items.length} label="Items" tone="blue" />
                <Stat value={money(totalValue)} label="Total Value" tone="teal" />
                <Stat value={lowStock.length} label="Low Stock" tone="red" />
                <Stat value={expiring.length} label="Expiring ≤30d" tone="orange" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card">
                  <p className="font-display text-base font-semibold text-slate-100 mb-4">Stock Value by Store</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={byStore} layout="vertical" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `$${v}`} />
                      <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={110} />
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} formatter={v => [money(v), 'Value']} />
                      <Bar dataKey="value" fill="#14b8a6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="card">
                  <p className="font-display text-base font-semibold text-slate-100 mb-4">Value by Category</p>
                  <Table>
                    <Thead><tr><Th>Category</Th><Th>Items</Th><Th>Value</Th></tr></Thead>
                    <Tbody>{byCategory.map(c => (
                      <Tr key={c.name}><Td className="text-slate-100">{c.name}</Td><Td className="text-slate-400">{c.items}</Td><Td className="text-teal-400 font-semibold">{money(c.value)}</Td></Tr>
                    ))}</Tbody>
                  </Table>
                </div>
              </div>
              {lowStock.length > 0 && (
                <div className="card">
                  <p className="font-display text-base font-semibold text-slate-100 mb-3">Low Stock <span className="text-red-400 text-sm font-normal">({lowStock.length})</span></p>
                  <div className="overflow-x-auto"><Table>
                    <Thead><tr><Th>Part #</Th><Th>Item</Th><Th>Store</Th><Th>Stock</Th><Th>Min</Th><Th>Supplier</Th></tr></Thead>
                    <Tbody>{lowStock.slice(0, 100).map(i => (
                      <Tr key={i.id}><Td className="font-mono text-xs text-slate-400">{i.part_number}</Td><Td className="text-slate-100">{i.name}</Td><Td className="text-slate-400 text-xs">{i.stores?.name}</Td><Td className="text-red-400 font-semibold">{i.current_stock} {i.unit}</Td><Td className="text-slate-400">{i.min_stock}</Td><Td className="text-slate-400 text-xs">{i.supplier || '—'}</Td></Tr>
                    ))}</Tbody>
                  </Table></div>
                </div>
              )}
              {expiring.length > 0 && (
                <div className="card">
                  <p className="font-display text-base font-semibold text-slate-100 mb-3">Expiring / Near Expiry <span className="text-orange-400 text-sm font-normal">({expiring.length})</span></p>
                  <div className="overflow-x-auto"><Table>
                    <Thead><tr><Th>Part #</Th><Th>Item</Th><Th>Store</Th><Th>Stock</Th><Th>Expiry</Th><Th>Days Left</Th></tr></Thead>
                    <Tbody>{expiring.map(item => { const d = daysUntil(item.expiry_date); return (
                      <Tr key={item.id}><Td className="font-mono text-xs text-slate-400">{item.part_number}</Td><Td className="text-slate-100">{item.name}</Td><Td className="text-slate-400 text-xs">{item.stores?.name}</Td><Td className="text-slate-100 font-semibold">{item.current_stock} {item.unit}</Td><Td className="text-slate-300">{item.expiry_date}</Td>
                        <Td>{d < 0 ? <Badge variant="red">Expired {Math.abs(d)}d ago</Badge> : d <= 7 ? <Badge variant="red">{d}d left</Badge> : d <= 15 ? <Badge variant="orange">{d}d left</Badge> : <Badge variant="yellow">{d}d left</Badge>}</Td></Tr>
                    ) })}</Tbody>
                  </Table></div>
                </div>
              )}
            </>
          )}

          {/* ── MOVEMENT ────────────────────────────────────────────────── */}
          {report === 'movement' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat value={topItems.length} label="Items Issued (30d)" tone="teal" />
                <Stat value={neverIssued.length} label="No Movement (30d)" tone="slate" />
                <Stat value={issuances.reduce((s, i) => s + Number(i.quantity_issued), 0)} label="Total Units Issued" tone="blue" />
                <Stat value={items.length} label="Total Items" tone="slate" />
              </div>
              <div className="card">
                <p className="font-display text-base font-semibold text-slate-100 mb-3">Top Issued Items — Last 30 Days</p>
                <div className="overflow-x-auto"><Table>
                  <Thead><tr><Th>#</Th><Th>Part #</Th><Th>Item</Th><Th>Store</Th><Th>Total Issued</Th><Th>Unit</Th></tr></Thead>
                  <Tbody>{topItems.map(({ item, qty }, i) => (
                    <Tr key={item.id}><Td className="text-slate-500">{i + 1}</Td><Td className="font-mono text-xs text-slate-400">{item.part_number}</Td><Td className="text-slate-100">{item.name}</Td><Td className="text-slate-400 text-xs">{item.stores?.name}</Td><Td><span className="font-bold text-[#00AEEF]">{qty}</span></Td><Td className="text-slate-400 text-xs">{item.unit}</Td></Tr>
                  ))}</Tbody>
                </Table></div>
              </div>
              {neverIssued.length > 0 && (
                <div className="card">
                  <p className="font-display text-base font-semibold text-slate-100 mb-3">No Movement (not issued in 30 days) <span className="text-slate-500 text-sm font-normal">({neverIssued.length})</span></p>
                  <div className="overflow-x-auto"><Table>
                    <Thead><tr><Th>Part #</Th><Th>Item</Th><Th>Store</Th><Th>Stock</Th><Th>Value</Th></tr></Thead>
                    <Tbody>{neverIssued.slice(0, 100).map(i => (
                      <Tr key={i.id}><Td className="font-mono text-xs text-slate-400">{i.part_number}</Td><Td className="text-slate-100">{i.name}</Td><Td className="text-slate-400 text-xs">{i.stores?.name}</Td><Td className="text-slate-300">{i.current_stock} {i.unit}</Td><Td className="text-slate-400">{money(Number(i.current_stock) * Number(i.unit_cost || 0))}</Td></Tr>
                    ))}</Tbody>
                  </Table></div>
                </div>
              )}
            </>
          )}

          {/* ── DELIVERY ISSUES ─────────────────────────────────────────── */}
          {report === 'delivery' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {Object.keys(ISSUE_LABEL).map((k, i) => (
                  <Stat key={k} value={bnIssues.filter(r => r.status === k).length} label={ISSUE_LABEL[k]} tone={['red', 'orange', 'red', 'orange'][i]} />
                ))}
              </div>
              {issuesByType.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="card">
                    <p className="font-display text-base font-semibold text-slate-100 mb-3">Issues by Type</p>
                    <ResponsiveContainer width="100%" height={230}>
                      <PieChart>
                        <Pie data={issuesByType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                          {issuesByType.map((e, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                        </Pie>
                        <Legend /><Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card">
                    <p className="font-display text-base font-semibold text-slate-100 mb-3">Issues by Week</p>
                    <div className="overflow-x-auto"><Table>
                      <Thead><tr><Th>Week</Th><Th>Not Arr.</Th><Th>Short</Th><Th>Damaged</Th><Th>Wrong</Th><Th>Total</Th></tr></Thead>
                      <Tbody>{issuesByWeek.map(w => (
                        <Tr key={w.week}><Td className="text-slate-100 font-medium">{w.week}</Td><Td className="text-red-400">{w.not_arrived}</Td><Td className="text-yellow-400">{w.short}</Td><Td className="text-red-400">{w.damaged}</Td><Td className="text-orange-400">{w.wrong_item}</Td><Td className="font-bold text-slate-100">{w.total}</Td></Tr>
                      ))}</Tbody>
                    </Table></div>
                  </div>
                </div>
              )}
              <div className="card">
                <p className="font-display text-base font-semibold text-slate-100 mb-3">All Delivery Issues</p>
                <div className="overflow-x-auto"><Table>
                  <Thead><tr><Th>Date</Th><Th>Status</Th><Th>Code</Th><Th>Product</Th><Th>Dept</Th><Th>Ordered</Th><Th>Issue Qty</Th><Th>Supplier</Th><Th>PO</Th></tr></Thead>
                  <Tbody>{bnIssues.slice(0, 200).map(r => (
                    <Tr key={r.id}><Td className="text-slate-400 text-xs">{r.boat_notes?.note_date || '—'}</Td><Td><Badge variant={r.status === 'wrong_item' ? 'orange' : r.status === 'short' ? 'yellow' : 'red'}>{ISSUE_LABEL[r.status] || r.status}</Badge></Td><Td className="font-mono text-xs text-slate-400">{r.part_number}</Td><Td className="text-slate-100 max-w-xs truncate">{r.product_name}</Td><Td className="text-slate-400 text-xs">{r.department}</Td><Td className="text-slate-300">{r.ordered_qty}</Td><Td className="text-amber-400">{r.damaged_qty ?? r.short_qty ?? r.wrong_qty ?? '—'}</Td><Td className="text-slate-400 text-xs max-w-[10rem] truncate">{r.supplier || '—'}</Td><Td className="font-mono text-xs text-slate-400">{r.po_number || '—'}</Td></Tr>
                  ))}</Tbody>
                </Table></div>
              </div>
            </>
          )}

          {/* ── RETURNS ─────────────────────────────────────────────────── */}
          {report === 'returns' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat value={returns.length} label="Total Returns" tone="purple" />
                <Stat value={(returnsSummary.awaiting_return || 0) + (returnsSummary.returned || 0)} label="Open" tone="orange" />
                <Stat value={returnsSummary.replaced || 0} label="Replaced" tone="teal" />
                <Stat value={returnsSummary.changed || 0} label="Replaced (changed)" tone="purple" />
              </div>
              <div className="card">
                <p className="font-display text-base font-semibold text-slate-100 mb-3">Returns Log</p>
                <div className="overflow-x-auto"><Table>
                  <Thead><tr><Th>Logged</Th><Th>Reason</Th><Th>Status</Th><Th>Code</Th><Th>Product</Th><Th>Qty</Th><Th>Supplier</Th><Th>Replacement</Th></tr></Thead>
                  <Tbody>{returns.map(r => (
                    <Tr key={r.id}><Td className="text-slate-400 text-xs">{String(r.created_at || '').slice(0, 10)}</Td><Td><Badge variant={r.reason === 'damaged' ? 'red' : 'orange'}>{r.reason === 'wrong_item' ? 'wrong item' : r.reason}</Badge></Td><Td><Badge variant={r.status === 'changed' ? 'purple' : r.status === 'replaced' ? 'green' : 'yellow'}>{r.status}</Badge></Td><Td className="font-mono text-xs text-slate-400">{r.part_number}</Td><Td className="text-slate-100 max-w-xs truncate">{r.product_name}</Td><Td className="text-slate-300">{r.qty} {r.unit}</Td><Td className="text-slate-400 text-xs max-w-[10rem] truncate">{r.supplier || '—'}</Td>
                      <Td className="text-xs text-slate-400 max-w-[12rem] truncate">{(r.status === 'replaced' || r.status === 'changed') ? <span>{r.changed && <span className="text-purple-400 font-semibold">CHANGED → </span>}{r.replacement_part_number} × {r.replacement_qty}</span> : '—'}</Td></Tr>
                  ))}</Tbody>
                </Table></div>
              </div>
            </>
          )}

          {/* ── WASTE ───────────────────────────────────────────────────── */}
          {report === 'waste' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat value={waste.length} label="Records (90d)" tone="red" />
                <Stat value={waste.reduce((s, w) => s + Number(w.quantity || 0), 0).toFixed(0)} label="Units Wasted" tone="orange" />
                <Stat value={money(wasteTotalValue)} label="Waste Value" tone="orange" />
                <Stat value={wasteByReason.length} label="Reasons" tone="slate" />
              </div>
              <div className="card">
                <p className="font-display text-base font-semibold text-slate-100 mb-3">Waste by Reason</p>
                <Table>
                  <Thead><tr><Th>Reason</Th><Th>Records</Th><Th>Qty</Th><Th>Value</Th></tr></Thead>
                  <Tbody>{wasteByReason.map(r => (
                    <Tr key={r.name}><Td className="text-slate-100">{r.name}</Td><Td className="text-slate-400">{r.count}</Td><Td className="text-slate-300">{r.qty.toFixed(1)}</Td><Td className="text-orange-400 font-semibold">{money(r.value)}</Td></Tr>
                  ))}</Tbody>
                </Table>
              </div>
            </>
          )}

          {/* ── SUPPLIERS ───────────────────────────────────────────────── */}
          {report === 'suppliers' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat value={suppliers.length} label="Suppliers" tone="slate" />
                <Stat value={suppliers.filter(s => s.origin === 'local').length} label="Local Suppliers" tone="teal" />
                <Stat value={suppliers.filter(s => s.origin === 'foreign').length} label="Foreign Suppliers" tone="blue" />
                <Stat value={supplierBreakdown.unset.length} label="Items w/o Origin" tone="orange" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card">
                  <p className="font-display text-base font-semibold text-slate-100 mb-1">Stock by Origin</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-emerald-300">Local items</span><span className="text-slate-100">{supplierBreakdown.local.length} · {money(supplierBreakdown.localVal)}</span></div>
                    <div className="flex justify-between"><span className="text-sky-300">Foreign items</span><span className="text-slate-100">{supplierBreakdown.foreign.length} · {money(supplierBreakdown.foreignVal)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">Origin not set</span><span className="text-slate-100">{supplierBreakdown.unset.length}</span></div>
                  </div>
                </div>
                <div className="card">
                  <p className="font-display text-base font-semibold text-slate-100 mb-3">Suppliers</p>
                  <div className="overflow-x-auto"><Table>
                    <Thead><tr><Th>Name</Th><Th>Origin</Th><Th>Contact</Th><Th>Email</Th></tr></Thead>
                    <Tbody>{suppliers.map(s => (
                      <Tr key={s.id}><Td className="text-slate-100">{s.name}</Td><Td>{s.origin ? <Badge variant={s.origin === 'local' ? 'green' : 'blue'}>{s.origin}</Badge> : <span className="text-slate-600 text-xs">—</span>}</Td><Td className="text-slate-400 text-xs">{s.contact_name || s.contact_person || '—'}</Td><Td className="text-slate-400 text-xs">{s.email || '—'}</Td></Tr>
                    ))}</Tbody>
                  </Table></div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {showEmail && <SendReportModal onClose={() => setShowEmail(false)} />}
    </div>
  )
}
