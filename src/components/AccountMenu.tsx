import { ChevronDown, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/auth'

export default function AccountMenu() {
  const navigate = useNavigate()
  const { user } = useSession()
  const email = user?.email ?? ''

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error(error.message || 'Could not sign out. Try again.')
      return
    }
    navigate('/', { replace: true })
  }

  if (!email) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={email}
        className="inline-flex min-h-11 items-center gap-2 rounded-[5px] border border-border bg-card px-3 text-[13px] text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="max-w-[160px] truncate sm:max-w-[220px]">{email}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[200px]">
        <DropdownMenuLabel className="label text-muted-foreground">
          Signed in as
        </DropdownMenuLabel>
        <DropdownMenuItem disabled className="opacity-100">
          <span className="truncate text-[13px] text-foreground">{email}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={signOut}
          className="text-[13px] focus:bg-secondary focus:text-foreground"
        >
          <LogOut className="size-4 text-muted-foreground" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
