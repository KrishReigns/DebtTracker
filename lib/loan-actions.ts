/**
 * Loan state actions — shared helpers called from every payment entry point.
 * All functions are client-safe (use browser Supabase client).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeFamilyLoanState, computeDailyAccruedInterest, allocatePayment } from './calculations'
import type { RepaymentMode, FamilyLoanState, ScheduleStatus } from './types'
import { todayISO } from './utils'

// ---------------------------------------------------------------------------
// Pure status computation (testable without DB)
// ---------------------------------------------------------------------------

/**
 * Determine the correct loan status based on schedule rows (fixed-EMI)
 * or family loan state (flexible).
 */
export function computeNewLoanStatus(
  repaymentMode: RepaymentMode,
  scheduleRows: Array<{ status: ScheduleStatus }>,
  familyState?: FamilyLoanState,
  interestType?: string
): 'active' | 'closed' {
  // Revolving credit cards never auto-close: paying off a statement doesn't end
  // the card, and a closed card disappears from the import picker (which then
  // creates duplicate cards). Closing a card is a manual action only.
  if (interestType === 'revolving') return 'active'
  if (repaymentMode === 'fixed_emi') {
    if (scheduleRows.length === 0) return 'active'
    const allSettled = scheduleRows.every(r => r.status === 'paid' || r.status === 'skipped')
    return allSettled ? 'closed' : 'active'
  }
  // flexible_manual — closed only when principal AND accrued interest are settled
  if (!familyState) return 'active'
  return familyState.totalPayable <= 0.01 ? 'closed' : 'active'
}

// ---------------------------------------------------------------------------
// DB-side sync
// ---------------------------------------------------------------------------

/**
 * After any payment state change, recompute and persist loans.status.
 * Handles both fixed-EMI (schedule-based) and flexible (transaction-based).
 */
export async function syncLoanStatus(loanId: string, supabase: SupabaseClient) {
  const { data: loan } = await supabase
    .from('loans')
    .select('repayment_mode, principal, interest_rate, start_date, status, interest_type')
    .eq('id', loanId)
    .single()
  if (!loan) return

  // Revolving cards: status is manual-only (see computeNewLoanStatus) — don't
  // auto-close on all-paid, and don't reopen a card the user closed on purpose.
  if (loan.interest_type === 'revolving') return

  let newStatus: 'active' | 'closed'

  if (loan.repayment_mode === 'fixed_emi') {
    const { data: rows } = await supabase
      .from('payment_schedules')
      .select('status')
      .eq('loan_id', loanId)
    newStatus = computeNewLoanStatus('fixed_emi', rows ?? [], undefined, loan.interest_type)
  } else {
    const { data: txs } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('loan_id', loanId)
      .order('payment_date')
    const today = todayISO()
    const familyState = computeFamilyLoanState(
      loan.principal, loan.interest_rate, loan.start_date,
      txs ?? [], today
    )
    newStatus = computeNewLoanStatus('flexible_manual', [], familyState)
  }

  if (newStatus !== loan.status) {
    await supabase.from('loans').update({ status: newStatus }).eq('id', loanId)
  }
}

// ---------------------------------------------------------------------------
// Fixed-EMI: mark a schedule row paid or unpaid
// ---------------------------------------------------------------------------

/**
 * Mark a schedule row as paid. Within 1 currency unit of emi_amount → 'paid'
 * (UI shows amounts rounded to whole units, so paying the rounded figure is full),
 * otherwise 'partial'. Creates a payment_transaction and syncs legacy payments + loan status.
 */
export async function markScheduleRowPaid(
  loanId: string,
  scheduleRowId: string,
  contractualDueDate: string,
  emiAmount: number,
  principalAmount: number,
  interestAmount: number,
  paidAmount: number,
  paymentDate: string,
  note: string | null,
  paymentMethod: string | null,
  supabase: SupabaseClient
) {
  const isFullPayment = paidAmount > emiAmount - 1
  const newStatus: ScheduleStatus = isFullPayment ? 'paid' : 'partial'

  // Upsert: remove any existing transaction for this schedule row first
  const { error: delErr } = await supabase
    .from('payment_transactions')
    .delete()
    .eq('schedule_row_id', scheduleRowId)
  if (delErr) throw new Error(`Could not update payment record: ${delErr.message}`)

  // Overpayment beyond the scheduled EMI counts as extra principal, so the
  // applied fields always sum to the cash actually paid
  const extraPrincipal = Math.max(0, paidAmount - emiAmount)
  const { error: insErr } = await supabase.from('payment_transactions').insert({
    loan_id: loanId,
    schedule_row_id: scheduleRowId,
    payment_date: paymentDate,
    amount: paidAmount,
    principal_applied: isFullPayment ? principalAmount + extraPrincipal : Math.max(0, paidAmount - interestAmount),
    interest_applied: isFullPayment ? Math.min(interestAmount, paidAmount) : Math.min(paidAmount, interestAmount),
    note,
    payment_method: paymentMethod,
  })
  if (insErr) throw new Error(`Payment record failed to save: ${insErr.message}`)

  // planned_pay_date tracks the actual date paid (auto-set on payment, reflects reality)
  const { error: updErr } = await supabase
    .from('payment_schedules')
    .update({ status: newStatus, amount_paid: paidAmount, planned_pay_date: paymentDate })
    .eq('id', scheduleRowId)
  if (updErr) throw new Error(`Schedule update failed: ${updErr.message}`)

  await syncLoanStatus(loanId, supabase)
}

/**
 * Revert a schedule row to pending. Removes transaction and resets loan if needed.
 */
export async function markScheduleRowUnpaid(
  loanId: string,
  scheduleRowId: string,
  contractualDueDate: string,
  supabase: SupabaseClient
) {
  await supabase
    .from('payment_schedules')
    .update({ status: 'pending', amount_paid: null, planned_pay_date: null })
    .eq('id', scheduleRowId)

  await supabase
    .from('payment_transactions')
    .delete()
    .eq('schedule_row_id', scheduleRowId)

  await syncLoanStatus(loanId, supabase)
}

// ---------------------------------------------------------------------------
// Flexible: recompute stored allocation fields after any tx change
// ---------------------------------------------------------------------------

/**
 * After editing or deleting a flexible-loan transaction, re-derive
 * principal_applied / interest_applied for every transaction of the loan
 * so the stored fields stay accurate.
 */
export async function recomputeFlexibleAllocations(loanId: string, supabase: SupabaseClient) {
  const { data: loan } = await supabase
    .from('loans')
    .select('principal, interest_rate, start_date')
    .eq('id', loanId)
    .single()
  if (!loan) return

  const { data: txs } = await supabase
    .from('payment_transactions')
    .select('id, payment_date, amount')
    .eq('loan_id', loanId)
    .order('payment_date')
  if (!txs || txs.length === 0) return

  let outstanding = loan.principal
  let lastDate = loan.start_date
  let carriedInterest = 0 // unpaid interest shortfall carries to the next payment

  for (const tx of txs) {
    const accrued = carriedInterest + computeDailyAccruedInterest(outstanding, loan.interest_rate, lastDate, tx.payment_date)
    const { principalApplied, interestApplied, remainingBalance } = allocatePayment(outstanding, accrued, tx.amount)
    carriedInterest = Math.max(0, Math.round((accrued - interestApplied) * 100) / 100)

    await supabase
      .from('payment_transactions')
      .update({ principal_applied: principalApplied, interest_applied: interestApplied })
      .eq('id', tx.id)

    outstanding = remainingBalance
    lastDate = tx.payment_date
  }
}
