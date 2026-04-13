import { createClient } from '@/lib/supabase-server'
import DashboardClient from '@/components/DashboardClient'
import type { Loan, PaymentSchedule, PaymentTransaction, ExchangeRate } from '@/lib/types'

export default async function DashboardPage() {
  const supabase = await createClient()

  const [{ data: loans }, { data: rates }] = await Promise.all([
    supabase.from('loans').select('*').eq('status', 'active').order('created_at'),
    supabase.from('exchange_rates').select('*'),
  ])

  const activeLoanIds = (loans ?? []).map((l: { id: string }) => l.id)

  const [{ data: schedules }, { data: transactions }] = await Promise.all([
    activeLoanIds.length > 0
      ? supabase.from('payment_schedules').select('*').in('loan_id', activeLoanIds)
      : Promise.resolve({ data: [] as PaymentSchedule[] }),
    activeLoanIds.length > 0
      ? supabase.from('payment_transactions').select('*').in('loan_id', activeLoanIds)
      : Promise.resolve({ data: [] as PaymentTransaction[] }),
  ])

  return (
    <DashboardClient
      loans={(loans ?? []) as Loan[]}
      schedules={(schedules ?? []) as PaymentSchedule[]}
      transactions={(transactions ?? []) as PaymentTransaction[]}
      exchangeRates={(rates ?? []) as ExchangeRate[]}
    />
  )
}
