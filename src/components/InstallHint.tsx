import { useState } from 'react'
import { X } from 'lucide-react'

const DISMISS_KEY = 'install-hint-dismissed'

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // iOS Safari sets navigator.standalone when launched from Home Screen.
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
    true
  // Modern browsers expose this via the display-mode media query.
  const mediaStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  return iosStandalone || mediaStandalone
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function computeInitialVisibility(): boolean {
  if (typeof window === 'undefined') return false
  if (!isIOS()) return false
  if (isStandalone()) return false
  if (wasDismissed()) return false
  return true
}

export default function InstallHint() {
  const [visible, setVisible] = useState(computeInitialVisibility)

  if (!visible) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // private mode / quota — best effort
    }
    setVisible(false)
  }

  return (
    <div className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-[1280px] items-start gap-3 px-4 py-3 sm:px-7">
        <div className="flex-1 text-[13px] leading-snug text-secondary-foreground">
          <div className="label mb-1">Install</div>
          <span>
            Install Dashboard to your Home Screen for notifications and
            full-screen use. Tap the Share icon, then{' '}
            <span className="text-foreground">Add to Home Screen</span>.
          </span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install hint"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
