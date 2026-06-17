import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, ClipboardList, BarChart2,
  ShoppingCart, TrendingUp, Settings, LogOut, Waves, X, History,
  Trash2, ArrowLeftRight, ClipboardCheck, Building2, Inbox, ScanLine
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
      { to:'/issuance',      icon:ClipboardList,  label:'Daily Issuance'  },
      { to:'/issuance-scan', icon:ScanLine,        label:'Scan Issuance'  },
      { to:'/receiving',     icon:Inbox,           label:'Receiving (GRN)' },
      { to:'/transfers',     icon:ArrowLeftRight,  label:'Transfers'       },
      { to:'/waste',         icon:Trash2,          label:'Waste Log'       },
      { to:'/stocktake',     icon:ClipboardCheck,  label:'Stocktake'       },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { to:'/reports',   icon:BarChart2,  label:'Reports'       },
      { to:'/analytics', icon:TrendingUp, label:'Analytics'     },
      { to:'/history',   icon:History,    label:'Stock History' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to:'/suppliers', icon:Building2,    label:'Suppliers' },
      { to:'/orders',    icon:ShoppingCart, label:'Orders'    },
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

      {/* Brand */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-teal-500 to-teal-700 rounded-xl flex items-center justify-center shadow-lg shrink-0">
            <Waves className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-display text-sm font-bold text-teal-400 leading-tight">Outrigger</p>
            <p className="text-xs text-slate-400 leading-tight">Maafushivaru</p>
          </div>
        </div>
        <button onClick={onClose} className="lg:hidden p-1.5 hover:bg-slate-700 rounded-lg transition-colors">
          <X className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Nav */}
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
                      ? 'bg-teal-600/20 text-teal-300 border border-teal-600/30'
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

      {/* User footer */}
      <div className="p-2 border-t border-slate-700">
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl mb-1">
          <div className="w-8 h-8 bg-gradient-to-br from-teal-600 to-teal-800 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0">
            {session?.user?.email?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-300 truncate">{session?.user?.email}</p>
            <p className="text-xs text-slate-500">Inventory Manager</p>
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
