/**
 * Export engine — CSV, XLSX, PDF
 * All functions are client-side safe (no Node-only APIs).
 */
import * as XLSX from 'xlsx'
import type { Loan, PaymentSchedule, PaymentTransaction, FamilyLoanState } from './types'
import { LOAN_TYPE_LABELS } from './types'
import { formatCurrency } from './calculations'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * jsPDF built-in fonts (Helvetica/Courier/Times) do not include the ₹ glyph.
 * Substitute with "Rs." for all currency values written into PDF tables/text.
 * CSV and XLSX outputs are unaffected and keep the original ₹ symbol.
 */
function pdfFmt(amount: number, currency: 'INR' | 'USD'): string {
  return formatCurrency(amount, currency).replace('₹', 'Rs.')
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function toCSV(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [
    headers.join(','),
    ...rows.map(r =>
      headers.map(h => {
        const v = String(r[h] ?? '')
        return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v
      }).join(',')
    ),
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Loans list export
// ---------------------------------------------------------------------------

export interface LoansExportRow {
  loan: Loan
  outstandingPrincipal: number
  totalPaid: number
  scheduleCount: number
  paidCount: number
}

function loansToRows(data: LoansExportRow[]): Record<string, string | number>[] {
  return data.map(({ loan, outstandingPrincipal, totalPaid, scheduleCount, paidCount }) => ({
    'Lender': loan.lender_name,
    'Type': LOAN_TYPE_LABELS[loan.loan_type],
    'Mode': loan.repayment_mode === 'fixed_emi' ? 'Fixed EMI' : 'Flexible',
    'Currency': loan.currency,
    'Principal': loan.principal,
    'Interest Rate (%)': loan.interest_rate,
    'Interest Type': loan.interest_type,
    'Start Date': loan.start_date,
    'Tenure (months)': loan.tenure_months ?? '',
    'EMI Amount': loan.emi_amount ?? '',
    'Outstanding': outstandingPrincipal,
    'Total Paid': totalPaid,
    'EMIs Paid': paidCount,
    'Total EMIs': scheduleCount,
    'Account No.': loan.account_number ?? '',
    'Status': loan.status,
    'Notes': loan.notes ?? '',
  }))
}

export function exportLoansCSV(data: LoansExportRow[], filename = 'loans.csv') {
  const rows = loansToRows(data)
  const csv = toCSV(rows)
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename)
}

export function exportLoansXLSX(data: LoansExportRow[], filename = 'loans.xlsx') {
  const rows = loansToRows(data)
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Loans')
  XLSX.writeFile(wb, filename)
}

export async function exportLoansPDF(data: LoansExportRow[], filename = 'loans.pdf') {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: 'landscape' })

  doc.setFontSize(16)
  doc.text('Debt Tracker — Loans Summary', 14, 16)
  doc.setFontSize(10)
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 14, 23)

  autoTable(doc, {
    startY: 28,
    head: [['Lender', 'Type', 'Mode', 'CCY', 'Principal', 'Rate', 'Outstanding', 'Paid', 'EMIs', 'Status']],
    body: data.map(({ loan, outstandingPrincipal, totalPaid, scheduleCount, paidCount }) => [
      loan.lender_name,
      LOAN_TYPE_LABELS[loan.loan_type],
      loan.repayment_mode === 'fixed_emi' ? 'Fixed' : 'Flexible',
      loan.currency,
      pdfFmt(loan.principal, loan.currency),
      `${loan.interest_rate}%`,
      pdfFmt(outstandingPrincipal, loan.currency),
      pdfFmt(totalPaid, loan.currency),
      `${paidCount}/${scheduleCount}`,
      loan.status,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [99, 102, 241] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })

  doc.save(filename)
}

// ---------------------------------------------------------------------------
// Fixed-EMI loan detail export
// ---------------------------------------------------------------------------

export function exportScheduleCSV(loan: Loan, scheduleRows: PaymentSchedule[], filename?: string) {
  const rows = scheduleRows.map(r => ({
    '#': r.installment_number,
    'Due Date': r.contractual_due_date,
    'Opening Balance': r.opening_balance,
    'EMI': r.emi_amount,
    'Interest': r.interest_amount,
    'Principal': r.principal_amount,
    'Closing Balance': r.closing_balance,
    'Status': r.status,
  }))
  const csv = toCSV(rows)
  triggerDownload(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    filename ?? `${loan.lender_name.replace(/\s+/g, '_')}_schedule.csv`
  )
}

export function exportScheduleXLSX(loan: Loan, scheduleRows: PaymentSchedule[], transactions: PaymentTransaction[], filename?: string) {
  const scheduleData = scheduleRows.map(r => ({
    '#': r.installment_number,
    'Due Date': r.contractual_due_date,
    'Opening Balance': r.opening_balance,
    'EMI': r.emi_amount,
    'Interest': r.interest_amount,
    'Principal': r.principal_amount,
    'Closing Balance': r.closing_balance,
    'Status': r.status,
  }))

  const txData = transactions.map(t => ({
    'Payment Date': t.payment_date,
    'Amount': t.amount,
    'Principal Applied': t.principal_applied ?? '',
    'Interest Applied': t.interest_applied ?? '',
    'Method': t.payment_method ?? '',
    'Note': t.note ?? '',
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scheduleData), 'Schedule')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txData), 'Transactions')
  XLSX.writeFile(wb, filename ?? `${loan.lender_name.replace(/\s+/g, '_')}.xlsx`)
}

