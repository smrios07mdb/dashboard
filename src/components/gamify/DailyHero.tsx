import { Flame, Sparkles } from 'lucide-react'
import type { User } from '@supabase/supabase-js'

import WhatsNextSheet from '@/components/WhatsNextSheet'
import type { Category, Subcategory, Task } from '@/db/types'
import { calcStats, catProgress, type Stats } from '@/lib/gamify'
import { useUIStore } from '@/state/uiStore'

import CatBar from './CatBar'
import CountUp from './CountUp'
import ProgressRing from './ProgressRing'

/*
 * Daily Progress Hero — the gamified landing element (redesign chunk 26).
 *
 * Ported from `hupomnemata_handoff/app/src/gamify.jsx` (DailyHero) and wired
 * onto real data: every figure derives from the passed live-subcategory-
 * filtered tasks / subcategories / categories, the streak is the canonical
 * routines streak computed by the Dashboard (max of morning/night, ARCH §11),
 * the minutes input binds to `uiStore.availableMinutes`, and the spark pill
 * opens the existing `WhatsNextSheet` via its `trigger` prop.
 *
 * The ring is captioned "today" but computes overall completion (done/total),
 * matching the prototype — it has no `planned_for` / due-today dependency. A
 * genuinely today-scoped ring is the deferred third-column chunk's call (note A).
 *
 * Only inline CSS transitions are used here; the prototype's completion-FX
 * keyframes (checkPop / rowFlush / xpFloat) belong to the task rows (chunk 27).
 */

type DailyHeroProps = {
  /** Session user, for the greeting name (null → bare greeting). */
  user: User | null
  /** Tasks already filtered to live (non-archived) subcategories. */
  tasks: Task[]
  /** Live (non-archived) subcategories. */
  subcategories: Subcategory[]
  categories: Category[]
  /** Best current routine streak (max of morning/night), computed upstream. */
  streak: number
}

// ── time-aware greeting + encouragement (ported verbatim from gamify.jsx) ──

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Still up'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Winding down'
}

function encourage(s: Stats): string {
  if (s.total === 0) return 'A clean slate. Add something to chase.'
  if (s.done === 0) return 'Nothing done yet — knock out the first one.'
  if (s.ratio >= 1) return 'Every task cleared. Beautifully done.'
  if (s.ratio >= 0.66) return 'Almost there — the finish line is close.'
  if (s.ratio >= 0.33) return "You're on a roll. Keep the momentum."
  return 'Good start. One at a time.'
}

/**
 * A clean first name for the greeting, or null. Prefers a real name from the
 * session user metadata; falls back to the email local-part only when it reads
 * like a name (letters first, no `+`/`.`-noise); otherwise null so we render
 * the bare greeting and never surface a raw address (chunk-26 note C).
 */
function displayName(user: User | null): string | null {
  if (!user) return null
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const metaName = [meta.name, meta.full_name, meta.display_name].find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  )
  if (metaName) return metaName.trim()
  const local = user.email?.split('@')[0] ?? ''
  if (/^[a-zA-Z][a-zA-Z0-9'’-]*$/.test(local) && local.length <= 20) {
    return local.charAt(0).toUpperCase() + local.slice(1)
  }
  return null
}

