import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getUserSubscription, isPro } from '@/lib/subscription'
import { FREE_LOAN_LIMIT } from '@/lib/stripe'
import LoanForm from '@/components/loans/LoanForm'
import Link from 'next/link'

export default async function NewLoanPage() {
  const supabase = await createClient()

  const [{ count: activeLoanCount }, sub] = await Promise.all([
    supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    getUserSubscription(),
  ])

  const proActive = isPro(sub)
  const atLimit = !proActive && (activeLoanCount ?? 0) >= FREE_LOAN_LIMIT

  if (atLimit) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center space-y-5">
        <div className="text-5xl">🔒</div>
        <h1 className="text-2xl font-bold text-gray-900">Free plan limit reached</h1>
        <p className="text-gray-500">
          You have {activeLoanCount} active loans — the free plan supports up to {FREE_LOAN_LIMIT}.
          Upgrade to Pro for unlimited loans, bulk exports, and email reminders.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <Link
            href="/upgrade"
            className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-lg shadow-indigo-200"
          >
            ⚡ Upgrade to Pro
          </Link>
          <Link
            href="/loans"
            className="inline-flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 font-medium px-6 py-3 rounded-xl hover:bg-gray-50 transition-all"
          >
            Back to Loans
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Add New Loan</h1>
        <p className="text-sm text-gray-500 mt-1">
          Fill in the details — the EMI and full payment schedule will be generated automatically.
        </p>
        {!proActive && (
          <p className="text-xs text-amber-600 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
            Free plan: {activeLoanCount ?? 0} / {FREE_LOAN_LIMIT} loans used ·{' '}
            <Link href="/upgrade" className="font-semibold underline">Upgrade for unlimited</Link>
          </p>
        )}
      </div>
      <LoanForm />
    </div>
  )
}
