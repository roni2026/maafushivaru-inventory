import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, ClipboardList, BarChart2,
  ShoppingCart, TrendingUp, Settings, LogOut, Waves, X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

const NAV = [
  { to: '/',          icon: LayoutDashboard, label: 'Dashboard',      end: true },
  { to: '/inventory', icon: Package,          label: 'Inventory'               },
  { to: '/issuance',  icon: ClipboardList,    label: 'Daily Issuance'          },
  { to: '/reports',   icon: BarChart2,        label: 'Reports'                 },
  { to: '/orders',    icon: ShoppingCart,     label: 'Orders'                  },
  { to: '/analytics', icon: TrendingUp,       label: 'Analytics'               },
  { to: '/settings',  icon: Settings,         label: 'Settings'                },
]

export default function Sidebar({ session, isOpen, onClose }) {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    toast.success('Signed out')
    navigate('/login')
  }

  return (
    <aside
      className={[
        'fixed lg:static inset-y-0 left-0 z-30 w-64',
        'bg-slate-800 border-r border-slate-700 flex flex-col',
        'transform transition-transform duration-200 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      ].join(' ')}
    >
      {/* Brand */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center shadow-lg">
            <Waves className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-display text-sm font-bold text-teal-400 leading-tight">Outrigger</p>
            <p className="text-xs text-slate-400 leading-tight">Maafushivaru</p>
          </div>
        </div>
        <button onClick={onClose} className="lg:hidden p-1 hover:bg-slate-700 rounded-lg transition-colors">
          <X className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onClose}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium',
                isActive
                  ? 'bg-teal-600/20 text-teal-300 border border-teal-600/30'
                  : 'text-slate-400 hover:bg-slate-700/60 hover:text-slate-100',
              ].join(' ')
            }
          >
            <Icon className="w-4.5 h-4.5 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="p-3 border-t border-slate-700 space-y-1">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
          <div className="w-8 h-8 bg-teal-700 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0">
            {session?.user?.email?.[0]?.toUpperCase() || 'U'}
          </div>
          <p className="text-sm text-slate-300 truncate flex-1">{session?.user?.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-red-900/30 hover:text-red-400 transition-colors"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </aside>
  )
}
