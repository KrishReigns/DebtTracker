'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface Props {
  loanId: string
  loanName: string
}

export default function DeleteLoanButton({ loanId, loanName }: Props) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'confirm' | 'deleting'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setState('deleting')
    setError(null)
    try {
      const supabase = createClient()
      // Delete all child records first, then the loan
      await supabase.from('payment_transactions').delete().eq('loan_id', loanId)
      await supabase.from('payment_schedules').delete().eq('loan_id', loanId)
      await supabase.from('payment_plan_rows').delete().eq('loan_id', loanId)
      const { error: err } = await supabase.from('loans').delete().eq('id', loanId)
      if (err) throw new Error(err.message)
      router.push('/loans')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setState('idle')
    }
  }

  if (state === 'confirm' || state === 'deleting') {
    return (
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-red-500">{error}</span>}
        <span className="text-xs text-slate-500 hidden sm:block">Delete &ldquo;{loanName}&rdquo;?</span>
        <button
          onClick={handleDelete}
          disabled={state === 'deleting'}
          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {state === 'deleting' ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button
          onClick={() => setState('idle')}
          disabled={state === 'deleting'}
          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setState('confirm')}
      className="px-3 py-2 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors"
    >
      Delete
    </button>
  )
}
