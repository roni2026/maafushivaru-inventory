import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { TrendingUp, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'

function classifyItems(items, issuances) {
  const now = new Date(); now.setHours(0,0,0,0)
  const cutoff7  = new Date(now); cutoff7.setDate(cutoff7.getDate()-7)
  const cutoff14 = new Date(now); cutoff14.setDate(cutoff14.getDate()-14)

  // Weekly avg issuance per item
  const weekMap  = {}
  const twoWkMap = {}
  ;(issuances||[]).forEach(iss => {
    const d = new Date(iss.date)
    if (d >= cutoff7)  weekMap[iss.item_id]  = (weekMap[iss.item_id]  || 0) + Number(iss.quantity_issued)
    if (d >= cutoff14) twoWkMap[iss.item_id] = (twoWkMap[iss.item_id] || 0) + Number(iss.quantity_issued)
  })

  const weekAvgs = (items||[]).map(i => weekMap[i.id] || 0)
  weekAvgs.sort((a,b) => a-b)
  const p25 = weekAvgs[Math.floor(weekAvgs.length * 0.25)]
  const p75 = weekAvgs[Math.floor(weekAvgs.length * 0.75)]

  return (items||[]).map(item => {
    const wkTotal  = weekMap[item.id]  || 0
    const twoWkTotal = twoWkMap[item.id] || 0
    const noMovement14 = twoWkTotal === 0
    const noMovement7  = wkTotal === 0

    let classification, badge
    if (noMovement14) {
      classification = 'No Movement'; badge = 'gray'
    } else if (wkTotal >= p75) {
      classification = 'Fast Moving'; badge = 'green'
    } else if (wkTotal <= p25 || noMovement7) {
      classification = 'Slow Moving'; badge = 'orange'
    } else {
      classification = 'Normal'; badge = 'teal'
    }

    return { ...item, wkTotal, twoWkTotal, classification, badge }
  })
}

export default function Analytics() {
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [filterStore, setFilterStore] = useState('')
  const [filterCat,   setFilterCat]   = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [sortField,   setSortField]   = useState('wkTotal')
  const [sortDir,     setSortDir]     = useState('desc')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cutoff14 = new Date(); cutoff14.setDate(cutoff14.getDate()-14)
      const [{ data: items }, { data: issuances }, { data: stores }] = await Promise.all([
        supabase.from('items').select('*, stores(name, category)'),
        supabase.from('issuances').select('item_id, quantity_issued, date').gte('date', cutoff14.toISOString().split('T')[0]),
        supabase.from('stores').select('*').order('name'),
      ])
      const classified = classifyItems(items, issuances)
      setData({ classified, stores: stores||[] })
    } catch (err) {
      toast.error('Failed: ' + err.message)
    }
    setLoading(false)
  }, [])

  const filtered = (() => {
    if (!data) return []
    let list = [...data.classified]
    if (filterStore) list = list.filter(i => i.store_id === filterStore)
    if (filterCat)   list = list.filter(i => i.stores?.category === filterCat)
    if (filterClass) list = list.filter(i => i.classification === filterClass)
    list.sort((a,b) => {
      let va = a[sortField], vb = b[sortField]
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb||'').toLowerCase() }
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    })
    return list
  })()

  const top20Chart = [...(data?.classified||[])].sort((a,b) => b.wkTotal - a.wkTotal).slice(0,20)
  const colorMap = { 'Fast Moving':'#22c55e', 'Normal':'#0d9488', 'Slow Moving':'#f97316', 'No Movement':'#64748b' }

  const toggleSort = (f) => {
    if (sortField === f) setSortDir(d => d==='asc'?'desc':'asc')
    else { setSortField(f); setSortDir('desc') }
  }

  const categories = [...new Set((data?.stores||[]).map(s => s.category))].sort()

  const summary = data?.classified.reduce((acc, i) => {
    acc[i.classification] = (acc[i.classification]||0) + 1
    return acc
  }, {}) || {}

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="page-title">Analytics</h1><p className="page-sub">Item movement classification</p></div>
        <Button onClick={load} loading={loading}><RefreshCw className="w-4 h-4" /> Analyse</Button>
      </div>

      {!data && !loading && (
        <div className="card text-center py-20 text-slate-500">
          <TrendingUp className="w-14 h-14 mx-auto mb-4 opacity-20" />
          <p className="font-medium text-lg">No analysis yet</p>
          <p className="text-sm mt-1">Click "Analyse" to classify items by movement speed.</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {data && !loading && (
        <>
          {/* Summary badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label:'Fast Moving',  variant:'green',  key:'Fast Moving'  },
              { label:'Normal',       variant:'teal',   key:'Normal'       },
              { label:'Slow Moving',  variant:'orange', key:'Slow Moving'  },
              { label:'No Movement',  variant:'gray',   key:'No Movement'  },
            ].map(({ label, variant, key }) => (
              <div key={key} className="card-sm text-center cursor-pointer hover:bg-slate-700/60 transition-colors"
                onClick={() => setFilterClass(filterClass === key ? '' : key)}>
                <p className="text-2xl font-bold text-slate-100">{summary[key] || 0}</p>
                <Badge variant={variant} className="mt-1">{label}</Badge>
              </div>
            ))}
          </div>

          {/* Bar chart */}
          <div className="card">
            <h2 className="font-display text-lg font-semibold text-slate-100 mb-5">Top 20 Items by Weekly Issuance</h2>
            {top20Chart.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No issuance data in the last 14 days.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={top20Chart} layout="vertical" margin={{ top:0, right:30, left:130, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis type="number" tick={{ fill:'#94a3b8', fontSize:12 }} />
                  <YAxis type="category" dataKey="name"
                    tickFormatter={v => v.length > 20 ? v.slice(0,20)+'…' : v}
                    tick={{ fill:'#94a3b8', fontSize:10 }} width={130} />
                  <Tooltip
                    contentStyle={{ background:'#1e293b', border:'1px solid #334155', borderRadius:'8px', color:'#f1f5f9' }}
                    formatter={(val, _, props) => [`${val} ${props.payload.unit}`, 'Weekly Issued']}
                  />
                  <Bar dataKey="wkTotal" name="Weekly Issued" radius={[0,4,4,0]}>
                    {top20Chart.map((item, i) => (
                      <Cell key={i} fill={colorMap[item.classification] || '#0d9488'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            <div className="flex gap-4 mt-3 flex-wrap">
              {Object.entries(colorMap).map(([label, color]) => (
                <span key={label} className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="w-3 h-3 rounded" style={{ background: color }} />{label}
                </span>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="card py-3 px-4 flex flex-wrap gap-3 items-center">
            <select value={filterStore} onChange={e => setFilterStore(e.target.value)} className="input text-sm w-auto">
              <option value="">All Stores</option>
              {data.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="input text-sm w-auto">
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterClass} onChange={e => setFilterClass(e.target.value)} className="input text-sm w-auto">
              <option value="">All Classifications</option>
              <option value="Fast Moving">Fast Moving</option>
              <option value="Normal">Normal</option>
              <option value="Slow Moving">Slow Moving</option>
              <option value="No Movement">No Movement (14d)</option>
            </select>
            <span className="text-slate-400 text-sm ml-auto">{filtered.length} items</span>
          </div>

          {/* Table */}
          <Table>
            <Thead><tr>
              <Th sortable onClick={() => toggleSort('part_number')} sorted={sortField==='part_number'?sortDir:undefined}>Part #</Th>
              <Th sortable onClick={() => toggleSort('name')} sorted={sortField==='name'?sortDir:undefined}>Item Name</Th>
              <Th>Store</Th>
              <Th sortable onClick={() => toggleSort('wkTotal')} sorted={sortField==='wkTotal'?sortDir:undefined}>Wk Issued</Th>
              <Th sortable onClick={() => toggleSort('twoWkTotal')} sorted={sortField==='twoWkTotal'?sortDir:undefined}>2Wk Issued</Th>
              <Th sortable onClick={() => toggleSort('current_stock')} sorted={sortField==='current_stock'?sortDir:undefined}>Stock</Th>
              <Th sortable onClick={() => toggleSort('classification')} sorted={sortField==='classification'?sortDir:undefined}>Classification</Th>
            </tr></Thead>
            <Tbody>
              {filtered.map(item => (
                <Tr key={item.id}>
                  <Td className="font-mono text-xs text-slate-300">{item.part_number}</Td>
                  <Td className="font-medium text-slate-100 max-w-xs truncate">{item.name}</Td>
                  <Td className="text-slate-400 text-xs">{item.stores?.name}</Td>
                  <Td className="text-slate-100">{item.wkTotal} <span className="text-slate-500 text-xs">{item.unit}</span></Td>
                  <Td className="text-slate-300">{item.twoWkTotal}</Td>
                  <Td className={Number(item.current_stock) <= Number(item.min_stock) ? 'text-red-400 font-semibold' : 'text-slate-300'}>
                    {item.current_stock}
                  </Td>
                  <Td><Badge variant={item.badge}>{item.classification}</Badge></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </>
      )}
    </div>
  )
}
