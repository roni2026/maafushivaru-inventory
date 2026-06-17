import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart2, Download, RefreshCw, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line, Legend
} from 'recharts'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import SendReportModal from '../components/SendReportModal'

function daysUntil(d) {
  if (!d) return null
  const exp = new Date(d); exp.setHours(0,0,0,0)
  const now = new Date();  now.setHours(0,0,0,0)
  return Math.ceil((exp - now) / 86400000)
}

export default function Reports() {
  const [items,    setItems]    = useState([])
  const [issuances,setIssuances]= useState([])
  const [stores,   setStores]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showEmail,setShowEmail]= useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: i }, { data: s }, { data: iss }] = await Promise.all([
      supabase.from('items').select('*,stores(name,category)'),
      supabase.from('stores').select('*'),
      supabase.from('issuances').select('*').gte('date', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]),
    ])
    setItems(i || [])
    setStores(s || [])
    setIssuances(iss || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // ── Computed stats ─────────────────────────────────────────
  const expiring = items
    .filter(i => { const d = daysUntil(i.expiry_date); return d !== null && d <= 30 })
    .sort((a, b) => daysUntil(a.expiry_date) - daysUntil(b.expiry_date))

  const lowStock   = items.filter(i => Number(i.current_stock) <= Number(i.min_stock))
  const totalValue = items.reduce((s, i) => s + Number(i.current_stock) * Number(i.unit_cost || 0), 0)

  // Daily issuance chart (last 14 days)
  const issuanceByDay = (() => {
    const map = {}
    for (let d = 13; d >= 0; d--) {
      const dt = new Date(); dt.setDate(dt.getDate() - d)
      const k  = dt.toISOString().split('T')[0]
      map[k] = { date: dt.toLocaleDateString('en-US', { month:'short', day:'numeric' }), qty: 0 }
    }
    ;(issuances || []).forEach(iss => {
      if (map[iss.date]) map[iss.date].qty += Number(iss.quantity_issued)
    })
    return Object.values(map)
  })()

  // Top issued items
  const topItems = (() => {
    const map = {}
    ;(issuances || []).forEach(iss => {
      map[iss.item_id] = (map[iss.item_id] || 0) + Number(iss.quantity_issued)
    })
    return Object.entries(map)
      .map(([id, qty]) => ({ item: items.find(i => i.id === id), qty }))
      .filter(r => r.item)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10)
  })()

  // Stock by store
  const byStore = stores.map(s => ({
    name:  s.name,
    items: items.filter(i => i.store_id === s.id).length,
    value: items.filter(i => i.store_id === s.id).reduce((t, i) => t + Number(i.current_stock) * Number(i.unit_cost || 0), 0),
  }))

  const exportCSV = () => {
    const rows = [
      ['Part #', 'Name', 'Store', 'Stock', 'Unit', 'Min Stock', 'Unit Cost', 'Value', 'Expiry', 'Days Left'],
      ...items.map(i => [
        i.part_number, i.name, i.stores?.name, i.current_stock, i.unit,
        i.min_stock, i.unit_cost || 0,
        (Number(i.current_stock) * Number(i.unit_cost || 0)).toFixed(2),
        i.expiry_date || '',
        daysUntil(i.expiry_date) ?? '',
      ]),
    ]
    const csv  = rows.map(r => r.join(',')).join('\n')
    const link = document.createElement('a')
    link.href  = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    link.download = `inventory_report_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    toast.success('CSV exported')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">Inventory analytics, expiry tracking, and automated email reports</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={exportCSV} className="btn-secondary btn-sm"><Download className="w-4 h-4" /> Export CSV</button>
          <Button onClick={() => setShowEmail(true)}>
            <Mail className="w-4 h-4" /> Send Email Report
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="card-sm text-center">
              <p className="text-2xl font-bold text-[#00AEEF]">{items.length}</p>
              <p className="text-slate-400 text-xs mt-1">Total Items</p>
            </div>
            <div className="card-sm text-center border border-red-700/30 bg-red-900/10">
              <p className="text-2xl font-bold text-red-400">{lowStock.length}</p>
              <p className="text-slate-400 text-xs mt-1">Low Stock</p>
            </div>
            <div className="card-sm text-center border border-orange-700/30 bg-orange-900/10">
              <p className="text-2xl font-bold text-orange-400">{expiring.length}</p>
              <p className="text-slate-400 text-xs mt-1">Expiring ≤30d</p>
            </div>
            <div className="card-sm text-center border border-teal-700/30 bg-teal-900/10">
              <p className="text-2xl font-bold text-teal-400">${totalValue.toFixed(0)}</p>
              <p className="text-slate-400 text-xs mt-1">Total Value</p>
            </div>
          </div>

          {/* Issuance chart */}
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

          {/* Stock by store */}
          {byStore.length > 0 && (
            <div className="card">
              <p className="font-display text-base font-semibold text-slate-100 mb-4">Stock Value by Store</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byStore} layout="vertical" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={120} />
                  <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    formatter={v => [`$${Number(v).toFixed(2)}`, 'Value']} />
                  <Bar dataKey="value" fill="#14b8a6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top issued items */}
          {topItems.length > 0 && (
            <div className="card">
              <p className="font-display text-base font-semibold text-slate-100 mb-3">Top Issued Items — Last 30 Days</p>
              <Table>
                <Thead><tr>
                  <Th>Part #</Th><Th>Item</Th><Th>Store</Th><Th>Total Issued</Th><Th>Unit</Th>
                </tr></Thead>
                <Tbody>
                  {topItems.map(({ item, qty }) => (
                    <Tr key={item.id}>
                      <Td className="font-mono text-xs text-slate-400">{item.part_number}</Td>
                      <Td className="font-medium text-slate-100">{item.name}</Td>
                      <Td className="text-slate-400 text-xs">{item.stores?.name}</Td>
                      <Td><span className="font-bold text-[#00AEEF] text-base">{qty}</span></Td>
                      <Td className="text-slate-400 text-xs">{item.unit}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}

          {/* Expiring items */}
          {expiring.length > 0 && (
            <div className="card">
              <p className="font-display text-base font-semibold text-slate-100 mb-3">
                Items Expiring / Near Expiry
                <span className="ml-2 text-orange-400 text-sm font-normal">({expiring.length} items)</span>
              </p>
              <Table>
                <Thead><tr>
                  <Th>Part #</Th><Th>Item</Th><Th>Store</Th><Th>Stock</Th><Th>Expiry Date</Th><Th>Days Left</Th>
                </tr></Thead>
                <Tbody>
                  {expiring.map(item => {
                    const d = daysUntil(item.expiry_date)
                    return (
                      <Tr key={item.id}>
                        <Td className="font-mono text-xs text-slate-400">{item.part_number}</Td>
                        <Td className="font-medium text-slate-100">{item.name}</Td>
                        <Td className="text-slate-400 text-xs">{item.stores?.name}</Td>
                        <Td className="font-semibold text-slate-100">{item.current_stock} <span className="text-slate-500 text-xs">{item.unit}</span></Td>
                        <Td className="text-slate-300">{item.expiry_date}</Td>
                        <Td>
                          {d < 0   ? <Badge variant="red">Expired {Math.abs(d)}d ago</Badge>
                          : d <= 7 ? <Badge variant="red">{d}d left</Badge>
                          : d <= 15? <Badge variant="orange">{d}d left</Badge>
                          :          <Badge variant="yellow">{d}d left</Badge>}
                        </Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>
            </div>
          )}
        </>
      )}

      {/* Send Email Report modal */}
      {showEmail && <SendReportModal onClose={() => setShowEmail(false)} />}
    </div>
  )
}
