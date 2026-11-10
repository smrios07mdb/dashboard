/*
 * The scratchpad tab (chunk 93, D2–D5): one ruled textarea, a live count and
 * Send. The draft is saved to `hup:mb:scratch` on every input and restored
 * at start. ⌘↵ sends, Esc hides the popover, ↵ is a new line. The send
 * itself is `sendScratch` (pure), run by the caller.
 */
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react'

import { readDraft, saveDraft } from './prefs'
import {
  footerCount,
  planScratch,
  type ScratchLists,
  type ScratchResult,
} from './scratchpad'

// The count and destination do not depend on the day, so the footer plans
// with a fixed clock; the send reads the real one.
const COUNT_CLOCK = new Date(0)

export default function Scratchpad({
  lists,
  userId,
  send,
  hotkeyError,
  focusSeq,
  onHide,
}: {
  /** Null until the first Today load lands. */
  lists: ScratchLists | null
  userId: string
  send: (text: string) => Promise<ScratchResult>
  /** e.g. `⌥H is taken by another app`. */
  hotkeyError: string | null
  /** Bumped by the hotkey: focus the pad, caret at the end. */
  focusSeq: number
  onHide: () => void
}) {
  const [text, setText] = useState(readDraft)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const padRef = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const pad = padRef.current
    if (focusSeq === 0 || !pad) return
    pad.focus()
    pad.setSelectionRange(pad.value.length, pad.value.length)
  }, [focusSeq])

  const lines = text.split('\n').filter((l) => l.trim().length > 0).length
  const plan = lists
    ? planScratch(text, { ...lists, userId, now: COUNT_CLOCK })
    : null
  const count = plan
    ? footerCount(plan)
    : lines === 0
      ? 'Nothing to send'
      : `${lines} ${lines === 1 ? 'line' : 'lines'}`
  const disabled = sending || lines === 0 || !lists

  function update(next: string) {
    setText(next)
    saveDraft(next)
  }

  async function submit() {
    if (disabled) return
    setSending(true)
    try {
      const r = await send(text)
      update(r.leftover)
      setResult(r.result)
    } catch (e) {
      console.error('menubar: scratchpad send failed', e)
      setResult('Could not save — retry')
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      // The draft is already saved.
      e.preventDefault()
      onHide()
    } else if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <>
      <div className="mb-sec mb-pad">
        <textarea
          ref={padRef}
          className="mb-pad-ta"
          aria-label="Scratchpad"
          spellCheck={false}
          value={text}
          readOnly={sending}
          onChange={(e) => {
            update(e.target.value)
            setResult(null)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="mb-pad-foot">
        <div className="mb-pc">
          <span role="status">{result ?? count}</span>
          {hotkeyError ? (
            <span className="mb-pc-warn">{hotkeyError}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="mb-send"
          disabled={disabled}
          onClick={() => void submit()}
        >
          Send <kbd aria-hidden="true">⌘↵</kbd>
        </button>
      </div>
    </>
  )
}
