import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import LoanCard from '@/components/loans/LoanCard'
import LoansExportButton from '@/components/loans/LoansExportButton'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { computeFamilyLoanState } from '@/lib/calculations'
import { getUserSubscription, isPro } from '@/lib/subscription'
import type { Loan, PaymentSchedule, PaymentTransaction } from '@/lib/types'
import type { LoanCardSummary } from '@/components/loans/LoanCard'
import type { LoansExportRow } from '@/lib/export'

export default async function LoansPage() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const [{ data: loansRaw }, sub] = await Promise.all([
    supabase.from('loans').select('*').order('created_at'),
    getUserSubscription(),
  ])
  const proActive = isPro(sub)
  const loans = (loansRaw ?? []) as Loan[]
  const loanIds = loans.map(l => l.id)

  // Fetch payment schedules for all loans (fixed-EMI data)
  const { data: schedulesRaw } = loanIds.length > 0
    ? await supabase.from('payment_schedules').select('*').in('loan_id', loanIds).order('installment_number')
    : { data: [] }
  const schedules = (schedulesRaw ?? []) as PaymentSchedule[]

  // Fetch transactions for flexible loans
  const flexibleIds = loans.filter(l => l.repayment_mode === 'flexible_manual').map(l => l.id)
  const { data: txRaw } = flexibleIds.length > 0
    ? await supabase.from('payment_transactions').select('*').in('loan_id', flexibleIds).order('payment_date')
    : { data: [] }
  const transactions = (txRaw ?? []) as PaymentTransaction[]

  // Build per-loan summaries
  const summaries: Record<string, LoanCardSummary> = {}

  for (const loan of loans) {
    if (loan.repayment_mode === 'flexible_manual') {
      const loanTx = transactions
        .filter(t => t.loan_id === loan.id)
        .sort((a, b) => a.payment_date.localeCompare(b.payment_date))
      const isClosed = loan.status !== 'active'
      // Don't compute fresh accruals for closed loans — they're settled
      const state = isClosed
        ? { outstandingPrincipal: 0, accruedInterest: 0, totalPaid: 0, principalRepaid: 0, totalPayable: 0 }
        : computeFamilyLoanState(loan.principal, loan.interest_rate, loan.start_date, loanTx, today)
      summaries[loan.id] = {
        paidCount: loanTx.length,
        totalCount: 0,
        remainingPrincipal: state.outstandingPrincipal,
        nextEMI: null,
        nextDueDate: null,
        accruedInterest: state.accruedInterest,
        isClosed,
      }
    } else {
      const rows = schedules.filter(s => s.loan_id === loan.id)
      const paid = rows.filter(r => r.status === 'paid' || r.status === 'skipped')
      const pending = rows.filter(r => r.status !== 'paid' && r.status !== 'skipped')
      const nextRow = pending[0]
      summaries[loan.id] = {
        paidCount: paid.length,
        totalCount: rows.length,
        remainingPrincipal: nextRow?.opening_balance ?? 0,
        nextEMI: nextRow?.emi_amount ?? null,
        nextDueDate: nextRow?.contractual_due_date ?? null,
      }
    }
  }

  const active = loans.filter(l => l.status === 'active')
  const closed = loans.filter(l => l.status !== 'active')

  // Build export data
  const exportData: LoansExportRow[] = loans.map(loan => {
    const summary = summaries[loan.id]
    const isFlexible = loan.repayment_mode === 'flexible_manual'
    let totalPaid = 0
    if (isFlexible) {
      const loanTx = transactions.filter(t => t.loan_id === loan.id)
      totalPaid = loanTx.reduce((sum, t) => sum + t.amount, 0)
    } else {
      const rows = schedules.filter(s => s.loan_id === loan.id)
      totalPaid = rows
        .filter(r => r.status === 'paid' || r.status === 'partial')
        .reduce((sum, r) => sum + r.emi_amount, 0)
    }
    return {
      loan,
      outstandingPrincipal: summary?.remainingPrincipal ?? 0,
      totalPaid,
      scheduleCount: summary?.totalCount ?? 0,
      paidCount: summary?.paidCount ?? 0,
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Loans</h1>
          <p className="text-sm text-gray-500 mt-1">{active.length} active · {closed.length} closed</p>
        </div>
        <div className="flex items-center gap-2">
          <LoansExportButton data={exportData} isPro={proActive} />
          <Link href="/loans/new" className={cn(buttonVariants())}>+ Add Loan</Link>
        </div>
      </div>

      {active.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-3">🏦</div>
          <p className="text-lg font-medium">No loans yet</p>
          <p className="text-sm mt-1">Add your first loan to get started</p>
          <Link href="/loans/new" className={cn(buttonVariants(), 'mt-4')}>Add Loan</Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {active.map(loan => (
          <LoanCard key={loan.id} loan={loan} summary={summaries[loan.id]} />
        ))}
      </div>

      {closed.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">Closed / Paused</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {closed.map(loan => (
              <LoanCard key={loan.id} loan={loan} summary={summaries[loan.id]} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