export default function DailyHero({
  user,
  tasks,
  subcategories,
  categories,
  streak,
}: DailyHeroProps) {
  const availableMinutes = useUIStore((s) => s.availableMinutes)
  const setAvailableMinutes = useUIStore((s) => s.setAvailableMinutes)

  const stats = calcStats(tasks)
  const work = catProgress(tasks, subcategories, categories, 'Work')
  const personal = catProgress(tasks, subcategories, categories, 'Personal')
  const pct = Math.round(stats.ratio * 100)
  const name = displayName(user)

  return (
    <div
      className="mb-6"
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, var(--surface), var(--surface-2))',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-md)',
        padding: '20px 22px',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -90,
          right: -40,
          width: 280,
          height: 280,
          background: 'radial-gradient(circle, var(--work) 0%, transparent 70%)',
          opacity: 0.13,
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: -110,
          right: 160,
          width: 240,
          height: 240,
          background:
            'radial-gradient(circle, var(--personal) 0%, transparent 70%)',
          opacity: 0.1,
          pointerEvents: 'none',
        }}
      />

      {/* top row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
          position: 'relative',
        }}
      >
        <ProgressRing value={stats.ratio} size={88} stroke={9}>
          <span
            className="num display"
            style={{ fontSize: 21, fontWeight: 600, color: 'var(--ink)' }}
          >
            {pct}
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>%</span>
          </span>
          <span className="label" style={{ fontSize: 8, marginTop: 2 }}>
            today
          </span>
        </ProgressRing>

        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h1
            className="display"
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 500,
              letterSpacing: '-.015em',
              color: 'var(--ink)',
              lineHeight: 1.12,
            }}
          >
            {name ? `${greeting()}, ${name}` : greeting()}
          </h1>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginTop: 10,
            }}
          >
            {/* streak chip — gold literals (no token for this hue; chunk-26 step 2) */}
            <span
              title="Check-in streak"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(201,148,47,.14)',
                border: '1px solid rgba(201,148,47,.28)',
              }}
            >
              <Flame size={13} style={{ color: '#c9942f' }} aria-hidden />
              <span
                className="num"
                style={{ fontSize: 12.5, fontWeight: 700, color: '#a9772a' }}
              >
                {streak}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                day{streak === 1 ? '' : 's'}
              </span>
            </span>
            {/* level chip — amethyst */}
            <span
              title={`${stats.xp.toLocaleString()} XP`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                background:
                  'color-mix(in srgb, var(--jewel-amethyst) 13%, transparent)',
                border:
                  '1px solid color-mix(in srgb, var(--jewel-amethyst) 34%, transparent)',
              }}
            >
              <span
                className="label"
                style={{ fontSize: 8.5, color: 'var(--jewel-amethyst)' }}
              >
                LVL
              </span>
              <span
                className="num"
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: 'var(--jewel-amethyst)',
                }}
              >
                {stats.level}
              </span>
              <span
                style={{
                  width: 1,
                  height: 11,
                  background:
                    'color-mix(in srgb, var(--jewel-amethyst) 30%, transparent)',
                }}
              />
              <CountUp
                value={stats.xp}
                className="num"
                style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 700 }}
              />
              <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>xp</span>
            </span>
          </div>
          <p style={{ margin: '7px 0 0', fontSize: 13.5, color: 'var(--ink-2)' }}>
            {encourage(stats)}{' '}
            <span className="num" style={{ color: 'var(--ink-3)' }}>
              · {stats.done}/{stats.total} done
            </span>
          </p>
          {/* level progress sliver */}
          <div
            style={{
              marginTop: 10,
              height: 5,
              borderRadius: 999,
              background: 'var(--bg-alt)',
              overflow: 'hidden',
              maxWidth: 320,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${stats.intoLevel * 100}%`,
                background:
                  'linear-gradient(90deg, var(--jewel-amethyst), var(--jewel-sapphire))',
                transition: 'width 1s cubic-bezier(.2,.7,.2,1)',
                boxShadow: '0 0 10px -1px var(--jewel-amethyst)',
              }}
            />
          </div>
        </div>

        {/* action: I have __ min / What's next? */}
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            position: 'relative',
            flexShrink: 0,
            borderRadius: 999,
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            alignSelf: 'center',
          }}
        >
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 6px 0 14px',
            }}
          >
            <span className="label" style={{ fontSize: 9 }}>
              I have
            </span>
            <input
              value={availableMinutes}
              type="number"
              min="0"
              step="15"
              onChange={(e) => setAvailableMinutes(Number(e.target.value) || 0)}
              className="num"
              aria-label="Available minutes"
              style={{
                width: 42,
                border: 0,
                outline: 'none',
                background: 'transparent',
                fontSize: 15,
                fontWeight: 600,
                textAlign: 'right',
                color: 'var(--ink)',
              }}
            />
            <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              min
            </span>
          </label>
          <WhatsNextSheet
            trigger={
              <button
                type="button"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '10px 16px',
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--spark-ink, #fff)',
                  whiteSpace: 'nowrap',
                  border: 0,
                  cursor: 'pointer',
                  background: 'var(--spark-grad)',
                  boxShadow:
                    'inset 0 1px 0 rgba(255,255,255,.30), 0 6px 20px -5px var(--spark-glow)',
                }}
              >
                <Sparkles size={14} aria-hidden />
                What&rsquo;s next?
              </button>
            }
          />
        </div>
      </div>

      {/* category progress bars */}
      <div
        style={{
          display: 'flex',
          gap: 22,
          marginTop: 18,
          paddingTop: 16,
          borderTop: '1px solid var(--line)',
          position: 'relative',
          flexWrap: 'wrap',
        }}
      >
        <CatBar name="Work" {...work} color="var(--work)" />
        <CatBar name="Personal" {...personal} color="var(--personal)" />
      </div>
    </div>
  )
}
