'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { markScheduleRowPaid, syncLoanStatus, recomputeFlexibleAllocations } from '@/lib/loan-actions'
import { computeFamilyLoanState, allocatePayment, formatCurrency } from '@/lib/calculations'
import { formatDate } from '@/lib/utils'
import type { Loan, PaymentTransaction, PaymentSchedule } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  loan: Loan
  open: boolean
  onClose: () => void
  /** For fixed-EMI: the schedule row being paid */
  scheduleRow?: PaymentSchedule
  /** For flexible: existing transactions to compute current state */
  transactions?: PaymentTransaction[]
}

const PAYMENT_METHODS = ['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Online', 'Other']

export default function RecordPaymentModal({ loan, open, onClose, scheduleRow, transactions = [] }: Props) {
  const router = useRouter()
  const today = new Date().toISOString().split('T')[0]
  const isFlexible = loan.repayment_mode === 'flexible_manual'

  // For partial payments: how much has already been paid toward this schedule row?
  const alreadyPaid = scheduleRow
    ? transactions
        .filter(t => t.schedule_row_id === scheduleRow.id)
        .reduce((s, t) => s + t.amount, 0)
    : 0
  const remainingDue = scheduleRow ? Math.max(0, scheduleRow.emi_amount - alreadyPaid) : 0

  const getSuggestedAmount = () => {
    if (scheduleRow) return remainingDue > 0 ? remainingDue.toString() : scheduleRow.emi_amount.toString()
    if (isFlexible) {
      const state = computeFamilyLoanState(
        loan.principal, loan.interest_rate, loan.start_date, transactions, today
      )
      return Math.round(state.totalPayable).toString()
    }
    return ''
  }

  const [form, setForm] = useState({
    payment_date: today,
    amount: getSuggestedAmount(),
    note: '',
    payment_method: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Live allocation preview for flexible loans
  const getPreview = () => {
    if (!isFlexible || !form.amount) return null
    const sortedTx = [...transactions].sort((a, b) => a.payment_date.localeCompare(b.payment_date))
    const state = computeFamilyLoanState(loan.principal, loan.interest_rate, loan.start_date, sortedTx, form.payment_date)
    const { principalApplied, interestApplied, remainingBalance } = allocatePayment(
      state.outstandingPrincipal, state.accruedInterest, parseFloat(form.amount) || 0
    )
    return { principalApplied, interestApplied, remainingBalance, accruedInterest: state.accruedInterest }
  }

  const preview = getPreview()
  const enteredAmount = parseFloat(form.amount) || 0
  const isPartial = scheduleRow && enteredAmount > 0 && enteredAmount < scheduleRow.emi_amount

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) { setError('Enter a valid amount'); return }

    setLoading(true)
    setError('')
    const supabase = createClient()

    if (isFlexible) {
      const sortedTx = [...transactions].sort((a, b) => a.payment_date.localeCompare(b.payment_date))
      const state = computeFamilyLoanState(loan.principal, loan.interest_rate, loan.start_date, sortedTx, form.payment_date)
      const { principalApplied, interestApplied } = allocatePayment(state.outstandingPrincipal, state.accruedInterest, amount)

      const { error: err } = await supabase.from('payment_transactions').insert({
        loan_id: loan.id,
        schedule_row_id: null,
        payment_date: form.payment_date,
        amount,
        principal_applied: principalApplied,
        interest_applied: interestApplied,
        note: form.note || null,
        payment_method: form.payment_method || null,
      })
      if (err) { setError(err.message); setLoading(false); return }
      await recomputeFlexibleAllocations(loan.id, supabase)
      await syncLoanStatus(loan.id, supabase)

    } else if (scheduleRow) {
      // Fixed-EMI: use shared action which handles partial correctly
      await markScheduleRowPaid(
        loan.id,
        scheduleRow.id,
        scheduleRow.contractual_due_date,
        scheduleRow.emi_amount,
        scheduleRow.principal_amount,
        scheduleRow.interest_amount,
        amount,
        form.payment_date,
        form.note || null,
        form.payment_method || null,
        supabase
      )
    } else {
      // Fixed-EMI ad-hoc payment (no specific row)
      const { error: err } = await supabase.from('payment_transactions').insert({
        loan_id: loan.id,
        schedule_row_id: null,
        payment_date: form.payment_date,
        amount,
        note: form.note || null,
        payment_method: form.payment_method || null,
      })
      if (err) { setError(err.message); setLoading(false); return }
      await syncLoanStatus(loan.id, supabase)
    }

    router.refresh()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment — {loan.lender_name}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {scheduleRow && (
            <div className="bg-blue-50 rounded p-3 text-sm space-y-1">
              <p className="font-medium text-blue-800">EMI #{scheduleRow.installment_number}</p>
              <p className="text-blue-600">
                Due: {formatDate(scheduleRow.contractual_due_date)}
              </p>
              <p className="text-blue-600">Full EMI: {formatCurrency(scheduleRow.emi_amount, loan.currency)}</p>
              {alreadyPaid > 0 && (
                <p className="text-orange-600">Already paid: {formatCurrency(alreadyPaid, loan.currency)} · Remaining: {formatCurrency(remainingDue, loan.currency)}</p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="pdate">Payment Date</Label>
            <Input
              id="pdate" type="date" className="mt-1"
              value={form.payment_date}
              onChange={e => set('payment_date', e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="amount">Amount ({loan.currency})</Label>
            <Input
              id="amount" type="number" step="0.01" className="mt-1"
              placeholder="0"
              value={form.amount}
              onChange={e => set('amount', e.target.value)}
              required
            />
            {isPartial && (
              <p className="text-xs text-orange-600 mt-1">
                Partial payment — installment will stay open until {formatCurrency(scheduleRow!.emi_amount, loan.currency)} is fully paid.
              </p>
            )}
          </div>

          {/* Live allocation preview for flexible loans */}
          {isFlexible && preview && enteredAmount > 0 && (
            <div className="bg-gray-50 rounded p-3 text-xs space-y-1">
              <p className="font-medium text-gray-700">Payment Allocation</p>
              <div className="flex justify-between">
                <span className="text-gray-500">Accrued interest</span>
                <span className="text-red-600">{formatCurrency(preview.accruedInterest, loan.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">→ Interest applied</span>
                <span className="text-orange-600">{formatCurrency(preview.interestApplied, loan.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">→ Principal applied</span>
                <span className="text-green-600">{formatCurrency(preview.principalApplied, loan.currency)}</span>
              </div>
              <div className="flex justify-between font-medium border-t border-gray-200 pt-1">
                <span className="text-gray-700">Remaining principal</span>
                <span>{formatCurrency(preview.remainingBalance, loan.currency)}</span>
              </div>
              {preview.remainingBalance <= 0.01 && (
                <p className="text-green-600 font-medium text-center pt-1">
                  This payment will fully settle the loan.
                </p>
              )}
            </div>
          )}

          <div>
            <Label>Payment Method</Label>
            <Select value={form.payment_method} onValueChange={v => set('payment_method', v ?? '')}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select method (optional)" /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea
              id="note" className="mt-1" rows={2}
              placeholder="e.g. Paid via HDFC UPI"
              value={form.note}
              onChange={e => set('note', e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Recording…' : isPartial ? 'Record Partial Payment' : 'Record Payment'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
