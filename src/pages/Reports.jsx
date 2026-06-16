import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, PieChart, Pie, AreaChart, Area, LineChart, Line
} from 'recharts'
import { BarChart2, Download, RefreshCw, Calendar, TrendingUp } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'

// ── helpers ────────────────────────────────────────────────
function daysUntil(d) {
  if (!d) return null
  const e = new Date(d); e.setHours(0,0,0,0)
  const n = new Date();  n.setHours(0,0,0,0)
  return Math.ceil((e - n) / 86400000)
}
function statusBadge(days) {
  if (days===null)  return <Badge variant="gray">No expiry</Badge>
  if (days<0)       return <Badge variant="red">Expired</Badge>
  if (days<=7)      return <Badge variant="red">Critical</Badge>
  if (days<=15)     return <Badge variant="orange">Warning</Badge>
  if (days<=30)     return <Badge variant="yellow">Watch</Badge>
  return                   <Badge variant="green">OK</Badge>
}

const PRIMARY    = [15, 118, 110]
const CAT_COLORS = { Beverage:'#0369a1', Food:'#0d9488', General:'#6366f1', Unknown:'#64748b' }
const CHART_C    = ['#0d9488','#0369a1','#6366f1','#a855f7','#ec4899','#f97316','#eab308','#22c55e','#06b6d4','#8b5cf6']

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-xl p-3 shadow-2xl text-xs">
      <p className="text-slate-300 font-medium mb-1.5">{label}</p>
      {payload.map((p,i) => <p key={i} style={{color:p.color}}>{p.name}: <strong>{p.value}</strong></p>)}
    </div>
  )
}

// ── range presets ──────────────────────────────────────────
const RANGES = [
  { label:'Last 7 days',  days:7  },
  { label:'Last 14 days', days:14 },
  { label:'Last 30 days', days:30 },
]

