import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Package, AlertTriangle, Clock, TrendingDown, RefreshCw, CheckCircle } from 'lucide-react'
import Badge from '../components/ui/Badge'
import toast from 'react-hot-toast'

function daysUntil(dateStr) {
  if (!dateStr) return null
  const expiry = new Date(dateStr); expiry.setHours(0,0,0,0)
  const today  = new Date();        today.setHours(0,0,0,0)
  return Math.ceil((expiry - today) / 86400000)
}

function expiryBadge(days) {
  if (days === null) return null
  if (days <  0)  return <Badge variant="red">Expired</Badge>
  if (days <= 7)  return <Badge variant="red">{days}d left</Badge>
  if (days <= 15) return <Badge variant="orange">{days}d left</Badge>
  if (days <= 30) return <Badge variant="yellow">{days}d left</Badge>
  return              <Badge variant="green">{days}d left</Badge>
}

function rowBg(days) {
  if (days === null) return ''
  if (days <  0)  return 'bg-red-950/40 border-l-2 border-red-500'
  if (days <= 7)  return 'bg-red-950/30 border-l-2 border-red-400'
  if (days <= 15) return 'bg-orange-950/30 border-l-2 border-orange-400'
  return              'bg-yellow-950/20 border-l-2 border-yellow-500'
}

export default function Dashboard() {
  const [stats,    setStats]    = useState(null)
  const [expiring, setExpiring] = useState([])
  const [updates,  setUpdates]  = useState([])
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: items }, { data: upd }] = await Promise.all([
        supabase.from('items').select('*, stores(name, category)'),
        supabase.from('stock_updates')
          .select('*, items(name, part_number)')
          .order('created_at', { ascending: false }).limit(8),
      ])

      const today = new Date(); today.setHours(0,0,0,0)

      const exp = (items || [])
        .filter(i => i.expiry_date && daysUntil(i.expiry_date) <= 30)
        .sort((a, b) => daysUntil(a.expiry_date) - daysUntil(b.expiry_date))

      setStats({
        total:    (items || []).length,
        critical: (items || []).filter(i => { const d = daysUntil(i.expiry_date); return d !== null && d <= 7 }).length,
        warn15:   (items || []).filter(i => { const d = daysUntil(i.expiry_date); return d !== null && d > 7 && d <= 15 }).length,
        warn30:   (items || []).filter(i => { const d = daysUntil(i.expiry_date); return d !== null && d > 15 && d <= 30 }).length,
        lowStock: (items || []).filter(i => Number(i.current_stock) <= Number(i.min_stock)).length,
        byCategory: {
          Beverage: (items || []).filter(i => i.stores?.category === 'Beverage').length,
          Food:     (items || []).filter(i => i.stores?.category === 'Food').length,
          General:  (items || []).filter(i => i.stores?.category === 'General').length,
        },
      })
      setExpiring(exp.slice(0, 12))
      setUpdates(upd || [])
    } catch {
      toast.error('Failed to load dashboard')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">{new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
        </div>
        <button onClick={load} className="btn-secondary btn-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Package className="w-6 h-6 text-teal-400" />}          label="Total Items"           value={stats?.total    || 0} accent="teal"   />
        <StatCard icon={<AlertTriangle className="w-6 h-6 text-red-400" />}     label="Expired / ≤7 Days"     value={stats?.critical || 0} accent="red"    />
        <StatCard icon={<Clock className="w-6 h-6 text-orange-400" />}          label="Expiring 8–15 Days"    value={stats?.warn15   || 0} accent="orange" />
        <StatCard icon={<TrendingDown className="w-6 h-6 text-yellow-400" />}   label="Low / Out of Stock"    value={stats?.lowStock || 0} accent="yellow" />
      </div>

      {/* Category breakdown */}
      <div className="grid grid-cols-3 gap-4">
        {Object.entries(stats?.byCategory || {}).map(([cat, count]) => (
          <div key={cat} className="card text-center py-5">
            <p className="text-4xl font-bold text-teal-400">{count}</p>
            <p className="text-slate-400 text-sm mt-1">{cat} Items</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Expiring soon */}
        <div className="card">
          <h2 className="font-display text-lg font-semibold text-slate-100 mb-4">Expiring Within 30 Days</h2>
          {expiring.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No items expiring soon</p>
            </div>
          ) : (
            <div className="space-y-2">
              {expiring.map(item => {
                const days = daysUntil(item.expiry_date)
                return (
                  <div key={item.id} className={`flex items-center justify-between p-3 rounded-lg ${rowBg(days)}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-100 truncate">{item.name}</p>
                      <p className="text-xs text-slate-400">{item.part_number} · {item.stores?.name}</p>
                    </div>
                    <div className="shrink-0 ml-2">{expiryBadge(days)}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent updates */}
        <div className="card">
          <h2 className="font-display text-lg font-semibold text-slate-100 mb-4">Recent Stock Updates</h2>
          {updates.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No recent updates</p>
            </div>
          ) : (
            <div className="space-y-2">
              {updates.map(u => (
                <div key={u.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-700 bg-slate-700/20">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100 truncate">{u.items?.name}</p>
                    <p className="text-xs text-slate-400">{u.date} · {u.updated_by || 'System'}</p>
                  </div>
                  <span className={`text-sm font-bold shrink-0 ml-2 ${u.quantity_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {u.quantity_change >= 0 ? '+' : ''}{u.quantity_change}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, accent }) {
  const borders = { teal: 'border-teal-800/60', red: 'border-red-800/60', orange: 'border-orange-800/60', yellow: 'border-yellow-800/60' }
  return (
    <div className={`card border ${borders[accent] || 'border-slate-700'}`}>
      <div className="p-2 bg-slate-700/60 rounded-lg w-fit mb-3">{icon}</div>
      <p className="text-3xl font-bold text-slate-100">{value}</p>
      <p className="text-slate-400 text-sm mt-1">{label}</p>
    </div>
  )
}
