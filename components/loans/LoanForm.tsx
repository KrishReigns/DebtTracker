'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { calculateEMI, generateSchedule, formatCurrency } from '@/lib/calculations'
import {
  ACTIVE_LOAN_TYPES, LOAN_TYPE_LABELS,
  type LoanType, type Currency, type InterestType, type RepaymentMode, type Loan,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props { loan?: Loan }

const INTEREST_TYPE_OPTIONS: { value: InterestType; label: string }[] = [
  { value: 'reducing', label: 'Reducing Balance (standard EMI)' },
  { value: 'flat', label: 'Flat Rate' },
  { value: 'simple', label: 'Simple Interest (family loans)' },
  { value: 'revolving', label: 'Revolving (credit card)' },
  { value: 'bullet', label: 'Bullet (lump-sum at maturity)' },
]

export default function LoanForm({ loan }: Props) {
  const router = useRouter()
  const isEdit = !!loan

  // Derive default repayment_mode from loan_type when adding
  const defaultMode: RepaymentMode = loan?.repayment_mode
    ?? (loan?.loan_type === 'family' ? 'flexible_manual' : 'fixed_emi')

  const [form, setForm] = useState({
    loan_type: (loan?.loan_type ?? 'personal_loan') as LoanType,
    repayment_mode: defaultMode,
    lender_name: loan?.lender_name ?? '',
    account_number: loan?.account_number ?? '',
    currency: (loan?.currency ?? 'INR') as Currency,
    principal: loan?.principal?.toString() ?? '',
    interest_rate: loan?.interest_rate?.toString() ?? '',
    interest_type: (loan?.interest_type ?? 'reducing') as InterestType,
    start_date: loan?.start_date ?? new Date().toISOString().split('T')[0],
    disbursement_date: loan?.disbursement_date ?? '',
    first_emi_date: loan?.first_emi_date ?? '',
    tenure_months: loan?.tenure_months?.toString() ?? '12',
    emi_amount: loan?.emi_amount?.toString() ?? '',
    payment_day: loan?.payment_day?.toString() ?? '1',
    notes: loan?.notes ?? '',
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [autoEMI, setAutoEMI] = useState(0)

  const principal = parseFloat(form.principal) || 0
  const rate = parseFloat(form.interest_rate) || 0
  const tenure = parseInt(form.tenure_months) || 12
  const isFlexible = form.repayment_mode === 'flexible_manual'
  const isFamily = form.loan_type === 'family'

  // Auto-set repayment_mode when loan_type changes
  useEffect(() => {
    if (!isEdit) {
      set('repayment_mode', form.loan_type === 'family' ? 'flexible_manual' : 'fixed_emi')
      if (form.loan_type === 'family') {
        set('interest_type', 'simple')
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.loan_type])

  useEffect(() => {
    if (principal > 0 && tenure > 0 && !isFlexible) {
      setAutoEMI(calculateEMI(principal, rate, tenure))
    }
  }, [principal, rate, tenure, isFlexible])

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  const schedulePreview = !isFlexible && principal > 0 && tenure > 0
    ? generateSchedule(principal, rate, tenure, form.start_date, form.interest_type, parseFloat(form.emi_amount) || undefined).slice(0, 6)
    : []

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not authenticated'); setLoading(false); return }

    const payload = {
      user_id: user.id,
      loan_type: form.loan_type,
      repayment_mode: form.repayment_mode,
      lender_name: form.lender_name,
      account_number: form.account_number || null,
      principal: parseFloat(form.principal),
      interest_rate: parseFloat(form.interest_rate) || 0,
      interest_type: form.interest_type,
      start_date: form.start_date,
      disbursement_date: form.disbursement_date || null,
      first_emi_date: form.first_emi_date || null,
      tenure_months: isFlexible ? null : (parseInt(form.tenure_months) || null),
      emi_amount: isFlexible ? null : (parseFloat(form.emi_amount) || autoEMI || null),
      payment_day: isFlexible ? null : (parseInt(form.payment_day) || 1),
      currency: form.currency,
      notes: form.notes || null,
    }

    let loanId = loan?.id
    if (isEdit) {
      const { error: err } = await supabase.from('loans').update(payload).eq('id', loan!.id)
      if (err) { setError(err.message); setLoading(false); return }
    } else {
      const { data, error: err } = await supabase.from('loans').insert(payload).select('id').single()
      if (err) { setError(err.message); setLoading(false); return }
      loanId = data.id

      // Generate payment schedule for fixed-EMI loans only
      if (!isFlexible && principal > 0) {
        const fullSchedule = generateSchedule(
          parseFloat(form.principal),
          parseFloat(form.interest_rate) || 0,
          parseInt(form.tenure_months) || 12,
          form.start_date,
          form.interest_type,
          parseFloat(form.emi_amount) || autoEMI || undefined
        )

        // Insert into both legacy payments table and new payment_schedules
        const payments = fullSchedule.map(row => ({
          loan_id: loanId,
          due_date: row.date,
          amount_due: row.emi,
          principal_component: row.principal,
          interest_component: row.interest,
          status: 'pending' as const,
        }))
        await supabase.from('payments').insert(payments)

        const scheduleRows = fullSchedule.map((row, i) => ({
          loan_id: loanId,
          installment_number: i + 1,
          contractual_due_date: row.date,
          opening_balance: row.openingBalance,
          emi_amount: row.emi,
          principal_amount: row.principal,
          interest_amount: row.interest,
          closing_balance: row.closingBalance,
          rate: parseFloat(form.interest_rate) || 0,
          status: 'pending',
        }))
        await supabase.from('payment_schedules').insert(scheduleRows)
      }
    }

    router.push(`/loans/${loanId}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          <div>
            <Label>Loan Type</Label>
            <Select value={form.loan_type} onValueChange={v => set('loan_type', v ?? '')}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTIVE_LOAN_TYPES.map(t => (
                  <SelectItem key={t} value={t}>{LOAN_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Repayment Mode</Label>
            <Select value={form.repayment_mode} onValueChange={v => set('repayment_mode', v ?? 'fixed_emi')}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed_emi">Fixed EMI (lender schedule)</SelectItem>
                <SelectItem value="flexible_manual">Flexible / Manual (family, ad-hoc)</SelectItem>
              </SelectContent>
            </Select>
            {isFamily && !isFlexible && (
              <p className="text-xs text-amber-600 mt-1">Family loans are usually flexible. Consider switching.</p>
            )}
          </div>

          <div>
            <Label htmlFor="lender">Lender / Person Name</Label>
            <Input
              id="lender" className="mt-1"
              placeholder={isFamily ? 'e.g. Uncle Raj' : 'e.g. SBI, HDFC, Axis'}
              value={form.lender_name}
              onChange={e => set('lender_name', e.target.value)}
              required
            />
          </div>

          {!isFlexible && (
            <div>
              <Label htmlFor="account_number">Account / Agreement Number</Label>
              <Input
                id="account_number" className="mt-1"
                placeholder="e.g. PPR029206321830"
                value={form.account_number}
                onChange={e => set('account_number', e.target.value)}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={v => set('currency', v ?? '')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INR">INR (₹)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="principal">Principal Amount</Label>
              <Input
                id="principal" type="number" className="mt-1"
                placeholder="500000"
                value={form.principal}
                onChange={e => set('principal', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rate">Annual Interest Rate (%)</Label>
              <Input
                id="rate" type="number" step="0.01" className="mt-1"
                placeholder="11.6"
                value={form.interest_rate}
                onChange={e => set('interest_rate', e.target.value)}
              />
            </div>
            <div>
              <Label>Interest Type</Label>
              <Select value={form.interest_type} onValueChange={v => set('interest_type', v ?? '')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTEREST_TYPE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="start">Start Date</Label>
              <Input
                id="start" type="date" className="mt-1"
                value={form.start_date}
                onChange={e => set('start_date', e.target.value)}
                required
              />
            </div>
            {!isFlexible && (
              <div>
                <Label htmlFor="disb">Disbursement Date</Label>
                <Input
                  id="disb" type="date" className="mt-1"
                  value={form.disbursement_date}
                  onChange={e => set('disbursement_date', e.target.value)}
                />
              </div>
            )}
          </div>

          {!isFlexible && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="first_emi">First EMI Date</Label>
                  <Input
                    id="first_emi" type="date" className="mt-1"
                    value={form.first_emi_date}
                    onChange={e => set('first_emi_date', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="tenure">Tenure (months)</Label>
                  <Input
                    id="tenure" type="number" className="mt-1"
                    placeholder="60"
                    value={form.tenure_months}
                    onChange={e => set('tenure_months', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="emi">
                    EMI Amount{' '}
                    {autoEMI > 0 && !form.emi_amount && (
                      <span className="text-xs text-muted-foreground">(auto: {formatCurrency(autoEMI, form.currency)})</span>
                    )}
                  </Label>
                  <Input
                    id="emi" type="number" className="mt-1"
                    placeholder={autoEMI > 0 ? Math.round(autoEMI).toString() : 'Auto'}
                    value={form.emi_amount}
                    onChange={e => set('emi_amount', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="payment_day">Payment Day of Month</Label>
                  <Input
                    id="payment_day" type="number" min={1} max={31} className="mt-1"
                    value={form.payment_day}
                    onChange={e => set('payment_day', e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes" className="mt-1" rows={3}
              placeholder="Any extra details…"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </div>

          {/* Schedule preview (fixed-EMI only) */}
          {schedulePreview.length > 0 && (
            <Card className="bg-gray-50">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm text-gray-600">First 6 EMI Preview</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left pb-1">Month</th>
                      <th className="text-right pb-1">EMI</th>
                      <th className="text-right pb-1">Interest</th>
                      <th className="text-right pb-1">Principal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedulePreview.map(row => (
                      <tr key={row.month} className="border-t border-gray-200">
                        <td className="py-1 text-gray-600">{row.date.slice(0, 7)}</td>
                        <td className="py-1 text-right font-medium">{formatCurrency(row.emi, form.currency)}</td>
                        <td className="py-1 text-right text-red-500">{formatCurrency(row.interest, form.currency)}</td>
                        <td className="py-1 text-right text-green-600">{formatCurrency(row.principal, form.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? 'Saving…' : isEdit ? 'Update Loan' : 'Add Loan'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
