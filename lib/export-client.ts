/**
 * Re-exports + helpers for client components.
 * Keeps export.ts importable from both server and client contexts.
 */
export {
  exportScheduleCSV,
  exportScheduleXLSX,
  exportSchedulePDF,
  exportFlexibleCSV,
  exportFlexibleXLSX,
  exportFlexiblePDF,
  exportLoansCSV,
  exportLoansXLSX,
  exportLoansPDF,
} from './export'

export type { LoansExportRow } from './export'

import type { PaymentPlanRow, PaymentTransaction, Loan, FamilyLoanState } from './types'
import type { FlexibleExportRow } from './export'
import { buildFlexiblePlanner } from './calculations'

/**
 * Build planner export rows from DB plan rows + transactions.
 */
export function buildFlexibleExportRows(
  planRows: PaymentPlanRow[],
  transactions: PaymentTransaction[],
  loan: Loan,
  state: FamilyLoanState
): FlexibleExportRow[] {
  const today = new Date().toISOString().split('T')[0]
  const sortedTx = [...transactions].sort((a, b) => a.payment_date.localeCompare(b.payment_date))

  const plannerRows = buildFlexiblePlanner(
    state.outstandingPrincipal,
    loan.interest_rate,
    today,
    planRows,
    sortedTx
  )

  return plannerRows.map(r => ({
    index: r.index,
    date: r.date,
    openingBalance: r.openingBalance,
    plannedPayment: r.plannedPayment,
    interestApplied: r.interestApplied,
    principalApplied: r.principalApplied,
    closingBalance: r.closingBalance,
    isPaid: r.isPaid,
  }))
}
