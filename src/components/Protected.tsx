import type { ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth'
import Login from '@/screens/Login'

type ProtectedProps = { children: ReactNode }

export default function Protected({ children }: ProtectedProps) {
  const { session, loading } = useSession()

  if (loading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-6">
        <div className="w-full max-w-[380px] space-y-3">
          <Skeleton className="mx-auto h-8 w-48" />
          <Skeleton className="h-[42px] w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </main>
    )
  }

  if (!session) return <Login />

  return <>{children}</>
}
