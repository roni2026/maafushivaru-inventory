import { useEffect, useState, useCallback } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import {
  Package, AlertTriangle, TrendingDown, RefreshCw, Zap,
  Activity, ArrowUpRight, CheckCircle, Clock, Star,
  ArrowDownRight, Boxes
} from 'lucide-react'
import Badge from '../components/ui/Badge'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'

// ── Colour palette ─────────────────────────────────────────
const CHART_COLORS = ['#0d9488','#0369a1','#6366f1','#a855f7','#ec4899','#f97316','#eab308','#22c55e']
const HEALTH_COLORS = { good:'#22c55e', ok:'#0d9488', low:'#f97316', out:'#ef4444' }

// ── Util ───────────────────────────────────────────────────
function daysUntil(d) {
  if (!d) return null
  const e = new Date(d); e.setHours(0,0,0,0)
  const n = new Date();  n.setHours(0,0,0,0)
  return Math.ceil((e - n) / 86400000)
}

// ── Custom recharts tooltip ────────────────────────────────
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-xl p-3 shadow-2xl text-xs">
      <p className="text-slate-300 font-medium mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  )
}

// ── StatCard sub-component ─────────────────────────────────
function StatCard({ icon, label, value, sub, color, urgent, link }) {
  const styles = {
    teal:   { border:'border-teal-700/40',   icon:'bg-teal-900/50 text-teal-400',   val:'text-slate-100' },
    red:    { border:'border-red-700/50',     icon:'bg-red-900/50 text-red-400',     val:'text-red-300'   },
    orange: { border:'border-orange-700/40',  icon:'bg-orange-900/50 text-orange-400', val:'text-slate-100' },
    blue:   { border:'border-blue-700/40',    icon:'bg-blue-900/50 text-blue-400',   val:'text-slate-100' },
    purple: { border:'border-purple-700/40',  icon:'bg-purple-900/50 text-purple-400', val:'text-slate-100' },
  }
  const s = styles[color] || styles.teal
  const inner = (
    <div className={`card border ${s.border} ${urgent ? 'ring-1 ring-red-500/40 animate-pulse-slow' : ''} ${link ? 'hover:border-teal-600/60 transition-colors cursor-pointer' : ''}`}>
      <div className={`w-9 h-9 rounded-xl ${s.icon} flex items-center justify-center mb-3`}>{icon}</div>
      <p className={`text-3xl font-bold ${s.val}`}>{value}</p>
      <p className="text-slate-300 text-sm font-medium mt-1">{label}</p>
      {sub && <p className="text-slate-500 text-xs mt-0.5">{sub}</p>}
    </div>
  )
  return link ? <Link to={link}>{inner}</Link> : inner
}

