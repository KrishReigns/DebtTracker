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
  personal:  'from-indigo-50 to-indigo-100/40',
  home:      'from-emerald-50 to-emerald-100/40',
  vehicle:   'from-sky-50 to-sky-100/40',
  education: 'from-violet-50 to-violet-100/40',
  business:  'from-amber-50 to-amber-100/40',
  gold:      'from-yellow-50 to-yellow-100/40',
  credit:    'from-rose-50 to-rose-100/40',
  family:    'from-teal-50 to-teal-100/40',
  other:     'from-slate-50 to-slate-100/40',
}

export default function LoanCard({ loan, summary }: Props) {
  const { paidCount, totalCount, remainingPrincipal, nextEMI, nextDueDate, accruedInterest, isClosed } = summary
  const isFlexible = loan.repayment_mode === 'flexible_manual'
  const isCls = loan.status !== 'active'
  const progress = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0
  const accentColor = LOAN_TYPE_COLORS[loan.loan_type] ?? '#6366f1'
  const bgGradient = LOAN_TYPE_BG[loan.loan_type] ?? LOAN_TYPE_BG.other
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

        <div className="px-4 pt-3 pb-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-slate-800 text-base leading-tight truncate group-hover:text-indigo-700 transition-colors">
                {loan.lender_name}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">{LOAN_TYPE_LABELS[loan.loan_type]}</p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[statusKey].badge}`}>
                {loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}
              </span>
              <span className="text-xs text-slate-400 font-medium">{loan.currency}</span>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-slate-200/70" />

          {/* Body */}
          {isCls ? (
            // --- CLOSED LOAN (any repayment mode) ---
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400 text-xs">Taken</span>
                <span className="text-slate-600 text-xs">{formatDate(takenDate)}</span>
              </div>
              <div className="flex items-center justify-center py-2">
                <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-4 py-2">
                  <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-semibold text-slate-600">Settled &amp; Closed</span>
                </div>
              </div>
            </div>

          ) : isFlexible ? (
            // --- ACTIVE FLEXIBLE LOAN ---
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Taken</span>
                <span className="text-slate-600">{formatDate(takenDate)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">Outstanding</span>
                <span className={`text-base font-bold ${NUM_COLORS.outstanding}`}>
                  {formatCurrency(remainingPrincipal, loan.currency)}
                </span>
              </div>
              {(accruedInterest ?? 0) > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">Accrued Interest</span>
                  <span className={`text-sm font-semibold ${NUM_COLORS.interest}`}>
                    {formatCurrency(accruedInterest!, loan.currency)}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center bg-white/70 rounded-lg px-2.5 py-1.5 border border-slate-200/60">
                <span className="text-sm text-slate-500 font-medium">Total Payable</span>
                <span className={`text-sm font-bold ${NUM_COLORS.payable}`}>
                  {formatCurrency(remainingPrincipal + (accruedInterest ?? 0), loan.currency)}
                </span>
              </div>
            </div>

          ) : (
            // --- ACTIVE FIXED-EMI LOAN ---
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Taken</span>
                <span className="text-slate-600">{formatDate(takenDate)}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">Remaining</span>
                <span className={`text-base font-bold ${NUM_COLORS.outstanding}`}>
                  {formatCurrency(remainingPrincipal, loan.currency)}
                </span>
              </div>

              {nextEMI !== null && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">Next EMI</span>
                  <span className="text-sm font-semibold text-slate-700">
                    {formatCurrency(nextEMI, loan.currency)}
                  </span>
                </div>
              )}

              {nextDueDate && (
                <div className={`flex justify-between items-center rounded-lg px-2.5 py-1.5 border ${
                  isOverdue
                    ? 'bg-red-50 border-red-200'
                    : 'bg-white/70 border-slate-200/60'
                }`}>
                  <span className={`text-sm font-medium ${isOverdue ? 'text-red-600' : 'text-slate-500'}`}>
                    {isOverdue ? '⚠ Overdue' : 'Due Date'}
                  </span>
                  <span className={`text-sm font-semibold ${isOverdue ? NUM_COLORS.outstanding : 'text-indigo-600'}`}>
                    {formatDate(nextDueDate)}
                  </span>
                </div>
              )}

              {totalCount > 0 && (
                <div className="space-y-1.5 pt-0.5">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{paidCount} of {totalCount} paid</span>
                    <span className={progress === 100 ? 'text-emerald-600 font-semibold' : 'text-slate-500'}>
                      {progress}%
                    </span>
                  </div>
                  <div className="relative h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                      style={{ width: `${progress}%`, backgroundColor: accentColor }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
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
