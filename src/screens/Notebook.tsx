import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import AttachPicker, {
  type AttachTarget,
} from '@/components/notebook/AttachPicker'
import NoteEditor from '@/components/notebook/NoteEditor'
import NoteList from '@/components/notebook/NoteList'
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
 * a note that already exists does not delete it.
 */

const SAVE_ERROR = 'Could not save — retry'

type NoteChanges = Partial<
  Pick<
    Note,
    | 'title'
    | 'body'
    | 'pinned'
    | 'taskId'
    | 'subcategoryId'
    | 'detachedLabel'
    | 'detachedAt'
  >
>

type ViewData = {
  notes: Note[]
  categories: Category[]
  subcategories: Subcategory[]
  tasks: Task[]
}

const isBlank = (n: Pick<Note, 'title' | 'body'>) =>
  n.title.trim() === '' && n.body.trim() === ''

export default function Notebook() {
  const { noteId } = useParams<{ noteId?: string }>()
  const navigate = useNavigate()
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
  const [draft, setDraft] = useState<Note | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  /**
   * Unsaved drafts as the save path sees them, by id. State lags a render, and
   * a draft's last keystrokes are flushed as its editor unmounts — by which
   * time New note may already have opened the next one.
   */
  const draftsRef = useRef(new Map<string, Note>())
  /**
   * Notes created here that a refetch has not returned yet. A read that began
   * before the insert landed must not drop the note the user is typing in.
   */
  const createdRef = useRef(new Set<string>())
  /** Writes run one at a time, so an update never overtakes its insert. */
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())

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
      for (const n of notes) createdRef.current.delete(n.id)
      setData((prev) => ({
        notes: [
          ...prev.notes.filter((n) => createdRef.current.has(n.id)),
          ...notes,
        ],
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
  }, [dashboardRefreshKey])

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

  /** Apply one change to one note: the draft, a first insert, or an update. */
  const write = useCallback(
    async (id: string, changes: NoteChanges): Promise<void> => {
      const drafts = draftsRef.current
      const d = drafts.get(id)
      const show = (next: Note | null) =>
        setDraft((cur) => (cur && cur.id === id ? next : cur))
      if (d) {
        const merged: Note = { ...d, ...changes }
        if (isBlank(merged)) {
          drafts.set(id, merged)
          show(merged)
          return
        }
        drafts.delete(id)
        try {
          const created = await repo.notes.create({
            userId: merged.userId,
            id: merged.id,
            title: merged.title,
            body: merged.body,
            pinned: merged.pinned,
            taskId: merged.taskId,
            subcategoryId: merged.subcategoryId,
          })
          createdRef.current.add(created.id)
          setData((prev) => ({ ...prev, notes: [created, ...prev.notes] }))
          show(null)
        } catch (e) {
          drafts.set(id, merged)
          show(merged)
          throw e
        }
        return
      }
      const updated = await repo.notes.update(id, changes)
      setData((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === id ? updated : n)),
      }))
    },
    [],
  )

  const save = useCallback(
    (id: string, changes: NoteChanges): Promise<void> => {
      const run = chainRef.current.then(() => write(id, changes))
      chainRef.current = run.catch(() => undefined)
      return run.catch((e) => {
        console.error('Note save failed', e)
        toast.error(SAVE_ERROR)
        throw e
      })
    },
    [write],
  )

  function newNote() {
    if (!userId) return
    const now = new Date().toISOString()
    const fresh: Note = {
      id: crypto.randomUUID(),
      userId,
      title: '',
      body: '',
      pinned: false,
      taskId: null,
      subcategoryId: null,
      detachedLabel: null,
      detachedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    draftsRef.current.set(fresh.id, fresh)
    setDraft(fresh)
    navigate(`/notebook/${fresh.id}`)
  }

  const attachment = selected ? resolveAttachment(selected, ctx) : null
  const linkedName =
    attachment && attachment.kind !== 'detached' ? attachment.name : null

  function detach(note: Note) {
    const name = linkedName ?? 'its list'
    void save(note.id, { taskId: null, subcategoryId: null }).then(
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
    void save(note.id, {
      taskId: target.kind === 'task' ? target.id : null,
      subcategoryId: target.kind === 'subcategory' ? target.id : null,
      detachedLabel: null,
      detachedAt: null,
    }).then(
      () => toast.success(`Attached to ${target.name}.`),
      () => undefined,
    )
  }

  async function remove(note: Note, isDraft: boolean) {
    if (isDraft) {
      draftsRef.current.delete(note.id)
      setDraft(null)
      navigate('/notebook')
      return
    }
    try {
      // Behind any write still queued for this note.
      await chainRef.current
      await repo.notes.delete(note.id)
      createdRef.current.delete(note.id)
      setData((prev) => ({
        ...prev,
        notes: prev.notes.filter((n) => n.id !== note.id),
      }))
      navigate('/notebook')
      toast.success('Note deleted.')
    } catch (e) {
      console.error('Note delete failed', e)
      toast.error(SAVE_ERROR)
    }
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
            onDelete={() => remove(selected, selectedIsDraft)}
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
