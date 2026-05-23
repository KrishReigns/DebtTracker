'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/lib/calculations'
import type { Currency } from '@/lib/types'
import type { ParsedStatement } from '@/app/api/credit-card/parse-statement/route'

// Helper — statement currency is a plain string; cast for formatCurrency
function cur(c: string): Currency { return c as Currency }

interface Props {
  loanId: string
  currency: string
  onImported: () => void
}

type Step = 'idle' | 'parsing' | 'preview' | 'importing' | 'done' | 'error'

export default function CreditCardImport({ loanId, currency, onImported }: Props) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [statement, setStatement] = useState<ParsedStatement | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStep('idle')
    setError(null)
    setStatement(null)
    setSelected(new Set())
    if (fileRef.current) fileRef.current.value = ''
  }

  function close() {
    reset()
    setOpen(false)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStep('parsing')
    setError(null)

    try {
      const form = new FormData()
      form.append('pdf', file)
      const res = await fetch('/api/credit-card/parse-statement', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? 'Parse failed')

      const s: ParsedStatement = data.statement
      setStatement(s)

      // Pre-select all payments (positive amounts = money paid to card)
      const payments = new Set<number>()
      s.transactions.forEach((tx, i) => {
        if (tx.type === 'payment' || tx.amount > 0) payments.add(i)
      })
      setSelected(payments)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStep('error')
    }
  }

  function toggleAll(checked: boolean) {
    if (checked) setSelected(new Set(statement!.transactions.map((_, i) => i)))
    else setSelected(new Set())
  }

  function toggleRow(i: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
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
          amount: Math.abs(tx.amount),   // store as positive — app convention
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
      setTimeout(() => {
        close()
        onImported()
      }, 1200)
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
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Import Statement
      </button>

      {/* Modal */}
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

              {/* Step: idle */}
              {step === 'idle' && (
                <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-12 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
                  <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-600">Click to upload PDF statement</p>
                    <p className="text-xs text-slate-400 mt-1">Works with Chase, Citi, Amex, Capital One, HDFC, ICICI &amp; more · Max 10 MB</p>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={handleFile}
                  />
                </label>
              )}

              {/* Step: parsing */}
              {step === 'parsing' && (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <div className="w-10 h-10 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                  <p className="text-sm text-slate-500">Reading your statement…</p>
                </div>
              )}

              {/* Step: error */}
              {step === 'error' && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-4 space-y-3">
                  <p className="text-sm font-medium text-red-700">Could not parse statement</p>
                  <p className="text-xs text-red-500">{error}</p>
                  <button
                    onClick={reset}
                    className="text-xs font-medium text-red-600 underline"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Step: preview */}
              {step === 'preview' && statement && (
                <div className="space-y-4">
                  {/* Statement summary */}
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
                      Minimum payment due: <span className="font-medium text-slate-600">{formatCurrency(statement.minimumDue, cur(statement.currency))}</span>
                    </p>
                  )}

                  {/* Transaction table */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-slate-700">
                        Transactions <span className="text-slate-400 font-normal">({statement.transactions.length} found)</span>
                      </p>
                      <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selected.size === statement.transactions.length}
                          onChange={e => toggleAll(e.target.checked)}
                        />
                        Select all
                      </label>
                    </div>

                    <p className="text-xs text-slate-400 mb-2">
                      Payments (positive = money paid to card) are pre-selected. Deselect charges you don&apos;t want to import.
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
                              <tr
                                key={i}
                                className={`cursor-pointer transition-colors ${selected.has(i) ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}
                                onClick={() => toggleRow(i)}
                              >
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    className="rounded pointer-events-none"
                                    checked={selected.has(i)}
                                    readOnly
                                  />
                                </td>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{tx.date}</td>
                                <td className="px-3 py-2 text-slate-700 max-w-[200px] truncate">{tx.description}</td>
                                <td className="px-3 py-2">
                                  <TypeBadge type={tx.type} />
                                </td>
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

              {/* Step: done */}
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
