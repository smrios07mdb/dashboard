import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { toast } from 'sonner'

import AttachPicker, {
  type AttachTarget,
} from '@/components/notebook/AttachPicker'
import NoteEditor from '@/components/notebook/NoteEditor'
import NoteList from '@/components/notebook/NoteList'
import { useNoteWriter } from '@/components/notebook/useNoteWriter'
import { repo } from '@/db/repo'
import type { Category, Note, Subcategory, Task } from '@/db/types'
import { useSession } from '@/lib/auth'
import { resolveAttachment, type NoteContext } from '@/lib/notes'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/state/uiStore'

/*
 * Notebook (`/notebook`, `/notebook/:noteId`) — chunk 58.
 *
 * From 640px up it is two panes: the list, and the selected note's editor.
 * Below 640px the list is the page and `:noteId` is a full-screen editor (the
 * bottom nav is not rendered on that route — see Tabs / AppShell). Both
 * layouts are one DOM tree placed with CSS, so there is exactly one editor and
 * one autosave whatever the width.
 *
 * New note opens an unsaved draft: nothing is written until its title or body
 * is non-empty, and walking away from an empty draft simply drops it. Emptying
 * a note that already exists does not delete it. That write path is
 * `useNoteWriter`, shared with the task sheet since chunk 59.
 */

type ViewData = {
  notes: Note[]
  categories: Category[]
  subcategories: Subcategory[]
  tasks: Task[]
}

export default function Notebook() {
  const { noteId } = useParams<{ noteId?: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useSession()
  const userId = user?.id ?? null
  const touch = useIsTouchDevice()
  const dashboardRefreshKey = useUIStore((s) => s.dashboardRefreshKey)

  const [data, setData] = useState<ViewData>({
    notes: [],
    categories: [],
    subcategories: [],
    tasks: [],
  })
  const [loaded, setLoaded] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // The draft / create / update / delete path lives in `useNoteWriter` (chunk
  // 59), shared with the task sheet. This screen keeps its own list, so each
  // successful write is applied to it here as well.
  const {
    draft,
    openDraft,
    save,
    attach,
    detach: detachNote,
    remove: removeNote,
    keepCreated,
  } = useNoteWriter({
    onCreated: (created) =>
      setData((prev) => ({ ...prev, notes: [created, ...prev.notes] })),
    onUpdated: (updated) =>
      setData((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === updated.id ? updated : n)),
      })),
    onDeleted: (id) =>
      setData((prev) => ({
        ...prev,
        notes: prev.notes.filter((n) => n.id !== id),
      })),
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [notes, categories, subcategories, tasks] = await Promise.all([
        repo.notes.listAll(),
        repo.categories.list(),
        repo.subcategories.list(),
        repo.tasks.list(),
      ])
      if (cancelled) return
      const merge = keepCreated(notes)
      setData((prev) => ({
        notes: merge(prev.notes),
        categories,
        subcategories,
        tasks,
      }))
      setLoaded(true)
    }
    load().catch((e) => {
      console.error('Notebook load failed', e)
      if (!cancelled) setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [dashboardRefreshKey, keepCreated])

  const ctx: NoteContext = useMemo(
    () => ({
      categories: data.categories,
      subcategories: data.subcategories,
      tasks: data.tasks,
    }),
    [data.categories, data.subcategories, data.tasks],
  )

  const selected =
    data.notes.find((n) => n.id === noteId) ??
    (draft && draft.id === noteId ? draft : null)
  const selectedIsDraft = selected !== null && selected === draft

  function newNote() {
    if (!userId) return
    navigate(`/notebook/${openDraft(userId).id}`)
  }

  // `/notebook?attach=subcategory:<id>` (the drill-down's "New note here"):
  // read once, open an unsaved draft already attached to that list, and put
  // the draft's own URL in place of this one. An id that names no live list —
  // unknown, or archived — is ignored and the param dropped.
  const attachParam = searchParams.get('attach')
  const attachHandled = useRef(false)
  useEffect(() => {
    if (!attachParam || !loaded || !userId || attachHandled.current) return
    attachHandled.current = true
    const id = /^subcategory:(.+)$/.exec(attachParam)?.[1]
    const list = data.subcategories.find((s) => s.id === id && !s.archivedAt)
    navigate(
      list
        ? `/notebook/${openDraft(userId, { subcategoryId: list.id }).id}`
        : '/notebook',
      { replace: true },
    )
  }, [attachParam, loaded, userId, data.subcategories, navigate, openDraft])

  const attachment = selected ? resolveAttachment(selected, ctx) : null
  const linkedName =
    attachment && attachment.kind !== 'detached' ? attachment.name : null

  function detach(note: Note) {
    const name = linkedName ?? 'its list'
    void detachNote(note.id).then(
      () => toast.success(`Detached from ${name}.`),
      () => undefined,
    )
  }

  function pick(note: Note, target: AttachTarget | null) {
    setPickerOpen(false)
    if (!target) {
      detach(note)
      return
    }
    void attach(note.id, target).then(
      () => toast.success(`Attached to ${target.name}.`),
      () => undefined,
    )
  }

  async function remove(note: Note) {
    if (await removeNote(note)) navigate('/notebook')
  }

  // An id that names neither a note nor the open draft: back to the list.
  if (loaded && noteId && !selected) {
    return <Navigate to="/notebook" replace />
  }

  return (
    <div className="sm:flex sm:h-[calc(100svh-13.5rem)] sm:min-h-[480px] sm:overflow-hidden sm:rounded-lg sm:border sm:border-line">
      <aside
        className={cn(
          '-mx-[var(--shell-side)] sm:mx-0 sm:w-[300px] sm:shrink-0 sm:border-r sm:border-line sm:bg-[color-mix(in_srgb,var(--surface)_55%,transparent)] lg:w-[340px]',
          noteId && 'max-sm:hidden',
        )}
      >
        <NoteList
          notes={data.notes}
          ctx={ctx}
          activeId={selected?.id ?? null}
          touch={touch}
          onSelect={(id) => navigate(`/notebook/${id}`)}
          onNew={newNote}
        />
      </aside>
      <section
        aria-label="Note"
        className={cn(
          'min-w-0 bg-surface sm:flex-1',
          selected
            ? 'max-sm:fixed max-sm:inset-0 max-sm:z-40 max-sm:pb-[env(safe-area-inset-bottom)] max-sm:pt-[env(safe-area-inset-top)]'
            : 'max-sm:hidden',
        )}
      >
        {selected && (
          <NoteEditor
            key={selected.id}
            note={selected}
            persisted={!selectedIsDraft}
            attachment={attachment}
            touch={touch}
            onSave={(changes) => save(selected.id, changes)}
            onTogglePin={() =>
              void save(selected.id, { pinned: !selected.pinned }).catch(
                () => undefined,
              )
            }
            onAttach={() => setPickerOpen(true)}
            onDetach={() => detach(selected)}
            onDelete={() => remove(selected)}
            onBack={() => navigate('/notebook')}
          />
        )}
      </section>
      {selected && (
        <AttachPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          note={selected}
          notes={data.notes}
          ctx={ctx}
          onPick={(target) => pick(selected, target)}
        />
      )}
    </div>
  )
}
