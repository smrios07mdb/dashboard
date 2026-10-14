/**
 * Centralized icon vocabulary — lucide-react equivalents of the prototype's
 * `hupomnemata_handoff/app/src/icons.jsx` glyph set. Import icons from here so
 * every screen shares one source.
 *
 * Defaults to the Daylight look: 18px, light 1.6 stroke (matching the prototype
 * icons.jsx). Both are overridable per-usage (`<ChevronRight size={14} strokeWidth={2} />`).
 */
import * as Lucide from 'lucide-react'
import type { LucideIcon, LucideProps } from 'lucide-react'
import { forwardRef } from 'react'

function icon(Base: LucideIcon, name: string) {
  const Wrapped = forwardRef<SVGSVGElement, LucideProps>(function Icon(
    { size = 18, strokeWidth = 1.6, ...props },
    ref,
  ) {
    return <Base ref={ref} size={size} strokeWidth={strokeWidth} {...props} />
  })
  Wrapped.displayName = name
  return Wrapped
}

// Navigation / chevrons
export const ChevronRight = /* @__PURE__ */ icon(Lucide.ChevronRight, 'ChevronRight')
export const ChevronLeft = /* @__PURE__ */ icon(Lucide.ChevronLeft, 'ChevronLeft')
export const ChevronDown = /* @__PURE__ */ icon(Lucide.ChevronDown, 'ChevronDown')
export const ChevronUp = /* @__PURE__ */ icon(Lucide.ChevronUp, 'ChevronUp')
export const ArrowRight = /* @__PURE__ */ icon(Lucide.ArrowRight, 'ArrowRight')
// Actions
export const Plus = /* @__PURE__ */ icon(Lucide.Plus, 'Plus')
export const Minus = /* @__PURE__ */ icon(Lucide.Minus, 'Minus')
export const X = /* @__PURE__ */ icon(Lucide.X, 'X')
export const Check = /* @__PURE__ */ icon(Lucide.Check, 'Check')
export const MoreHorizontal = /* @__PURE__ */ icon(Lucide.MoreHorizontal, 'MoreHorizontal')
export const Trash = /* @__PURE__ */ icon(Lucide.Trash2, 'Trash')
export const GripVertical = /* @__PURE__ */ icon(Lucide.GripVertical, 'GripVertical')
export const Move = /* @__PURE__ */ icon(Lucide.Move, 'Move')
export const RefreshCw = /* @__PURE__ */ icon(Lucide.RefreshCw, 'RefreshCw')
export const Filter = /* @__PURE__ */ icon(Lucide.Filter, 'Filter')
export const ListChecks = /* @__PURE__ */ icon(Lucide.ListChecks, 'ListChecks')
export const ChartColumn = /* @__PURE__ */ icon(Lucide.ChartColumn, 'ChartColumn')
export const Tag = /* @__PURE__ */ icon(Lucide.Tag, 'Tag')
// Status / notification
export const Bell = /* @__PURE__ */ icon(Lucide.Bell, 'Bell')
export const BellRing = /* @__PURE__ */ icon(Lucide.BellRing, 'BellRing')
export const Info = /* @__PURE__ */ icon(Lucide.Info, 'Info')
export const Shield = /* @__PURE__ */ icon(Lucide.Shield, 'Shield')
export const Sparkles = /* @__PURE__ */ icon(Lucide.Sparkles, 'Sparkles')
export const Flame = /* @__PURE__ */ icon(Lucide.Flame, 'Flame')
// Time / calendar
export const Clock = /* @__PURE__ */ icon(Lucide.Clock, 'Clock')
export const Calendar = /* @__PURE__ */ icon(Lucide.Calendar, 'Calendar')
export const Sun = /* @__PURE__ */ icon(Lucide.Sun, 'Sun')
export const Moon = /* @__PURE__ */ icon(Lucide.Moon, 'Moon')
// Search / view / data
export const Search = /* @__PURE__ */ icon(Lucide.Search, 'Search')
export const Eye = /* @__PURE__ */ icon(Lucide.Eye, 'Eye')
export const EyeOff = /* @__PURE__ */ icon(Lucide.EyeOff, 'EyeOff')
export const Upload = /* @__PURE__ */ icon(Lucide.Upload, 'Upload')
export const Download = /* @__PURE__ */ icon(Lucide.Download, 'Download')
export const Link = /* @__PURE__ */ icon(Lucide.Link2, 'Link')
export const User = /* @__PURE__ */ icon(Lucide.User, 'User')
// `Gear`, not `Settings`, so it can't collide with the Settings screen import.
export const Gear = /* @__PURE__ */ icon(Lucide.Settings, 'Gear')
// Notebook (chunk 58)
export const BookOpen = /* @__PURE__ */ icon(Lucide.BookOpen, 'BookOpen')
export const Pin = /* @__PURE__ */ icon(Lucide.Pin, 'Pin')
export const Unlink = /* @__PURE__ */ icon(Lucide.Unlink, 'Unlink')
// Note glyph (chunk 59): task rows, list headers, planner blocks
export const Note = /* @__PURE__ */ icon(Lucide.StickyNote, 'Note')
