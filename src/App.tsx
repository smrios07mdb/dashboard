import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'

import AppShell from '@/components/AppShell'
import Protected from '@/components/Protected'
import AuthCallback from '@/screens/AuthCallback'

function Dashboard() {
  return (
    <div>
      <div className="label mb-2">Today</div>
      <h1
        className="text-[28px] font-semibold"
        style={{ letterSpacing: '-0.02em' }}
      >
        Dashboard (signed in)
      </h1>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route
          path="/"
          element={
            <Protected>
              <AppShell>
                <Dashboard />
              </AppShell>
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster theme="dark" position="top-center" richColors closeButton />
    </BrowserRouter>
  )
}
