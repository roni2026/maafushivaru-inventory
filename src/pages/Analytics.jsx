import { useState, useCallback, useMemo } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts'
import { TrendingUp, RefreshCw, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'

// ── Classification logic ─────────────────────────────
// Movement speed over a selectable window (`days`). The current window is the
// last `days` days; the previous equal-length window is used for the trend %.
function classifyItems(items, issuances, days = 14) {
  const now = new Date(); now.setHours(0,0,0,0)
  const start     = new Date(now); start.setDate(start.getDate() - days)
  const prevStart = new Date(now); prevStart.setDate(prevStart.getDate() - days * 2)

  const curMap  = {}
  const prevMap = {}

  ;(issuances||[]).forEach(iss => {
    const d = new Date(iss.date); d.setHours(0,0,0,0)
    if (d >= start)                 { curMap[iss.item_id]  = (curMap[iss.item_id] ||0)+Number(iss.quantity_issued) }
    else if (d >= prevStart && d < start) { prevMap[iss.item_id] = (prevMap[iss.item_id]||0)+Number(iss.quantity_issued) }
  })

  const curVals = (items||[]).map(i => curMap[i.id]||0).sort((a,b)=>a-b)
  const p25 = curVals[Math.floor(curVals.length*0.25)]||0
  const p75 = curVals[Math.floor(curVals.length*0.75)]||0

  return (items||[]).map(item => {
    const cur   = curMap[item.id]  || 0
    const prev  = prevMap[item.id] || 0
    const noMov = cur === 0

    let cls, badge
    if (noMov)         { cls='No Movement'; badge='gray'   }
    else if (cur>=p75) { cls='Fast Moving'; badge='green'  }
    else if (cur<=p25) { cls='Slow Moving'; badge='orange' }
    else               { cls='Normal';      badge='teal'   }

    const trend = prev > 0 ? ((cur - prev) / prev * 100).toFixed(0) : null

    return { ...item, wkTotal:cur, twkTotal:cur, prevTotal:prev, cls, badge, trend }
  })
}

// ── Chart tooltip ──────────────────────────────────────────
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-xl p-3 shadow-2xl text-xs">
      <p className="text-slate-300 font-medium mb-1.5">{label}</p>
      {payload.map((p,i)=><p key={i} style={{color:p.color}}>{p.name}: <strong>{p.value}</strong></p>)}
    </div>
  )
}

const CLS_COLORS = { 'Fast Moving':'#22c55e', 'Normal':'#0d9488', 'Slow Moving':'#f97316', 'No Movement':'#475569' }
const PIE_COLORS = ['#22c55e','#0d9488','#f97316','#475569']

