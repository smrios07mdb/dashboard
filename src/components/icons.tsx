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
export const ChevronRight = icon(Lucide.ChevronRight, 'ChevronRight')
export const ChevronLeft = icon(Lucide.ChevronLeft, 'ChevronLeft')
export const ChevronDown = icon(Lucide.ChevronDown, 'ChevronDown')
export const ChevronUp = icon(Lucide.ChevronUp, 'ChevronUp')
export const ArrowRight = icon(Lucide.ArrowRight, 'ArrowRight')
// Actions
export const Plus = icon(Lucide.Plus, 'Plus')
export const Minus = icon(Lucide.Minus, 'Minus')
export const X = icon(Lucide.X, 'X')
export const Check = icon(Lucide.Check, 'Check')
export const MoreHorizontal = icon(Lucide.MoreHorizontal, 'MoreHorizontal')
export const Trash = icon(Lucide.Trash2, 'Trash')
export const GripVertical = icon(Lucide.GripVertical, 'GripVertical')
export const Move = icon(Lucide.Move, 'Move')
export const RefreshCw = icon(Lucide.RefreshCw, 'RefreshCw')
export const Filter = icon(Lucide.Filter, 'Filter')
export const Tag = icon(Lucide.Tag, 'Tag')
// Status / notification
export const Bell = icon(Lucide.Bell, 'Bell')
export const BellRing = icon(Lucide.BellRing, 'BellRing')
export const Info = icon(Lucide.Info, 'Info')
export const Shield = icon(Lucide.Shield, 'Shield')
export const Sparkles = icon(Lucide.Sparkles, 'Sparkles')
export const Flame = icon(Lucide.Flame, 'Flame')
// Time / calendar
export const Clock = icon(Lucide.Clock, 'Clock')
export const Calendar = icon(Lucide.Calendar, 'Calendar')
export const Sun = icon(Lucide.Sun, 'Sun')
export const Moon = icon(Lucide.Moon, 'Moon')
// Search / view / data
export const Search = icon(Lucide.Search, 'Search')
export const Eye = icon(Lucide.Eye, 'Eye')
export const EyeOff = icon(Lucide.EyeOff, 'EyeOff')
export const Upload = icon(Lucide.Upload, 'Upload')
export const Download = icon(Lucide.Download, 'Download')
export const Link = icon(Lucide.Link2, 'Link')
export const User = icon(Lucide.User, 'User')
