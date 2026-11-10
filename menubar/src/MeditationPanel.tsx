/*
 * The meditation reminder (chunk 96, D7), above the focus header while a
 * reminder is at its heads-up or due — the prototype's two HUDs. Nothing
 * starts until Start is pressed.
 *
 * The shell owns the clock and drops this panel by showing the popover. This
 * only draws the last snapshot: the heads-up countdown is `dueAt − now`,
 * redrawn once a second and only while the popover is shown.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'

import { timeText } from '@/lib/whenLabel'

import { hotkeyLabel } from './hotkeys'
import { countdownText, type Meditation } from './meditation'
import { watchPopover } from './native'

/** Reminders are in the Mac's local time (D2), not the Settings zone. */
function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export default function MeditationPanel({
  meditation,
  hotkey,
  hotkeyError,
}: {
  meditation: Meditation
  /** The accelerator bound to "meditate", for the Start button's hint. */
  hotkey: string
  /** `⌥⇧M is taken by another app`. */
  hotkeyError: string | null
}) {
  const { snapshot: s, at } = useSyncExternalStore(
    meditation.subscribe,
    meditation.getState,
  )
  const [shown, setShown] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(
    () =>
      watchPopover((isShown) => {
        setShown(isShown)
        if (isShown) setTick(Date.now())
      }),
    [],
  )

  // One redraw a second, on the second, while shown and counting down.
  const countTo = s.status === 'heads_up' ? s.dueAt : null
  useEffect(() => {
    if (!shown || countTo === null) return
    const redraw = () => setTick(Date.now())
    let interval: number | undefined
    const toNextSecond = (((countTo - Date.now()) % 1000) + 1000) % 1000
    const lead = window.setTimeout(() => {
      redraw()
      interval = window.setInterval(redraw, 1000)
    }, toNextSecond)
    return () => {
      window.clearTimeout(lead)
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [shown, countTo])

  if ((s.status !== 'heads_up' && s.status !== 'due') || s.dueAt === null) {
    return null
  }
  const due = s.status === 'due'
  const title = due
    ? 'Time to breathe'
    : `Breathe at ${timeText(new Date(s.dueAt), localZone())}`
  const sub = due
    ? `${s.length} minutes. ${s.pauseSpotify ? 'Spotify pauses, ' : ''}Esc ends it.`
    : `${s.length}-minute session · in ${countdownText(s.dueAt - Math.max(tick, at))}`

  return (
    <section className="mb-med" aria-label="Meditation reminder">
      <div className="mb-med-row">
        <i className="mb-med-orb" aria-hidden="true" />
        <div className="mb-med-text">
          <b>{title}</b>
          <small>{sub}</small>
        </div>
      </div>
      {due ? (
        <button
          type="button"
          className="mb-fbtn mb-med-start"
          onClick={() => void meditation.startSession()}
        >
          Start session <kbd>{hotkeyLabel(hotkey)}</kbd>
        </button>
      ) : null}
      <div className="mb-med-btns">
        {due ? null : (
          <button
            type="button"
            className="mb-fbtn"
            onClick={() => void meditation.startSession()}
          >
            Start now
          </button>
        )}
        <button
          type="button"
          className="mb-fbtn"
          onClick={() => void meditation.snooze(5)}
        >
          Snooze 5
        </button>
        <button
          type="button"
          className="mb-fbtn"
          onClick={() => void meditation.snooze(15)}
        >
          Snooze 15
        </button>
        <button
          type="button"
          className="mb-fbtn"
          onClick={() => void meditation.skip()}
        >
          Skip
        </button>
      </div>
      {hotkeyError ? (
        <span className="mb-focus-warn" role="status">
          {hotkeyError}
        </span>
      ) : null}
    </section>
  )
}
