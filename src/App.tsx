import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'

import ApplyAccent from '@/components/ApplyAccent'
import InAppReminders from '@/components/InAppReminders'
import ProtectedLayout from '@/components/ProtectedLayout'
import RealtimeBridge from '@/components/RealtimeBridge'
import SyncRunner from '@/components/SyncRunner'
import UpdatePrompt from '@/components/UpdatePrompt'
import AuthCallback from '@/screens/AuthCallback'
import CategoryView from '@/screens/CategoryView'
import Dashboard from '@/screens/Dashboard'
import Routines from '@/screens/Routines'
import Settings from '@/screens/Settings'
import SubcategoryView from '@/screens/SubcategoryView'
// Side-effect import: registers window online/offline → syncStore.
import '@/lib/network'

// Insights pulls in recharts (a sizable dep) — lazy-load so it lands in its own
// chunk and doesn't bloat the initial bundle / Lighthouse Perf (chunk-16 R7).
const Insights = lazy(() => import('@/screens/Insights'))

// Throwaway design-token check page (redesign chunk 21). DEV-only: the ternary
// is statically false in prod, so Vite drops the dynamic import and never emits
// the chunk. Route is also `import.meta.env.DEV`-gated below.
const TokenCheck = import.meta.env.DEV
  ? lazy(() => import('@/screens/TokenCheck'))
  : null

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        {import.meta.env.DEV && TokenCheck && (
          <Route
            path="/dev/tokens"
            element={
              <Suspense fallback={null}>
                <TokenCheck />
              </Suspense>
            }
          />
        )}
        <Route element={<ProtectedLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="category/:categoryId" element={<CategoryView />} />
          <Route
            path="subcategory/:subcategoryId"
            element={<SubcategoryView />}
          />
          <Route path="routines" element={<Routines />} />
          <Route
            path="insights"
            element={
              <Suspense
                fallback={
                  <div
                    className="h-[280px] animate-pulse rounded-md bg-secondary motion-reduce:animate-none"
                    aria-hidden
                  />
                }
              >
                <Insights />
              </Suspense>
            }
          />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster theme="light" position="top-center" richColors closeButton />
      <ApplyAccent />
      <UpdatePrompt />
      <RealtimeBridge />
      <InAppReminders />
      <SyncRunner />
    </BrowserRouter>
  )
}