export async function exportSchedulePDF(loan: Loan, scheduleRows: PaymentSchedule[], filename?: string) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: 'landscape' })

  doc.setFontSize(16)
  doc.text(`${loan.lender_name} — Repayment Schedule`, 14, 16)
  doc.setFontSize(10)
  doc.text(
    `Principal: ${pdfFmt(loan.principal, loan.currency)}  |  Rate: ${loan.interest_rate}% p.a.  |  Type: ${loan.interest_type}`,
    14, 23
  )
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 14, 29)

  const paidCount = scheduleRows.filter(r => r.status === 'paid').length

  autoTable(doc, {
    startY: 34,
    head: [['#', 'Due Date', 'Opening', 'EMI', 'Interest', 'Principal', 'Closing', 'Status']],
    body: scheduleRows.map(r => [
      r.installment_number,
      r.contractual_due_date,
      pdfFmt(r.opening_balance, loan.currency),
      pdfFmt(r.emi_amount, loan.currency),
      pdfFmt(r.interest_amount, loan.currency),
      pdfFmt(r.principal_amount, loan.currency),
      pdfFmt(r.closing_balance, loan.currency),
      r.status.toUpperCase(),
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [99, 102, 241] },
    didParseCell: (data) => {
      if (data.column.index === 7 && data.section === 'body') {
        if (data.cell.raw === 'PAID') data.cell.styles.textColor = [22, 163, 74]
        else if (data.cell.raw === 'OVERDUE') data.cell.styles.textColor = [220, 38, 38]
      }
    },
    foot: [[
      '', '', '', '', '', '', '',
      `${paidCount}/${scheduleRows.length} paid`
    ]],
    footStyles: { fillColor: [243, 244, 246], textColor: [75, 85, 99] },
  })

  doc.save(filename ?? `${loan.lender_name.replace(/\s+/g, '_')}_schedule.pdf`)
}

// ---------------------------------------------------------------------------
// Flexible loan detail export
// ---------------------------------------------------------------------------

export interface FlexibleExportRow {
  index: number
  date: string | null
  openingBalance: number
  plannedPayment: number
  interestApplied: number
  principalApplied: number
  closingBalance: number
  isPaid: boolean
}

export function exportFlexibleCSV(loan: Loan, transactions: PaymentTransaction[], plannerRows: FlexibleExportRow[], filename?: string) {
  const txRows = transactions.map(t => ({
    'Payment Date': t.payment_date,
    'Amount': t.amount,
    'Principal Applied': t.principal_applied ?? '',
    'Interest Applied': t.interest_applied ?? '',
    'Method': t.payment_method ?? '',
    'Note': t.note ?? '',
  }))

  const planRows = plannerRows.map(r => ({
    '#': r.index,
    'Planned Date': r.date ?? '',
    'Opening Balance': r.openingBalance,
    'Planned Payment': r.plannedPayment,
    'Interest Applied': r.interestApplied,
    'Principal Applied': r.principalApplied,
    'Closing Balance': r.closingBalance,
    'Status': r.isPaid ? 'Paid' : 'Planned',
  }))

  const csv = ['=== Payment History ===', toCSV(txRows), '', '=== Repayment Planner ===', toCSV(planRows)].join('\n')
  triggerDownload(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    filename ?? `${loan.lender_name.replace(/\s+/g, '_')}_flexible.csv`
  )
}

