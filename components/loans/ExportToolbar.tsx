'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Loan, PaymentSchedule, PaymentTransaction, PaymentPlanRow, FamilyLoanState } from '@/lib/types'
import {
  exportScheduleCSV, exportScheduleXLSX, exportSchedulePDF,
  exportFlexibleCSV, exportFlexibleXLSX, exportFlexiblePDF,
  buildFlexibleExportRows,
} from '@/lib/export-client'

interface Props {
  loan: Loan
  scheduleRows?: PaymentSchedule[]
  transactions?: PaymentTransaction[]
  planRows?: PaymentPlanRow[]
  familyState?: FamilyLoanState
}

export default function ExportToolbar({ loan, scheduleRows = [], transactions = [], planRows = [], familyState }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const isFlexible = loan.repayment_mode === 'flexible_manual'

  async function run(key: string, fn: () => Promise<void> | void) {
    setLoading(key)
    try { await fn() } finally { setLoading(null) }
  }

  if (isFlexible && familyState) {
    const plannerRows = buildFlexibleExportRows(planRows, transactions, loan, familyState)
    return (
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!!loading}
          onClick={() => run('csv', () => exportFlexibleCSV(loan, transactions, plannerRows))}>
          {loading === 'csv' ? '…' : 'CSV'}
        </Button>
        <Button size="sm" variant="outline" disabled={!!loading}
          onClick={() => run('xlsx', () => exportFlexibleXLSX(loan, transactions, plannerRows, familyState))}>
          {loading === 'xlsx' ? '…' : 'XLSX'}
        </Button>
        <Button size="sm" variant="outline" disabled={!!loading}
          onClick={() => run('pdf', () => exportFlexiblePDF(loan, transactions, familyState))}>
          {loading === 'pdf' ? '…' : 'PDF'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={!!loading}
        onClick={() => run('csv', () => exportScheduleCSV(loan, scheduleRows))}>
        {loading === 'csv' ? '…' : 'CSV'}
      </Button>
      <Button size="sm" variant="outline" disabled={!!loading}
        onClick={() => run('xlsx', () => exportScheduleXLSX(loan, scheduleRows, transactions))}>
        {loading === 'xlsx' ? '…' : 'XLSX'}
      </Button>
      <Button size="sm" variant="outline" disabled={!!loading}
        onClick={() => run('pdf', () => exportSchedulePDF(loan, scheduleRows))}>
        {loading === 'pdf' ? '…' : 'PDF'}
      </Button>
    </div>
  )
}
