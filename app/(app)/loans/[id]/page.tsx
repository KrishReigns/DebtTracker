import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import LoanDetailClient from '@/components/loans/LoanDetailClient'
import ExportToolbar from '@/components/loans/ExportToolbar'
import { computeFamilyLoanState } from '@/lib/calculations'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Loan, PaymentSchedule, PaymentTransaction, PaymentPlanRow, FamilyLoanState } from '@/lib/types'

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: loan } = await supabase.from('loans').select('*').eq('id', id).single()
  if (!loan) notFound()

  const [{ data: scheduleRows }, { data: transactions }, { data: planRows }] = await Promise.all([
    supabase.from('payment_schedules').select('*').eq('loan_id', id).order('installment_number'),
    supabase.from('payment_transactions').select('*').eq('loan_id', id).order('payment_date'),
    supabase.from('payment_plan_rows').select('*').eq('loan_id', id).order('sort_order'),
  ])

  const loanTypeName = (loan.loan_type as string).replace(/_/g, ' ')
  const today = new Date().toISOString().split('T')[0]

  const typedLoan = loan as Loan
  const typedTx = (transactions ?? []) as PaymentTransaction[]

  let familyState: FamilyLoanState | undefined
  if (typedLoan.repayment_mode === 'flexible_manual') {
    const sorted = [...typedTx].sort((a, b) => a.payment_date.localeCompare(b.payment_date))
    familyState = computeFamilyLoanState(typedLoan.principal, typedLoan.interest_rate, typedLoan.start_date, sorted, today)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/loans" className="text-sm text-gray-500 hover:text-gray-700">← Loans</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{loan.lender_name}</h1>
          <p className="text-sm text-gray-500 capitalize">
            {loanTypeName} · {loan.currency} · {loan.repayment_mode === 'flexible_manual' ? 'Flexible' : 'Fixed EMI'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportToolbar
            loan={typedLoan}
            scheduleRows={(scheduleRows ?? []) as PaymentSchedule[]}
            transactions={typedTx}
            planRows={(planRows ?? []) as PaymentPlanRow[]}
            familyState={familyState}
          />
          <Link href={`/loans/${id}/edit`} className={cn(buttonVariants({ variant: 'outline' }))}>
            Edit Loan
          </Link>
        </div>
      </div>
      <LoanDetailClient
        loan={typedLoan}
        scheduleRows={(scheduleRows ?? []) as PaymentSchedule[]}
        transactions={typedTx}
        planRows={(planRows ?? []) as PaymentPlanRow[]}
      />
    </div>
  )
}
