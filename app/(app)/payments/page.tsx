import { createClient } from '@/lib/supabase-server'
import PaymentsClient from '@/components/payments/PaymentsClient'
import type { Loan, PaymentSchedule, PaymentTransaction } from '@/lib/types'

export default async function PaymentsPage() {
  const supabase = await createClient()

  // Fetch ALL loans (active and closed) — user can filter by closed in the UI
  const { data: loans } = await supabase.from('loans').select('*').order('created_at')

  const loanIds = (loans ?? []).map((l: { id: string }) => l.id)

  const [{ data: schedules }, { data: transactions }] = await Promise.all([
    loanIds.length > 0
      ? supabase
          .from('payment_schedules')
          .select('*')
          .in('loan_id', loanIds)
          .order('contractual_due_date')
      : Promise.resolve({ data: [] as PaymentSchedule[] }),
    loanIds.length > 0
      ? supabase
          .from('payment_transactions')
          .select('*')
          .in('loan_id', loanIds)
          .order('payment_date', { ascending: false })
      : Promise.resolve({ data: [] as PaymentTransaction[] }),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <p className="text-sm text-gray-500 mt-1">Track EMI schedules and flexible loan payments</p>
      </div>
      <PaymentsClient
        loans={(loans ?? []) as Loan[]}
        schedules={(schedules ?? []) as PaymentSchedule[]}
        transactions={(transactions ?? []) as PaymentTransaction[]}
      />
    </div>
  )
}
