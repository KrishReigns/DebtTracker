'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { markScheduleRowUnpaid, syncLoanStatus } from '@/lib/loan-actions'
import {
  computeFamilyLoanState, buildFlexiblePlanner,
  formatCurrency, totalInterestCost,
} from '@/lib/calculations'
import { LOAN_TYPE_COLORS } from '@/lib/types'
import type { Loan, PaymentSchedule, PaymentTransaction, PaymentPlanRow } from '@/lib/types'
import { formatDate, formatMonthYear, STATUS_COLORS, NUM_COLORS } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import RecordPaymentModal from './RecordPaymentModal'
import EditPaymentModal from './EditPaymentModal'

interface Props {
  loan: Loan
  scheduleRows: PaymentSchedule[]
  transactions: PaymentTransaction[]
  planRows: PaymentPlanRow[]
}

export default function LoanDetailClient({ loan, scheduleRows, transactions, planRows }: Props) {
  const router = useRouter()
  const [recordModal, setRecordModal] = useState<{ open: boolean; scheduleRow?: PaymentSchedule }>({ open: false })
  const [editModal, setEditModal] = useState<{ open: boolean; transaction?: PaymentTransaction }>({ open: false })
  const [actionId, setActionId] = useState<string | null>(null)
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [closeError, setCloseError] = useState('')
  // Controlled state for planned pay date inputs — avoids uncontrolled→controlled warning
  const [plannedDates, setPlannedDates] = useState<Record<string, string>>(
    () => Object.fromEntries(scheduleRows.map(r => [r.id, r.planned_pay_date ?? '']))
  )
  // Sync when scheduleRows refresh from server (after router.refresh)
  useEffect(() => {
    setPlannedDates(Object.fromEntries(scheduleRows.map(r => [r.id, r.planned_pay_date ?? ''])))
  }, [scheduleRows])
  // Which row's planned date is currently in edit mode
  const [editingDateRowId, setEditingDateRowId] = useState<string | null>(null)

  const isFlexible = loan.repayment_mode === 'flexible_manual'
  const today = new Date().toISOString().split('T')[0]
  const color = LOAN_TYPE_COLORS[loan.loan_type]
  const sortedTx = [...transactions].sort((a, b) => a.payment_date.localeCompare(b.payment_date))

  const takenDate = loan.disbursement_date ?? loan.start_date

  // ── Fixed-EMI helpers ──────────────────────────────────────────────────────
  const paidRows = scheduleRows.filter(r => r.status === 'paid')
  const partialRows = scheduleRows.filter(r => r.status === 'partial')
  const pendingRows = scheduleRows.filter(r => r.status !== 'paid' && r.status !== 'skipped')
  const paidCount = paidRows.length
  const totalRows = scheduleRows.length
  const progress = totalRows > 0 ? Math.round((paidCount / totalRows) * 100) : 0

  const totalPaidFixedEMI = transactions.reduce((s, t) => s + t.amount, 0)
  const remainingPrincipalFixedEMI = pendingRows[0]?.opening_balance ?? 0

  const totalInterestFixedEMI = totalInterestCost(
    scheduleRows.map(r => ({
      month: r.installment_number, date: r.contractual_due_date,
      openingBalance: r.opening_balance, emi: r.emi_amount,
      interest: r.interest_amount, principal: r.principal_amount, closingBalance: r.closing_balance,
    }))
  )
  const payoffDateFixedEMI = scheduleRows[scheduleRows.length - 1]?.contractual_due_date ?? ''

  const chartData = scheduleRows.slice(0, 24).map(r => ({
    month: r.contractual_due_date.slice(0, 7),
    Interest: Math.round(r.interest_amount),
    Principal: Math.round(r.principal_amount),
  }))

  // ── Flexible helpers ────────────────────────────────────────────────────────
  const familyState = isFlexible
    ? computeFamilyLoanState(loan.principal, loan.interest_rate, loan.start_date, sortedTx, today)
    : null

  const planner = isFlexible
    ? buildFlexiblePlanner(familyState!.outstandingPrincipal, loan.interest_rate, today, planRows, transactions)
    : []

  // ── Status badge ───────────────────────────────────────────────────────────
  const statusLabel = loan.status === 'closed' ? 'Closed'
    : loan.status === 'paused' ? 'Paused'
    : partialRows.length > 0 ? 'Has Partial'
    : 'Active'
  const statusColorKey = loan.status === 'closed' ? 'closed'
    : loan.status === 'paused' ? 'paused'
    : partialRows.length > 0 ? 'partial'
    : 'active'

  // ── Mark unpaid ─────────────────────────────────────────────────────────────
  async function handleMarkUnpaid(row: PaymentSchedule) {
    setActionId(row.id)
    const supabase = createClient()
    await markScheduleRowUnpaid(loan.id, row.id, row.contractual_due_date, supabase)
    router.refresh()
    setActionId(null)
  }

  // ── Smart close/reopen ─────────────────────────────────────────────────────
  async function handleCloseReopen() {
    const supabase = createClient()

    if (loan.status !== 'active') {
      // Reopening is always safe
      await supabase.from('loans').update({ status: 'active' }).eq('id', loan.id)
      setCloseConfirm(false)
      router.refresh()
      return
    }

    // Validate before closing
    if (!isFlexible) {
      const unpaid = scheduleRows.filter(r => r.status !== 'paid' && r.status !== 'skipped')
      if (unpaid.length > 0) {
        if (!closeConfirm) {
          setCloseError(
            `${unpaid.length} installment(s) are not yet paid. ` +
            `Close anyway? They will be marked as skipped.`
          )
          setCloseConfirm(true)
          return
        }
        // Force close: mark remaining rows as skipped
        for (const row of unpaid) {
          await supabase.from('payment_schedules')
            .update({ status: 'skipped' })
            .eq('id', row.id)
          await supabase.from('payments')
            .update({ status: 'overdue' })
            .eq('loan_id', loan.id)
            .eq('due_date', row.contractual_due_date)
        }
      }
    } else if (familyState && familyState.outstandingPrincipal > 0.01) {
      if (!closeConfirm) {
        setCloseError(
          `Outstanding balance: ${formatCurrency(familyState.outstandingPrincipal, loan.currency)}. Close anyway?`
        )
        setCloseConfirm(true)
        return
      }
    }

    await supabase.from('loans').update({ status: 'closed' }).eq('id', loan.id)
    setCloseConfirm(false)
    setCloseError('')
    router.refresh()
  }

  // ── Plan row CRUD ─────────────────────────────────────────────────────────
  async function addPlanRow() {
    const supabase = createClient()
    await supabase.from('payment_plan_rows').insert({ loan_id: loan.id, sort_order: planRows.length })
    router.refresh()
  }

  async function updatePlanRow(id: string, field: 'planned_date' | 'planned_amount' | 'note', value: string) {
    const supabase = createClient()
    await supabase.from('payment_plan_rows').update({ [field]: value || null }).eq('id', id)
    router.refresh()
  }

  async function deletePlanRow(id: string) {
    const supabase = createClient()
    await supabase.from('payment_plan_rows').delete().eq('id', id)
    router.refresh()
  }

  async function updatePlannedPayDate(rowId: string, date: string) {
    const supabase = createClient()
    await supabase.from('payment_schedules').update({ planned_pay_date: date || null }).eq('id', rowId)
    router.refresh()
  }

  return (
    <div className="space-y-5">

      {/* ── Loan metadata header ─────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-x-6 gap-y-3 items-start">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Status</p>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[statusColorKey].badge}`}>
                {statusLabel}
              </span>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Loan Taken</p>
              <p className="text-sm font-medium text-slate-800">{formatDate(takenDate)}</p>
            </div>
            {!isFlexible && loan.first_emi_date && (
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">First EMI</p>
                <p className="text-sm font-medium text-slate-800">{formatDate(loan.first_emi_date)}</p>
              </div>
            )}
            {loan.account_number && (
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Account / Agreement</p>
                <p className="text-sm font-mono font-medium text-slate-700">{loan.account_number}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Rate</p>
              <p className="text-sm font-medium text-slate-800">{loan.interest_rate}% p.a. · {loan.interest_type}</p>
            </div>
            {loan.tenure_months && (
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Tenure</p>
                <p className="text-sm font-medium text-slate-800">{loan.tenure_months} months</p>
              </div>
            )}
            <div className="w-full sm:w-auto sm:ml-auto flex flex-col items-start sm:items-end gap-1">
              {closeError && closeConfirm && (
                <p className="text-xs text-amber-600 max-w-xs text-right">{closeError}</p>
              )}
              <div className="flex gap-2">
                {closeConfirm && (
                  <Button size="sm" variant="outline" className="text-xs h-9" onClick={() => { setCloseConfirm(false); setCloseError('') }}>
                    Cancel
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={closeConfirm ? 'destructive' : 'outline'}
                  className="text-xs h-9"
                  onClick={handleCloseReopen}
                >
                  {loan.status === 'active'
                    ? closeConfirm ? 'Confirm Close' : 'Mark Closed'
                    : 'Reactivate'}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Principal</p>
            <p className={`text-xl font-bold mt-1 ${NUM_COLORS.neutral}`}>{formatCurrency(loan.principal, loan.currency)}</p>
          </CardContent>
        </Card>

        {isFlexible ? (
          <>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Outstanding</p>
                <p className={`text-xl font-bold mt-1 ${NUM_COLORS.outstanding}`}>{formatCurrency(familyState!.outstandingPrincipal, loan.currency)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Accrued Interest</p>
                <p className={`text-xl font-bold mt-1 ${NUM_COLORS.interest}`}>{formatCurrency(familyState!.accruedInterest, loan.currency)}</p>
                <p className="text-xs text-slate-400 mt-0.5">as of today</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Total Payable Now</p>
                <p className={`text-xl font-bold mt-1 ${NUM_COLORS.payable}`}>{formatCurrency(familyState!.totalPayable, loan.currency)}</p>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Remaining Principal</p>
                <p className={`text-xl font-bold mt-1 ${NUM_COLORS.outstanding}`}>{formatCurrency(remainingPrincipalFixedEMI, loan.currency)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Total Interest Cost</p>
                <p className={`text-xl font-bold mt-1 ${NUM_COLORS.interest}`}>{formatCurrency(totalInterestFixedEMI, loan.currency)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Payoff Date</p>
                <p className={`text-xl font-bold mt-1 ${NUM_COLORS.paid}`}>{formatMonthYear(payoffDateFixedEMI)}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* ── Insights panel (fixed-EMI only) ───────────────────────────────────── */}
      {!isFlexible && totalRows > 0 && loan.status === 'active' && (
        <Card className="border-indigo-100 bg-indigo-50/40">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-3">💡 Loan Insights</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-slate-500">Total Cost of Loan</p>
                <p className="text-base font-bold text-slate-800 mt-0.5">
                  {formatCurrency(loan.principal + totalInterestFixedEMI, loan.currency)}
                </p>
                <p className="text-xs text-slate-400">principal + interest</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Interest Paid So Far</p>
                <p className="text-base font-bold text-red-500 mt-0.5">
                  {formatCurrency(
                    scheduleRows.filter(r => r.status === 'paid').reduce((s, r) => s + r.interest_amount, 0),
                    loan.currency
                  )}
                </p>
                <p className="text-xs text-slate-400">of {formatCurrency(totalInterestFixedEMI, loan.currency)} total</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Interest Remaining</p>
                <p className="text-base font-bold text-orange-500 mt-0.5">
                  {formatCurrency(
                    scheduleRows.filter(r => r.status !== 'paid').reduce((s, r) => s + r.interest_amount, 0),
                    loan.currency
                  )}
                </p>
                <p className="text-xs text-slate-400">still to be paid</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Prepay ₹1L → Save</p>
                <p className="text-base font-bold text-emerald-600 mt-0.5">
                  {formatCurrency(
                    Math.round((remainingPrincipalFixedEMI > 100000
                      ? scheduleRows.filter(r => r.status !== 'paid').reduce((s, r) => s + r.interest_amount, 0) *
                        (100000 / remainingPrincipalFixedEMI)
                      : 0)),
                    loan.currency
                  )}
                </p>
                <p className="text-xs text-slate-400">approx. interest saved</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Progress bar (fixed-EMI) ────────────────────────────────────────── */}
      {!isFlexible && totalRows > 0 && (
        <Card>
          <CardContent className="pt-4 pb-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">
                {paidCount} of {totalRows} EMIs paid
                {partialRows.length > 0 && <span className="ml-2 text-amber-600">· {partialRows.length} partial</span>}
              </span>
              <span className="font-semibold text-slate-700">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" style={{ '--progress-foreground': color } as React.CSSProperties} />
            <div className="flex justify-between text-xs text-slate-400">
              <span>Paid: <span className={NUM_COLORS.paid}>{formatCurrency(totalPaidFixedEMI, loan.currency)}</span></span>
              <span>Remaining: <span className={NUM_COLORS.outstanding}>{formatCurrency(remainingPrincipalFixedEMI, loan.currency)}</span></span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Flexible: payment history ───────────────────────────────────────── */}
      {isFlexible && (
        <Card>
          <CardContent className="pt-4 space-y-1">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <span className="font-medium text-sm text-slate-700">Payment History</span>
              <span className="text-xs text-slate-400">{transactions.length} payments · {formatCurrency(familyState!.totalPaid, loan.currency)} total</span>
            </div>
            {sortedTx.length === 0 && <p className="text-sm text-slate-400 py-3 text-center">No payments recorded yet.</p>}
            {sortedTx.map(tx => (
              <div key={tx.id} className="flex justify-between items-start py-2 border-b border-slate-50 last:border-0">
                <div>
                  <span className="text-sm font-medium text-slate-800">{formatDate(tx.payment_date)}</span>
                  {tx.payment_method && <span className="text-slate-400 ml-2 text-xs">{tx.payment_method}</span>}
                  {tx.note && <p className="text-xs text-slate-400">{tx.note}</p>}
                  <p className="text-xs text-slate-400 mt-0.5">
                    P: <span className={NUM_COLORS.principal}>{formatCurrency(tx.principal_applied ?? 0, loan.currency)}</span>
                    {' · '}
                    I: <span className={NUM_COLORS.interest}>{formatCurrency(tx.interest_applied ?? 0, loan.currency)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <p className={`font-semibold text-sm ${NUM_COLORS.paid}`}>{formatCurrency(tx.amount, loan.currency)}</p>
                  {loan.status === 'active' && (
                    <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => setEditModal({ open: true, transaction: tx })}>
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {loan.status === 'active' && (
              <Button className="w-full mt-2" onClick={() => setRecordModal({ open: true })}>
                + Record Payment
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Chart ───────────────────────────────────────────────────────────── */}
      {!isFlexible && chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">Principal vs Interest (first 24 months)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barSize={8}>
                <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={5} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v), loan.currency)} />
                <Legend />
                <Bar dataKey="Principal" fill="#6366f1" />
                <Bar dataKey="Interest" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Upcoming payments (active fixed-EMI only) ───────────────────────── */}
      {!isFlexible && pendingRows.length > 0 && loan.status === 'active' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm text-slate-700">Upcoming Payments</CardTitle>
            <Button size="sm" onClick={() => setRecordModal({ open: true, scheduleRow: pendingRows[0] })}>
              Pay Next EMI
            </Button>
          </CardHeader>
          <CardContent className="space-y-0 divide-y divide-slate-100">
            {pendingRows.slice(0, 5).map(row => {
              const isOverdue = row.contractual_due_date < today
              const isPartial = row.status === 'partial'
              const alreadyPaid = transactions.filter(t => t.schedule_row_id === row.id).reduce((s, t) => s + t.amount, 0)
              return (
                <div key={row.id} className={`flex items-center justify-between py-3 ${isOverdue ? 'bg-red-50 -mx-6 px-6' : ''}`}>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <span>#{row.installment_number}</span>
                      <span className="text-slate-400">·</span>
                      <span>{formatDate(row.contractual_due_date)}</span>
                      {isOverdue && <span className={`text-xs font-normal px-1.5 py-0.5 rounded ${STATUS_COLORS.overdue.badge}`}>Overdue</span>}
                      {isPartial && <span className={`text-xs font-normal px-1.5 py-0.5 rounded ${STATUS_COLORS.partial.badge}`}>Partial · {formatCurrency(alreadyPaid, loan.currency)} paid</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      P: {formatCurrency(row.principal_amount, loan.currency)} · I: {formatCurrency(row.interest_amount, loan.currency)}
                    </p>
                    {row.planned_pay_date && (
                      <p className="text-xs text-indigo-400 mt-0.5">Planned: {formatDate(row.planned_pay_date)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold text-sm ${isOverdue ? NUM_COLORS.outstanding : NUM_COLORS.neutral}`}>{formatCurrency(row.emi_amount, loan.currency)}</span>
                    <Button
                      size="sm"
                      variant={isOverdue ? 'destructive' : 'outline'}
                      disabled={actionId === row.id}
                      onClick={() => setRecordModal({ open: true, scheduleRow: row })}
                      className="text-xs h-7"
                    >
                      {isPartial ? 'Pay Rest' : 'Pay'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Flexible planner ─────────────────────────────────────────────────── */}
      {isFlexible && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-slate-700">Repayment Planner</CardTitle>
            {loan.status === 'active' && (
              <Button size="sm" variant="outline" onClick={addPlanRow}>+ Add Row</Button>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {planRows.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No plan rows yet. Add rows to forecast your repayment.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b">
                    <th className="text-left pb-2 pr-3 font-medium">#</th>
                    <th className="text-left pb-2 pr-3 font-medium">Planned Date</th>
                    <th className="text-right pb-2 pr-3 font-medium">Opening</th>
                    <th className="text-right pb-2 pr-3 font-medium">Payment</th>
                    <th className="text-right pb-2 pr-3 font-medium">Interest</th>
                    <th className="text-right pb-2 pr-3 font-medium">Principal</th>
                    <th className="text-right pb-2 pr-3 font-medium">Closing</th>
                    <th className="text-center pb-2 font-medium">Status</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {planner.map((row, i) => {
                    const planRow = planRows[i]
                    if (i > 0 && planner[i - 1].closingBalance <= 0.01) return null
                    return (
                      <tr key={planRow.id} className={`border-b border-slate-50 ${row.isPaid ? STATUS_COLORS.paid.row : ''}`}>
                        <td className="py-1.5 pr-3 text-slate-400">{row.index}</td>
                        <td className="py-1.5 pr-3">
                          <Input
                            type="date" className="h-7 text-xs w-32"
                            defaultValue={planRow.planned_date ?? ''}
                            onBlur={e => updatePlanRow(planRow.id, 'planned_date', e.target.value)}
                          />
                        </td>
                        <td className={`py-1.5 pr-3 text-right ${NUM_COLORS.neutral}`}>{formatCurrency(row.openingBalance, loan.currency)}</td>
                        <td className="py-1.5 pr-3 text-right">
                          <Input
                            type="number" className="h-7 text-xs w-24 text-right"
                            defaultValue={planRow.planned_amount ?? ''}
                            onBlur={e => updatePlanRow(planRow.id, 'planned_amount', e.target.value)}
                          />
                        </td>
                        <td className={`py-1.5 pr-3 text-right ${NUM_COLORS.interest}`}>{formatCurrency(row.interestApplied, loan.currency)}</td>
                        <td className={`py-1.5 pr-3 text-right ${NUM_COLORS.principal}`}>{formatCurrency(row.principalApplied, loan.currency)}</td>
                        <td className={`py-1.5 pr-3 text-right ${NUM_COLORS.neutral}`}>{formatCurrency(row.closingBalance, loan.currency)}</td>
                        <td className="py-1.5 text-center">
                          {row.isPaid
                            ? <span className={`text-xs font-medium ${NUM_COLORS.paid}`}>✓ Paid</span>
                            : <span className="text-slate-400 text-xs">Planned</span>
                          }
                        </td>
                        <td className="py-1.5 pl-2">
                          <button className="text-slate-300 hover:text-red-400 text-xs" onClick={() => deletePlanRow(planRow.id)}>✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Full schedule (fixed-EMI) ─────────────────────────────────────────── */}
      {!isFlexible && scheduleRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-700">Full Amortization Schedule</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b font-medium">
                  <th className="text-left pb-2 pr-3">#</th>
                  <th className="text-left pb-2 pr-3">Due Date</th>
                  <th className="text-left pb-2 pr-3">Paid / Planned</th>
                  <th className="text-right pb-2 pr-3">EMI</th>
                  <th className="text-right pb-2 pr-3">Interest</th>
                  <th className="text-right pb-2 pr-3">Principal</th>
                  <th className="text-right pb-2 pr-3">Balance</th>
                  <th className="text-center pb-2 pl-3">Status</th>
                  <th className="pb-2 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {scheduleRows.map(row => {
                  const isPaid = row.status === 'paid'
                  const isPartialRow = row.status === 'partial'
                  const isSkipped = row.status === 'skipped'
                  const isOverdue = !isPaid && !isPartialRow && !isSkipped && row.contractual_due_date < today
                  const rowTxTotal = transactions.filter(t => t.schedule_row_id === row.id).reduce((s, t) => s + t.amount, 0)

                  const rowBg = isPaid ? STATUS_COLORS.paid.row
                    : isPartialRow ? STATUS_COLORS.partial.row
                    : isOverdue ? STATUS_COLORS.overdue.row
                    : isSkipped ? STATUS_COLORS.closed.row
                    : ''

                  return (
                    <tr key={row.id} className={`border-b border-slate-50 ${rowBg}`}>
                      <td className="py-1.5 pr-3 text-slate-400">{row.installment_number}</td>
                      <td className="py-1.5 pr-3 text-slate-700">{formatDate(row.contractual_due_date)}</td>
                      <td className="py-1.5 pr-3">
                        {isPaid || isSkipped ? (
                          // Paid/skipped: show formatted date read-only
                          <span className={`text-xs ${NUM_COLORS.paid}`}>{formatDate(row.planned_pay_date)}</span>
                        ) : editingDateRowId === row.id || !plannedDates[row.id] ? (
                          // Edit mode OR no date set yet: show native date picker
                          <Input
                            type="date"
                            autoFocus={editingDateRowId === row.id}
                            className="h-7 text-xs w-32 border-dashed border-slate-300 px-1.5"
                            value={plannedDates[row.id] ?? ''}
                            onChange={e => setPlannedDates(prev => ({ ...prev, [row.id]: e.target.value }))}
                            onBlur={e => {
                              const val = e.target.value
                              setEditingDateRowId(null)
                              if (val !== (row.planned_pay_date ?? '')) {
                                updatePlannedPayDate(row.id, val)
                              }
                            }}
                          />
                        ) : (
                          // Display mode: show formatted date, click to edit
                          <button
                            type="button"
                            className="text-xs text-indigo-600 hover:underline hover:text-indigo-800 transition-colors"
                            onClick={() => setEditingDateRowId(row.id)}
                          >
                            {formatDate(plannedDates[row.id])}
                          </button>
                        )}
                      </td>
                      <td className={`py-1.5 pr-3 text-right font-medium ${NUM_COLORS.neutral}`}>{formatCurrency(row.emi_amount, loan.currency)}</td>
                      <td className={`py-1.5 pr-3 text-right ${NUM_COLORS.interest}`}>{formatCurrency(row.interest_amount, loan.currency)}</td>
                      <td className={`py-1.5 pr-3 text-right ${NUM_COLORS.principal}`}>{formatCurrency(row.principal_amount, loan.currency)}</td>
                      <td className={`py-1.5 pr-3 text-right ${NUM_COLORS.neutral}`}>{formatCurrency(row.closing_balance, loan.currency)}</td>
                      <td className="py-1.5 pl-3 text-center">
                        {isPaid ? (
                          <span className={`text-xs font-medium ${NUM_COLORS.paid}`}>✓ Paid</span>
                        ) : isSkipped ? (
                          <span className="text-xs text-slate-400">Skipped</span>
                        ) : isPartialRow ? (
                          <span className={`text-xs font-medium ${NUM_COLORS.interest}`}>Partial ({formatCurrency(rowTxTotal, loan.currency)})</span>
                        ) : isOverdue ? (
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_COLORS.overdue.badge}`}>Overdue</span>
                        ) : (
                          <span className="text-slate-400 text-xs">Pending</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-2">
                        {loan.status === 'active' && (
                          isPaid ? (
                            <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-amber-600 border-amber-200 hover:bg-amber-50" disabled={actionId === row.id} onClick={() => handleMarkUnpaid(row)}>
                              Undo
                            </Button>
                          ) : isSkipped ? null : (
                            <Button size="sm" variant={isOverdue ? 'destructive' : 'outline'} className="h-6 text-xs px-2" disabled={actionId === row.id} onClick={() => setRecordModal({ open: true, scheduleRow: row })}>
                              Pay
                            </Button>
                          )
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <RecordPaymentModal loan={loan} open={recordModal.open} onClose={() => setRecordModal({ open: false })} scheduleRow={recordModal.scheduleRow} transactions={transactions} />
      {editModal.transaction && (
        <EditPaymentModal loan={loan} transaction={editModal.transaction} open={editModal.open} onClose={() => setEditModal({ open: false })} />
      )}
    </div>
  )
}
