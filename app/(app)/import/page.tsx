'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase'
import { generateSchedule, calculateEMI } from '@/lib/calculations'
import { LOAN_TYPE_LABELS, type LoanType, type Currency, type InterestType, type RepaymentMode } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

interface ImportRow {
  lender_name: string
  loan_type: LoanType
  repayment_mode: RepaymentMode
  principal: number
  interest_rate: number
  start_date: string
  tenure_months: number
  emi_amount?: number
  currency: Currency
  interest_type: InterestType
  account_number?: string
  notes?: string
}

const EXAMPLE_CSV = `lender_name,loan_type,currency,principal,interest_rate,start_date,tenure_months,emi_amount,interest_type,repayment_mode,account_number,notes
SBI Education Loan,student_loan,INR,3000000,11.6,2025-03-01,62,65000,reducing,fixed_emi,SBI123,
Axis Bank PL,personal_loan,INR,200000,13.25,2021-08-05,60,4576,reducing,fixed_emi,PPR029206321830,
India Credit Card,credit_card,INR,42000,30,2026-04-01,12,6000,revolving,fixed_emi,,
Uncle Raj,family,INR,100000,24,2024-01-01,24,,simple,flexible_manual,,2% per month`

// Parse CSV text (handles quoted fields)
function parseCSVText(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCSVLine(lines[0])
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] ?? '').trim() })
    return obj
  })
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

function rowToLoan(row: Record<string, string>): ImportRow | null {
  const principal = parseFloat(row.principal)
  if (!row.lender_name || isNaN(principal) || principal <= 0) return null
  const tenure = parseInt(row.tenure_months) || 12
  const rate = parseFloat(row.interest_rate) || 0
  const emi = parseFloat(row.emi_amount) || undefined
  const loanType = (row.loan_type as LoanType) || 'personal_loan'
  const defaultMode: RepaymentMode = loanType === 'family' ? 'flexible_manual' : 'fixed_emi'
  return {
    lender_name: row.lender_name.trim(),
    loan_type: loanType,
    repayment_mode: (row.repayment_mode as RepaymentMode) || defaultMode,
    principal,
    interest_rate: rate,
    start_date: row.start_date || new Date().toISOString().split('T')[0],
    tenure_months: tenure,
    emi_amount: emi,
    currency: (row.currency as Currency) || 'INR',
    interest_type: (row.interest_type as InterestType) || 'reducing',
    account_number: row.account_number?.trim() || undefined,
    notes: row.notes?.trim() || undefined,
  }
}

// Parse XLSX file → rows
function parseXLSX(buffer: ArrayBuffer): Record<string, string>[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false, defval: '' })
  return raw.map(row =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [String(k).trim(), String(v).trim()]))
  )
}

type InputMode = 'upload' | 'paste'