export default function Analytics() {
  const [classified,  setClassified]  = useState(null)
  const [stores,      setStores]      = useState([])
  const [loading,     setLoading]     = useState(false)
  const [filterStore, setFilterStore] = useState('')
  const [filterCat,   setFilterCat]   = useState('')
  const [filterCls,   setFilterCls]   = useState('')
  const [search,      setSearch]      = useState('')
  const [sortField,   setSortField]   = useState('wkTotal')
  const [sortDir,     setSortDir]     = useState('desc')
  const [period,      setPeriod]      = useState(14)   // 7 | 14 | 30 | 90 days

  const PERIODS = [
    { days: 7,  label: 'Weekly' },
    { days: 14, label: 'Last 14 Days' },
    { days: 30, label: 'Monthly' },
    { days: 90, label: 'Quarterly' },
  ]
  const periodLabel = (PERIODS.find(p => p.days === period) || PERIODS[1]).label

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch two windows' worth of issuances so the trend can compare against
      // the previous equal-length period.
      const since = new Date(); since.setDate(since.getDate() - period * 2)
      const [{ data: items }, { data: issuances }, { data: st }] = await Promise.all([
        selectAll(() => supabase.from('items').select('*, stores(name, category)').eq('active', true)),
        selectAll(() => supabase.from('issuances')
          .select('item_id, quantity_issued, date')
          .gte('date', since.toISOString().split('T')[0])),
        supabase.from('stores').select('*').order('name'),
      ])
      setClassified(classifyItems(items, issuances, period))
      setStores(st || [])
    } catch (err) {
      toast.error('Failed: ' + err.message)
    }
    setLoading(false)
  }, [period])

  // ── Filtered + sorted list ─────────────────────────────
  const filtered = useMemo(() => {
    if (!classified) return []
    let list = [...classified]
    if (search)      { const q=search.toLowerCase(); list=list.filter(i=>i.name.toLowerCase().includes(q)||i.part_number.toLowerCase().includes(q)) }
    if (filterStore) list = list.filter(i => i.store_id === filterStore)
    if (filterCat)   list = list.filter(i => i.stores?.category === filterCat)
    if (filterCls)   list = list.filter(i => i.cls === filterCls)
    list.sort((a,b) => {
      const getv=(o)=> sortField==='store_name' ? (o.stores?.name||'') : o[sortField]
      let va=getv(a), vb=getv(b)
      if (typeof va==='string') { va=va.toLowerCase(); vb=(vb||'').toLowerCase() }
      if (va==null) return 1; if (vb==null) return -1
      return sortDir==='asc' ? (va>vb?1:-1) : (va<vb?1:-1)
    })
    return list
  }, [classified, search, filterStore, filterCat, filterCls, sortField, sortDir])

  const toggleSort = (f) => {
    if (sortField===f) setSortDir(d=>d==='asc'?'desc':'asc')
    else { setSortField(f); setSortDir('desc') }
  }

  // ── Summary counts ────────────────────────────────────
  const summary = useMemo(() => {
    const s = { 'Fast Moving':0, 'Normal':0, 'Slow Moving':0, 'No Movement':0 }
    ;(classified||[]).forEach(i => { if (s[i.cls]!==undefined) s[i.cls]++ })
    return s
  }, [classified])

  // ── Pie data ──────────────────────────────────────────
  const pieData = Object.entries(summary).map(([name,value],i) => ({
    name, value, color:PIE_COLORS[i]
  })).filter(d=>d.value>0)

  // ── Top 20 chart data ─────────────────────────────────
  const top20 = [...(classified||[])].sort((a,b)=>b.wkTotal-a.wkTotal).slice(0,20)

  // ── Week-over-week top 10 comparison ─────────────────
  const wowTop10 = [...(classified||[])]
    .filter(i => i.wkTotal>0 || i.prevTotal>0)
    .sort((a,b)=>b.wkTotal-a.wkTotal)
    .slice(0,10)
    .map(i => ({
      name:  i.name.length>16 ? i.name.slice(0,16)+'…' : i.name,
      unit:  i.unit,
      thisWeek: i.wkTotal,
      lastWeek: i.prevTotal,
    }))

  const categories = [...new Set((stores).map(s=>s.category))].sort()

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-sub">Movement speed classification & trend comparison · {periodLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
            {PERIODS.map(p => (
              <button key={p.days} onClick={() => setPeriod(p.days)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${period === p.days ? 'bg-[#00AEEF] text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <Button onClick={load} loading={loading}>
            <RefreshCw className="w-4 h-4" /> Analyse
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {!classified && !loading && (
        <div className="card text-center py-20 text-slate-500">
          <TrendingUp className="w-14 h-14 mx-auto mb-4 opacity-20" />
          <p className="font-medium text-lg">No analysis yet</p>
          <p className="text-sm mt-1">Click "Analyse" to classify all items by movement speed.</p>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm animate-pulse">Analysing {period} days of data…</p>
        </div>
      )}

      {classified && !loading && (
        <>
          {/* Classification summary (clickable) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { cls:'Fast Moving',  badge:'green',  icon:'🚀' },
              { cls:'Normal',       badge:'teal',   icon:'✅' },
              { cls:'Slow Moving',  badge:'orange', icon:'🐢' },
              { cls:'No Movement',  badge:'gray',   icon:'💤' },
            ].map(({ cls, badge, icon }) => (
              <button key={cls}
                onClick={() => setFilterCls(filterCls===cls ? '' : cls)}
                className={`card text-center transition-all cursor-pointer ${filterCls===cls ? 'ring-2 ring-teal-500' : 'hover:border-slate-600'}`}>
                <p className="text-3xl mb-2">{icon}</p>
                <p className="text-2xl font-bold text-slate-100">{summary[cls]||0}</p>
                <Badge variant={badge} className="mt-1">{cls}</Badge>
              </button>
            ))}
          </div>

          {/* Pie chart + Explanation */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card">
              <h2 className="font-display text-base font-semibold text-slate-100 mb-1">Classification Breakdown</h2>
              <p className="text-slate-500 text-xs mb-4">Proportion of items in each movement category</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%"
                    outerRadius={80} paddingAngle={4} dataKey="value"
                    label={({name,percent})=>`${(percent*100).toFixed(0)}%`}
                    labelLine={{stroke:'#475569'}}>
                    {pieData.map((e,i)=><Cell key={i} fill={e.color} strokeWidth={0} />)}
                  </Pie>
                  <Tooltip contentStyle={{background:'#1e293b',border:'1px solid #334155',borderRadius:'8px',color:'#f1f5f9',fontSize:'12px'}} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex gap-4 justify-center flex-wrap mt-2">
                {pieData.map(p=>(
                  <div key={p.name} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{background:p.color}} />
                    <span className="text-slate-400">{p.name}:</span>
                    <span className="text-slate-200 font-semibold">{p.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h2 className="font-display text-base font-semibold text-slate-100 mb-3">How Classification Works</h2>
              <div className="space-y-3 text-sm">
                <div className="flex gap-3 p-3 rounded-lg bg-green-900/20 border border-green-800/30">
                  <span className="text-lg shrink-0">🚀</span>
                  <div><p className="text-green-300 font-semibold">Fast Moving</p><p className="text-slate-400 text-xs mt-0.5">Top 25% of items by weekly issuance volume. High demand items.</p></div>
                </div>
                <div className="flex gap-3 p-3 rounded-lg bg-teal-900/20 border border-teal-800/30">
                  <span className="text-lg shrink-0">✅</span>
                  <div><p className="text-teal-300 font-semibold">Normal</p><p className="text-slate-400 text-xs mt-0.5">Middle 50%. Regular, steady usage. Standard ordering applies.</p></div>
                </div>
                <div className="flex gap-3 p-3 rounded-lg bg-orange-900/20 border border-orange-800/30">
                  <span className="text-lg shrink-0">🐢</span>
                  <div><p className="text-orange-300 font-semibold">Slow Moving</p><p className="text-slate-400 text-xs mt-0.5">Bottom 25%. Consider reducing order quantities.</p></div>
                </div>
                <div className="flex gap-3 p-3 rounded-lg bg-slate-700/30 border border-slate-700">
                  <span className="text-lg shrink-0">💤</span>
                  <div><p className="text-slate-300 font-semibold">No Movement</p><p className="text-slate-400 text-xs mt-0.5">Zero issuance in the selected period. Review if still needed in stock.</p></div>
                </div>
              </div>
            </div>
          </div>

          {/* Week-over-week comparison */}
          {wowTop10.length > 0 && (
            <div className="card">
              <h2 className="font-display text-base font-semibold text-slate-100 mb-1">Period-over-Period Comparison</h2>
              <p className="text-slate-500 text-xs mb-4">This {periodLabel.toLowerCase()} period vs the previous one — top 10 items by current usage</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={wowTop10} layout="vertical" margin={{top:0,right:30,left:130,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis type="number" tick={{fill:'#64748b',fontSize:11}} />
                  <YAxis type="category" dataKey="name" tick={{fill:'#64748b',fontSize:10}} width={130} />
                  <Tooltip content={<ChartTip />} />
                  <Legend wrapperStyle={{color:'#94a3b8',fontSize:12,paddingTop:8}} />
                  <Bar dataKey="thisWeek" name="This period"  fill="#0d9488" radius={[0,3,3,0]} />
                  <Bar dataKey="lastWeek" name="Previous period"  fill="#475569" radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top 20 movement bar chart */}
          <div className="card">
            <h2 className="font-display text-base font-semibold text-slate-100 mb-1">Top 20 Items by Issuance ({periodLabel})</h2>
            <p className="text-slate-500 text-xs mb-4">Colour indicates movement classification</p>
            {top20.length===0 ? (
              <p className="text-slate-500 text-center py-8">No issuance data in the selected period.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={top20} layout="vertical" margin={{top:0,right:30,left:130,bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis type="number" tick={{fill:'#64748b',fontSize:11}} />
                    <YAxis type="category" dataKey="name" tick={{fill:'#64748b',fontSize:10}} width={130}
                      tickFormatter={v=>v.length>20?v.slice(0,20)+'…':v} />
                    <Tooltip content={<ChartTip />} formatter={(v,_,p)=>[`${v} ${p.payload.unit}`,'Weekly Issued']} />
                    <Bar dataKey="wkTotal" name="Weekly Issued" radius={[0,4,4,0]}>
                      {top20.map((item,i)=><Cell key={i} fill={CLS_COLORS[item.cls]||'#0d9488'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-3 flex-wrap">
                  {Object.entries(CLS_COLORS).map(([label,color])=>(
                    <span key={label} className="flex items-center gap-1.5 text-xs text-slate-400">
                      <span className="w-3 h-3 rounded" style={{background:color}} />{label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Filters */}
          <div className="card py-3 px-4 flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-40">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input className="input pl-9 text-sm" placeholder="Search…"
                value={search} onChange={e=>setSearch(e.target.value)} />
            </div>
            <select value={filterStore} onChange={e=>setFilterStore(e.target.value)} className="input text-sm w-auto">
              <option value="">All Stores</option>
              {stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} className="input text-sm w-auto">
              <option value="">All Categories</option>
              {categories.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterCls} onChange={e=>setFilterCls(e.target.value)} className="input text-sm w-auto">
              <option value="">All Classifications</option>
              <option value="Fast Moving">🚀 Fast Moving</option>
              <option value="Normal">✅ Normal</option>
              <option value="Slow Moving">🐢 Slow Moving</option>
              <option value="No Movement">💤 No Movement</option>
            </select>
            <span className="text-slate-400 text-sm ml-auto">{filtered.length} items</span>
          </div>

          {/* Detail table */}
          <Table>
            <Thead><tr>
              <Th sortable onClick={()=>toggleSort('part_number')} sorted={sortField==='part_number'?sortDir:undefined}>Part #</Th>
              <Th sortable onClick={()=>toggleSort('name')} sorted={sortField==='name'?sortDir:undefined}>Item Name</Th>
              <Th sortable onClick={()=>toggleSort('store_name')} sorted={sortField==='store_name'?sortDir:undefined}>Store</Th>
              <Th sortable onClick={()=>toggleSort('wkTotal')} sorted={sortField==='wkTotal'?sortDir:undefined}>Current</Th>
              <Th sortable onClick={()=>toggleSort('prevTotal')} sorted={sortField==='prevTotal'?sortDir:undefined}>Previous</Th>
              <Th sortable onClick={()=>toggleSort('trend')} sorted={sortField==='trend'?sortDir:undefined}>Trend</Th>
              <Th sortable onClick={()=>toggleSort('current_stock')} sorted={sortField==='current_stock'?sortDir:undefined}>Stock</Th>
              <Th sortable onClick={()=>toggleSort('cls')} sorted={sortField==='cls'?sortDir:undefined}>Classification</Th>
            </tr></Thead>
            <Tbody>
              {filtered.map(item => {
                const trendNum = item.trend !== null ? Number(item.trend) : null
                return (
                  <Tr key={item.id}>
                    <Td className="font-mono text-xs text-slate-300">{item.part_number}</Td>
                    <Td className="font-medium text-slate-100 max-w-xs truncate">{item.name}</Td>
                    <Td className="text-slate-400 text-xs">{item.stores?.name}</Td>
                    <Td className="text-slate-100 font-semibold">
                      {item.wkTotal} <span className="text-slate-500 text-xs font-normal">{item.unit}</span>
                    </Td>
                    <Td className="text-slate-400">{item.prevTotal}</Td>
                    <Td>
                      {trendNum===null ? <span className="text-slate-600 text-xs">—</span>
                        : trendNum > 0
                          ? <span className="text-green-400 text-xs font-semibold">↑ +{trendNum}%</span>
                          : trendNum < 0
                            ? <span className="text-red-400 text-xs font-semibold">↓ {trendNum}%</span>
                            : <span className="text-slate-500 text-xs">→ 0%</span>}
                    </Td>
                    <Td className={Number(item.current_stock)<=Number(item.min_stock)?'text-red-400 font-semibold':'text-slate-300'}>
                      {item.current_stock}
                    </Td>
                    <Td><Badge variant={item.badge}>{item.cls}</Badge></Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        </>
      )}
    </div>
  )
}
