import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, ClipboardList, BarChart2,
  ShoppingCart, TrendingUp, Settings, LogOut, X, History,
  Trash2, ArrowLeftRight, ClipboardCheck, Building2, Inbox,
  ScanLine, AlertTriangle, CalendarClock, Gauge, Ship, ClipboardX, ListTodo
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { to:'/',          icon:LayoutDashboard, label:'Dashboard',      end:true },
      { to:'/inventory', icon:Package,         label:'Inventory'               },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to:'/issuance',      icon:ClipboardList,  label:'Daily Issuance'   },
      { to:'/issuance-scan', icon:ScanLine,        label:'Scan Requisition'},
      { to:'/issue-no-req',  icon:ClipboardX,      label:'Issue w/o Req'    },
      { to:'/boat-note',     icon:Ship,            label:'Boat Note'       },
      { to:'/tasks',         icon:ListTodo,        label:'Store Tasks'     },
      { to:'/receiving',     icon:Inbox,           label:'Receiving (GRN)' },
      { to:'/transfers',     icon:ArrowLeftRight,  label:'Transfers'        },
      { to:'/waste',         icon:Trash2,          label:'Waste Log'        },
      { to:'/stocktake',     icon:ClipboardCheck,  label:'Stocktake'        },
      { to:'/claims',        icon:AlertTriangle,   label:'Delivery Claims'  },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { to:'/reports',   icon:BarChart2,     label:'Reports'       },
      { to:'/analytics', icon:TrendingUp,    label:'Analytics'     },
      { to:'/expiry',    icon:CalendarClock, label:'Item Expiry'   },
      { to:'/movement',  icon:Gauge,         label:'Item Movement' },
      { to:'/history',   icon:History,       label:'Stock History' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to:'/orders',    icon:ShoppingCart, label:'Orders'    },
      { to:'/suppliers', icon:Building2,    label:'Suppliers' },
      { to:'/settings',  icon:Settings,     label:'Settings'  },
    ],
  },
]

export default function Sidebar({ session, isOpen, onClose }) {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    toast.success('Signed out')
    navigate('/login')
  }

  return (
    <aside className={[
      'fixed lg:static inset-y-0 left-0 z-30 w-64 shrink-0',
      'bg-slate-800 border-r border-slate-700 flex flex-col',
      'transform transition-transform duration-200 ease-in-out',
      isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
    ].join(' ')}>

      {/* ── Brand ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <div className="flex items-center gap-3 min-w-0">
          <img src="/logo.svg" alt="Outrigger" className="h-8 w-auto shrink-0" draggable={false} />
          <div className="min-w-0">
            <p className="font-display text-xs font-bold text-[#00AEEF] leading-tight truncate">Outrigger</p>
            <p className="text-[10px] text-slate-400 leading-tight truncate">Maafushivaru · Inventory</p>
          </div>
        </div>
        <button onClick={onClose} className="lg:hidden p-1.5 hover:bg-slate-700 rounded-lg transition-colors shrink-0 ml-2">
          <X className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* ── Navigation ────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-3 mb-1">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ to, icon: Icon, label, end }) => (
                <NavLink key={to} to={to} end={end} onClick={onClose}
                  className={({ isActive }) => [
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-medium',
                    isActive
                      ? 'bg-[#00AEEF]/15 text-[#00AEEF] border border-[#00AEEF]/30'
                      : 'text-slate-400 hover:bg-slate-700/60 hover:text-slate-100 border border-transparent',
                  ].join(' ')}>
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── User footer ───────────────────────────────────── */}
      <div className="p-2 border-t border-slate-700">
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl mb-1">
          <div className="w-8 h-8 bg-gradient-to-br from-[#00AEEF] to-teal-700 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0">
            {session?.user?.email?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-300 truncate">{session?.user?.email}</p>
            <p className="text-[10px] text-slate-500">Inventory Manager</p>
          </div>
        </div>
        <button onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:bg-red-900/30 hover:text-red-400 transition-colors">
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </aside>
  )
}
