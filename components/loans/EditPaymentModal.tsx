'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { recomputeFlexibleAllocations, syncLoanStatus } from '@/lib/loan-actions'
import { formatCurrency } from '@/lib/calculations'
import type { Loan, PaymentTransaction } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  loan: Loan
  transaction: PaymentTransaction
  open: boolean
  onClose: () => void
}

const PAYMENT_METHODS = ['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Online', 'Other']

export default function EditPaymentModal({ loan, transaction, open, onClose }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    payment_date: transaction.payment_date,
    amount: transaction.amount.toString(),
    note: transaction.note ?? '',
    payment_method: transaction.payment_method ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) { setError('Enter a valid amount'); return }

    setLoading(true)
    setError('')
    const supabase = createClient()

    const { error: err } = await supabase
      .from('payment_transactions')
      .update({
        payment_date: form.payment_date,
        amount,
        note: form.note || null,
        payment_method: form.payment_method || null,
      })
      .eq('id', transaction.id)

    if (err) { setError(err.message); setLoading(false); return }

    // Recompute all allocation fields for this loan's transactions
    await recomputeFlexibleAllocations(loan.id, supabase)
    await syncLoanStatus(loan.id, supabase)

    router.refresh()
    onClose()
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    const supabase = createClient()

    const { error: err } = await supabase
      .from('payment_transactions')
      .delete()
      .eq('id', transaction.id)

    if (err) { setError(err.message); setDeleting(false); return }

    await recomputeFlexibleAllocations(loan.id, supabase)
    await syncLoanStatus(loan.id, supabase)

    router.refresh()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); setConfirmDelete(false) } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Payment — {loan.lender_name}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 mt-2">
          <div>
            <Label htmlFor="ep-date">Payment Date</Label>
            <Input
              id="ep-date" type="date" className="mt-1"
              value={form.payment_date}
              onChange={e => set('payment_date', e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="ep-amount">Amount ({loan.currency})</Label>
            <Input
              id="ep-amount" type="number" step="0.01" className="mt-1"
              value={form.amount}
              onChange={e => set('amount', e.target.value)}
              required
            />
            <p className="text-xs text-gray-400 mt-1">
              Original: {formatCurrency(transaction.amount, loan.currency)}
            </p>
          </div>

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
            <Label htmlFor="ep-note">Note (optional)</Label>
            <Textarea
              id="ep-note" className="mt-1" rows={2}
              value={form.note}
              onChange={e => set('note', e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Saving…' : 'Save Changes'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>

          <div className="border-t pt-3">
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-sm text-red-600 font-medium">
                  Delete this {formatCurrency(transaction.amount, loan.currency)} payment on {transaction.payment_date}?
                  This will recalculate all balances.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    className="flex-1"
                    disabled={deleting}
                    onClick={handleDelete}
                  >
                    {deleting ? 'Deleting…' : 'Yes, Delete Payment'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmDelete(false)}
                  >Cancel</Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                onClick={handleDelete}
              >
                Delete Payment
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
