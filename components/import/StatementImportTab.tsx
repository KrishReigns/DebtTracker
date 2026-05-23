'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/lib/calculations'
import type { Currency, Loan } from '@/lib/types'
import type { ParsedStatement } from '@/app/api/credit-card/parse-statement/route'

function cur(c: string): Currency { return c as Currency }

/** Extract all text from a PDF using pdfjs-dist (client-side, supports passwords) */
async function extractPdfText(buffer: ArrayBuffer, password?: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    ...(password ? { password } : {}),
  })
  const doc = await loadingTask.promise
  const parts: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    parts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }
  return parts.join('\n')
}

type Step = 'select' | 'upload' | 'checking' | 'password' | 'parsing' | 'preview' | 'duplicate' | 'importing' | 'done' | 'error'

interface ExistingStatement {
  id: string
  payment_date: string
  amount: number
  note: string | null
}

export default function StatementImportTab() {
  const router = useRouter()
  const [cards, setCards] = useState<Loan[]>([])
  const [selectedCard, setSelectedCard] = useState<Loan | null>(null)
  const [step, setStep] = useState<Step>('select')
  const [error, setError] = useState<string | null>(null)
  const [statement, setStatement] = useState<ParsedStatement | null>(null)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [existing, setExisting] = useState<ExistingStatement | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingFile = useRef<File | null>(null)

  useEffect(() => {
    createClient()
      .from('loans')
      .select('*')
      .eq('loan_type', 'credit_card')
      .order('lender_name')
      .then(({ data }) => setCards((data ?? []) as Loan[]))
  }, [])

  function reset() {
    setStep(selectedCard ? 'upload' : 'select')
    setError(null)
    setStatement(null)
    setPassword('')
    setPasswordError(null)
    setExisting(null)
    pendingFile.current = null
    if (fileRef.current) fileRef.current.value = ''
  }

  function selectCard(card: Loan) {
    setSelectedCard(card)
    setStep('upload')
    reset()
  }

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

    // Check for same-month existing statement for this card
    if (s.statementDate && selectedCard) {
      const month = s.statementDate.slice(0, 7) // YYYY-MM
      const { data: existing } = await createClient()
        .from('payment_transactions')
        .select('id, payment_date, amount, note')
        .eq('loan_id', selectedCard.id)
        .eq('payment_method', 'statement_import')
        .gte('payment_date', `${month}-01`)
        .lte('payment_date', `${month}-31`)
        .maybeSingle()

      if (existing) {
        setExisting(existing as ExistingStatement)
        setStep('duplicate')
        return
      }
    }

    setStep('preview')
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    pendingFile.current = file
    setStep('checking')
    setError(null)

    try {
      const buffer = await file.arrayBuffer()
      await extractPdfText(buffer) // probe for password
      await sendToApi(file, null)
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'PasswordException') {
        setStep('password')
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setStep('error')
      }
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim() || !pendingFile.current) return
    setPasswordError(null)
    try {
      const buffer = await pendingFile.current.arrayBuffer()
      const text = await extractPdfText(buffer, password)
      await sendToApi(null, text)
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'PasswordException') {
        setPasswordError('Incorrect password. Please try again.')
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setStep('error')
      }
    }
  }

  async function handleImport(replaceExisting = false) {
    if (!statement || !selectedCard) return
    setStep('importing')

    try {
      const supabase = createClient()
      const totalPaid = statement.transactions
        .filter(tx => tx.type === 'payment' || tx.type === 'credit' || tx.amount > 0)
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0)

      const period = statement.statementDate
        ? new Date(statement.statementDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        : 'Unknown period'

      const record = {
        loan_id: selectedCard.id,
        payment_date: statement.statementDate ?? new Date().toISOString().split('T')[0],
        amount: totalPaid,
        note: `Statement ${period}${statement.newBalance != null ? ` · Balance: ${formatCurrency(statement.newBalance, cur(statement.currency))}` : ''}${statement.dueDate ? ` · Due: ${statement.dueDate}` : ''}`,
        payment_method: 'statement_import',
        principal_applied: null,
        interest_applied: null,
        schedule_row_id: null,
      }

      if (replaceExisting && existing) {
        await supabase.from('payment_transactions').delete().eq('id', existing.id)
      }

      const { error: dbErr } = await supabase.from('payment_transactions').insert(record)
      if (dbErr) throw new Error(dbErr.message)

      // Update the loan's principal to the current statement balance so the card always shows current debt
      if (statement.newBalance != null) {
        await supabase
          .from('loans')
          .update({ principal: statement.newBalance })
          .eq('id', selectedCard.id)
      }

      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('error')
    }
  }

  const paymentTotal = statement
    ? statement.transactions
        .filter(tx => tx.type === 'payment' || tx.type === 'credit' || tx.amount > 0)
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
    : 0

  return (
    <div className="space-y-6">
      {/* Card selector */}
      <div>
        <h3 className="text-sm font-medium text-slate-700 mb-3">Select Credit Card</h3>
        {cards.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">
            No credit card loans found. <a href="/loans/new" className="text-indigo-600 underline">Add one first →</a>
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cards.map(card => (
              <button
                key={card.id}
                onClick={() => selectCard(card)}
                className={`text-left rounded-xl border px-4 py-3 transition-all ${
                  selectedCard?.id === card.id
                    ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300'
                    : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/30'
                }`}
              >
                <p className="font-medium text-sm text-slate-800">{card.lender_name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{card.currency} · {card.interest_rate}% p.a.</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Upload area — only shown when a card is selected */}
      {selectedCard && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-800">{selectedCard.lender_name}</p>
              <p className="text-xs text-slate-400 mt-0.5">Upload a monthly statement PDF</p>
            </div>
            <button onClick={reset} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
              Change file
            </button>
          </div>

          {/* idle */}
          {step === 'upload' && (
            <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-10 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
              <svg className="w-9 h-9 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <div className="text-center">
                <p className="text-sm font-medium text-slate-600">Click to upload PDF statement</p>
                <p className="text-xs text-slate-400 mt-1">Chase, Citi, Amex, Capital One, HDFC, ICICI &amp; more · Password-protected supported · Max 10 MB</p>
              </div>
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFile} />
            </label>
          )}

          {/* checking / parsing */}
          {(step === 'checking' || step === 'parsing') && (
            <div className="flex flex-col items-center py-12 gap-4">
              <div className="w-9 h-9 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              <p className="text-sm text-slate-500">{step === 'checking' ? 'Checking PDF…' : 'Reading statement…'}</p>
            </div>
          )}

          {/* password */}
          {step === 'password' && (
            <div className="space-y-4">
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
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="PDF password"
                  autoFocus
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!password.trim()}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                >
                  Unlock
                </button>
              </form>
              {passwordError && <p className="text-xs text-red-500">{passwordError}</p>}
            </div>
          )}

          {/* duplicate warning */}
          {step === 'duplicate' && statement && existing && (
            <div className="space-y-4">
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-2">
                <p className="text-sm font-semibold text-amber-800">Statement already imported for this month</p>
                <p className="text-xs text-amber-700">
                  Existing: <span className="font-medium">{existing.note ?? `${formatCurrency(existing.amount, selectedCard.currency)} on ${existing.payment_date}`}</span>
                </p>
                <p className="text-xs text-amber-700">
                  New: Statement balance{' '}
                  <span className="font-medium">{statement.newBalance != null ? formatCurrency(statement.newBalance, cur(statement.currency)) : '—'}</span>
                  {paymentTotal > 0 && <> · Payment <span className="font-medium">{formatCurrency(paymentTotal, cur(statement.currency))}</span></>}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={reset} className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => handleImport(true)}
                  className="flex-1 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
                >
                  Replace existing
                </button>
              </div>
            </div>
          )}

          {/* preview */}
          {step === 'preview' && statement && (
            <div className="space-y-4">
              {/* Summary grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Bank', value: statement.bank },
                  { label: 'Statement Date', value: statement.statementDate ?? '—' },
                  { label: 'Due Date', value: statement.dueDate ?? '—' },
                  { label: 'Closing Balance', value: statement.newBalance != null ? formatCurrency(statement.newBalance, cur(statement.currency)) : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="text-sm font-semibold text-slate-700 mt-0.5 truncate">{value}</p>
                  </div>
                ))}
              </div>

              {statement.minimumDue != null && (
                <p className="text-xs text-slate-400">Minimum due: <span className="font-medium text-slate-600">{formatCurrency(statement.minimumDue, cur(statement.currency))}</span></p>
              )}

              {/* What will be recorded */}
              <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-4 space-y-2">
                <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">What gets recorded</p>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Payment toward card</span>
                  <span className="font-semibold text-emerald-600">{formatCurrency(paymentTotal, cur(statement.currency))}</span>
                </div>
                {statement.newBalance != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Card balance updated to</span>
                    <span className="font-semibold text-slate-800">{formatCurrency(statement.newBalance, cur(statement.currency))}</span>
                  </div>
                )}
                <p className="text-xs text-indigo-500 mt-1">One entry per statement period. Your card&apos;s outstanding balance will reflect the closing balance.</p>
              </div>

              <button
                onClick={() => handleImport(false)}
                className="w-full px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Import Statement
              </button>
            </div>
          )}

          {/* importing */}
          {step === 'importing' && (
            <div className="flex flex-col items-center py-12 gap-4">
              <div className="w-9 h-9 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              <p className="text-sm text-slate-500">Saving statement…</p>
            </div>
          )}

          {/* done */}
          {step === 'done' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-8 gap-3 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-slate-700">Statement imported</p>
                <p className="text-xs text-slate-400 max-w-xs">
                  {selectedCard.lender_name}&apos;s balance and payment history have been updated.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { router.push(`/loans/${selectedCard.id}`) }}
                  className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  View {selectedCard.lender_name} →
                </button>
                <button
                  onClick={() => { reset(); setStep('upload') }}
                  className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                >
                  Import another
                </button>
              </div>
            </div>
          )}

          {/* error */}
          {step === 'error' && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-4 space-y-2">
              <p className="text-sm font-medium text-red-700">Failed to import</p>
              <p className="text-xs text-red-500">{error}</p>
              <button onClick={reset} className="text-xs font-medium text-red-600 underline">Try again</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
