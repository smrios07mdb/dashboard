import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'

import InAppReminders from '@/components/InAppReminders'
import ProtectedLayout from '@/components/ProtectedLayout'
import RealtimeBridge from '@/components/RealtimeBridge'
import UpdatePrompt from '@/components/UpdatePrompt'
import AuthCallback from '@/screens/AuthCallback'
import CategoryView from '@/screens/CategoryView'
import Dashboard from '@/screens/Dashboard'
import Insights from '@/screens/Insights'
import Routines from '@/screens/Routines'
import Settings from '@/screens/Settings'
import SubcategoryView from '@/screens/SubcategoryView'
// Side-effect import: registers window online/offline → syncStore.
import '@/lib/network'

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route element={<ProtectedLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="category/:categoryId" element={<CategoryView />} />
          <Route
            path="subcategory/:subcategoryId"
            element={<SubcategoryView />}
          />
          <Route path="routines" element={<Routines />} />
          <Route path="insights" element={<Insights />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster theme="dark" position="top-center" richColors closeButton />
      <UpdatePrompt />
      <RealtimeBridge />
      <InAppReminders />
    </BrowserRouter>
  )
}