// ── Main Dashboard ─────────────────────────────────────────
export default function Dashboard() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [clock,   setClock]   = useState(new Date())

  // Live clock (updates every minute)
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const today    = new Date(); today.setHours(0,0,0,0)
      const todayStr = today.toISOString().split('T')[0]
      const d7  = new Date(today); d7.setDate(d7.getDate()-7)
      const d14 = new Date(today); d14.setDate(d14.getDate()-14)

      const [{ data: items }, { data: issuances }, { data: updates }] = await Promise.all([
        selectAll(() => supabase.from('items').select('id, name, part_number, store_id, current_stock, min_stock, unit, expiry_date, stores(name, category)').eq('active', true)),
        supabase.from('issuances')
          .select('item_id, quantity_issued, date, items(name, unit, stores(category))')
          .gte('date', d14.toISOString().split('T')[0])
          .order('date'),
        supabase.from('stock_updates')
          .select('*, items(name, part_number)')
          .order('created_at', { ascending: false }).limit(8),
      ])

      // ── Core stats ──────────────────────────────────────
      const it = items || []
      const iss = issuances || []
      const upd = updates || []
      const d7Str = d7.toISOString().split('T')[0]

      const critical = it.filter(i => { const d=daysUntil(i.expiry_date); return d!==null&&d<=7 }).length
      const warn30   = it.filter(i => { const d=daysUntil(i.expiry_date); return d!==null&&d>7&&d<=30 }).length
      const lowStock = it.filter(i => Number(i.current_stock)>0 && Number(i.current_stock)<=Number(i.min_stock)).length
      const outStock = it.filter(i => Number(i.current_stock)===0).length
      const todayIss = iss.filter(i=>i.date===todayStr)
      const todayTotal = todayIss.reduce((s,i)=>s+Number(i.quantity_issued),0)

      // ── Stock health donut ──────────────────────────────
      const healthData = [
        { name:'Good (>150% min)',  value: it.filter(i=>Number(i.current_stock)>Number(i.min_stock)*1.5).length,                                            color:HEALTH_COLORS.good },
        { name:'OK (>min)',         value: it.filter(i=>{const c=Number(i.current_stock),m=Number(i.min_stock);return c>m&&c<=m*1.5}).length,               color:HEALTH_COLORS.ok   },
        { name:'Low (≤min)',        value: it.filter(i=>Number(i.current_stock)>0&&Number(i.current_stock)<=Number(i.min_stock)).length,                     color:HEALTH_COLORS.low  },
        { name:'Out of Stock',      value: it.filter(i=>Number(i.current_stock)===0).length,                                                                 color:HEALTH_COLORS.out  },
      ].filter(x=>x.value>0)

      // ── 7-day daily area chart ──────────────────────────
      const dailyMap = {}
      for (let i=6;i>=0;i--) {
        const dt = new Date(today); dt.setDate(dt.getDate()-i)
        const k  = dt.toISOString().split('T')[0]
        dailyMap[k] = { key:k, label:dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}), units:0, lines:0 }
      }
      iss.filter(i=>i.date>=d7Str).forEach(i => {
        if (dailyMap[i.date]) { dailyMap[i.date].units+=Number(i.quantity_issued); dailyMap[i.date].lines+=1 }
      })
      const dailyData = Object.values(dailyMap)

      // ── Top 5 items this week ───────────────────────────
      const itemMap = {}
      iss.filter(i=>i.date>=d7Str).forEach(i => {
        if (!itemMap[i.item_id]) itemMap[i.item_id]={ name:i.items?.name||'?', unit:i.items?.unit||'', total:0 }
        itemMap[i.item_id].total+=Number(i.quantity_issued)
      })
      const top5 = Object.values(itemMap).sort((a,b)=>b.total-a.total).slice(0,5)

      // ── Issuance by category ────────────────────────────
      const catMap = {}
      iss.filter(i=>i.date>=d7Str).forEach(i => {
        const cat = i.items?.stores?.category || 'Unknown'
        catMap[cat] = (catMap[cat]||0)+Number(i.quantity_issued)
      })
      const categoryPie = Object.entries(catMap).map(([name,value],idx)=>({
        name, value, color:CHART_COLORS[idx%CHART_COLORS.length]
      }))

      // ── Expiry urgency progress bars ────────────────────
      const total = it.length
      const expiry = [
        { label:'Expired',    count:it.filter(i=>{const d=daysUntil(i.expiry_date);return d!==null&&d<0}).length,          color:'#ef4444' },
        { label:'≤ 7 Days',   count:it.filter(i=>{const d=daysUntil(i.expiry_date);return d!==null&&d>=0&&d<=7}).length,   color:'#f97316' },
        { label:'8–15 Days',  count:it.filter(i=>{const d=daysUntil(i.expiry_date);return d!==null&&d>7&&d<=15}).length,   color:'#eab308' },
        { label:'16–30 Days', count:it.filter(i=>{const d=daysUntil(i.expiry_date);return d!==null&&d>15&&d<=30}).length,  color:'#22c55e' },
        { label:'> 30 Days',  count:it.filter(i=>{const d=daysUntil(i.expiry_date);return d===null||d>30}).length,         color:'#0d9488' },
      ]

      // ── Low stock items (sorted by % remaining asc) ─────
      const lowStockItems = it
        .filter(i=>Number(i.current_stock)<=Number(i.min_stock))
        .sort((a,b)=>{
          const pa = Number(a.min_stock)>0 ? Number(a.current_stock)/Number(a.min_stock) : 1
          const pb = Number(b.min_stock)>0 ? Number(b.current_stock)/Number(b.min_stock) : 1
          return pa-pb
        })
        .slice(0,8)

      // ── Expiring items (next 15 days) ───────────────────
      const expiringItems = it
        .filter(i=>{ const d=daysUntil(i.expiry_date); return d!==null&&d<=15 })
        .sort((a,b)=>daysUntil(a.expiry_date)-daysUntil(b.expiry_date))
        .slice(0,8)

      setData({
        total, critical, warn30, lowStock, outStock,
        todayTotal, todayCount: todayIss.length,
        healthData, dailyData, top5, categoryPie, expiry,
        lowStockItems, expiringItems, updates: upd,
      })
    } catch (err) {
      toast.error('Dashboard error: ' + err.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4">
      <div className="w-14 h-14 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-400 text-sm animate-pulse">Loading dashboard…</p>
    </div>
  )

  const d = data

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-100">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {clock.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}
            {' · '}
            <span className="text-teal-400 font-semibold tabular-nums">{clock.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</span>
          </p>
        </div>
        <button onClick={load} className="btn-secondary btn-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* ── 4 Stat Cards ────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          icon={<Package className="w-5 h-5" />}
          label="Total Items" value={d.total}
          sub={`${d.warn30} expiring in 30d`}
          color="teal" link="/inventory"
        />
        <StatCard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Expired / Critical" value={d.critical}
          sub="Expired or ≤ 7 days left"
          color="red" urgent={d.critical > 0} link="/inventory"
        />
        <StatCard
          icon={<TrendingDown className="w-5 h-5" />}
          label="Low / Out of Stock" value={d.lowStock + d.outStock}
          sub={`${d.outStock} completely out of stock`}
          color="orange" urgent={d.outStock > 0}
        />
        <StatCard
          icon={<Zap className="w-5 h-5" />}
          label="Issued Today" value={d.todayTotal}
          sub={`${d.todayCount} issuance lines`}
          color="blue" link="/issuance"
        />
      </div>

      {/* ── Area chart + Stock health donut ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* 7-day trend */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">7-Day Issuance Trend</h2>
              <p className="text-slate-500 text-xs mt-0.5">Units issued per day over the last week</p>
            </div>
            <Activity className="w-4 h-4 text-teal-400 shrink-0" />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={d.dailyData} margin={{top:5,right:5,left:-25,bottom:0}}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#0d9488" stopOpacity={0.45}/>
                  <stop offset="95%" stopColor="#0d9488" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" tick={{fill:'#64748b',fontSize:11}} />
              <YAxis tick={{fill:'#64748b',fontSize:11}} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="units" name="Units Issued"
                stroke="#0d9488" strokeWidth={2.5}
                fill="url(#areaGrad)"
                dot={{fill:'#0d9488',r:4,stroke:'#042f2e',strokeWidth:2}}
                activeDot={{r:7,fill:'#14b8a6',stroke:'#042f2e',strokeWidth:2}} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Stock health donut */}
        <div className="card flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">Stock Health</h2>
              <p className="text-slate-500 text-xs">{d.total} total items</p>
            </div>
            <CheckCircle className="w-4 h-4 text-teal-400 shrink-0" />
          </div>
          {d.healthData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">No data</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={155}>
                <PieChart>
                  <Pie data={d.healthData} cx="50%" cy="50%"
                    innerRadius={45} outerRadius={68}
                    paddingAngle={3} dataKey="value"
                    startAngle={90} endAngle={-270}>
                    {d.healthData.map((e,i) => <Cell key={i} fill={e.color} strokeWidth={0} />)}
                  </Pie>
                  <Tooltip contentStyle={{background:'#1e293b',border:'1px solid #334155',borderRadius:'8px',color:'#f1f5f9',fontSize:'12px'}} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-auto">
                {d.healthData.map(h => (
                  <div key={h.name} className="flex items-center gap-2 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:h.color}} />
                    <span className="text-slate-400 flex-1 truncate">{h.name}</span>
                    <span className="text-slate-200 font-semibold">{h.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Top 5 items + Issuance by category ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top 5 items this week */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">Top 5 Items This Week</h2>
              <p className="text-slate-500 text-xs">By units issued (last 7 days)</p>
            </div>
            <Star className="w-4 h-4 text-yellow-400 shrink-0" />
          </div>
          {d.top5.length === 0 ? (
            <div className="flex items-center justify-center h-36 text-slate-500 text-sm">No issuances this week</div>
          ) : (
            <ResponsiveContainer width="100%" height={185}>
              <BarChart data={d.top5} layout="vertical" margin={{top:0,right:20,left:85,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" tick={{fill:'#64748b',fontSize:11}} />
                <YAxis type="category" dataKey="name" tick={{fill:'#64748b',fontSize:10}} width={85}
                  tickFormatter={v => v.length>14 ? v.slice(0,14)+'…' : v} />
                <Tooltip content={<ChartTip />} formatter={(v,_,p)=>[`${v} ${p.payload.unit}`,'Issued']} />
                <Bar dataKey="total" name="Issued" radius={[0,4,4,0]}>
                  {d.top5.map((_,i) => <Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Issuance by category (pie) */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">Issuance by Category</h2>
              <p className="text-slate-500 text-xs">Unit breakdown this week</p>
            </div>
            <Boxes className="w-4 h-4 text-purple-400 shrink-0" />
          </div>
          {d.categoryPie.length === 0 ? (
            <div className="flex items-center justify-center h-36 text-slate-500 text-sm">No issuances this week</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={155}>
                <PieChart>
                  <Pie data={d.categoryPie} cx="50%" cy="50%"
                    outerRadius={68} paddingAngle={4} dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}
                    labelLine={{ stroke:'#475569' }}>
                    {d.categoryPie.map((e,i) => <Cell key={i} fill={e.color} strokeWidth={0} />)}
                  </Pie>
                  <Tooltip contentStyle={{background:'#1e293b',border:'1px solid #334155',borderRadius:'8px',color:'#f1f5f9',fontSize:'12px'}} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex gap-4 justify-center flex-wrap mt-2">
                {d.categoryPie.map(c => (
                  <div key={c.name} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{background:c.color}} />
                    <span className="text-slate-400">{c.name}</span>
                    <span className="text-slate-200 font-semibold">{c.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Expiry urgency bars ──────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-100">Expiry Urgency Overview</h2>
            <p className="text-slate-500 text-xs">All {d.total} items grouped by time to expiry</p>
          </div>
          <Clock className="w-4 h-4 text-yellow-400 shrink-0" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mb-5">
          {d.expiry.map(({ label, count, color }) => (
            <div key={label} className="text-center p-3 rounded-xl bg-slate-700/30">
              <p className="text-2xl font-bold" style={{color}}>{count}</p>
              <p className="text-slate-400 text-xs mt-1">{label}</p>
            </div>
          ))}
        </div>
        {/* Stacked visual bar */}
        <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
          {d.expiry.filter(e=>e.count>0).map(({ label, count, color }) => (
            <div key={label} className="h-full transition-all duration-700 rounded-sm"
              style={{ width:`${Math.round((count/d.total)*100)}%`, background:color }}
              title={`${label}: ${count}`} />
          ))}
        </div>
      </div>

      {/* ── Low stock + Recent activity ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Low stock */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-slate-100">Low / Out of Stock</h2>
            {d.lowStockItems.length > 0
              ? <Badge variant="orange">{d.lowStockItems.length} items</Badge>
              : <Badge variant="green">All OK</Badge>}
          </div>
          {d.lowStockItems.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2 text-slate-500">
              <CheckCircle className="w-10 h-10 text-green-500 opacity-50" />
              <p className="text-sm">All items are adequately stocked</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {d.lowStockItems.map(item => {
                const isOut = Number(item.current_stock) === 0
                const pct   = Number(item.min_stock)>0
                  ? Math.min(100, Math.round((Number(item.current_stock)/Number(item.min_stock))*100))
                  : 0
                return (
                  <div key={item.id}
                    className={`p-3 rounded-xl border ${isOut ? 'border-red-700/50 bg-red-900/15' : 'border-orange-700/30 bg-orange-900/10'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-100 truncate">{item.name}</p>
                        <p className="text-xs text-slate-500">{item.stores?.name} · Min: {item.min_stock} {item.unit}</p>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ml-3 ${isOut ? 'text-red-400' : 'text-orange-400'}`}>
                        {isOut ? '⚠ OUT' : `${item.current_stock}`}
                      </span>
                    </div>
                    {!isOut && (
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-orange-500 transition-all duration-500"
                          style={{width:`${pct}%`}} />
                      </div>
                    )}
                  </div>
                )
              })}
              <Link to="/orders" className="block text-center text-xs text-teal-400 hover:text-teal-300 transition-colors mt-2">
                → Generate Order Sheet for these items
              </Link>
            </div>
          )}
        </div>

        {/* Recent stock activity */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-slate-100">Recent Stock Activity</h2>
            <Link to="/history" className="text-xs text-teal-400 hover:text-teal-300 transition-colors">View all →</Link>
          </div>
          {d.updates.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2 text-slate-500">
              <Package className="w-10 h-10 opacity-20" />
              <p className="text-sm">No recent stock changes</p>
            </div>
          ) : (
            <div className="space-y-2">
              {d.updates.map(u => (
                <div key={u.id}
                  className="flex items-start gap-3 p-3 rounded-xl bg-slate-700/20 border border-slate-700/30">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${u.quantity_change>=0 ? 'bg-green-900/60 text-green-400' : 'bg-red-900/60 text-red-400'}`}>
                    {u.quantity_change>=0
                      ? <ArrowUpRight className="w-4 h-4" />
                      : <ArrowDownRight className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-100 truncate">{u.items?.name}</p>
                    <p className="text-xs text-slate-500">{u.date} · {u.updated_by || 'System'}</p>
                    {u.note && <p className="text-xs text-slate-600 truncate mt-0.5">{u.note}</p>}
                  </div>
                  <span className={`text-sm font-bold shrink-0 ${u.quantity_change>=0 ? 'text-green-400' : 'text-red-400'}`}>
                    {u.quantity_change>=0 ? '+' : ''}{u.quantity_change}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Expiring items list ──────────────────────────── */}
      {d.expiringItems.length > 0 && (
        <div className="card border border-red-800/30">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <h2 className="font-display text-base font-semibold text-red-300">
              Items Expiring Within 15 Days ({d.expiringItems.length})
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {d.expiringItems.map(item => {
              const days = daysUntil(item.expiry_date)
              const color = days !== null && days < 0 ? 'text-red-400' : days !== null && days<=7 ? 'text-orange-400' : 'text-yellow-400'
              return (
                <div key={item.id} className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-700/30 border border-slate-700/40">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.part_number} · {item.stores?.name}</p>
                  </div>
                  <span className={`text-xs font-bold shrink-0 ml-3 ${color}`}>
                    {days !== null && days < 0 ? 'EXPIRED' : `${days}d`}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="mt-3 text-center">
            <Link to="/inventory" className="text-xs text-teal-400 hover:text-teal-300 transition-colors">
              → View full inventory & manage expiry
            </Link>
          </div>
        </div>
      )}

    </div>
  )
}