export default function Reports() {
  const [report,    setReport]    = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [exporting, setExporting] = useState(false)
  const [rangeDays, setRangeDays] = useState(7)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const now    = new Date()
      const cutoff = new Date(now); cutoff.setDate(cutoff.getDate()-rangeDays)
      const cutStr = cutoff.toISOString().split('T')[0]

      const [{ data: items }, { data: issuances }] = await Promise.all([
        supabase.from('items').select('*, stores(name, category)'),
        supabase.from('issuances')
          .select('*, items(name, unit, stores(category))')
          .gte('date', cutStr)
          .order('date'),
      ])

      const it  = items || []
      const iss = issuances || []

      // ── Daily totals ──────────────────────────────────
      const dailyMap = {}
      for (let i=rangeDays-1;i>=0;i--) {
        const d = new Date(now); d.setDate(d.getDate()-i)
        const k = d.toISOString().split('T')[0]
        dailyMap[k] = { date:k, label:d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}), total:0, lines:0 }
      }
      iss.forEach(i => { if (dailyMap[i.date]) { dailyMap[i.date].total+=Number(i.quantity_issued); dailyMap[i.date].lines+=1 } })
      const dailyData = Object.values(dailyMap)

      // ── Cumulative trend ──────────────────────────────
      let running = 0
      const cumulativeData = dailyData.map(d => {
        running += d.total
        return { ...d, cumulative: running }
      })

      // ── Top 10 items ──────────────────────────────────
      const itemMap = {}
      iss.forEach(i => {
        if (!itemMap[i.item_id]) itemMap[i.item_id]={ name:i.items?.name||'?', unit:i.items?.unit||'', total:0, lines:0 }
        itemMap[i.item_id].total+=Number(i.quantity_issued)
        itemMap[i.item_id].lines+=1
      })
      const top10 = Object.values(itemMap).sort((a,b)=>b.total-a.total).slice(0,10)

      // ── Issuance by category (pie) ────────────────────
      const catMap = {}
      iss.forEach(i => {
        const cat = i.items?.stores?.category || 'Unknown'
        catMap[cat] = (catMap[cat]||0)+Number(i.quantity_issued)
      })
      const categoryPie = Object.entries(catMap).map(([name,value])=>({ name, value, color: CAT_COLORS[name]||'#64748b' }))

      // ── Store breakdown ────────────────────────────────
      const storeMap = {}
      iss.forEach(i => {
        const item = it.find(x=>x.id===i.item_id)
        const store = item?.stores?.name || 'Unknown'
        storeMap[store] = (storeMap[store]||0)+Number(i.quantity_issued)
      })
      const storeData = Object.entries(storeMap).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({ name, value }))

      // ── Stock vs min (bottom 15 by ratio) ────────────
      const stockData = it
        .filter(i=>Number(i.min_stock)>0)
        .sort((a,b) => (Number(a.current_stock)/Number(a.min_stock)) - (Number(b.current_stock)/Number(b.min_stock)))
        .slice(0,15)
        .map(i => ({
          name:    i.name.length>18 ? i.name.slice(0,18)+'…' : i.name,
          current: Number(i.current_stock),
          minimum: Number(i.min_stock),
        }))

      // ── Expiry summary ────────────────────────────────
      const expirySummary = {
        expired:  it.filter(i=>{const d=daysUntil(i.expiry_date);return d!==null&&d<0}).length,
        critical: it.filter(i=>{const d=daysUntil(i.expiry_date);return d!==null&&d>=0&&d<=7}).length,
        warning:  it.filter(i=>{const d=daysUntil(i.expiry_date);return d!==null&&d>7&&d<=15}).length,
        watch:    it.filter(i=>{const d=daysUntil(i.expiry_date);return d!==null&&d>15&&d<=30}).length,
        ok:       it.filter(i=>{const d=daysUntil(i.expiry_date);return d===null||d>30}).length,
      }

      // ── Full detail table ─────────────────────────────
      const detail = it.map(item => ({
        ...item,
        weeklyIssued: (iss.filter(i=>i.item_id===item.id).reduce((s,i)=>s+Number(i.quantity_issued),0)),
        daysLeft:     daysUntil(item.expiry_date),
      })).sort((a,b)=>b.weeklyIssued-a.weeklyIssued)

      // ── Period stats ──────────────────────────────────
      const totalIssued  = iss.reduce((s,i)=>s+Number(i.quantity_issued),0)
      const totalRecords = iss.length
      const uniqueItems  = new Set(iss.map(i=>i.item_id)).size

      setReport({
        dailyData, cumulativeData, top10, categoryPie, storeData,
        stockData, expirySummary, detail,
        totalIssued, totalRecords, uniqueItems,
        generatedAt: new Date(), rangeDays,
      })
    } catch (err) {
      toast.error('Failed: ' + err.message)
    }
    setLoading(false)
  }, [rangeDays])

  const exportPDF = async () => {
    if (!report) return
    setExporting(true)
    try {
      const { default: jsPDF }     = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' })
      const now = report.generatedAt
      const period = `Last ${report.rangeDays} Days`

      // Header
      doc.setFillColor(...PRIMARY)
      doc.rect(0,0,297,24,'F')
      doc.setTextColor(255,255,255)
      doc.setFontSize(16); doc.setFont('helvetica','bold')
      doc.text('Outrigger Maafushivaru Resort – Inventory Report', 14, 13)
      doc.setFontSize(9); doc.setFont('helvetica','normal')
      doc.text(`Period: ${period}  |  Generated: ${now.toLocaleString()}`, 14, 21)

      // Expiry summary
      doc.setTextColor(0,0,0); doc.setFontSize(11); doc.setFont('helvetica','bold')
      doc.text('Expiry Risk Summary', 14, 33)
      autoTable(doc, {
        startY:33,
        head:[['Expired','Critical (≤7d)','Warning (≤15d)','Watch (≤30d)','OK / No Expiry']],
        body:[[report.expirySummary.expired, report.expirySummary.critical, report.expirySummary.warning, report.expirySummary.watch, report.expirySummary.ok]],
        headStyles:{fillColor:PRIMARY},
        styles:{halign:'center'},
      })

      // Period stats
      let y = doc.lastAutoTable.finalY + 10
      doc.setFontSize(11); doc.setFont('helvetica','bold')
      doc.text(`Issuance Summary (${period})`, 14, y)
      autoTable(doc, {
        startY: y + 3,
        head:[['Total Units Issued','Total Transactions','Unique Items Issued']],
        body:[[report.totalIssued, report.totalRecords, report.uniqueItems]],
        headStyles:{fillColor:PRIMARY},
        styles:{halign:'center'},
      })

      // Top 10
      y = doc.lastAutoTable.finalY + 10
      doc.setFontSize(11); doc.setFont('helvetica','bold')
      doc.text('Top 10 Items Issued', 14, y)
      autoTable(doc, {
        startY: y + 3,
        head:[['#','Item Name','Unit','Total Issued','Transactions']],
        body: report.top10.map((i,idx)=>[idx+1, i.name, i.unit, i.total, i.lines]),
        headStyles:{fillColor:PRIMARY},
      })

      // Full item detail
      y = doc.lastAutoTable.finalY + 10
      doc.setFontSize(11); doc.setFont('helvetica','bold')
      doc.text('Full Item Report', 14, y)
      autoTable(doc, {
        startY: y + 3,
        head:[['Part #','Item Name','Store','Unit','Curr. Stock','Min','Period Issued','Expiry Date','Status']],
        body: report.detail.map(i=>[
          i.part_number, i.name, i.stores?.name||'', i.unit,
          i.current_stock, i.min_stock, i.weeklyIssued,
          i.expiry_date||'N/A',
          i.daysLeft===null?'No expiry':i.daysLeft<0?'Expired':`${i.daysLeft}d left`,
        ]),
        headStyles:{fillColor:PRIMARY},
        styles:{fontSize:8},
        didParseCell:(data)=>{
          if (data.section==='body'&&data.column.index===8) {
            const v=String(data.cell.raw)
            if (v==='Expired'||v.match(/^[0-7]d/)) data.cell.styles.textColor=[220,38,38]
            else if (v.match(/^(8|9|1[0-5])d/)) data.cell.styles.textColor=[234,88,12]
          }
        },
      })

      doc.save(`Outrigger_Report_${report.rangeDays}d_${now.toISOString().split('T')[0]}.pdf`)
      toast.success('PDF exported')
    } catch (err) {
      toast.error('Export failed: ' + err.message)
    }
    setExporting(false)
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">Issuance analytics and inventory health</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {report && <Button variant="secondary" onClick={exportPDF} loading={exporting}><Download className="w-4 h-4" /> PDF</Button>}
          <Button onClick={generate} loading={loading}><RefreshCw className="w-4 h-4" /> Generate</Button>
        </div>
      </div>

      {/* Range selector */}
      <div className="card py-3 px-4 flex items-center gap-3 flex-wrap">
        <Calendar className="w-4 h-4 text-teal-400 shrink-0" />
        <span className="text-sm text-slate-400">Period:</span>
        <div className="flex gap-2">
          {RANGES.map(({ label, days }) => (
            <button key={days} onClick={() => setRangeDays(days)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${rangeDays===days ? 'bg-teal-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {!report && !loading && (
        <div className="card text-center py-20 text-slate-500">
          <BarChart2 className="w-14 h-14 mx-auto mb-4 opacity-20" />
          <p className="font-medium text-lg">No report yet</p>
          <p className="text-sm mt-1">Select a period above and click Generate.</p>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm">Analysing data…</p>
        </div>
      )}

      {report && !loading && (
        <>
          {/* Period stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="card text-center">
              <p className="text-3xl font-bold text-teal-400">{report.totalIssued.toLocaleString()}</p>
              <p className="text-slate-400 text-sm mt-1">Total Units Issued</p>
            </div>
            <div className="card text-center">
              <p className="text-3xl font-bold text-blue-400">{report.totalRecords}</p>
              <p className="text-slate-400 text-sm mt-1">Issuance Transactions</p>
            </div>
            <div className="card text-center col-span-2 sm:col-span-1">
              <p className="text-3xl font-bold text-purple-400">{report.uniqueItems}</p>
              <p className="text-slate-400 text-sm mt-1">Unique Items Issued</p>
            </div>
          </div>

          {/* Expiry risk */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label:'Expired',   val:report.expirySummary.expired,  v:'red'    },
              { label:'Critical',  val:report.expirySummary.critical, v:'red'    },
              { label:'Warning',   val:report.expirySummary.warning,  v:'orange' },
              { label:'Watch',     val:report.expirySummary.watch,    v:'yellow' },
              { label:'OK',        val:report.expirySummary.ok,       v:'green'  },
            ].map(({label,val,v})=>(
              <div key={label} className="card-sm text-center">
                <p className="text-2xl font-bold text-slate-100">{val}</p>
                <Badge variant={v} className="mt-1">{label}</Badge>
              </div>
            ))}
          </div>

          {/* Daily bar chart + Cumulative area chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card">
              <h2 className="font-display text-base font-semibold text-slate-100 mb-1">Daily Issuance Volume</h2>
              <p className="text-slate-500 text-xs mb-4">Units issued per day</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={report.dailyData} margin={{top:5,right:5,left:-20,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" tick={{fill:'#64748b',fontSize:10}} />
                  <YAxis tick={{fill:'#64748b',fontSize:11}} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="total" name="Units Issued" radius={[4,4,0,0]}>
                    {report.dailyData.map((_,i)=><Cell key={i} fill={CHART_C[i%CHART_C.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <h2 className="font-display text-base font-semibold text-slate-100 mb-1">Cumulative Issuance</h2>
              <p className="text-slate-500 text-xs mb-4">Running total of units issued</p>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={report.cumulativeData} margin={{top:5,right:5,left:-20,bottom:0}}>
                  <defs>
                    <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" tick={{fill:'#64748b',fontSize:10}} />
                  <YAxis tick={{fill:'#64748b',fontSize:11}} />
                  <Tooltip content={<ChartTip />} />
                  <Area type="monotone" dataKey="cumulative" name="Cumulative Units"
                    stroke="#6366f1" strokeWidth={2.5} fill="url(#cumGrad)"
                    dot={{fill:'#6366f1',r:3}} activeDot={{r:6}} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top 10 items + Category pie */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card">
              <h2 className="font-display text-base font-semibold text-slate-100 mb-1">Top 10 Most Issued Items</h2>
              <p className="text-slate-500 text-xs mb-4">By total units issued this period</p>
              {report.top10.length===0 ? (
                <div className="flex items-center justify-center h-40 text-slate-500 text-sm">No issuance data</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={report.top10} layout="vertical" margin={{top:0,right:20,left:120,bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis type="number" tick={{fill:'#64748b',fontSize:11}} />
                    <YAxis type="category" dataKey="name" tick={{fill:'#64748b',fontSize:9}} width={120}
                      tickFormatter={v=>v.length>18?v.slice(0,18)+'…':v} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="total" name="Units Issued" fill="#0d9488" radius={[0,4,4,0]}>
                      {report.top10.map((_,i)=><Cell key={i} fill={CHART_C[i%CHART_C.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card">
              <h2 className="font-display text-base font-semibold text-slate-100 mb-1">Issuance by Category</h2>
              <p className="text-slate-500 text-xs mb-4">Unit breakdown by store category</p>
              {report.categoryPie.length===0 ? (
                <div className="flex items-center justify-center h-40 text-slate-500 text-sm">No issuance data</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart>
                      <Pie data={report.categoryPie} cx="50%" cy="50%"
                        outerRadius={80} paddingAngle={4} dataKey="value"
                        label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`}
                        labelLine={{stroke:'#475569'}}>
                        {report.categoryPie.map((e,i)=><Cell key={i} fill={e.color} strokeWidth={0} />)}
                      </Pie>
                      <Tooltip contentStyle={{background:'#1e293b',border:'1px solid #334155',borderRadius:'8px',color:'#f1f5f9',fontSize:'12px'}} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 justify-center flex-wrap">
                    {report.categoryPie.map(c=>(
                      <div key={c.name} className="flex items-center gap-1.5 text-xs">
                        <div className="w-3 h-3 rounded-full" style={{background:c.color}} />
                        <span className="text-slate-400">{c.name}:</span>
                        <span className="text-slate-200 font-semibold">{c.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Stock vs min */}
          <div className="card">
            <h2 className="font-display text-base font-semibold text-slate-100 mb-1">Stock Levels vs Minimum Required</h2>
            <p className="text-slate-500 text-xs mb-4">Showing items closest to running out (sorted by ratio)</p>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={report.stockData} layout="vertical" margin={{top:0,right:30,left:130,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" tick={{fill:'#64748b',fontSize:11}} />
                <YAxis type="category" dataKey="name" tick={{fill:'#64748b',fontSize:10}} width={130} />
                <Tooltip contentStyle={{background:'#1e293b',border:'1px solid #334155',borderRadius:'8px',color:'#f1f5f9',fontSize:'12px'}} />
                <Legend wrapperStyle={{color:'#94a3b8',fontSize:12,paddingTop:8}} />
                <Bar dataKey="current" name="Current Stock" fill="#0d9488" radius={[0,3,3,0]} />
                <Bar dataKey="minimum" name="Min Required"  fill="#dc2626" radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Issuance by store */}
          {report.storeData.length > 0 && (
            <div className="card">
              <h2 className="font-display text-base font-semibold text-slate-100 mb-1">Issuance by Store</h2>
              <p className="text-slate-500 text-xs mb-4">Total units issued per store this period</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={report.storeData} margin={{top:5,right:5,left:-20,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" tick={{fill:'#64748b',fontSize:11}}
                    tickFormatter={v=>v.length>12?v.slice(0,12)+'…':v} />
                  <YAxis tick={{fill:'#64748b',fontSize:11}} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="value" name="Units Issued" radius={[4,4,0,0]}>
                    {report.storeData.map((_,i)=><Cell key={i} fill={CHART_C[i%CHART_C.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Full detail table */}
          <div className="card">
            <h2 className="font-display text-base font-semibold text-slate-100 mb-4">Full Item Report</h2>
            <Table>
              <Thead><tr>
                <Th>Part #</Th><Th>Item Name</Th><Th>Store</Th>
                <Th>Stock</Th><Th>Min</Th><Th>Period Issued</Th><Th>Expiry</Th><Th>Status</Th>
              </tr></Thead>
              <Tbody>
                {report.detail.map(item=>(
                  <Tr key={item.id}>
                    <Td className="font-mono text-xs text-slate-300">{item.part_number}</Td>
                    <Td className="font-medium text-slate-100 max-w-xs truncate">{item.name}</Td>
                    <Td className="text-slate-400 text-xs">{item.stores?.name}</Td>
                    <Td className={Number(item.current_stock)<=Number(item.min_stock)?'text-red-400 font-semibold':'text-slate-100'}>{item.current_stock}</Td>
                    <Td className="text-slate-500">{item.min_stock}</Td>
                    <Td><Badge variant={item.weeklyIssued>0?'teal':'gray'}>{item.weeklyIssued}</Badge></Td>
                    <Td className="text-slate-400 text-xs">{item.expiry_date||'—'}</Td>
                    <Td>{statusBadge(item.daysLeft)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