export default function ImportPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<InputMode>('upload')
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ImportRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [importError, setImportError] = useState('')
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)

  function processRows(rows: Record<string, string>[]) {
    const errors: string[] = []
    const loans: ImportRow[] = []
    rows.forEach((row, i) => {
      const loan = rowToLoan(row)
      if (loan) {
        loans.push(loan)
      } else {
        errors.push(`Row ${i + 2}: "${row.lender_name || '(blank)'}" skipped — missing lender name or invalid principal`)
      }
    })
    setPreview(loans)
    setParseErrors(errors)
    if (loans.length === 0 && errors.length === 0) {
      setParseErrors(['No rows found. Check that your file has a header row and data rows.'])
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setPreview([])
    setParseErrors([])

    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'csv' || ext === 'txt') {
      const text = await file.text()
      setCsvText(text)
      processRows(parseCSVText(text))
    } else if (ext === 'xlsx' || ext === 'xls') {
      const buffer = await file.arrayBuffer()
      const rows = parseXLSX(buffer)
      processRows(rows)
    } else {
      setParseErrors([`Unsupported file type: .${ext}. Use CSV or XLSX.`])
    }
  }

  function handlePaste() {
    processRows(parseCSVText(csvText))
  }

  async function handleImport() {
    if (preview.length === 0) return
    setLoading(true)
    setImportError('')
    setProgress({ current: 0, total: preview.length })

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setImportError('Not authenticated'); setLoading(false); return }

    for (let idx = 0; idx < preview.length; idx++) {
      const loan = preview[idx]
      setProgress({ current: idx + 1, total: preview.length })

      const isFlexible = loan.repayment_mode === 'flexible_manual'
      const emi = isFlexible ? null
        : (loan.emi_amount ?? calculateEMI(loan.principal, loan.interest_rate, loan.tenure_months))

      const { data: inserted, error: err } = await supabase.from('loans').insert({
        user_id: user.id,
        loan_type: loan.loan_type,
        repayment_mode: loan.repayment_mode,
        lender_name: loan.lender_name,
        account_number: loan.account_number ?? null,
        principal: loan.principal,
        interest_rate: loan.interest_rate,
        interest_type: loan.interest_type,
        start_date: loan.start_date,
        tenure_months: isFlexible ? null : loan.tenure_months,
        emi_amount: emi,
        payment_day: isFlexible ? null : 1,
        currency: loan.currency,
        status: 'active',
        notes: loan.notes ?? null,
      }).select('id').single()

      if (err) { setImportError(err.message); setLoading(false); return }

      if (!isFlexible) {
        const schedule = generateSchedule(
          loan.principal, loan.interest_rate, loan.tenure_months,
          loan.start_date, loan.interest_type, emi ?? undefined
        )

        // All rows start as 'pending' — never auto-mark past-due rows as paid.
        // User must explicitly record payments after import to reflect real history.
        await supabase.from('payments').insert(schedule.map(row => ({
          loan_id: inserted.id,
          due_date: row.date,
          amount_due: row.emi,
          principal_component: row.principal,
          interest_component: row.interest,
          status: 'pending',
        })))

        await supabase.from('payment_schedules').insert(schedule.map((row, i) => ({
          loan_id: inserted.id,
          installment_number: i + 1,
          contractual_due_date: row.date,
          opening_balance: row.openingBalance,
          emi_amount: row.emi,
          principal_amount: row.principal,
          interest_amount: row.interest,
          closing_balance: row.closingBalance,
          rate: loan.interest_rate,
          status: 'pending',
        })))
        // No payment_transactions created on import — only real recorded payments create transactions.
      }
    }

    setDone(true)
    setLoading(false)
    setTimeout(() => router.push('/loans'), 2000)
  }

  if (done) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-gray-900">Import Complete!</h2>
        <p className="text-gray-500 mt-2">Redirecting to your loans…</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import Loans</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload a file or paste CSV. Each row = one loan. Schedules auto-generated.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === 'upload' ? 'default' : 'outline'}
          onClick={() => { setMode('upload'); setPreview([]); setParseErrors([]) }}
        >Upload File</Button>
        <Button
          size="sm"
          variant={mode === 'paste' ? 'default' : 'outline'}
          onClick={() => { setMode('paste'); setPreview([]); setParseErrors([]) }}
        >Paste CSV</Button>
      </div>

      {/* File upload */}
      {mode === 'upload' && (
        <Card>
          <CardContent className="pt-6">
            <div
              className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                const file = e.dataTransfer.files[0]
                if (file && fileInputRef.current) {
                  const dt = new DataTransfer()
                  dt.items.add(file)
                  fileInputRef.current.files = dt.files
                  fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
                }
              }}
            >
              <div className="text-3xl mb-2">📂</div>
              <p className="text-sm font-medium text-gray-700">
                {fileName ? `Selected: ${fileName}` : 'Click to choose or drag & drop'}
              </p>
              <p className="text-xs text-gray-400 mt-1">Supports CSV (.csv), Excel (.xlsx, .xls)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,.txt"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
            {fileName && preview.length === 0 && parseErrors.length === 0 && (
              <p className="text-xs text-gray-400 mt-2 text-center">Processing…</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* CSV paste */}
      {mode === 'paste' && (
        <div className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-sm">Expected columns</CardTitle></CardHeader>
            <CardContent>
              <pre className="text-xs bg-gray-50 rounded p-3 overflow-x-auto text-gray-600 whitespace-pre">{EXAMPLE_CSV}</pre>
              <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={() => setCsvText(EXAMPLE_CSV)}>
                Load Example
              </Button>
            </CardContent>
          </Card>
          <div className="space-y-2">
            <Label>Paste CSV data</Label>
            <Textarea
              rows={8}
              placeholder="lender_name,loan_type,currency,principal,..."
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              className="font-mono text-xs"
            />
            <Button onClick={handlePaste} disabled={!csvText.trim()}>Parse & Preview</Button>
          </div>
        </div>
      )}

      {/* Parse errors */}
      {parseErrors.length > 0 && (
        <div className="space-y-1">
          {parseErrors.map((e, i) => (
            <p key={i} className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-1.5">{e}</p>
          ))}
        </div>
      )}

      {/* Preview table */}
      {preview.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{preview.length} loans ready to import</CardTitle>
              <div className="flex gap-2">
                {preview.filter(l => l.repayment_mode === 'fixed_emi').length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {preview.filter(l => l.repayment_mode === 'fixed_emi').length} Fixed EMI
                  </Badge>
                )}
                {preview.filter(l => l.repayment_mode === 'flexible_manual').length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {preview.filter(l => l.repayment_mode === 'flexible_manual').length} Flexible
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b">
                  <th className="text-left pb-2 pr-3">Lender</th>
                  <th className="text-left pb-2 pr-3">Type</th>
                  <th className="text-left pb-2 pr-3">Mode</th>
                  <th className="text-left pb-2 pr-3">CCY</th>
                  <th className="text-right pb-2 pr-3">Principal</th>
                  <th className="text-right pb-2 pr-3">Rate</th>
                  <th className="text-right pb-2 pr-3">Mo.</th>
                  <th className="text-left pb-2">Interest</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((l, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1.5 pr-3 font-medium">{l.lender_name}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{LOAN_TYPE_LABELS[l.loan_type]}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${l.repayment_mode === 'fixed_emi' ? 'bg-indigo-50 text-indigo-700' : 'bg-green-50 text-green-700'}`}>
                        {l.repayment_mode === 'fixed_emi' ? 'Fixed' : 'Flexible'}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">{l.currency}</td>
                    <td className="py-1.5 pr-3 text-right">{l.principal.toLocaleString('en-IN')}</td>
                    <td className="py-1.5 pr-3 text-right">{l.interest_rate}%</td>
                    <td className="py-1.5 pr-3 text-right">{l.repayment_mode === 'flexible_manual' ? '—' : l.tenure_months}</td>
                    <td className="py-1.5 text-gray-600 capitalize">{l.interest_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {importError && <p className="text-sm text-red-600 mt-3">{importError}</p>}

            {progress && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Importing {progress.current} of {progress.total}…</span>
                  <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className="bg-indigo-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="mt-4 flex gap-3">
              <Button onClick={handleImport} disabled={loading}>
                {loading ? `Importing ${progress?.current}/${progress?.total}…` : `Import ${preview.length} Loans`}
              </Button>
              <Button variant="outline" onClick={() => { setPreview([]); setFileName(''); if (fileInputRef.current) fileInputRef.current.value = '' }}>
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Field reference */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Column Reference</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {[
              ['lender_name', 'Bank or person name', 'required'],
              ['loan_type', 'student_loan | personal_loan | family | credit_card | gold_loan', 'required'],
              ['currency', 'INR or USD', 'required'],
              ['principal', 'Original loan amount', 'required'],
              ['interest_rate', 'Annual rate in %', 'required'],
              ['start_date', 'YYYY-MM-DD', 'required'],
              ['tenure_months', 'Number of months', 'fixed-EMI'],
              ['emi_amount', 'Leave blank to auto-calculate', 'optional'],
              ['interest_type', 'reducing | flat | simple | revolving | bullet', 'optional'],
              ['repayment_mode', 'fixed_emi | flexible_manual (auto-set for family)', 'optional'],
              ['account_number', 'Bank account/agreement number', 'optional'],
              ['notes', 'Any notes', 'optional'],
            ].map(([col, desc, tag]) => (
              <div key={col} className="flex gap-2 py-1 border-b border-gray-50">
                <span className="font-mono text-indigo-600 w-32 shrink-0">{col}</span>
                <span className="text-gray-500 flex-1">{desc}</span>
                <span className={`text-xs shrink-0 ${tag === 'required' ? 'text-red-500' : 'text-gray-400'}`}>{tag}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
