'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/lib/calculations'
import type { Currency, Loan } from '@/lib/types'
import type { ParsedStatement } from '@/app/api/credit-card/parse-statement/route'

function cur(c: string): Currency { return c as Currency }

async function extractPdfText(buffer: ArrayBuffer, password?: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  // Use a static public path — import.meta.url is unreliable on iOS Safari
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)), ...(password ? { password } : {}) }).promise
  const parts: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    parts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }
  return parts.join('\n')
}


type Step = 'upload' | 'checking' | 'password' | 'parsing' | 'confirm-card' | 'preview' | 'duplicate' | 'importing' | 'done' | 'error'

interface ExistingStatement { id: string; payment_date: string; amount: number; note: string | null }

export default function StatementImportTab() {
  const router = useRouter()
  const [cards, setCards] = useState<Loan[]>([])
  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)
  const [statement, setStatement] = useState<ParsedStatement | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<string>('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [existing, setExisting] = useState<ExistingStatement | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingFile = useRef<File | null>(null)

  useEffect(() => {
    createClient().from('loans').select('*')
      .eq('loan_type', 'credit_card').eq('status', 'active').order('lender_name')
      .then(({ data }) => {
        const loans = (data ?? []) as Loan[]
        setCards(loans)
        // No auto-selection — user must explicitly pick their card
      })
  }, [])

  function reset() {
    setStep('upload')
    setError(null)
    setStatement(null)
    setPassword('')
    setPasswordError(null)
    setExisting(null)
    pendingFile.current = null
    if (fileRef.current) fileRef.current.value = ''
  }

  const selectedCard = cards.find(c => c.id === selectedCardId) ?? null

  async function sendToApi(file: File | null, text: string | null) {
    setStep('parsing')
    const form = new FormData()
    if (text !== null) form.append('text', text)
    else if (file) form.append('pdf', file)

    const res = await fetch('/api/credit-card/parse-statement', { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error ?? 'Parse failed')
    const s: ParsedStatement = data.statement
    setStatement(s)

    // Never auto-match — generic loan names cause wrong matches (e.g. "US Credit Card" → Axis)
    // User always picks explicitly
    setSelectedCardId('')
    setStep('confirm-card')
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    pendingFile.current = file
    setStep('checking')
    setError(null)
    try {
      await extractPdfText(await file.arrayBuffer())
      await sendToApi(file, null)
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'PasswordException') { setStep('password') }
      else { setError(err instanceof Error ? err.message : 'Unknown error'); setStep('error') }
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim() || !pendingFile.current) return
    setPasswordError(null)
    try {
      const text = await extractPdfText(await pendingFile.current.arrayBuffer(), password)
      await sendToApi(null, text)
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'PasswordException') setPasswordError('Incorrect password.')
      else { setError(err instanceof Error ? err.message : 'Unknown error'); setStep('error') }
    }
  }

  async function checkDuplicate(card: Loan): Promise<ExistingStatement | null> {
    if (!statement?.statementDate) return null
    const month = statement.statementDate.slice(0, 7)
    const { data: dup } = await createClient()
      .from('payment_transactions').select('id, payment_date, amount, note')
      .eq('loan_id', card.id).eq('payment_method', 'statement_import')
      .gte('payment_date', `${month}-01`).lte('payment_date', `${month}-31`)
      .maybeSingle()
    return (dup as ExistingStatement | null)
  }

  async function proceedToPreview() {
    if (!statement || !selectedCard) return
    const dup = await checkDuplicate(selectedCard)
    if (dup) { setExisting(dup); setStep('duplicate'); return }
    setStep('preview')
  }

  /** Core import logic — operates on any card (existing or just-created) */
  async function runImport(card: Loan, replaceExistingId?: string) {
    if (!statement) return
    const supabase = createClient()
    const paymentTotal = statement.transactions
      .filter(tx => tx.type === 'payment' || tx.type === 'credit' || tx.amount > 0)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
    const period = statement.statementDate
      ? new Date(statement.statementDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'Unknown period'

    if (replaceExistingId) {
      await supabase.from('payment_transactions').delete().eq('id', replaceExistingId)
    }

    await supabase.from('payment_transactions').insert({
      loan_id: card.id,
      payment_date: statement.statementDate ?? new Date().toISOString().split('T')[0],
      amount: paymentTotal,
      note: `Statement ${period}${statement.newBalance != null ? ` · Balance: ${formatCurrency(statement.newBalance, cur(statement.currency))}` : ''}${statement.dueDate ? ` · Due: ${statement.dueDate}` : ''}`,
      payment_method: 'statement_import',
      principal_applied: null, interest_applied: null, schedule_row_id: null,
    })

    if (statement.newBalance != null) {
      await supabase.from('loans').update({ principal: statement.newBalance }).eq('id', card.id)
      const dueDate = statement.dueDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const { data: schedRows } = await supabase
        .from('payment_schedules').select('id, status').eq('loan_id', card.id).order('installment_number')
      if (schedRows && schedRows.length > 0) {
        const pendingIds = schedRows.filter(r => r.status === 'pending').map(r => r.id)
        if (pendingIds.length > 0) await supabase.from('payment_schedules').delete().in('id', pendingIds)
        await supabase.from('payment_schedules').insert({
          loan_id: card.id,
          installment_number: (schedRows.length - pendingIds.length) + 1,
          contractual_due_date: dueDate, planned_pay_date: dueDate,
          opening_balance: statement.newBalance, emi_amount: statement.newBalance,
          principal_amount: statement.newBalance, interest_amount: 0, closing_balance: 0,
          amount_paid: null, rate: card.interest_rate, status: 'pending',
        })
      }
    }
  }

  async function handleImport(replaceExisting = false) {
    if (!statement || !selectedCard) return
    setStep('importing')
    try {
      await runImport(selectedCard, replaceExisting && existing ? existing.id : undefined)
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed'); setStep('error')
    }
  }

  /** Create a new credit card loan from the parsed statement, then import into it */
  async function handleCreateAndImport() {
    if (!statement) return
    setStep('importing')
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const today = new Date().toISOString().split('T')[0]
      const { data: newLoan, error: loanErr } = await supabase.from('loans').insert({
        user_id: user.id,
        lender_name: statement.bank,
        loan_type: 'credit_card',
        repayment_mode: 'fixed_emi',
        interest_type: 'revolving',
        currency: statement.currency,
        principal: statement.newBalance ?? 0,
        interest_rate: 0,
        start_date: statement.statementDate ?? today,
        status: 'active',
        tenure_months: 1,
      }).select().single()

      if (loanErr || !newLoan) throw new Error(loanErr?.message ?? 'Failed to create card')

      // Create an initial schedule row so the detail page renders correctly
      const dueDate = statement.dueDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      await supabase.from('payment_schedules').insert({
        loan_id: newLoan.id,
        installment_number: 1,
        contractual_due_date: dueDate, planned_pay_date: dueDate,
        opening_balance: statement.newBalance ?? 0, emi_amount: statement.newBalance ?? 0,
        principal_amount: statement.newBalance ?? 0, interest_amount: 0, closing_balance: 0,
        amount_paid: null, rate: 0, status: 'pending',
      })

      await runImport(newLoan as Loan)
      setSelectedCardId(newLoan.id)
      setCards(prev => [...prev, newLoan as Loan])
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create card'); setStep('error')
    }
  }

  const paymentTotal = statement
    ? statement.transactions.filter(tx => tx.type === 'payment' || tx.type === 'credit' || tx.amount > 0)
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
    : 0

  return (
    <div className="space-y-5 max-w-2xl">

      {/* Upload drop zone — always shown at top */}
      {(step === 'upload' || step === 'checking' || step === 'parsing') && (
        <div>
          {step === 'upload' ? (
            <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-14 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
              <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <div className="text-center">
                <p className="text-sm font-medium text-slate-600">Upload PDF statement</p>
                <p className="text-xs text-slate-400 mt-1">Chase, Citi, Amex, Capital One, HDFC, ICICI &amp; more · Password-protected supported · Max 10 MB</p>
              </div>
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFile} />
            </label>
          ) : (
            <div className="flex flex-col items-center py-14 gap-4">
              <div className="w-9 h-9 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              <p className="text-sm text-slate-500">{step === 'checking' ? 'Checking PDF…' : 'Reading statement…'}</p>
            </div>
          )}
        </div>
      )}

      {/* Password prompt */}
      {step === 'password' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 p-4">
            <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-800">Password protected PDF</p>
              <p className="text-xs text-amber-600 mt-1">HDFC → DOB as DDMMYYYY · ICICI → first 4 letters of name + DOB · Axis → customer ID</p>
            </div>
          </div>
          <form onSubmit={handlePasswordSubmit} className="flex gap-2">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="PDF password" autoFocus
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button type="submit" disabled={!password.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors">
              Unlock
            </button>
          </form>
          {passwordError && <p className="text-xs text-red-500">{passwordError}</p>}
          <button onClick={reset} className="text-xs text-slate-400 hover:text-slate-600">← Upload different file</button>
        </div>
      )}

      {/* Confirm which card this statement belongs to */}
      {step === 'confirm-card' && statement && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">

          {/* Parsed statement summary */}
          <div>
            <p className="font-medium text-slate-800">
              Statement read: <span className="text-indigo-600">{statement.bank}</span>
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {statement.statementDate ?? '—'} · Balance:{' '}
              {statement.newBalance != null ? formatCurrency(statement.newBalance, cur(statement.currency)) : '—'}
              {statement.dueDate ? ` · Due: ${statement.dueDate}` : ''}
            </p>
          </div>

          {/* Primary action: create this as a new card and import immediately */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Recommended</p>
            <button onClick={handleCreateAndImport}
              className="w-full text-left rounded-xl border-2 border-indigo-300 bg-indigo-50 px-4 py-3 hover:bg-indigo-100 hover:border-indigo-400 transition-all group">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-indigo-800 group-hover:text-indigo-900">
                    Add &ldquo;{statement.bank}&rdquo; and import
                  </p>
                  <p className="text-xs text-indigo-500 mt-0.5">
                    Creates a new {statement.currency} credit card · imports this statement instantly
                  </p>
                </div>
                <svg className="w-5 h-5 text-indigo-400 shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
            </button>
          </div>

          {/* Secondary: link to an existing card */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Or link to an existing card
            </p>
            {cards.length === 0 ? (
              <p className="text-xs text-slate-400">No active credit card loans found.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {cards.map(card => {
                  const currencyMismatch = card.currency !== statement.currency
                  return (
                    <button key={card.id} onClick={() => setSelectedCardId(card.id)}
                      className={`text-left rounded-lg border px-3 py-2.5 transition-all text-sm ${
                        selectedCardId === card.id
                          ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300'
                          : currencyMismatch
                            ? 'border-slate-200 opacity-50 hover:opacity-70'
                            : 'border-slate-200 hover:border-indigo-200'
                      }`}>
                      <p className="font-medium text-slate-800">{card.lender_name}</p>
                      <p className="text-xs text-slate-400">
                        {card.currency} · {card.interest_rate}% p.a.
                        {currencyMismatch && <span className="ml-1 text-amber-500">· different currency</span>}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1 border-t border-slate-100">
            <button onClick={reset} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
              ← Back
            </button>
            <button onClick={proceedToPreview} disabled={!selectedCardId}
              className="flex-1 px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-30 transition-colors">
              {selectedCardId
                ? `Import into ${cards.find(c => c.id === selectedCardId)?.lender_name} →`
                : 'Select an existing card above'}
            </button>
          </div>
        </div>
      )}

      {/* Duplicate warning */}
      {step === 'duplicate' && statement && existing && selectedCard && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-3">
            <p className="text-sm font-semibold text-amber-800">A statement already exists for {selectedCard.lender_name} this month</p>
            <div className="space-y-1">
              <p className="text-xs text-amber-700">Existing: <span className="font-medium">{existing.note ?? `${formatCurrency(existing.amount, selectedCard.currency)} on ${existing.payment_date}`}</span></p>
              <p className="text-xs text-amber-700">
                New: Balance <span className="font-medium">{statement.newBalance != null ? formatCurrency(statement.newBalance, cur(statement.currency)) : '—'}</span>
                {paymentTotal > 0 && <> · Payment <span className="font-medium">{formatCurrency(paymentTotal, cur(statement.currency))}</span></>}
              </p>
            </div>
            <p className="text-xs text-amber-600 border-t border-amber-200 pt-2">
              💡 If this is a <strong>different physical card</strong> (e.g. Chase vs Amex), go to{' '}
              <a href="/loans/new" className="underline font-medium">Loans → Add Loan</a> and create a separate entry for each card, then re-import.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={() => handleImport(true)}
              className="w-full px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors">
              Replace — same card, updated statement
            </button>
            <button onClick={() => { setStep('preview') }}
              className="w-full px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
              Import anyway — this is a different card
            </button>
            <button onClick={reset} className="text-xs text-slate-400 hover:text-slate-600 text-center">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Preview */}
      {step === 'preview' && statement && selectedCard && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-800">{selectedCard.lender_name}</p>
              <p className="text-xs text-slate-400">{statement.bank} · {statement.statementDate ?? '—'}</p>
            </div>
            <button onClick={() => setStep('confirm-card')} className="text-xs text-slate-400 hover:text-slate-600">Change card</button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'Closing Balance', value: statement.newBalance != null ? formatCurrency(statement.newBalance, cur(statement.currency)) : '—', highlight: true },
              { label: 'Due Date', value: statement.dueDate ?? '—' },
              { label: 'Minimum Due', value: statement.minimumDue != null ? formatCurrency(statement.minimumDue, cur(statement.currency)) : '—' },
            ].map(({ label, value, highlight }) => (
              <div key={label} className={`rounded-lg border px-3 py-2 ${highlight ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
                <p className="text-xs text-slate-400">{label}</p>
                <p className={`text-sm font-semibold mt-0.5 ${highlight ? 'text-indigo-700' : 'text-slate-700'}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">What gets recorded</p>
            {paymentTotal > 0
              ? <div className="flex justify-between text-sm"><span className="text-slate-600">Payment toward card</span><span className="font-semibold text-emerald-600">{formatCurrency(paymentTotal, cur(statement.currency))}</span></div>
              : <p className="text-xs text-slate-400">No payments found in this statement period.</p>}
            {statement.newBalance != null && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">{selectedCard.lender_name} balance updated to</span>
                <span className="font-semibold text-slate-800">{formatCurrency(statement.newBalance, cur(statement.currency))}</span>
              </div>
            )}
          </div>

          <button onClick={() => handleImport(false)}
            className="w-full px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
            Import Statement
          </button>
        </div>
      )}

      {/* Importing */}
      {step === 'importing' && (
        <div className="flex flex-col items-center py-14 gap-4">
          <div className="w-9 h-9 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Saving…</p>
        </div>
      )}

      {/* Done */}
      {step === 'done' && selectedCard && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 space-y-4 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-800">Statement imported</p>
              <p className="text-xs text-emerald-600 mt-1">{selectedCard.lender_name} balance and payment history updated.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push(`/loans/${selectedCard.id}`)}
              className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors">
              View {selectedCard.lender_name} →
            </button>
            <button onClick={reset}
              className="flex-1 px-4 py-2 rounded-lg border border-emerald-300 text-sm text-emerald-700 hover:bg-emerald-100 transition-colors">
              Import another
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {step === 'error' && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 space-y-2">
          <p className="text-sm font-medium text-red-700">Failed to import</p>
          <p className="text-xs text-red-500">{error}</p>
          <button onClick={reset} className="text-xs font-medium text-red-600 underline">Try again</button>
        </div>
      )}
    </div>
  )
}
