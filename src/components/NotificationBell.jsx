import { useState, useCallback } from 'react'
import { Bell, X, AlertTriangle, Package, Clock, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { fetchNotifications, getReadIds, saveReadIds } from '../lib/notifications'

const SEVERITY = {
  critical: { dot:'bg-red-500',    text:'text-red-400',    bg:'bg-red-900/20'    },
  high:     { dot:'bg-orange-500', text:'text-orange-400', bg:'bg-orange-900/15' },
  medium:   { dot:'bg-yellow-500', text:'text-yellow-400', bg:'bg-yellow-900/10' },
  low:      { dot:'bg-slate-500',  text:'text-slate-400',  bg:''                 },
}
const TYPE_ICON = {
  expired:     <AlertTriangle className="w-4 h-4" />,
  expiring:    <Clock className="w-4 h-4" />,
  low_stock:   <Package className="w-4 h-4" />,
  no_movement: <Package className="w-4 h-4" />,
}
const GROUPS = [
  { key:'critical', label:'🔴 Critical' },
  { key:'high',     label:'🟠 High'     },
  { key:'medium',   label:'🟡 Medium'   },
  { key:'low',      label:'⚪ Info'     },
]

export default function NotificationBell() {
  const [open,   setOpen]   = useState(false)
  const [notifs, setNotifs] = useState([])
  const [readIds,setReadIds]= useState(getReadIds)
  const [loading,setLoading]= useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setNotifs(await fetchNotifications()) } catch {}
    setLoading(false)
  }, [])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) load()
  }

  const markAllRead = () => {
    const ids = new Set(notifs.map(n => n.id))
    saveReadIds(ids)
    setReadIds(ids)
  }

  const unread = notifs.filter(n => !readIds.has(n.id)).length

  return (
    <div className="relative">
      <button onClick={toggle}
        className="relative p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-slate-100"
        title="Notifications">
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-[380px] max-h-[80vh] bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl z-40 flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-teal-400" />
                <span className="font-semibold text-slate-100 text-sm">Alerts</span>
                {unread > 0 && <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full">{unread}</span>}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={load} className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors" title="Refresh">
                  <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading?'animate-spin':''}`} />
                </button>
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-xs text-teal-400 hover:text-teal-300 px-2 py-1 transition-colors">
                    Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1">
              {loading && notifs.length === 0 ? (
                <div className="flex justify-center py-10">
                  <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : notifs.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Bell className="w-10 h-10 mx-auto mb-2 opacity-20" />
                  <p className="text-sm font-medium">All clear!</p>
                  <p className="text-xs mt-1">No alerts at the moment.</p>
                </div>
              ) : (
                GROUPS.map(({ key, label }) => {
                  const items = notifs.filter(n => n.severity === key)
                  if (!items.length) return null
                  const s = SEVERITY[key]
                  return (
                    <div key={key}>
                      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 sticky top-0">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label} ({items.length})</p>
                      </div>
                      {items.map(n => {
                        const isRead = readIds.has(n.id)
                        return (
                          <Link key={n.id} to={n.link || '/inventory'} onClick={() => setOpen(false)}
                            className={`flex items-start gap-3 px-4 py-3 border-b border-slate-700/40 transition-colors hover:bg-slate-700/30 ${s.bg} ${isRead ? 'opacity-40' : ''}`}>
                            <div className={`mt-0.5 shrink-0 ${s.text}`}>{TYPE_ICON[n.type]}</div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${isRead ? 'text-slate-400' : 'text-slate-100'}`}>{n.title}</p>
                              <p className="text-xs text-slate-500 mt-0.5 truncate">{n.sub}</p>
                            </div>
                            {!isRead && <div className={`w-2 h-2 rounded-full ${s.dot} shrink-0 mt-1.5`} />}
                          </Link>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-slate-700 shrink-0 text-center">
              <Link to="/inventory" onClick={() => setOpen(false)}
                className="text-xs text-teal-400 hover:text-teal-300 transition-colors">
                → Open Inventory to resolve alerts
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
