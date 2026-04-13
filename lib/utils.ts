import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format an ISO date string (YYYY-MM-DD) consistently across the app.
 * Parses as local date to avoid UTC-midnight off-by-one issues.
 * Output: "1 Mar 2027"
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Short date format without year — for compact UI use.
 * Output: "1 Mar"
 */
export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  })
}

/**
 * Month+year only — for payoff date display.
 * Output: "Mar 2027"
 */
export function formatMonthYear(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  })
}

/** Consistent color tokens for status badges and row backgrounds */
export const STATUS_COLORS = {
  paid:    { badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', row: 'bg-emerald-50' },
  partial: { badge: 'bg-amber-100 text-amber-700 border-amber-200',    row: 'bg-amber-50' },
  overdue: { badge: 'bg-red-100 text-red-700 border-red-200',          row: 'bg-red-50' },
  pending: { badge: 'bg-slate-100 text-slate-600 border-slate-200',    row: '' },
  active:  { badge: 'bg-indigo-100 text-indigo-700 border-indigo-200', row: '' },
  closed:  { badge: 'bg-slate-200 text-slate-500 border-slate-300',    row: 'bg-slate-50' },
  paused:  { badge: 'bg-amber-100 text-amber-700 border-amber-200',    row: '' },
} as const

/** Number color tokens */
export const NUM_COLORS = {
  outstanding: 'text-red-600',
  interest:    'text-amber-600',
  principal:   'text-indigo-600',
  payable:     'text-purple-700',
  paid:        'text-emerald-600',
  neutral:     'text-slate-700',
} as const
