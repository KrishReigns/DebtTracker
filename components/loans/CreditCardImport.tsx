'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/lib/calculations'
import type { Currency } from '@/lib/types'
import type { ParsedStatement } from '@/app/api/credit-card/parse-statement/route'

function cur(c: string): Currency { return c as Currency }

interface Props {
  loanId: string
  currency: string
  onImported: () => void
}

type Step = 'idle' | 'checking' | 'password' | 'parsing' | 'preview' | 'importing' | 'done' | 'error'

/** Extract all text from a PDF using pdfjs-dist (client-side, supports passwords) */
async function extractPdfText(buffer: ArrayBuffer, password?: string): Promise<string> {
  // Dynamic import keeps pdfjs out of the server bundle
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    ...(password ? { password } : {}),
  })

  const doc = await loadingTask.promise
  const parts: string[] = []

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    parts.push(pageText)
  }

  return parts.join('\n')
}

export default function CreditCardImport({ loanId, currency, onImported }: Props) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [statement, setStatement] = useState<ParsedStatement | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingBuffer = useRef<ArrayBuffer | null>(null)
  const pendingFile = useRef<File | null>(null)

  function reset() {
    setStep('idle')
    setError(null)
    setStatement(null)
    setSelected(new Set())
    setPassword('')
    setPasswordError(null)
    pendingBuffer.current = null
    pendingFile.current = null
    if (fileRef.current) fileRef.current.value = ''
  }

  function close() { reset(); setOpen(false) }

  async function sendToApi(file: File | null, text: string | null) {
    setStep('parsing')
    const form = new FormData()
    if (text !== null) {
      form.append('text', text)
    } else if (file) {
      form.append('pdf', file)
    }
    const res = await fetch('/api/credit-card/parse-statement', { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error ?? 'Parse failed')

    const s: ParsedStatement = data.statement
    setStatement(s)
    const payments = new Set<number>()
    s.transactions.forEach((tx, i) => {
      if (tx.type === 'payment' || tx.amount > 0) payments.add(i)
    })
    setSelected(payments)
    setStep('preview')
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStep('checking')
    setError(null)

    const buffer = await file.arrayBuffer()
    pendingBuffer.current = buffer
    pendingFile.current = file

    try {
      // Probe the PDF — will throw PasswordException if protected
      await extractPdfText(buffer)
      // Not password-protected — send raw PDF to Claude for best accuracy
      await sendToApi(file, null)
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name ?? ''
      if (name === 'PasswordException') {
        // Password protected — prompt user
        setStep('password')
        setPasswordError(null)
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setStep('error')
      }
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim() || !pendingBuffer.current) return
    setPasswordError(null)

    try {
      const text = await extractPdfText(pendingBuffer.current, password)
      await sendToApi(null, text)
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name ?? ''
      if (name === 'PasswordException') {
        setPasswordError('Incorrect password. Please try again.')
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setStep('error')
      }
    }
  }

  function toggleAll(checked: boolean) {
    if (checked) setSelected(new Set(statement!.transactions.map((_, i) => i)))
    else setSelected(new Set())
  }

  function toggleRow(i: number) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  async function handleImport() {
    if (!statement || selected.size === 0) return
    setStep('importing')
    setError(null)
    try {
      const supabase = createClient()
      const rows = [...selected].map(i => {
        const tx = statement.transactions[i]
        return {
          loan_id: loanId,
          payment_date: tx.date,
          amount: Math.abs(tx.amount),
          note: `[Imported] ${tx.description}`,
          payment_method: 'statement_import',
          principal_applied: null,
          interest_applied: null,
          schedule_row_id: null,
        }
      })
      const { error: dbErr } = await supabase.from('payment_transactions').insert(rows)
      if (dbErr) throw new Error(dbErr.message)
      setStep('done')
      setTimeout(() => { close(); onImported() }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('error')
    }
  }

  const selectedTotal = statement
    ? [...selected].reduce((sum, i) => sum + Math.abs(statement.transactions[i].amount), 0)
    : 0

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Import Statement
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-semibold text-slate-800">Import Credit Card Statement</h2>
                <p className="text-xs text-slate-400 mt-0.5">Upload a PDF statement to import payment history</p>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

              {/* idle */}
              {step === 'idle' && (
                <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-12 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
                  <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-600">Click to upload PDF statement</p>
                    <p className="text-xs text-slate-400 mt-1">Chase, Citi, Amex, Capital One, HDFC, ICICI &amp; more · Password-protected PDFs supported · Max 10 MB</p>
                  </div>
                  <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFile} />
                </label>
              )}

              {/* checking / parsing */}
              {(step === 'checking' || step === 'parsing') && (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <div className="w-10 h-10 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                  <p className="text-sm text-slate-500">
                    {step === 'checking' ? 'Checking PDF…' : 'Reading your statement…'}
                  </p>
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
                      <p className="text-sm font-medium text-amber-800">This PDF is password protected</p>
                      <p className="text-xs text-amber-600 mt-1">
                        Common passwords: HDFC → your DOB (DDMMYYYY) · ICICI → first 4 letters of name + DOB · Axis → customer ID
                      </p>
                    </div>
                  </div>
                  <form onSubmit={handlePasswordSubmit} className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">PDF Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Enter PDF password"
                        autoFocus
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      {passwordError && <p className="text-xs text-red-500 mt-1">{passwordError}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={reset} className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                        ← Different file
                      </button>
                      <button
                        type="submit"
                        disabled={!password.trim()}
                        className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Unlock &amp; Parse
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* error */}
              {step === 'error' && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-4 space-y-3">
                  <p className="text-sm font-medium text-red-700">Could not parse statement</p>
                  <p className="text-xs text-red-500">{error}</p>
                  <button onClick={reset} className="text-xs font-medium text-red-600 underline">Try again</button>
                </div>
              )}

              {/* preview */}
              {step === 'preview' && statement && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Bank', value: statement.bank },
                      { label: 'Closing Date', value: statement.statementDate ?? '—' },
                      { label: 'Due Date', value: statement.dueDate ?? '—' },
                      { label: 'New Balance', value: statement.newBalance != null ? formatCurrency(statement.newBalance, cur(statement.currency)) : '—' },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                        <p className="text-xs text-slate-400">{label}</p>
                        <p className="text-sm font-semibold text-slate-700 mt-0.5 truncate">{value}</p>
                      </div>
                    ))}
                  </div>

                  {statement.minimumDue != null && (
                    <p className="text-xs text-slate-400">
                      Minimum due: <span className="font-medium text-slate-600">{formatCurrency(statement.minimumDue, cur(statement.currency))}</span>
                    </p>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-slate-700">
                        Transactions <span className="text-slate-400 font-normal">({statement.transactions.length} found)</span>
                      </p>
                      <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                        <input type="checkbox" className="rounded" checked={selected.size === statement.transactions.length} onChange={e => toggleAll(e.target.checked)} />
                        Select all
                      </label>
                    </div>
                    <p className="text-xs text-slate-400 mb-2">
                      Payments (money paid to card) are pre-selected. Deselect charges you don&apos;t want to import.
                    </p>
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="overflow-x-auto max-h-64">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 sticky top-0">
                            <tr>
                              <th className="w-8 px-3 py-2" />
                              <th className="text-left px-3 py-2 text-slate-500 font-medium">Date</th>
                              <th className="text-left px-3 py-2 text-slate-500 font-medium">Description</th>
                              <th className="text-left px-3 py-2 text-slate-500 font-medium">Type</th>
                              <th className="text-right px-3 py-2 text-slate-500 font-medium">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {statement.transactions.map((tx, i) => (
                              <tr key={i} className={`cursor-pointer transition-colors ${selected.has(i) ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`} onClick={() => toggleRow(i)}>
                                <td className="px-3 py-2">
                                  <input type="checkbox" className="rounded pointer-events-none" checked={selected.has(i)} readOnly />
                                </td>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{tx.date}</td>
                                <td className="px-3 py-2 text-slate-700 max-w-[200px] truncate">{tx.description}</td>
                                <td className="px-3 py-2"><TypeBadge type={tx.type} /></td>
                                <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${tx.amount > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                  {tx.amount > 0 ? '+' : ''}{formatCurrency(Math.abs(tx.amount), cur(statement.currency))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {selected.size > 0 && (
                      <p className="text-xs text-slate-500 mt-2">
                        {selected.size} transaction{selected.size !== 1 ? 's' : ''} selected ·{' '}
                        <span className="font-medium text-slate-700">{formatCurrency(selectedTotal, cur(statement.currency))} total</span>
                        {' '}will be added as payment records
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* done */}
              {step === 'done' && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-slate-700">Imported successfully</p>
                </div>
              )}
            </div>

            {/* Footer */}
            {step === 'preview' && statement && (
              <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
                <button onClick={reset} className="text-sm text-slate-500 hover:text-slate-700 transition-colors">
                  ← Upload different file
                </button>
                <button
                  onClick={handleImport}
                  disabled={selected.size === 0}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Import {selected.size} transaction{selected.size !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const TYPE_STYLES: Record<string, string> = {
  payment:  'bg-emerald-50 text-emerald-700',
  credit:   'bg-sky-50 text-sky-700',
  charge:   'bg-slate-100 text-slate-600',
  fee:      'bg-amber-50 text-amber-700',
  interest: 'bg-rose-50 text-rose-700',
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${TYPE_STYLES[type] ?? 'bg-slate-100 text-slate-500'}`}>
      {type}
    </span>
  )
}
