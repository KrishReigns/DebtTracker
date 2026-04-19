'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase'
import { generateSchedule, calculateEMI } from '@/lib/calculations'
import { LOAN_TYPE_LABELS, type LoanType, type Currency, type InterestType, type RepaymentMode } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// ── Types ─────────────────────────────────────────────────────────────────────
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

type Step = 'upload' | 'map' | 'preview'

// ── Field definitions ─────────────────────────────────────────────────────────
const APP_FIELDS: { key: string; label: string; required: boolean; desc: string }[] = [
  { key: 'lender_name',   label: 'Lender Name',       required: true,  desc: 'Bank or person name' },
  { key: 'principal',     label: 'Principal Amount',   required: true,  desc: 'Original loan amount (number)' },
  { key: 'interest_rate', label: 'Interest Rate (%)',  required: true,  desc: 'Annual % e.g. 11.6' },
  { key: 'start_date',    label: 'Start Date',         required: true,  desc: 'Any date format' },
  { key: 'loan_type',     label: 'Loan Type',          required: false, desc: 'student_loan | personal_loan | family | credit_card | gold_loan' },
  { key: 'currency',      label: 'Currency',           required: false, desc: 'INR or USD (default: INR)' },
  { key: 'tenure_months', label: 'Tenure (months)',    required: false, desc: 'Number of months' },
  { key: 'emi_amount',    label: 'EMI Amount',         required: false, desc: 'Auto-calculated if blank' },
  { key: 'interest_type', label: 'Interest Type',      required: false, desc: 'reducing | flat | simple | revolving | bullet' },
  { key: 'repayment_mode',label: 'Repayment Mode',     required: false, desc: 'fixed_emi | flexible_manual' },
  { key: 'account_number',label: 'Account Number',     required: false, desc: 'Loan reference / account no.' },
  { key: 'notes',         label: 'Notes',              required: false, desc: 'Any remarks' },
]

// ── Synonyms for fuzzy matching ───────────────────────────────────────────────
const FIELD_SYNONYMS: Record<string, string[]> = {
  lender_name:   ['lender', 'bank', 'lender name', 'bank name', 'creditor', 'loan name', 'name', 'institution', 'source', 'from', 'borrower', 'person'],
  principal:     ['principal', 'amount', 'loan amount', 'original amount', 'disbursed', 'sanctioned', 'amount taken', 'loan principal', 'total amount', 'face value'],
  interest_rate: ['rate', 'interest rate', 'roi', 'rate of interest', 'interest', 'annual rate', 'apr', 'interest %', 'rate %', 'p.a.'],
  start_date:    ['start date', 'date', 'disbursement date', 'loan date', 'taken date', 'issue date', 'start', 'from date', 'availed date', 'sanction date'],
  loan_type:     ['type', 'loan type', 'category', 'loan category', 'kind', 'loan kind'],
  currency:      ['currency', 'ccy', 'curr', 'currency code'],
  tenure_months: ['tenure', 'months', 'term', 'duration', 'period', 'loan term', 'tenure months', 'no of months', 'no. of months', 'repayment period'],
  emi_amount:    ['emi', 'emi amount', 'monthly payment', 'installment', 'monthly emi', 'monthly installment', 'monthly repayment', 'payment amount'],
  interest_type: ['interest type', 'calculation method', 'type of interest', 'interest method', 'method'],
  repayment_mode:['repayment mode', 'mode', 'repayment type', 'payment type'],
  account_number:['account number', 'account no', 'account no.', 'loan number', 'loan no', 'loan no.', 'ref', 'reference', 'ref no', 'acc no'],
  notes:         ['notes', 'note', 'remarks', 'comments', 'description', 'details', 'info'],
}

// ── Value normalizers ─────────────────────────────────────────────────────────
function normalizeLoanType(val: string): LoanType {
  const v = val.toLowerCase().trim()
  if (v.includes('student') || v.includes('education') || v.includes('educ')) return 'student_loan'
  if (v.includes('personal') || v === 'pl') return 'personal_loan'
  if (v.includes('family') || v.includes('friend') || v.includes('relative') || v.includes('informal')) return 'family'
  if (v.includes('credit') || v.includes('card') || v.includes('cc')) return 'credit_card'
  if (v.includes('gold')) return 'gold_loan'
  if (v.includes('home') || v.includes('house') || v.includes('mortgage') || v.includes('property')) return 'home_loan'
  if (v.includes('car') || v.includes('vehicle') || v.includes('auto')) return 'car_loan'
  // try exact enum
  const VALID: LoanType[] = ['student_loan','personal_loan','family','credit_card','gold_loan','home_loan','car_loan']
  if (VALID.includes(v as LoanType)) return v as LoanType
  return 'personal_loan'
}

