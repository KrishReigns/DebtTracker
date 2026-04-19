'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { markScheduleRowUnpaid } from '@/lib/loan-actions'
import { computeFamilyLoanState, formatCurrency } from '@/lib/calculations'
import { LOAN_TYPE_LABELS } from '@/lib/types'
import type { Loan, PaymentSchedule, PaymentTransaction } from '@/lib/types'
import { formatDate, STATUS_COLORS, NUM_COLORS } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import RecordPaymentModal from '@/components/loans/RecordPaymentModal'

interface Props {
  loans: Loan[]
  schedules: PaymentSchedule[]
  transactions: PaymentTransaction[]
}

type Filter = 'all' | 'overdue' | 'pending' | 'paid' | 'closed'

export default function PaymentsClient({ loans, schedules, transactions }: Props) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')
  const [loanFilter, setLoanFilter] = useState('all')
  const [actionId, setActionId] = useState<string | null>(null)
  const [recordModal, setRecordModal] = useState<{ open: boolean; scheduleRow?: PaymentSchedule; loan?: Loan }>({ open: false })

  const today = new Date().toISOString().split('T')[0]
  const loanMap = Object.fromEntries(loans.map(l => [l.id, l]))

  const activeLoans = loans.filter(l => l.status === 'active')
  const closedLoans = loans.filter(l => l.status !== 'active')

  // ── Enriched schedule rows ─────────────────────────────────────────────────
  const enrichedSchedule = schedules.map(s => {
    const loan = loanMap[s.loan_id]
    const computedStatus = s.status === 'paid' ? 'paid'
      : s.status === 'partial' ? 'partial'
      : s.status === 'skipped' ? 'skipped'
      : s.contractual_due_date < today ? 'overdue'
      : 'pending'
    return { ...s, computedStatus, isClosedLoan: loan?.status !== 'active' }
  })

  // ── Flexible active loans ──────────────────────────────────────────────────
  const flexibleActive = activeLoans.filter(l => l.repayment_mode === 'flexible_manual')
  const flexibleRows = flexibleActive.map(loan => {
    const loanTx = transactions.filter(t => t.loan_id === loan.id).sort((a, b) => a.payment_date.localeCompare(b.payment_date))
    const state = computeFamilyLoanState(loan.principal, loan.interest_rate, loan.start_date, loanTx, today)
    return { loan, state }
  })

  // Closed flexible loans (no fresh accruals — they're settled)
  const flexibleClosed = closedLoans.filter(l => l.repayment_mode === 'flexible_manual')

  // ── Summary counts (active only) ───────────────────────────────────────────
  const active = enrichedSchedule.filter(s => !s.isClosedLoan)
  const overdueCt = active.filter(s => s.computedStatus === 'overdue').length
  const pendingCt = active.filter(s => s.computedStatus === 'pending' || s.computedStatus === 'partial').length
  const paidCt = active.filter(s => s.computedStatus === 'paid').length

  // ── Cutoff for upcoming (next 3 months) ────────────────────────────────────
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() + 3)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  // ── Filter logic ──────────────────────────────────────────────────────────
  const filteredSchedule = enrichedSchedule.filter(s => {
    if (loanFilter !== 'all' && s.loan_id !== loanFilter) return false
    if (filter === 'closed') return s.isClosedLoan
    if (s.isClosedLoan) return false
    if (filter === 'overdue') return s.computedStatus === 'overdue'
    if (filter === 'pending') return s.computedStatus === 'pending' || s.computedStatus === 'partial'
    if (filter === 'paid') return s.computedStatus === 'paid'
    // "All" tab: show everything except far-future pending (beyond 3 months) to keep the list manageable
    // Use "Pending" tab to see all future scheduled payments
    if (filter === 'all') return s.computedStatus !== 'pending' || s.contractual_due_date <= cutoffStr
    return true
  })

  const showFlexible = filter !== 'overdue' && filter !== 'pending' && filter !== 'paid' && filter !== 'closed'
    && (loanFilter === 'all' || loanMap[loanFilter]?.repayment_mode === 'flexible_manual')

  const selectedLoanIsFlexibleClosed = loanFilter !== 'all'
    && loanMap[loanFilter]?.repayment_mode === 'flexible_manual'
    && loanMap[loanFilter]?.status !== 'active'

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleMarkUnpaid(s: PaymentSchedule) {
    setActionId(s.id)
    const supabase = createClient()
    await markScheduleRowUnpaid(s.loan_id, s.id, s.contractual_due_date, supabase)
    router.refresh()
    setActionId(null)
  }

  const filterLabels: Record<Filter, string> = {
    all: 'All', overdue: 'Overdue', pending: 'Pending', paid: 'Paid', closed: 'Closed'
  }

  return (
    <div className="space-y-4">
      {/* ── Summary tiles ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {([
          { key: 'overdue', label: 'Overdue', count: overdueCt, color: 'text-red-600' },
          { key: 'pending', label: 'Pending', count: pendingCt, color: 'text-amber-600' },
          { key: 'paid',    label: 'Paid',    count: paidCt,    color: 'text-emerald-600' },
        ] as const).map(({ key, label, count, color }) => (
          <Card
            key={key}
            className={`cursor-pointer transition-all ${filter === key ? 'ring-2 ring-indigo-400' : 'hover:shadow-sm'}`}
            onClick={() => setFilter(filter === key ? 'all' : key)}
          >
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-slate-500">{label} EMIs</p>
              <p className={`text-2xl font-bold mt-0.5 ${color}`}>{count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm flex-1 sm:flex-none">
          {(['all', 'overdue', 'pending', 'paid', 'closed'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 sm:flex-none px-3 py-2.5 capitalize transition-colors min-h-[44px] ${
                filter === f
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              } ${f !== 'all' ? 'border-l border-slate-200' : ''}`}
            >
              {filterLabels[f]}
            </button>
          ))}
        </div>

        <Select value={loanFilter} onValueChange={v => setLoanFilter(v ?? 'all')}>
          <SelectTrigger className="w-full sm:w-52 h-11 border-slate-200">
            <span className="truncate text-sm text-slate-700">
              {loanFilter === 'all'
                ? 'All Loans'
                : (loans.find(l => l.id === loanFilter)?.lender_name ?? 'All Loans')}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Loans</SelectItem>
            {activeLoans.map(l => (
              <SelectItem key={l.id} value={l.id}>{l.lender_name}</SelectItem>
            ))}
            {closedLoans.length > 0 && (
              <>
                <div className="px-2 pt-2 pb-1 text-xs text-slate-400 font-medium uppercase tracking-wide">Closed</div>
                {closedLoans.map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.lender_name} ✓</SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* ── Flexible active loans ─────────────────────────────────────────── */}
      {showFlexible && flexibleRows.filter(r => loanFilter === 'all' || r.loan.id === loanFilter).length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-2 bg-slate-50 border-b text-xs font-medium text-slate-500 uppercase tracking-wide">
              Flexible / Family Loans — Current Balance
            </div>
            <div className="divide-y divide-slate-100">
              {flexibleRows
                .filter(r => loanFilter === 'all' || r.loan.id === loanFilter)
                .map(({ loan, state }) => (
                  <div key={loan.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{loan.lender_name}</p>
                      <p className="text-xs text-slate-400">{LOAN_TYPE_LABELS[loan.loan_type]} · {loan.interest_rate}% p.a.</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Taken: {formatDate(loan.disbursement_date ?? loan.start_date)}
                        {' · '}Accrued: <span className={NUM_COLORS.interest}>{formatCurrency(state.accruedInterest, loan.currency)}</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${NUM_COLORS.outstanding}`}>{formatCurrency(state.outstandingPrincipal, loan.currency)}</p>
                      <p className="text-xs text-slate-400">outstanding</p>
                      <p className={`text-xs font-medium ${NUM_COLORS.payable}`}>{formatCurrency(state.totalPayable, loan.currency)} payable</p>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Closed flexible loans notice ─────────────────────────────────── */}
      {filter === 'closed' && selectedLoanIsFlexibleClosed && (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-sm text-slate-500">
              <strong>{loanMap[loanFilter]?.lender_name}</strong> is a flexible/family loan — no schedule rows.
            </p>
            <p className="text-xs text-slate-400 mt-1">View full details on the loan page.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Closed section header ─────────────────────────────────────────── */}
      {filter === 'closed' && !selectedLoanIsFlexibleClosed && (
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400 uppercase tracking-wide">
            {closedLoans.length} closed loan(s) · {filteredSchedule.length} schedule rows
          </span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
      )}

      {/* ── Schedule rows ─────────────────────────────────────────────────── */}
      {(filter !== 'closed' || !selectedLoanIsFlexibleClosed) && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100">
              {filteredSchedule.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-slate-400 text-sm">No payments found for this filter.</p>
                  {filter === 'closed' && closedLoans.filter(l => l.repayment_mode === 'flexible_manual').length > 0 && (
                    <p className="text-xs text-slate-400 mt-1">
                      Flexible closed loans ({closedLoans.filter(l => l.repayment_mode === 'flexible_manual').length}) have no schedule rows — view them on their loan page.
                    </p>
                  )}
                </div>
              ) : (
                filteredSchedule.map(s => {
                  const loan = loanMap[s.loan_id]
                  if (!loan) return null
                  const status = s.computedStatus
                  const alreadyPaid = transactions.filter(t => t.schedule_row_id === s.id).reduce((sum, t) => sum + t.amount, 0)

                  const rowBg = status === 'overdue' ? STATUS_COLORS.overdue.row
                    : status === 'paid' ? STATUS_COLORS.paid.row
                    : status === 'partial' ? STATUS_COLORS.partial.row
                    : s.isClosedLoan ? STATUS_COLORS.closed.row
                    : ''

                  return (
                    <div key={s.id} className={`px-4 py-3 ${rowBg}`}>
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-slate-800 truncate">{loan.lender_name}</span>
                            <span className="text-xs text-slate-400">#{s.installment_number}</span>
                            {s.isClosedLoan && (
                              <span className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_COLORS.closed.badge}`}>Closed</span>
                            )}
                            {status === 'overdue' && (
                              <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${STATUS_COLORS.overdue.badge}`}>Overdue</span>
                            )}
                            {status === 'partial' && (
                              <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${STATUS_COLORS.partial.badge}`}>Partial</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5 flex gap-3 flex-wrap">
                            <span>Due: <span className="text-slate-600">{formatDate(s.contractual_due_date)}</span></span>
                            {s.planned_pay_date && status !== 'paid' && (
                              <span>Planned: <span className="text-indigo-500">{formatDate(s.planned_pay_date)}</span></span>
                            )}
                            {status === 'paid' && s.planned_pay_date && (
                              <span>Paid: <span className={NUM_COLORS.paid}>{formatDate(s.planned_pay_date)}</span></span>
                            )}
                          </div>
                          {status === 'partial' && (
                            <p className={`text-xs mt-0.5 ${NUM_COLORS.interest}`}>
                              Paid: {formatCurrency(alreadyPaid, loan.currency)} · Remaining: {formatCurrency(s.emi_amount - alreadyPaid, loan.currency)}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-4">
                          <div className="text-right">
                            <p className={`text-sm font-semibold ${status === 'overdue' ? NUM_COLORS.outstanding : NUM_COLORS.neutral}`}>
                              {formatCurrency(s.emi_amount, loan.currency)}
                            </p>
                            {s.interest_amount > 0 && (
                              <p className={`text-xs ${NUM_COLORS.interest}`}>I: {formatCurrency(s.interest_amount, loan.currency)}</p>
                            )}
                          </div>

                          {status === 'paid' ? (
                            <Button
                              size="sm" variant="outline"
                              className="text-xs h-8 w-24 text-amber-600 border-amber-200 hover:bg-amber-50"
                              onClick={() => handleMarkUnpaid(s)}
                              disabled={actionId === s.id}
                            >
                              {actionId === s.id ? '…' : 'Mark Unpaid'}
                            </Button>
                          ) : status === 'partial' ? (
                            <Button
                              size="sm" variant="outline"
                              className="text-xs h-8 w-24"
                              disabled={actionId === s.id || !!s.isClosedLoan}
                              onClick={() => setRecordModal({ open: true, scheduleRow: s, loan })}
                            >
                              {actionId === s.id ? '…' : 'Pay Remaining'}
                            </Button>
                          ) : s.isClosedLoan ? (
                            <span className="text-xs text-slate-300 w-24 text-center">—</span>
                          ) : (
                            <Button
                              size="sm"
                              variant={status === 'overdue' ? 'destructive' : 'outline'}
                              className="text-xs h-8 w-24"
                              disabled={actionId === s.id}
                              onClick={() => setRecordModal({ open: true, scheduleRow: s, loan })}
                            >
                              {actionId === s.id ? '…' : 'Mark Paid'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {recordModal.loan && (
        <RecordPaymentModal
          loan={recordModal.loan}
          open={recordModal.open}
          onClose={() => setRecordModal({ open: false })}
          scheduleRow={recordModal.scheduleRow}
          transactions={transactions.filter(t => t.loan_id === recordModal.loan?.id)}
        />
      )}
    </div>
  )
}
