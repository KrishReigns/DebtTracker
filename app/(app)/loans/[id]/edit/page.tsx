import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import LoanForm from '@/components/loans/LoanForm'
import type { Loan } from '@/lib/types'

export default async function EditLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: loan } = await supabase.from('loans').select('*').eq('id', id).single()
  if (!loan) notFound()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Edit Loan</h1>
        <p className="text-sm text-gray-500 mt-1">{loan.lender_name}</p>
      </div>
      <LoanForm loan={loan as Loan} />
    </div>
  )
}