export function exportFlexibleXLSX(loan: Loan, transactions: PaymentTransaction[], plannerRows: FlexibleExportRow[], state: FamilyLoanState, filename?: string) {
  const txData = transactions.map(t => ({
    'Payment Date': t.payment_date,
    'Amount': t.amount,
    'Principal Applied': t.principal_applied ?? '',
    'Interest Applied': t.interest_applied ?? '',
    'Method': t.payment_method ?? '',
    'Note': t.note ?? '',
  }))

  const planData = plannerRows.map(r => ({
    '#': r.index,
    'Planned Date': r.date ?? '',
    'Opening Balance': r.openingBalance,
    'Planned Payment': r.plannedPayment,
    'Interest Applied': r.interestApplied,
    'Principal Applied': r.principalApplied,
    'Closing Balance': r.closingBalance,
    'Status': r.isPaid ? 'Paid' : 'Planned',
  }))

  const summaryData = [
    { 'Field': 'Lender', 'Value': loan.lender_name },
    { 'Field': 'Original Principal', 'Value': loan.principal },
    { 'Field': 'Outstanding Principal', 'Value': state.outstandingPrincipal },
    { 'Field': 'Accrued Interest', 'Value': state.accruedInterest },
    { 'Field': 'Total Payable', 'Value': state.totalPayable },
    { 'Field': 'Total Paid', 'Value': state.totalPaid },
    { 'Field': 'Interest Rate', 'Value': `${loan.interest_rate}% p.a.` },
    { 'Field': 'Currency', 'Value': loan.currency },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), 'Summary')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txData), 'Transactions')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(planData), 'Planner')
  XLSX.writeFile(wb, filename ?? `${loan.lender_name.replace(/\s+/g, '_')}.xlsx`)
}

export async function exportFlexiblePDF(loan: Loan, transactions: PaymentTransaction[], state: FamilyLoanState, filename?: string) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF()

  doc.setFontSize(16)
  doc.text(`${loan.lender_name} — Loan Summary`, 14, 16)
  doc.setFontSize(10)
  doc.text(`Rate: ${loan.interest_rate}% p.a. (daily accrual, Actual/365)  |  ${loan.currency}`, 14, 23)
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 14, 29)

  // Summary table
  autoTable(doc, {
    startY: 34,
    head: [['Field', 'Amount']],
    body: [
      ['Original Principal', pdfFmt(loan.principal, loan.currency)],
      ['Outstanding Principal', pdfFmt(state.outstandingPrincipal, loan.currency)],
      ['Accrued Interest (to date)', pdfFmt(state.accruedInterest, loan.currency)],
      ['Total Payable Now', pdfFmt(state.totalPayable, loan.currency)],
      ['Total Paid', pdfFmt(state.totalPaid, loan.currency)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [16, 185, 129] },
    columnStyles: { 1: { halign: 'right' } },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const afterSummary = ((doc as any).lastAutoTable?.finalY ?? 80) + 8
  doc.setFontSize(12)
  doc.text('Payment History', 14, afterSummary)

  autoTable(doc, {
    startY: afterSummary + 5,
    head: [['Date', 'Amount', 'Principal', 'Interest', 'Method', 'Note']],
    body: transactions.map(t => [
      t.payment_date,
      pdfFmt(t.amount, loan.currency),
      pdfFmt(t.principal_applied ?? 0, loan.currency),
      pdfFmt(t.interest_applied ?? 0, loan.currency),
      t.payment_method ?? '—',
      t.note ?? '—',
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [16, 185, 129] },
  })

  doc.save(filename ?? `${loan.lender_name.replace(/\s+/g, '_')}.pdf`)
}
