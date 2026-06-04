/**
 * Throwaway primitives showcase (redesign chunk 23). DEV-only — wired behind an
 * `import.meta.env.DEV` route guard in App.tsx; safe to delete once the Daylight
 * primitive vocabulary is verified. Visit at /dev/primitives (dev server only).
 */
import { useState } from 'react'

import {
  Bell,
  Calendar,
  Check as CheckIcon,
  ChevronRight,
  Flame,
  MoreHorizontal,
  Moon,
  Plus,
  Sparkles,
  Sun,
  Trash,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconBtn } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { BottomTabs, TopTabs, type NavItem } from '@/components/ui/nav-tabs'
import { Pill } from '@/components/ui/pill'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { SyncBadge, type SyncState } from '@/components/ui/sync-badge'
import { catColor, fmtMin } from '@/lib/cat'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="label text-ink-2">{title}</h2>
      <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface p-5 shadow">
        {children}
      </div>
    </section>
  )
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'routines', label: 'Routines' },
  { id: 'insights', label: 'Insights' },
  { id: 'settings', label: 'Settings' },
]

const SYNC_STATES: SyncState[] = ['synced', 'syncing', 'offline', 'sync_issues']

export default function Primitives() {
  const [tab, setTab] = useState('dashboard')
  const [bottomTab, setBottomTab] = useState('dashboard')
  const [checked, setChecked] = useState(true)

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10 flex flex-col gap-2">
        <div className="label">Hupomnemata · Daylight</div>
        <h1 className="title text-[40px]">
          Primitives <em>showcase</em>
        </h1>
        <p className="max-w-prose text-ink-2">
          Chunk 23 shared vocabulary, in the Daylight style. Dev-only.
        </p>
      </header>

      <div className="flex flex-col gap-12">
        <Section title="Button (shadcn variants)">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Ghost</Button>
          <Button variant="ghost">Plain</Button>
          <Button variant="destructive">Danger</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </Section>

        <Section title="IconBtn (tones)">
          <IconBtn label="More">
            <MoreHorizontal />
          </IconBtn>
          <IconBtn label="Next" tone="accent">
            <ChevronRight />
          </IconBtn>
          <IconBtn label="Remind" tone="ink">
            <Bell />
          </IconBtn>
          <IconBtn label="Delete" tone="danger">
            <Trash />
          </IconBtn>
          <IconBtn label="Add" size={36}>
            <Plus />
          </IconBtn>
        </Section>

        <Section title="Input">
          <Input placeholder="Add a task…" className="max-w-xs" />
          <Input defaultValue="Quarterly review" className="max-w-xs" />
          <Input type="number" defaultValue={90} className="w-24" />
        </Section>

        <Section title="Check (Checkbox)">
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <Checkbox checked={checked} onCheckedChange={(v) => setChecked(!!v)} />
            Toggle me
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink-3">
            <Checkbox checked={false} disabled />
            Disabled
          </label>
        </Section>

        <Section title="Pill — soft">
          <Pill tone="neutral">12 open</Pill>
          <Pill tone="work">Work</Pill>
          <Pill tone="personal">Personal</Pill>
          <Pill tone="accent">LVL 4</Pill>
          <Pill tone="warn">
            <Flame size={12} /> 6 days
          </Pill>
          <Pill tone="danger">Overdue</Pill>
        </Section>

        <Section title="Pill — filled (the “N OPEN” pill)">
          <Pill tone="work" filled>
            7 OPEN
          </Pill>
          <Pill tone="personal" filled>
            3 OPEN
          </Pill>
          <Pill tone="accent" filled>
            <Sparkles size={12} /> New
          </Pill>
          <Pill tone="neutral" filled>
            Done
          </Pill>
        </Section>

        <Section title="SyncBadge — states">
          {SYNC_STATES.map((s) => (
            <SyncBadge key={s} state={s} />
          ))}
        </Section>

        <Section title="TopTabs">
          <div className="w-full">
            <TopTabs items={NAV} value={tab} onChange={setTab} />
          </div>
        </Section>

        <Section title="BottomTabs (mobile)">
          <div className="w-full max-w-sm overflow-hidden rounded-md border border-line">
            <div className="h-24 bg-bg" />
            <BottomTabs
              className="!relative !z-0"
              items={NAV.map((n) => ({
                ...n,
                icon:
                  n.id === 'dashboard' ? (
                    <Calendar size={18} />
                  ) : n.id === 'routines' ? (
                    <Sun size={18} />
                  ) : n.id === 'insights' ? (
                    <Moon size={18} />
                  ) : (
                    <CheckIcon size={18} />
                  ),
              }))}
              value={bottomTab}
              onChange={setBottomTab}
            />
          </div>
        </Section>

        <Section title="Sheet · Dialog · Menu (shells)">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle className="title text-[20px]">A quiet sheet</SheetTitle>
                <SheetDescription>
                  Right-side slide-in, neutral ink veil with a soft blur.
                </SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="title text-[20px]">Confirm</DialogTitle>
                <DialogDescription>Centered modal on the Daylight surface.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost">Cancel</Button>
                <Button>Confirm</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconBtn label="More">
                <MoreHorizontal />
              </IconBtn>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Bell size={16} /> Set reminder
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Calendar size={16} /> Block time
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive">
                <Trash size={16} /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Section>

        <Section title="Helpers — catColor / fmtMin">
          <span className="flex items-center gap-2 text-[13px] text-ink">
            <span
              className="size-4 rounded-sm"
              style={{ background: catColor('Work') }}
            />
            catColor(&apos;Work&apos;)
          </span>
          <span className="flex items-center gap-2 text-[13px] text-ink">
            <span
              className="size-4 rounded-sm"
              style={{ background: catColor('Personal') }}
            />
            catColor(&apos;Personal&apos;)
          </span>
          <span className="num text-[13px] text-ink-2">
            fmtMin: {[0, 45, 60, 90, 125].map((m) => `${m}→${fmtMin(m)}`).join('  ·  ')}
          </span>
        </Section>
      </div>
    </div>
  )
}