function normalizeDate(val: string): string {
  if (!val) return new Date().toISOString().split('T')[0]
  const trimmed = val.trim()
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`
  // MM/DD/YYYY
  const mdy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (mdy) {
    const m = parseInt(mdy[1]), d = parseInt(mdy[2])
    if (m <= 12 && d > 12) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`
  }
  // D-Mon-YYYY or Mon-YYYY
  const monMap: Record<string,string> = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' }
  const dmon = trimmed.match(/^(\d{1,2})[\-\s]([a-zA-Z]{3})[\-\s](\d{4})$/)
  if (dmon) {
    const mon = monMap[dmon[2].toLowerCase()]
    if (mon) return `${dmon[3]}-${mon}-${dmon[1].padStart(2,'0')}`
  }
  // Try JS Date parse as fallback
  const parsed = new Date(trimmed)
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0]
  return new Date().toISOString().split('T')[0]
}

function normalizeInterestType(val: string): InterestType {
  const v = val.toLowerCase().trim()
  if (v.includes('flat')) return 'flat'
  if (v.includes('simple')) return 'simple'
  if (v.includes('revolv')) return 'revolving'
  if (v.includes('bullet')) return 'bullet'
  return 'reducing'
}

function normalizeRepaymentMode(val: string, loanType: LoanType): RepaymentMode {
  const v = val.toLowerCase().trim()
  if (v.includes('flexible') || v.includes('manual') || v.includes('irregular')) return 'flexible_manual'
  if (loanType === 'family') return 'flexible_manual'
  return 'fixed_emi'
}

// ── Fuzzy column detector ─────────────────────────────────────────────────────
function detectColumnMapping(headers: string[]): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  const usedHeaders = new Set<string>()

  for (const field of APP_FIELDS.map(f => f.key)) {
    const synonyms = FIELD_SYNONYMS[field] ?? []
    let bestHeader: string | null = null
    let bestScore = 0

    for (const header of headers) {
      if (usedHeaders.has(header)) continue
      const h = header.toLowerCase().trim()
      let score = 0

      for (const syn of synonyms) {
        if (h === syn) { score = 1.0; break }
        if (h === syn.replace(/\s+/g, '_')) { score = 0.95; break }
        if (h.includes(syn) || syn.includes(h)) { score = Math.max(score, 0.8); break }
        // word-level overlap
        const hWords = h.split(/[\s_\-\.\/]+/).filter(Boolean)
        const sWords = syn.split(/[\s_\-\.\/]+/).filter(Boolean)
        const overlap = hWords.filter(w => sWords.some(s => s === w || s.startsWith(w) || w.startsWith(s))).length
        if (overlap > 0) score = Math.max(score, 0.5 + overlap * 0.1)
      }

      if (score > bestScore) { bestScore = score; bestHeader = header }
    }

    if (bestScore >= 0.5 && bestHeader) {
      result[field] = bestHeader
      usedHeaders.add(bestHeader)
    } else {
      result[field] = null
    }
  }

  return result
}

// ── Apply mapping to transform a raw row into ImportRow ───────────────────────
function applyMapping(raw: Record<string, string>, map: Record<string, string | null>): ImportRow | null {
  const get = (field: string) => (map[field] ? raw[map[field]!] ?? '' : '').trim()

  const lenderName = get('lender_name')
  const principalStr = get('principal').replace(/[₹$,\s]/g, '')
  const principal = parseFloat(principalStr)

  if (!lenderName || isNaN(principal) || principal <= 0) return null

  const rateStr = get('interest_rate').replace(/[%\s]/g, '')
  const rate = parseFloat(rateStr) || 0
  const tenure = parseInt(get('tenure_months')) || 12
  const emiStr = get('emi_amount').replace(/[₹$,\s]/g, '')
  const emi = parseFloat(emiStr) || undefined

  const loanType = normalizeLoanType(get('loan_type') || 'personal_loan')
  const mode = normalizeRepaymentMode(get('repayment_mode'), loanType)

  return {
    lender_name:    lenderName,
    loan_type:      loanType,
    repayment_mode: mode,
    principal,
    interest_rate:  rate,
    start_date:     normalizeDate(get('start_date')),
    tenure_months:  tenure,
    emi_amount:     emi,
    currency:       (get('currency').toUpperCase() as Currency) || 'INR',
    interest_type:  normalizeInterestType(get('interest_type')),
    account_number: get('account_number') || undefined,
    notes:          get('notes') || undefined,
  }
}

