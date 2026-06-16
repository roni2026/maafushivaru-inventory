import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts'
import { BarChart2, Download, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'

function daysUntil(d) {
  if (!d) return null
  const e = new Date(d); e.setHours(0,0,0,0)
  const n = new Date();  n.setHours(0,0,0,0)
  return Math.ceil((e - n) / 86400000)
}
function statusBadge(days) {
  if (days === null) return <Badge variant="gray">No expiry</Badge>
  if (days <  0)    return <Badge variant="red">Expired</Badge>
  if (days <= 7)    return <Badge variant="red">Critical</Badge>
  if (days <= 15)   return <Badge variant="orange">Warning</Badge>
  if (days <= 30)   return <Badge variant="yellow">Watch</Badge>
  return                   <Badge variant="green">OK</Badge>
}

const COLORS = ['#0d9488','#0369a1','#6366f1','#a855f7','#ec4899','#f97316','#eab308','#22c55e','#06b6d4','#8b5cf6']

export default function Reports() {
  const [report,    setReport]    = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [exporting, setExporting] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const now       = new Date()
      const weekAgo   = new Date(now); weekAgo.setDate(weekAgo.getDate()-7)
      const weekAgoStr = weekAgo.toISOString().split('T')[0]

      const [{ data: items }, { data: issuances }] = await Promise.all([
        supabase.from('items').select('*, stores(name, category)'),
        supabase.from('issuances')
          .select('*, items(name, unit)')
          .gte('date', weekAgoStr)
          .order('date'),
      ])

      // Daily totals (bar chart data)
      const dailyMap = {}
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate()-i)
        const key = d.toISOString().split('T')[0]
        dailyMap[key] = { date: key, label: d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }), total: 0 }
      }
      ;(issuances || []).forEach(iss => {
        if (dailyMap[iss.date]) dailyMap[iss.date].total += Number(iss.quantity_issued)
      })
      const dailyData = Object.values(dailyMap)

      // Top 10 items by issuance
      const itemTotals = {}
      ;(issuances || []).forEach(iss => {
        if (!itemTotals[iss.item_id]) itemTotals[iss.item_id] = { name: iss.items?.name, unit: iss.items?.unit, total: 0 }
        itemTotals[iss.item_id].total += Number(iss.quantity_issued)
      })
      const top10 = Object.values(itemTotals).sort((a,b) => b.total - a.total).slice(0,10)

      // Stock vs min stock chart data
      const stockData = (items || [])
        .filter(i => Number(i.min_stock) > 0)
        .sort((a,b) => (Number(a.current_stock) / Number(a.min_stock)) - (Number(b.current_stock) / Number(b.min_stock)))
        .slice(0, 15)
        .map(i => ({
          name:    i.name.length > 18 ? i.name.slice(0,18)+'…' : i.name,
          current: Number(i.current_stock),
          minimum: Number(i.min_stock),
        }))

      // Expiry risk summary
      const expirySummary = {
        expired:  (items||[]).filter(i => { const d=daysUntil(i.expiry_date); return d!==null && d<0 }).length,
        critical: (items||[]).filter(i => { const d=daysUntil(i.expiry_date); return d!==null && d>=0 && d<=7 }).length,
        warning:  (items||[]).filter(i => { const d=daysUntil(i.expiry_date); return d!==null && d>7 && d<=15 }).length,
        watch:    (items||[]).filter(i => { const d=daysUntil(i.expiry_date); return d!==null && d>15 && d<=30 }).length,
        ok:       (items||[]).filter(i => { const d=daysUntil(i.expiry_date); return d===null || d>30 }).length,
      }

      // Per-item detail table
      const detail = (items||[]).map(item => {
        const issued = (issuances||[]).filter(i => i.item_id === item.id).reduce((s,i) => s+Number(i.quantity_issued), 0)
        const days   = daysUntil(item.expiry_date)
        return { ...item, weeklyIssued: issued, daysLeft: days }
      }).sort((a,b) => (b.weeklyIssued - a.weeklyIssued))

      setReport({ dailyData, top10, stockData, expirySummary, detail, generatedAt: new Date() })
    } catch (err) {
      toast.error('Failed to generate report: ' + err.message)
    }
    setLoading(false)
  }, [])

  const exportPDF = async () => {
    if (!report) return
    setExporting(true)
    try {
      const { default: jsPDF }      = await import('jspdf')
      const { default: autoTable }  = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

      const primary = [15, 118, 110]
      const now = report.generatedAt

      // Title
      doc.setFillColor(...primary)
      doc.rect(0, 0, 297, 22, 'F')
      doc.setTextColor(255,255,255)
      doc.setFontSize(16); doc.setFont('helvetica','bold')
      doc.text('Outrigger Maafushivaru Resort – Weekly Inventory Report', 14, 14)
      doc.setFontSize(9); doc.setFont('helvetica','normal')
      doc.text(`Generated: ${now.toLocaleString()}  |  Period: Last 7 Days`, 14, 20)

      // Expiry summary
      doc.setTextColor(0,0,0); doc.setFontSize(11); doc.setFont('helvetica','bold')
      doc.text('Expiry Risk Summary', 14, 32)
      autoTable(doc, {
        startY: 36,
        head: [['Expired','Critical (≤7d)','Warning (≤15d)','Watch (≤30d)','OK']],
        body: [[
          report.expirySummary.expired,
          report.expirySummary.critical,
          report.expirySummary.warning,
          report.expirySummary.watch,
          report.expirySummary.ok,
        ]],
        headStyles: { fillColor: primary },
        styles: { halign: 'center' },
      })

      // Top 10 items
      doc.setFontSize(11); doc.setFont('helvetica','bold')
      doc.text('Top 10 Items Issued (Last 7 Days)', 14, doc.lastAutoTable.finalY + 10)
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 14,
        head: [['#','Item Name','Unit','Total Issued']],
        body: report.top10.map((i, idx) => [idx+1, i.name, i.unit, i.total]),
        headStyles: { fillColor: primary },
      })

      // Detail table
      doc.setFontSize(11); doc.setFont('helvetica','bold')
      doc.text('Full Item Report', 14, doc.lastAutoTable.finalY + 10)
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 14,
        head: [['Part #','Item Name','Store','Unit','Curr. Stock','Min Stock','Wk Issued','Expiry Date','Status']],
        body: report.detail.map(i => [
          i.part_number, i.name, i.stores?.name || '', i.unit,
          i.current_stock, i.min_stock, i.weeklyIssued,
          i.expiry_date || 'N/A',
          i.daysLeft === null ? 'No expiry' : i.daysLeft < 0 ? 'Expired' : `${i.daysLeft}d left`,
        ]),
        headStyles: { fillColor: primary },
        styles: { fontSize: 8 },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 8) {
            const v = String(data.cell.raw)
            if (v === 'Expired' || v.match(/^[0-7]d/)) data.cell.styles.textColor = [220,38,38]
            else if (v.match(/^(8|9|1[0-5])d/)) data.cell.styles.textColor = [234,88,12]
          }
        },
      })

      doc.save(`Outrigger_WeeklyReport_${now.toISOString().split('T')[0]}.pdf`)
      toast.success('PDF exported')
    } catch (err) {
      toast.error('Export failed: ' + err.message)
    }
    setExporting(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="page-title">Weekly Reports</h1><p className="page-sub">Past 7 days analysis</p></div>
        <div className="flex gap-2">
          {report && <Button variant="secondary" onClick={exportPDF} loading={exporting}><Download className="w-4 h-4" /> Export PDF</Button>}
          <Button onClick={generate} loading={loading}><RefreshCw className="w-4 h-4" /> Generate Report</Button>
        </div>
      </div>

      {!report && !loading && (
        <div className="card text-center py-20 text-slate-500">
          <BarChart2 className="w-14 h-14 mx-auto mb-4 opacity-20" />
          <p className="font-medium text-lg">No report generated yet</p>
          <p className="text-sm mt-1">Click "Generate Report" to analyse the last 7 days.</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {report && !loading && (
        <>
          {/* Expiry risk */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label:'Expired',   value: report.expirySummary.expired,  variant:'red'    },
              { label:'Critical',  value: report.expirySummary.critical, variant:'red'    },
              { label:'Warning',   value: report.expirySummary.warning,  variant:'orange' },
              { label:'Watch',     value: report.expirySummary.watch,    variant:'yellow' },
              { label:'OK',        value: report.expirySummary.ok,       variant:'green'  },
            ].map(({ label, value, variant }) => (
              <div key={label} className="card-sm text-center">
                <p className="text-2xl font-bold text-slate-100">{value}</p>
                <Badge variant={variant} className="mt-1">{label}</Badge>
              </div>
            ))}
          </div>

          {/* Daily issuance bar chart */}
          <div className="card">
            <h2 className="font-display text-lg font-semibold text-slate-100 mb-5">Daily Issuance Volume (Last 7 Days)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={report.dailyData} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fill:'#94a3b8', fontSize:12 }} />
                <YAxis tick={{ fill:'#94a3b8', fontSize:12 }} />
                <Tooltip contentStyle={{ background:'#1e293b', border:'1px solid #334155', borderRadius:'8px', color:'#f1f5f9' }} />
                <Bar dataKey="total" name="Units Issued" radius={[4,4,0,0]}>
                  {report.dailyData.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top 10 items */}
          <div className="card">
            <h2 className="font-display text-lg font-semibold text-slate-100 mb-5">Top 10 Most Issued Items</h2>
            {report.top10.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No issuances recorded in the last 7 days.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={report.top10} layout="vertical" margin={{ top:0, right:30, left:120, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis type="number" tick={{ fill:'#94a3b8', fontSize:12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill:'#94a3b8', fontSize:11 }} width={120} />
                  <Tooltip contentStyle={{ background:'#1e293b', border:'1px solid #334155', borderRadius:'8px', color:'#f1f5f9' }} />
                  <Bar dataKey="total" name="Qty Issued" fill="#0d9488" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Stock vs min */}
          <div className="card">
            <h2 className="font-display text-lg font-semibold text-slate-100 mb-5">Current Stock vs Minimum Stock</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={report.stockData} layout="vertical" margin={{ top:0, right:30, left:130, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" tick={{ fill:'#94a3b8', fontSize:12 }} />
                <YAxis type="category" dataKey="name" tick={{ fill:'#94a3b8', fontSize:10 }} width={130} />
                <Tooltip contentStyle={{ background:'#1e293b', border:'1px solid #334155', borderRadius:'8px', color:'#f1f5f9' }} />
                <Legend wrapperStyle={{ color:'#94a3b8', fontSize:12, paddingTop:8 }} />
                <Bar dataKey="current" name="Current Stock" fill="#0d9488" radius={[0,3,3,0]} />
                <Bar dataKey="minimum" name="Min Stock" fill="#dc2626" radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detailed table */}
          <div className="card">
            <h2 className="font-display text-lg font-semibold text-slate-100 mb-4">Full Item Report</h2>
            <Table>
              <Thead><tr>
                <Th>Part #</Th><Th>Item Name</Th><Th>Store</Th>
                <Th>Curr. Stock</Th><Th>Min Stock</Th><Th>Wk Issued</Th><Th>Expiry Date</Th><Th>Status</Th>
              </tr></Thead>
              <Tbody>
                {report.detail.map(item => (
                  <Tr key={item.id}>
                    <Td className="font-mono text-xs text-slate-300">{item.part_number}</Td>
                    <Td className="font-medium text-slate-100 max-w-xs truncate">{item.name}</Td>
                    <Td className="text-slate-400 text-xs">{item.stores?.name}</Td>
                    <Td className={Number(item.current_stock) <= Number(item.min_stock) ? 'text-red-400 font-semibold' : 'text-slate-100'}>{item.current_stock}</Td>
                    <Td className="text-slate-400">{item.min_stock}</Td>
                    <Td><Badge variant="teal">{item.weeklyIssued}</Badge></Td>
                    <Td className="text-slate-400 text-xs">{item.expiry_date || '—'}</Td>
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
