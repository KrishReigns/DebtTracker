'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { calculateEMI, generateSchedule, formatCurrency } from '@/lib/calculations'
import {
  ACTIVE_LOAN_TYPES, LOAN_TYPE_LABELS, LOAN_TYPE_COLORS,
  type LoanType, type Currency, type InterestType, type RepaymentMode, type Loan,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate } from '@/lib/utils'

interface Props { loan?: Loan }

const LOAN_TYPE_ICONS: Record<string, string> = {
  personal_loan: '👤', home: '🏠', vehicle: '🚗', education: '🎓',
  business: '💼', gold: '🪙', credit_card: '💳', family: '🤝', other: '📋',
}

const INTEREST_TYPE_OPTIONS: { value: InterestType; label: string; desc: string }[] = [
  { value: 'reducing', label: 'Reducing Balance', desc: 'Standard bank EMI' },
  { value: 'flat',     label: 'Flat Rate',        desc: 'Interest on full principal' },
  { value: 'simple',   label: 'Simple Interest',  desc: 'Family / informal loans' },
  { value: 'revolving',label: 'Revolving',        desc: 'Credit card' },
  { value: 'bullet',   label: 'Bullet',           desc: 'Lump-sum at maturity' },
]

const STEPS = ['Loan Type', 'Details', 'Terms', 'Review']

