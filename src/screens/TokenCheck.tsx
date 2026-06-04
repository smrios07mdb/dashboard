/**
 * Throwaway token-check page (redesign chunk 21). DEV-only — wired behind an
 * `import.meta.env.DEV` route guard in App.tsx; safe to delete once the Daylight
 * foundation is verified. Renders color / type / shadow / radius swatches using
 * the new Tailwind utilities (so it also proves the theme compiles).
 *
 * Visit at /dev/tokens (dev server only).
 */

function Swatch({
  name,
  value,
  className,
  style,
  dark,
}: {
  name: string
  value: string
  className?: string
  style?: React.CSSProperties
  dark?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className={`h-16 rounded-md border border-line-strong ${className ?? ''}`}
        style={style}
      />
      <div className={`label ${dark ? 'text-ink-4' : ''}`}>{name}</div>
      <div className="font-mono text-[11px] text-ink-3">{value}</div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="label text-ink-2">{title}</h2>
      {children}
    </section>
  )
}

export default function TokenCheck() {
  const jewels = [
    'sapphire',
    'amethyst',
    'coral',
    'citron',
    'jade',
    'rose',
    'teal',
    'gold',
  ] as const

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      {/* transparent bg so the fixed body::before glow shows through */}
      <header className="mb-10 flex flex-col gap-2">
        <div className="label">Hupomnemata · Daylight</div>
        <h1 className="title text-[40px]">
          Design tokens <em>token check</em>
        </h1>
        <p className="max-w-prose text-ink-2">
          A throwaway swatch sheet for chunk 21. The background you see behind the
          cards is the fixed <code className="font-mono text-[12px]">body::before</code>{' '}
          glow wash.
        </p>
      </header>

      <div className="flex flex-col gap-12">
        <Section title="Surfaces">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Swatch name="bg" value="#f6f4f7" className="bg-bg" />
            <Swatch name="bg-alt" value="#eceaef" className="bg-bg-alt" />
            <Swatch name="surface" value="#ffffff" className="bg-surface" />
            <Swatch name="surface-2" value="#f8f6fa" className="bg-surface-2" />
          </div>
        </Section>

        <Section title="Ink scale">
          <div className="flex flex-col gap-2 rounded-md bg-surface p-5 shadow">
            <p className="text-ink">ink — primary text #221f28</p>
            <p className="text-ink-2">ink-2 — secondary text #635f6c</p>
            <p className="text-ink-3">ink-3 — hints / captions #948f9e</p>
            <p className="text-ink-4">ink-4 — placeholder / disabled #c7c2d0</p>
          </div>
        </Section>

        <Section title="Category — emerald (default)">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Swatch name="work" value="#059669" className="bg-work" />
            <Swatch name="work-soft" value="rgba(5,150,105,.14)" className="bg-work-soft" />
            <Swatch name="personal" value="#f43f5e" className="bg-personal" />
            <Swatch
              name="personal-soft"
              value="rgba(244,63,94,.14)"
              className="bg-personal-soft"
            />
          </div>
        </Section>

        <Section title="Jewel palette">
          <div className="grid grid-cols-4 gap-4 sm:grid-cols-8">
            {jewels.map((j) => (
              <Swatch
                key={j}
                name={j}
                value={`--jewel-${j}`}
                style={{ background: `var(--jewel-${j})` }}
              />
            ))}
          </div>
        </Section>

        <Section title="Status">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Swatch name="good" value="#11a06e" className="bg-good" />
            <Swatch name="warn" value="#d98a1c" className="bg-warn" />
            <Swatch name="offline" value="#b0a593" className="bg-offline" />
            <Swatch
              name="destructive"
              value="#b8462e"
              style={{ background: 'hsl(var(--destructive))' }}
            />
          </div>
        </Section>

        <Section title="Accent (forest) + spark button">
          <div className="flex flex-wrap items-end gap-6">
            <Swatch
              name="accent (pine)"
              value="#1f5142"
              style={{ background: 'hsl(var(--accent))' }}
            />
            <Swatch
              name="accent-soft"
              value="rgba(31,81,66,.10)"
              style={{ background: 'var(--accent-soft)' }}
            />
            <button
              type="button"
              className="rounded-md px-5 py-3 font-bold"
              style={{
                background: 'var(--spark-grad)',
                color: 'var(--spark-ink)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,.30), 0 6px 20px -5px var(--spark-glow)',
              }}
            >
              What&apos;s next?
            </button>
          </div>
        </Section>

        <Section title="Elevation">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="rounded-md bg-surface p-5 shadow-sm">
              <div className="label">shadow-sm</div>
            </div>
            <div className="rounded-md bg-surface p-5 shadow">
              <div className="label">shadow (md)</div>
            </div>
            <div className="rounded-md bg-surface p-5 shadow-lg">
              <div className="label">shadow-lg</div>
            </div>
          </div>
        </Section>

        <Section title="Radii">
          <div className="flex flex-wrap gap-6">
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-sm bg-work" />
              <div className="label">sm · 4px</div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded bg-work" />
              <div className="label">DEFAULT · 7px</div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-md bg-work" />
              <div className="label">md · 11px</div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-lg bg-work" />
              <div className="label">lg · 16px</div>
            </div>
          </div>
        </Section>

        <Section title="Typography">
          <div className="flex flex-col gap-4 rounded-md bg-surface p-6 shadow">
            <div className="title text-[31px]">
              Newsreader title — <em>editorial italic</em>
            </div>
            <div className="display text-[27px] text-ink">Newsreader display, 27px</div>
            <p className="text-ink">
              Inter body — the quick brown fox jumps over the lazy dog. 14px / 1.5.
            </p>
            <div className="label">Plex Mono label · .16em tracked</div>
            <div className="num text-[24px] text-ink">90 min · 1,240 xp · 72%</div>
            <div className="mono text-ink-2">mono tabular figures 0123456789</div>
          </div>
        </Section>
      </div>
    </div>
  )
}
