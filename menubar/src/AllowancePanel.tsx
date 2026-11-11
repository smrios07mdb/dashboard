/*
 * The five-minute warning of a daily allowance (chunk 100, D5 / D16), under
 * the meditation reminder and above the focus header, on both tabs and in
 * Settings, only while the shell's blocker state holds a warning.
 *
 * The shell counts the time and drops this panel by showing the popover
 * without taking focus; it hides it again after 10 s when nobody clicked
 * into it. This only draws the warning it was given. Built from the
 * meditation panel's classes: no new visual language.
 */
import type { BlockerWarning } from './blocker'

export default function AllowancePanel({
  warning,
  onDismiss,
}: {
  warning: BlockerWarning | null
  /** **OK**: `blocker_dismiss_warning`. */
  onDismiss: () => void
}) {
  if (!warning) return null
  const n = warning.minutesLeft
  return (
    <section className="mb-med" aria-label="Allowance warning">
      <div className="mb-med-row">
        <div className="mb-med-text">
          <b>{`${n} ${n === 1 ? 'minute' : 'minutes'} left for ${warning.name} today`}</b>
        </div>
      </div>
      <div className="mb-med-btns">
        <button type="button" className="mb-fbtn" onClick={onDismiss}>
          OK
        </button>
      </div>
    </section>
  )
}