// ── CSV parsers ───────────────────────────────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++ } else inQ = !inQ }
    else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else cur += ch
  }
  result.push(cur)
  return result
}
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
function parseXLSX(buffer: ArrayBuffer): Record<string, string>[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false, defval: '' })
  return raw.map(row =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [String(k).trim(), String(v).trim()]))
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ImportPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [rawHeaders, setRawHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [columnMap, setColumnMap] = useState<Record<string, string | null>>({})
  const [preview, setPreview] = useState<ImportRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [importError, setImportError] = useState('')
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)

  // ── After file parsed: go to mapper step ──────────────────────────────────
  function handleRawRows(rows: Record<string, string>[]) {
    if (rows.length === 0) {
      setParseErrors(['No rows found. Check that your file has a header row and data rows.'])
      return
    }
    const headers = Object.keys(rows[0])
    setRawHeaders(headers)
    setRawRows(rows)
    const detected = detectColumnMapping(headers)
    setColumnMap(detected)
    setStep('map')
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseErrors([])
    setStep('upload')

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'csv' || ext === 'txt') {
      const text = await file.text()
      handleRawRows(parseCSVText(text))
    } else if (ext === 'xlsx' || ext === 'xls') {
      const buffer = await file.arrayBuffer()
      handleRawRows(parseXLSX(buffer))
    } else {
      setParseErrors([`Unsupported file type: .${ext}. Use CSV, XLSX, or XLS.`])
    }
  }

  // ── Apply mapping → build preview ────────────────────────────────────────
  function applyAndPreview() {
    const errors: string[] = []
    const loans: ImportRow[] = []
    rawRows.forEach((row, i) => {
      const loan = applyMapping(row, columnMap)
      if (loan) loans.push(loan)
      else errors.push(`Row ${i + 2}: skipped — missing lender name or invalid principal`)
    })
    setPreview(loans)
    setParseErrors(errors)
    setStep('preview')
  }

  // ── Import loans ─────────────────────────────────────────────────────────
  async function handleImport() {
    if (preview.length === 0) return
    setLoading(true); setImportError('')
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
        const { error: paymentsErr } = await supabase.from('payments').insert(schedule.map(row => ({
          loan_id: inserted.id, due_date: row.date, amount_due: row.emi,
          principal_component: row.principal, interest_component: row.interest, status: 'pending',
        })))
        if (paymentsErr) console.warn('payments insert failed for loan', inserted.id, paymentsErr.message)

        const { error: scheduleErr } = await supabase.from('payment_schedules').insert(schedule.map((row, i) => ({
          loan_id: inserted.id, installment_number: i + 1,
          contractual_due_date: row.date, opening_balance: row.openingBalance,
          emi_amount: row.emi, principal_amount: row.principal, interest_amount: row.interest,
          closing_balance: row.closingBalance, rate: loan.interest_rate, status: 'pending',
        })))
        if (scheduleErr) { setImportError(`Schedule insert failed: ${scheduleErr.message}`); setLoading(false); return }
      }
    }

    setDone(true); setLoading(false)
    const t = setTimeout(() => router.push('/loans'), 2000)
    return () => clearTimeout(t)
  }

  // ── Done screen ───────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-gray-900">Import Complete!</h2>
        <p className="text-gray-500 mt-2">Redirecting to your loans…</p>
      </div>
    )
  }

  const requiredMissing = APP_FIELDS.filter(f => f.required && !columnMap[f.key])

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import Loans</h1>
        <p className="text-sm text-gray-500 mt-1">Upload any spreadsheet — the app will detect and map your columns automatically.</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(['upload', 'map', 'preview'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-slate-200" />}
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-medium transition-colors ${
              step === s ? 'bg-indigo-600 text-white'
              : (['upload','map','preview'] as Step[]).indexOf(step) > i ? 'bg-indigo-50 text-indigo-600'
              : 'text-slate-400'
            }`}>
              <span className="w-4 h-4 rounded-full border flex items-center justify-center text-xs">
                {(['upload','map','preview'] as Step[]).indexOf(step) > i ? '✓' : i + 1}
              </span>
              {s === 'upload' ? 'Upload' : s === 'map' ? 'Map Columns' : 'Preview & Import'}
            </div>
          </div>
        ))}
      </div>

      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                const file = e.dataTransfer.files[0]
                if (file && fileInputRef.current) {
                  const dt = new DataTransfer(); dt.items.add(file)
                  fileInputRef.current.files = dt.files
                  fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
                }
              }}
            >
              <div className="text-4xl mb-3">📂</div>
              <p className="text-sm font-semibold text-gray-700">
                {fileName ? `Selected: ${fileName}` : 'Click to choose or drag & drop your file'}
              </p>
              <p className="text-xs text-gray-400 mt-1">Supports CSV · Excel (.xlsx / .xls) · Any column names</p>
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden" onChange={handleFileUpload} />
            </div>

            {parseErrors.map((e, i) => (
              <p key={i} className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{e}</p>
            ))}

            {/* Example format hint */}
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-slate-600 mb-2">Works with any column names, e.g.:</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500">
                {[
                  ['"Bank Name"', '→ Lender Name'],
                  ['"Loan Amount"', '→ Principal'],
                  ['"ROI"', '→ Interest Rate'],
                  ['"Date Taken"', '→ Start Date'],
                  ['"No. of Months"', '→ Tenure'],
                  ['"Monthly EMI"', '→ EMI Amount'],
                ].map(([raw, mapped]) => (
                  <div key={raw} className="flex gap-1">
                    <span className="font-mono text-indigo-600">{raw}</span>
                    <span>{mapped}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Column Mapper ── */}
      {step === 'map' && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Map Your Columns</CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                We found <strong>{rawHeaders.length} columns</strong> in your file. Review the detected mappings below and adjust if needed.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {APP_FIELDS.map(field => (
                  <div key={field.key} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                    <div className="w-36 shrink-0">
                      <p className="text-sm font-medium text-slate-700">{field.label}</p>
                      <p className="text-xs text-slate-400">{field.desc}</p>
                    </div>
                    <div className="flex-1">
                      <select
                        value={columnMap[field.key] ?? ''}
                        onChange={e => setColumnMap(prev => ({ ...prev, [field.key]: e.target.value || null }))}
                        className={`w-full border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white ${
                          !columnMap[field.key] && field.required
                            ? 'border-red-300 bg-red-50'
                            : columnMap[field.key]
                            ? 'border-emerald-300 bg-emerald-50'
                            : 'border-slate-200'
                        }`}
                      >
                        <option value="">— Not in file —</option>
                        {rawHeaders.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-20 shrink-0">
                      {field.required ? (
                        <Badge variant="outline" className="text-xs text-red-600 border-red-200">required</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">optional</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {requiredMissing.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-sm font-medium text-amber-800">Map required fields to continue:</p>
              <p className="text-xs text-amber-700 mt-1">{requiredMissing.map(f => f.label).join(', ')}</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={applyAndPreview}
              disabled={requiredMissing.length > 0}
            >
              Apply Mapping → Preview {rawRows.length} rows
            </Button>
            <Button variant="outline" onClick={() => { setStep('upload'); setFileName(''); if (fileInputRef.current) fileInputRef.current.value = '' }}>
              ← Back
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Preview & Import ── */}
      {step === 'preview' && (
        <div className="space-y-4">
          {parseErrors.length > 0 && (
            <div className="space-y-1">
              {parseErrors.map((e, i) => (
                <p key={i} className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-1.5">{e}</p>
              ))}
            </div>
          )}

          {preview.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg">No valid rows found</p>
              <p className="text-sm mt-1">Check the column mapping — lender name and principal are required.</p>
              <Button variant="outline" className="mt-4" onClick={() => setStep('map')}>← Adjust Mapping</Button>
            </div>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{preview.length} loans ready to import</CardTitle>
                  <div className="flex gap-2">
                    {preview.filter(l => l.repayment_mode === 'fixed_emi').length > 0 && (
                      <Badge variant="outline" className="text-xs">{preview.filter(l => l.repayment_mode === 'fixed_emi').length} Fixed EMI</Badge>
                    )}
                    {preview.filter(l => l.repayment_mode === 'flexible_manual').length > 0 && (
                      <Badge variant="outline" className="text-xs">{preview.filter(l => l.repayment_mode === 'flexible_manual').length} Flexible</Badge>
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
                      <th className="text-left pb-2">Start</th>
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
                        <td className="py-1.5 text-gray-500">{l.start_date}</td>
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
                      <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                    </div>
                  </div>
                )}

                <div className="mt-4 flex gap-3">
                  <Button onClick={handleImport} disabled={loading}>
                    {loading ? `Importing ${progress?.current}/${progress?.total}…` : `Import ${preview.length} Loans`}
                  </Button>
                  <Button variant="outline" onClick={() => setStep('map')}>← Adjust Mapping</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
