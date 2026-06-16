import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { Package, ArrowLeft, Pencil, Clock, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'

function daysUntil(d) {
  if (!d) return null
  const e=new Date(d);e.setHours(0,0,0,0);const n=new Date();n.setHours(0,0,0,0)
  return Math.ceil((e-n)/86400000)
}
function statusBadge(days) {
  if (days===null) return <Badge variant="gray">No expiry</Badge>
  if (days<0)      return <Badge variant="red">Expired {Math.abs(days)}d ago</Badge>
  if (days<=7)     return <Badge variant="red">Critical – {days}d left</Badge>
  if (days<=15)    return <Badge variant="orange">{days}d left</Badge>
  if (days<=30)    return <Badge variant="yellow">{days}d left</Badge>
  return                  <Badge variant="green">{days}d left</Badge>
}

const ChartTip = ({active,payload,label})=>{
  if(!active||!payload?.length) return null
  return <div className="bg-slate-800 border border-slate-600 rounded-xl p-3 shadow-2xl text-xs"><p className="text-slate-300 font-medium mb-1">{label}</p>{payload.map((p,i)=><p key={i} style={{color:p.color}}>{p.name}: <strong>{p.value}</strong></p>)}</div>
}

export default function ItemDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const [item,      setItem]      = useState(null)
  const [issuances, setIssuances] = useState([])
  const [updates,   setUpdates]   = useState([])
  const [loading,   setLoading]   = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const today=new Date(); const d30=new Date(today); d30.setDate(d30.getDate()-30)
    const d30Str=d30.toISOString().split('T')[0]

    const [{ data: it, error }, { data: iss }, { data: upd }] = await Promise.all([
      supabase.from('items').select('*, stores(name,category)').eq('id',id).single(),
      supabase.from('issuances').select('*').eq('item_id',id).gte('date',d30Str).order('date'),
      supabase.from('stock_updates').select('*').eq('item_id',id).order('created_at',{ascending:false}).limit(30),
    ])
    if (error||!it) { toast.error('Item not found'); navigate('/inventory'); return }
    setItem(it); setIssuances(iss||[]); setUpdates(upd||[])
    setLoading(false)
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
  if (!item) return null

  const days        = daysUntil(item.expiry_date)
  const isLow       = Number(item.current_stock)<=Number(item.min_stock)
  const stockPct    = Number(item.min_stock)>0?Math.min(100,Math.round(Number(item.current_stock)/Number(item.min_stock)*100)):100
  const totalIssued = issuances.reduce((s,i)=>s+Number(i.quantity_issued),0)
  const inventoryValue = Number(item.current_stock)*Number(item.unit_cost||0)

  // Build 30-day daily issuance chart
  const today=new Date(); today.setHours(0,0,0,0)
  const dailyMap={}
  for(let i=29;i>=0;i--){
    const d=new Date(today);d.setDate(d.getDate()-i)
    const k=d.toISOString().split('T')[0]
    dailyMap[k]={label:d.toLocaleDateString('en-US',{month:'short',day:'numeric'}),units:0}
  }
  issuances.forEach(iss=>{if(dailyMap[iss.date])dailyMap[iss.date].units+=Number(iss.quantity_issued)})
  const dailyData=Object.values(dailyMap)

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Link to="/inventory" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-teal-400 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Inventory
        </Link>
      </div>

      {/* Item header */}
      <div className="card border border-slate-700/40">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${isLow?'bg-red-900/50':'bg-teal-900/50'}`}>
              <Package className={`w-7 h-7 ${isLow?'text-red-400':'text-teal-400'}`} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100">{item.name}</h1>
              <p className="text-slate-400 text-sm mt-1">
                <span className="font-mono text-teal-400">{item.part_number}</span>
                <span className="mx-2 text-slate-600">·</span>
                {item.stores?.name}
                {item.stores?.category&&<><span className="mx-2 text-slate-600">·</span>{item.stores.category}</>}
              </p>
            </div>
          </div>
          <Link to="/inventory" className="btn-secondary btn-sm"><Pencil className="w-4 h-4" /> Edit in Inventory</Link>
        </div>

        {/* Key stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <div className={`p-4 rounded-xl border ${isLow?'border-red-700/40 bg-red-900/15':'border-teal-700/30 bg-teal-900/10'}`}>
            <p className={`text-2xl font-bold ${isLow?'text-red-400':'text-teal-300'}`}>{item.current_stock}</p>
            <p className="text-slate-400 text-xs mt-1">Current Stock ({item.unit})</p>
            {!isLow&&<div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{width:`${stockPct}%`}}/></div>}
          </div>
          <div className="p-4 rounded-xl border border-slate-700/30 bg-slate-700/15">
            <p className="text-2xl font-bold text-slate-100">{item.min_stock}</p>
            <p className="text-slate-400 text-xs mt-1">Minimum Stock ({item.unit})</p>
          </div>
          <div className="p-4 rounded-xl border border-slate-700/30 bg-slate-700/15">
            <p className="text-2xl font-bold text-blue-400">{totalIssued}</p>
            <p className="text-slate-400 text-xs mt-1">Issued (Last 30 Days)</p>
          </div>
          <div className="p-4 rounded-xl border border-slate-700/30 bg-slate-700/15">
            <p className="text-2xl font-bold text-yellow-400">${inventoryValue.toFixed(2)}</p>
            <p className="text-slate-400 text-xs mt-1">Stock Value @ ${item.unit_cost||0}/unit</p>
          </div>
        </div>

        {/* Expiry + badges */}
        <div className="flex gap-3 flex-wrap mt-4">
          {statusBadge(days)}
          {item.expiry_date&&<span className="text-slate-500 text-xs self-center">Expiry: {item.expiry_date}</span>}
          {isLow&&<Badge variant="red">⚠ Below Minimum</Badge>}
          {Number(item.current_stock)===0&&<Badge variant="red">Out of Stock</Badge>}
        </div>
      </div>

      {/* 30-day issuance chart */}
      <div className="card">
        <h2 className="font-display text-base font-semibold text-slate-100 mb-1">30-Day Issuance History</h2>
        <p className="text-slate-500 text-xs mb-4">Units issued per day</p>
        {issuances.length===0 ? (
          <div className="flex items-center justify-center h-28 text-slate-500 text-sm">No issuances in the last 30 days.</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dailyData} margin={{top:5,right:5,left:-25,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" tick={{fill:'#64748b',fontSize:9}}
                tickFormatter={v=>v.split(' ')[1]} interval={Math.floor(dailyData.length/8)} />
              <YAxis tick={{fill:'#64748b',fontSize:11}} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="units" name="Units Issued" fill="#0d9488" radius={[3,3,0,0]}>
                {dailyData.map((_,i)=><Cell key={i} fill={dailyData[i].units>0?'#0d9488':'#1e293b'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <div className="mt-3 flex gap-6 text-xs text-slate-400">
          <span>Total issued: <strong className="text-slate-200">{totalIssued} {item.unit}</strong></span>
          <span>Avg/day: <strong className="text-slate-200">{(totalIssued/30).toFixed(1)}</strong></span>
          <span>Days with issuance: <strong className="text-slate-200">{issuances.length}</strong></span>
        </div>
      </div>

      {/* Item details */}
      <div className="card">
        <h2 className="font-display text-base font-semibold text-slate-100 mb-4">Item Details</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {[
            { label:'Part Number',     val:item.part_number },
            { label:'Unit',            val:item.unit },
            { label:'Store',           val:item.stores?.name },
            { label:'Category',        val:item.stores?.category||'—' },
            { label:'Unit Cost',       val:`$${Number(item.unit_cost||0).toFixed(2)}` },
            { label:'Expiry Date',     val:item.expiry_date||'Not set' },
          ].map(({label,val})=>(
            <div key={label}>
              <p className="text-slate-500 text-xs mb-1">{label}</p>
              <p className="text-slate-200 font-medium">{val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Stock update history */}
      <div className="card">
        <h2 className="font-display text-base font-semibold text-slate-100 mb-4">Recent Stock Changes</h2>
        {updates.length===0 ? (
          <p className="text-slate-500 text-sm text-center py-6">No stock changes recorded.</p>
        ) : (
          <Table>
            <Thead><tr><Th>Date</Th><Th>Change</Th><Th>New Qty</Th><Th>Updated By</Th><Th>Note</Th></tr></Thead>
            <Tbody>
              {updates.map(u=>(
                <Tr key={u.id}>
                  <Td className="text-slate-400 text-xs whitespace-nowrap">{u.date}</Td>
                  <Td>
                    <span className={`flex items-center gap-1 text-sm font-bold ${u.quantity_change>=0?'text-green-400':'text-red-400'}`}>
                      {u.quantity_change>=0?<ArrowUpRight className="w-3 h-3"/>:<ArrowDownRight className="w-3 h-3"/>}
                      {u.quantity_change>=0?'+':''}{u.quantity_change}
                    </span>
                  </Td>
                  <Td className="text-slate-300">{u.new_quantity} <span className="text-slate-500 text-xs">{item.unit}</span></Td>
                  <Td className="text-slate-400 text-xs">{u.updated_by||'—'}</Td>
                  <Td className="text-slate-500 text-xs max-w-xs truncate">{u.note||'—'}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>
    </div>
  )
}