export default function LoanForm({ loan }: Props) {
  const router = useRouter()
  const isEdit = !!loan
  const defaultMode: RepaymentMode = loan?.repayment_mode
    ?? (loan?.loan_type === 'family' ? 'flexible_manual' : 'fixed_emi')

  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    loan_type:        (loan?.loan_type ?? 'personal_loan') as LoanType,
    repayment_mode:   defaultMode,
    lender_name:      loan?.lender_name ?? '',
    account_number:   loan?.account_number ?? '',
    currency:         (loan?.currency ?? 'INR') as Currency,
    principal:        loan?.principal?.toString() ?? '',
    interest_rate:    loan?.interest_rate?.toString() ?? '',
    interest_type:    (loan?.interest_type ?? 'reducing') as InterestType,
    start_date:       loan?.start_date ?? new Date().toISOString().split('T')[0],
    disbursement_date:loan?.disbursement_date ?? '',
    first_emi_date:   loan?.first_emi_date ?? '',
    tenure_months:    loan?.tenure_months?.toString() ?? '12',
    emi_amount:       loan?.emi_amount?.toString() ?? '',
    payment_day:      loan?.payment_day?.toString() ?? '1',
    notes:            loan?.notes ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [autoEMI, setAutoEMI] = useState(0)

  const principal  = parseFloat(form.principal) || 0
  const rate       = parseFloat(form.interest_rate) || 0
  const tenure     = parseInt(form.tenure_months) || 12
  const isFlexible = form.repayment_mode === 'flexible_manual'
  const isFamily   = form.loan_type === 'family'

  useEffect(() => {
    if (!isEdit) {
      set('repayment_mode', form.loan_type === 'family' ? 'flexible_manual' : 'fixed_emi')
      if (form.loan_type === 'family') set('interest_type', 'simple')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.loan_type])

  useEffect(() => {
    if (principal > 0 && tenure > 0 && !isFlexible) setAutoEMI(calculateEMI(principal, rate, tenure))
  }, [principal, rate, tenure, isFlexible])

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  const effectiveEMI = parseFloat(form.emi_amount) || autoEMI
  const totalInterest = effectiveEMI > 0 ? (effectiveEMI * tenure) - principal : 0

  const schedulePreview = !isFlexible && principal > 0 && tenure > 0
    ? generateSchedule(principal, rate, tenure, form.start_date, form.interest_type,
        parseFloat(form.emi_amount) || undefined, form.first_emi_date || undefined).slice(0, 5)
    : []

  async function handleSubmit() {
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
      principal,
      interest_rate: rate,
      interest_type: form.interest_type,
      start_date: form.start_date,
      disbursement_date: form.disbursement_date || null,
      first_emi_date: form.first_emi_date || null,
      tenure_months: isFlexible ? null : (tenure || null),
      emi_amount: isFlexible ? null : (effectiveEMI || null),
      payment_day: isFlexible ? null : (parseInt(form.payment_day) || 1),
      currency: form.currency,
      notes: form.notes || null,
    }

    let loanId = loan?.id
    if (isEdit) {
      const { error: err } = await supabase.from('loans').update(payload).eq('id', loan!.id)
      if (err) { setError(err.message); setLoading(false); return }

      // Regenerate pending schedule rows from updated loan terms
      if (!isFlexible && principal > 0) {
        // Fetch paid/partial/skipped rows (keep as historical record)
        const { data: paidRows } = await supabase
          .from('payment_schedules')
          .select('*')
          .eq('loan_id', loan!.id)
          .in('status', ['paid', 'partial', 'skipped'])
          .order('installment_number', { ascending: true })

        const paid = paidRows ?? []
        const paidCount = paid.length
        const lastPaid = paid[paid.length - 1]

        // Delete all pending rows
        await supabase
          .from('payment_schedules')
          .delete()
          .eq('loan_id', loan!.id)
          .eq('status', 'pending')

        // Starting balance = closing balance of last paid row, or full principal
        const startBalance = lastPaid ? Number(lastPaid.closing_balance) : principal
        const remainingTenure = tenure - paidCount

        if (remainingTenure > 0 && startBalance > 0) {
          // Start date: if paid rows exist, derive next due date from last paid date + 1 month
          // adjusted to the new payment_day; otherwise use form.start_date
          let schedStartDate = form.start_date
          if (lastPaid) {
            const lastDate = new Date(lastPaid.contractual_due_date)
            const next = new Date(lastDate)
            next.setMonth(next.getMonth() + 1)
            const payDay = parseInt(form.payment_day) || 1
            next.setDate(Math.min(payDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()))
            schedStartDate = next.toISOString().split('T')[0]
          }

          const newRows = generateSchedule(
            startBalance, rate, remainingTenure, schedStartDate,
            form.interest_type, parseFloat(form.emi_amount) || autoEMI || undefined,
            lastPaid ? undefined : (form.first_emi_date || undefined) // only for fresh regen
          )

          const scheduleRows = newRows.map((row, i) => ({
            loan_id: loan!.id,
            installment_number: paidCount + i + 1,
            contractual_due_date: row.date,
            opening_balance: row.openingBalance,
            emi_amount: row.emi,
            principal_amount: row.principal,
            interest_amount: row.interest,
            closing_balance: row.closingBalance,
            rate,
            status: 'pending',
          }))
          await supabase.from('payment_schedules').insert(scheduleRows)
        }
      }
    } else {
      const { data, error: err } = await supabase.from('loans').insert(payload).select('id').single()
      if (err) { setError(err.message); setLoading(false); return }
      loanId = data.id

      if (!isFlexible && principal > 0) {
        const fullSchedule = generateSchedule(principal, rate, tenure, form.start_date,
          form.interest_type, parseFloat(form.emi_amount) || autoEMI || undefined,
          form.first_emi_date || undefined)

        const payments = fullSchedule.map(row => ({
          loan_id: loanId, due_date: row.date, amount_due: row.emi,
          principal_component: row.principal, interest_component: row.interest, status: 'pending' as const,
        }))
        await supabase.from('payments').insert(payments)

        const scheduleRows = fullSchedule.map((row, i) => ({
          loan_id: loanId, installment_number: i + 1, contractual_due_date: row.date,
          opening_balance: row.openingBalance, emi_amount: row.emi,
          principal_amount: row.principal, interest_amount: row.interest,
          closing_balance: row.closingBalance, rate, status: 'pending',
        }))
        await supabase.from('payment_schedules').insert(scheduleRows)
      }
    }

    router.push(`/loans/${loanId}`)
    router.refresh()
  }

  const accentColor = LOAN_TYPE_COLORS[form.loan_type] ?? '#6366f1'

  // ── Step 0: Loan Type Picker ─────────────────────────────────────────────
  const StepLoanType = (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">What type of loan is this?</h2>
        <p className="text-sm text-slate-500 mt-0.5">Choose the category that best fits</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {ACTIVE_LOAN_TYPES.map(type => {
          const color = LOAN_TYPE_COLORS[type] ?? '#6366f1'
          const active = form.loan_type === type
          return (
            <button
              key={type}
              type="button"
              onClick={() => set('loan_type', type)}
              className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all duration-200 ${
                active
                  ? 'border-transparent shadow-md scale-[1.02]'
                  : 'border-slate-200 hover:border-slate-300 hover:shadow-sm bg-white'
              }`}
              style={active ? { backgroundColor: `${color}18`, borderColor: color } : {}}
            >
              <span className="text-2xl">{LOAN_TYPE_ICONS[type] ?? '📋'}</span>
              <span className={`text-xs font-semibold text-center leading-tight ${active ? 'text-slate-800' : 'text-slate-600'}`}>
                {LOAN_TYPE_LABELS[type]}
              </span>
              {active && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              )}
            </button>
          )
        })}
      </div>
      {isFamily && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <span className="text-amber-500 mt-0.5">ℹ️</span>
          <p className="text-xs text-amber-700">Family loans will use flexible/manual repayment mode with daily simple interest.</p>
        </div>
      )}
    </div>
  )

  // ── Step 1: Basic Details ────────────────────────────────────────────────
  const StepDetails = (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Basic Details</h2>
        <p className="text-sm text-slate-500 mt-0.5">Who gave you the loan and how much?</p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="lender">
          {isFamily ? 'Person / Family Member Name' : 'Bank / Lender Name'}
        </Label>
        <Input
          id="lender"
          placeholder={isFamily ? 'e.g. Uncle Raj, Father' : 'e.g. SBI, HDFC, Axis Bank'}
          value={form.lender_name}
          onChange={e => set('lender_name', e.target.value)}
          className="h-11"
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Currency</Label>
          <Select value={form.currency} onValueChange={v => set('currency', v ?? 'INR')}>
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="INR">🇮🇳 INR (₹)</SelectItem>
              <SelectItem value="USD">🇺🇸 USD ($)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="principal">Loan Amount</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">
              {form.currency === 'INR' ? '₹' : '$'}
            </span>
            <Input
              id="principal" type="number"
              placeholder="5,00,000"
              value={form.principal}
              onChange={e => set('principal', e.target.value)}
              className="h-11 pl-7"
              required
            />
          </div>
        </div>
      </div>

      {!isFlexible && (
        <div className="space-y-1">
          <Label htmlFor="account_number">Account / Loan Reference Number <span className="text-slate-400 font-normal">(optional)</span></Label>
          <Input
            id="account_number"
            placeholder="e.g. PPR029206321830"
            value={form.account_number}
            onChange={e => set('account_number', e.target.value)}
            className="h-11 font-mono"
          />
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="notes">Notes <span className="text-slate-400 font-normal">(optional)</span></Label>
        <Textarea
          id="notes" rows={2}
          placeholder="Any extra details about this loan…"
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          className="resize-none"
        />
      </div>
    </div>
  )

  // ── Step 2: Loan Terms ───────────────────────────────────────────────────
  const StepTerms = (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Loan Terms</h2>
        <p className="text-sm text-slate-500 mt-0.5">Interest rate, dates and repayment schedule</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="rate">Interest Rate (% p.a.)</Label>
          <div className="relative">
            <Input
              id="rate" type="number" step="0.01"
              placeholder="11.6"
              value={form.interest_rate}
              onChange={e => set('interest_rate', e.target.value)}
              className="h-11 pr-8"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Interest Type</Label>
          <Select value={form.interest_type} onValueChange={v => set('interest_type', v ?? 'reducing')}>
            <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              {INTEREST_TYPE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  <span>{o.label}</span>
                  <span className="text-xs text-slate-400 ml-1">— {o.desc}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="start">Start / Taken Date</Label>
          <Input
            id="start" type="date"
            value={form.start_date}
            onChange={e => set('start_date', e.target.value)}
            className="h-11"
            required
          />
        </div>
        {!isFlexible && (
          <div className="space-y-1">
            <Label htmlFor="disb">Disbursement Date <span className="text-slate-400 font-normal">(optional)</span></Label>
            <Input
              id="disb" type="date"
              value={form.disbursement_date}
              onChange={e => set('disbursement_date', e.target.value)}
              className="h-11"
            />
          </div>
        )}
      </div>

      {!isFlexible && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="first_emi">First EMI Date <span className="text-slate-400 font-normal">(optional)</span></Label>
              <Input
                id="first_emi" type="date"
                value={form.first_emi_date}
                onChange={e => set('first_emi_date', e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tenure">Tenure (months)</Label>
              <Input
                id="tenure" type="number"
                placeholder="60"
                value={form.tenure_months}
                onChange={e => set('tenure_months', e.target.value)}
                className="h-11"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="emi">
                EMI Amount
                {autoEMI > 0 && !form.emi_amount && (
                  <span className="text-xs text-indigo-500 ml-1 font-normal">auto-calculated</span>
                )}
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                  {form.currency === 'INR' ? '₹' : '$'}
                </span>
                <Input
                  id="emi" type="number"
                  placeholder={autoEMI > 0 ? Math.round(autoEMI).toString() : 'Auto'}
                  value={form.emi_amount}
                  onChange={e => set('emi_amount', e.target.value)}
                  className="h-11 pl-7"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="payment_day">Payment Day</Label>
              <Input
                id="payment_day" type="number" min={1} max={31}
                value={form.payment_day}
                onChange={e => set('payment_day', e.target.value)}
                className="h-11"
              />
            </div>
          </div>

          {/* Live EMI summary */}
          {effectiveEMI > 0 && principal > 0 && (
            <div className="grid grid-cols-3 gap-2 rounded-2xl p-4" style={{ backgroundColor: `${accentColor}10`, border: `1px solid ${accentColor}30` }}>
              <div className="text-center">
                <p className="text-xs text-slate-500">Monthly EMI</p>
                <p className="text-base font-bold text-slate-800 mt-0.5">{formatCurrency(effectiveEMI, form.currency)}</p>
              </div>
              <div className="text-center border-x" style={{ borderColor: `${accentColor}30` }}>
                <p className="text-xs text-slate-500">Total Interest</p>
                <p className="text-base font-bold text-amber-600 mt-0.5">{formatCurrency(Math.max(0, totalInterest), form.currency)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-slate-500">Total Payable</p>
                <p className="text-base font-bold text-slate-800 mt-0.5">{formatCurrency(principal + Math.max(0, totalInterest), form.currency)}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )

  // ── Step 3: Review ───────────────────────────────────────────────────────
  const StepReview = (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Review & Confirm</h2>
        <p className="text-sm text-slate-500 mt-0.5">Double-check everything before saving</p>
      </div>

      {/* Summary card */}
      <div className="rounded-2xl border-2 overflow-hidden" style={{ borderColor: accentColor }}>
        <div className="px-4 py-3 flex items-center gap-3" style={{ backgroundColor: `${accentColor}15` }}>
          <span className="text-2xl">{LOAN_TYPE_ICONS[form.loan_type]}</span>
          <div>
            <p className="font-bold text-slate-800">{form.lender_name || '—'}</p>
            <p className="text-xs text-slate-500">{LOAN_TYPE_LABELS[form.loan_type]} · {form.currency}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xl font-bold text-slate-800">{principal > 0 ? formatCurrency(principal, form.currency) : '—'}</p>
            <p className="text-xs text-slate-500">Principal</p>
          </div>
        </div>
        <div className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm bg-white">
          <div className="flex justify-between">
            <span className="text-slate-500">Interest Rate</span>
            <span className="font-medium">{rate > 0 ? `${rate}% p.a.` : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Type</span>
            <span className="font-medium capitalize">{form.interest_type}</span>
          </div>
          {!isFlexible && (
            <>
              <div className="flex justify-between">
                <span className="text-slate-500">Tenure</span>
                <span className="font-medium">{tenure} months</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">EMI</span>
                <span className="font-medium text-indigo-600">{effectiveEMI > 0 ? formatCurrency(effectiveEMI, form.currency) : '—'}</span>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">Start Date</span>
            <span className="font-medium">{formatDate(form.start_date)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Mode</span>
            <span className="font-medium">{isFlexible ? 'Flexible' : 'Fixed EMI'}</span>
          </div>
        </div>
      </div>

      {/* EMI Schedule Preview */}
      {schedulePreview.length > 0 && (
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">First 5 EMI Preview</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100">
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-right px-4 py-2">EMI</th>
                <th className="text-right px-4 py-2">Interest</th>
                <th className="text-right px-4 py-2">Principal</th>
              </tr>
            </thead>
            <tbody>
              {schedulePreview.map((row, i) => (
                <tr key={row.month} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                  <td className="px-4 py-2 text-slate-600">{formatDate(row.date)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-slate-700">{formatCurrency(row.emi, form.currency)}</td>
                  <td className="px-4 py-2 text-right text-amber-600">{formatCurrency(row.interest, form.currency)}</td>
                  <td className="px-4 py-2 text-right text-emerald-600">{formatCurrency(row.principal, form.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  )

  const steps = [StepLoanType, StepDetails, StepTerms, StepReview]
  const totalSteps = isEdit ? 3 : 4
  const currentStep = isEdit ? step + 1 : step // edit skips loan type picker
  const displaySteps = isEdit ? STEPS.slice(1) : STEPS

  function canProceed() {
    if (!isEdit && step === 0) return true // loan type picker always valid
    const detailsStep = isEdit ? 0 : 1
    const termsStep   = isEdit ? 1 : 2
    if (step === detailsStep) return form.lender_name.trim().length > 0 && principal > 0
    if (step === termsStep)   return form.start_date.length > 0
    return true
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          {displaySteps.map((label, i) => {
            const idx = i
            const done = idx < step
            const active = idx === step
            return (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  done    ? 'bg-emerald-500 text-white' :
                  active  ? 'text-white' : 'bg-slate-200 text-slate-400'
                }`}
                  style={active ? { backgroundColor: accentColor } : {}}
                >
                  {done ? '✓' : i + 1}
                </div>
                <span className={`text-xs hidden sm:block ${active ? 'font-semibold text-slate-700' : 'text-slate-400'}`}>
                  {label}
                </span>
                {i < displaySteps.length - 1 && (
                  <div className={`h-px w-6 sm:w-10 mx-1 transition-all ${idx < step ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Step content */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 min-h-[320px]">
        {isEdit ? [StepDetails, StepTerms, StepReview][step] : steps[step]}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (step === 0) router.back()
            else setStep(s => s - 1)
          }}
          className="px-5"
        >
          {step === 0 ? 'Cancel' : '← Back'}
        </Button>

        {step < (isEdit ? 2 : 3) ? (
          <Button
            type="button"
            disabled={!canProceed()}
            onClick={() => setStep(s => s + 1)}
            className="px-6"
            style={canProceed() ? { backgroundColor: accentColor, borderColor: accentColor } : {}}
          >
            Continue →
          </Button>
        ) : (
          <Button
            type="button"
            disabled={loading || !canProceed()}
            onClick={handleSubmit}
            className="px-6"
            style={!loading ? { backgroundColor: accentColor, borderColor: accentColor } : {}}
          >
            {loading ? 'Saving…' : isEdit ? '✓ Update Loan' : '✓ Add Loan'}
          </Button>
        )}
      </div>
    </div>
  )
}
