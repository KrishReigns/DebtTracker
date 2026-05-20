import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { formatCurrency } from '@/lib/calculations'
import { LOAN_TYPE_LABELS, LOAN_TYPE_COLORS, type Loan } from '@/lib/types'
import { formatDate, STATUS_COLORS, NUM_COLORS } from '@/lib/utils'

export interface LoanCardSummary {
  paidCount: number
  totalCount: number
  remainingPrincipal: number
  nextEMI: number | null
  nextDueDate: string | null
  accruedInterest?: number
  isClosed?: boolean
}

interface Props {
  loan: Loan
  summary: LoanCardSummary
}

const LOAN_TYPE_BG: Record<string, string> = {
  personal_loan: 'from-indigo-50 to-indigo-100/40',
  home_loan:     'from-emerald-50 to-emerald-100/40',
  car_loan:      'from-sky-50 to-sky-100/40',
  student_loan:  'from-violet-50 to-violet-100/40',
  gold_loan:     'from-yellow-50 to-yellow-100/40',
  credit_card:   'from-rose-50 to-rose-100/40',
  family:        'from-teal-50 to-teal-100/40',
}

export default function LoanCard({ loan, summary }: Props) {
  const { paidCount, totalCount, remainingPrincipal, nextEMI, nextDueDate, accruedInterest, isClosed } = summary
  const isFlexible = loan.repayment_mode === 'flexible_manual'
  const isCls = loan.status !== 'active'
  const progress = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0
  const accentColor = LOAN_TYPE_COLORS[loan.loan_type] ?? '#6366f1'
  const bgGradient = LOAN_TYPE_BG[loan.loan_type] ?? 'from-slate-50 to-slate-100/40'
  const takenDate = loan.disbursement_date ?? loan.start_date
  const today = new Date().toISOString().split('T')[0]
  const isOverdue = !isCls && !!nextDueDate && nextDueDate < today

  const statusKey = loan.status === 'closed' ? 'closed'
    : loan.status === 'paused' ? 'paused'
    : 'active'

  return (
    <Link href={`/loans/${loan.id}`} className="block group">
      <div
        className={`
          relative rounded-2xl border border-slate-200/80 bg-gradient-to-br ${bgGradient}
          shadow-sm transition-all duration-300 ease-out overflow-hidden
          group-hover:shadow-lg group-hover:-translate-y-1 group-hover:border-slate-300
          ${isCls ? 'opacity-75 group-hover:opacity-100' : ''}
        `}
      >
        {/* Accent bar on top */}
        <div className="h-1 w-full rounded-t-2xl" style={{ backgroundColor: accentColor }} />

        {/* Overdue pulse ring */}
        {isOverdue && (
          <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
        )}

        <div className="px-4 pt-3 pb-4 flex flex-col gap-3">
          {/* ── Header ── */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-slate-800 text-base leading-tight truncate group-hover:text-indigo-700 transition-colors">
                {loan.lender_name}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{LOAN_TYPE_LABELS[loan.loan_type]}</p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[statusKey].badge}`}>
                {loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}
              </span>
              <span className="text-xs text-slate-400 font-medium">{loan.currency}</span>
            </div>
          </div>

          <div className="border-t border-slate-200/70" />

          {/* ── Body — all three states share the same row structure ── */}
          <div className="space-y-2 flex-1">

            {/* Row 1: Taken date — identical across all states */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400">Taken</span>
              <span className="text-xs text-slate-500 font-medium">{formatDate(takenDate)}</span>
            </div>

            {/* Row 2: Primary amount */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400">
                {isCls ? 'Principal' : isFlexible ? 'Outstanding' : 'Remaining'}
              </span>
              <span className={`text-lg font-bold leading-tight ${
                isCls ? 'text-slate-600' : NUM_COLORS.outstanding
              }`}>
                {formatCurrency(
                  isCls ? loan.principal : remainingPrincipal,
                  loan.currency
                )}
              </span>
            </div>

            {/* Row 3: Secondary info */}
            {isCls ? (
              // Closed: payment count — same label and format for both types
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Payments made</span>
                <span className="text-xs font-semibold text-slate-500">
                  {paidCount > 0 ? paidCount : '—'}
                </span>
              </div>
            ) : isFlexible ? (
              // Flexible active: accrued interest (always show, zero if none)
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Accrued Interest</span>
                <span className={`text-xs font-semibold ${
                  (accruedInterest ?? 0) > 0 ? NUM_COLORS.interest : 'text-slate-400'
                }`}>
                  {formatCurrency(accruedInterest ?? 0, loan.currency)}
                </span>
              </div>
            ) : (
              // Fixed-EMI active: next EMI amount (always show)
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Next EMI</span>
                <span className="text-xs font-semibold text-slate-600">
                  {nextEMI !== null ? formatCurrency(nextEMI, loan.currency) : '—'}
                </span>
              </div>
            )}

            {/* Row 4: Highlighted summary box */}
            {isCls ? (
              // Closed: Settled & Closed
              <div className="flex justify-between items-center bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                <span className="text-xs font-medium text-emerald-700">Settled &amp; Closed</span>
                <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            ) : isFlexible ? (
              // Flexible active: total payable
              <div className="flex justify-between items-center bg-white/70 rounded-lg px-2.5 py-1.5 border border-slate-200/60">
                <span className="text-xs font-medium text-slate-500">Total Payable</span>
                <span className={`text-xs font-bold ${NUM_COLORS.payable}`}>
                  {formatCurrency(remainingPrincipal + (accruedInterest ?? 0), loan.currency)}
                </span>
              </div>
            ) : (
              // Fixed-EMI active: due date
              <div className={`flex justify-between items-center rounded-lg px-2.5 py-1.5 border ${
                isOverdue ? 'bg-red-50 border-red-200' : 'bg-white/70 border-slate-200/60'
              }`}>
                <span className={`text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-slate-500'}`}>
                  {isOverdue ? '⚠ Overdue' : 'Due Date'}
                </span>
                <span className={`text-xs font-semibold ${isOverdue ? NUM_COLORS.outstanding : 'text-indigo-600'}`}>
                  {nextDueDate ? formatDate(nextDueDate) : '—'}
                </span>
              </div>
            )}

            {/* Row 5: Progress bar — all active loans (always rendered so card heights stay equal) */}
            {!isCls && (() => {
              const pct = isFlexible
                ? (loan.principal > 0 ? Math.round(((loan.principal - remainingPrincipal) / loan.principal) * 100) : 0)
                : progress
              const label = isFlexible
                ? `${paidCount} payment${paidCount !== 1 ? 's' : ''} made`
                : `${paidCount} of ${totalCount} paid`
              return (
                <div className="space-y-1 pt-0.5">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{label}</span>
                    <span className={pct === 100 ? 'text-emerald-600 font-semibold' : ''}>{pct}%</span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: accentColor }}
                    />
                  </div>
                </div>
              )
            })()}
          </div>

          {/* ── Footer ── */}
          <div className="flex items-center justify-between text-xs text-slate-400 pt-0.5 border-t border-slate-200/50">
            <span>{loan.interest_rate}% p.a. · {loan.interest_type}</span>
            {loan.account_number && (
              <span className="font-mono text-slate-300">···{loan.account_number.slice(-4)}</span>
            )}
          </div>
        </div>

        {/* Hover shimmer overlay */}
        <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none bg-gradient-to-br from-white/10 to-transparent" />
      </div>
    </Link>
  )
}
