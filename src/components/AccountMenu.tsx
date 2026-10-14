// Direct lucide import (not `@/components/icons`) so the gear keeps the same
// 2px stroke as LogOut and the chevron; `Settings` is lucide's gear glyph.
import { ChevronDown, LogOut, Settings as Gear } from 'lucide-react'
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
import { useSession } from '@/lib/auth'
import { signOutUser } from '@/lib/signOutCleanup'

/** First letter or digit of the email, uppercased; `?` if it has none. */
function accountInitial(email: string): string {
  return email.match(/[\p{L}\p{N}]/u)?.[0].toUpperCase() ?? '?'
}

export default function AccountMenu() {
  const navigate = useNavigate()
  const { user } = useSession()
  const email = user?.email ?? ''

  async function signOut() {
    const { error } = await signOutUser()
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
        aria-label={`Account: ${email}`}
        className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-card text-[13px] text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-auto sm:min-h-11 sm:rounded-[5px] sm:px-3"
      >
        {/* Chunk 68: below `sm` the trigger is a round 44px initial; the full
            email (which needs ~200px) comes back at >=sm. */}
        <span aria-hidden className="text-[15px] font-semibold sm:hidden">
          {accountInitial(email)}
        </span>
        <span className="hidden items-center gap-2 sm:inline-flex">
          <span className="max-w-[220px] truncate">{email}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[200px]">
        <DropdownMenuLabel className="label text-muted-foreground">
          Signed in as
        </DropdownMenuLabel>
        <DropdownMenuItem disabled className="opacity-100">
          <span className="truncate text-[13px] text-foreground">{email}</span>
        </DropdownMenuItem>
        {/* Chunk 79: Settings left the tab bar; this is its entry point. */}
        <DropdownMenuItem
          onSelect={() => navigate('/settings')}
          className="text-[13px] focus:bg-secondary focus:text-foreground"
        >
          <Gear className="size-4 text-muted-foreground" />
          Settings
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
