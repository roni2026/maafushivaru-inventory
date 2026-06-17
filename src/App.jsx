import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect, useState, lazy, Suspense } from 'react'
import { supabase } from './lib/supabase'
import Layout        from './components/Layout'
import Login         from './pages/Login'

// Core pages (always bundled)
import Dashboard     from './pages/Dashboard'
import Inventory     from './pages/Inventory'
import Issuance      from './pages/Issuance'
import Reports       from './pages/Reports'
import Orders        from './pages/Orders'
import Analytics     from './pages/Analytics'
import Settings      from './pages/Settings'
import StockHistory  from './pages/StockHistory'
import Claims        from './pages/Claims'

// Lazy-loaded pages (safe for build even if file not yet committed)
const IssuanceScan  = lazy(() => import('./pages/IssuanceScan'))
const Waste         = lazy(() => import('./pages/Waste'))
const Stocktake     = lazy(() => import('./pages/Stocktake'))
const Transfers     = lazy(() => import('./pages/Transfers'))
const Suppliers     = lazy(() => import('./pages/Suppliers'))
const ItemDetail    = lazy(() => import('./pages/ItemDetail'))
const Receiving     = lazy(() => import('./pages/Receiving'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ProtectedRoute({ session, children }) {
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style:   { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' },
          success: { iconTheme: { primary: '#00AEEF', secondary: '#f1f5f9' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#f1f5f9' } },
        }}
      />
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/*" element={
          <ProtectedRoute session={session}>
            <Layout session={session}>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route index                element={<Dashboard />}     />
                  <Route path="inventory"     element={<Inventory />}     />
                  <Route path="inventory/:id" element={<ItemDetail />}    />
                  <Route path="issuance"      element={<Issuance />}      />
                  <Route path="issuance-scan" element={<IssuanceScan />}  />
                  <Route path="receiving"     element={<Receiving />}     />
                  <Route path="transfers"     element={<Transfers />}     />
                  <Route path="waste"         element={<Waste />}         />
                  <Route path="stocktake"     element={<Stocktake />}     />
                  <Route path="claims"        element={<Claims />}        />
                  <Route path="reports"       element={<Reports />}       />
                  <Route path="analytics"     element={<Analytics />}     />
                  <Route path="history"       element={<StockHistory />}  />
                  <Route path="suppliers"     element={<Suppliers />}     />
                  <Route path="orders"        element={<Orders />}        />
                  <Route path="settings"      element={<Settings />}      />
                </Routes>
              </Suspense>
            </Layout>
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  )
}
