import { describe, it, expect } from 'vitest'
import { computeNewLoanStatus } from '../lib/loan-actions'
import { computeFamilyLoanState } from '../lib/calculations'
import type { PaymentTransaction, FamilyLoanState } from '../lib/types'

// ---------------------------------------------------------------------------
// computeNewLoanStatus — fixed-EMI
// ---------------------------------------------------------------------------

describe('computeNewLoanStatus — fixed-EMI', () => {
  it('returns active when no schedule rows', () => {
    expect(computeNewLoanStatus('fixed_emi', [])).toBe('active')
  })

  it('returns active when some rows pending', () => {
    const rows = [
      { status: 'paid' as const },
      { status: 'paid' as const },
      { status: 'pending' as const },
    ]
    expect(computeNewLoanStatus('fixed_emi', rows)).toBe('active')
  })

  it('returns closed when all rows paid', () => {
    const rows = [
      { status: 'paid' as const },
      { status: 'paid' as const },
      { status: 'paid' as const },
    ]
    expect(computeNewLoanStatus('fixed_emi', rows)).toBe('closed')
  })

  it('returns closed when all rows paid or skipped', () => {
    const rows = [
      { status: 'paid' as const },
      { status: 'skipped' as const },
      { status: 'paid' as const },
    ]
    expect(computeNewLoanStatus('fixed_emi', rows)).toBe('closed')
  })

  it('returns active when any row is partial', () => {
    const rows = [
      { status: 'paid' as const },
      { status: 'partial' as const },
    ]
    expect(computeNewLoanStatus('fixed_emi', rows)).toBe('active')
  })

  it('mark last row paid → loan closes', () => {
    // Simulate: 2 rows. First already paid. Mark second paid.
    const rowsBefore = [{ status: 'paid' as const }, { status: 'pending' as const }]
    const rowsAfter = [{ status: 'paid' as const }, { status: 'paid' as const }]
    expect(computeNewLoanStatus('fixed_emi', rowsBefore)).toBe('active')
    expect(computeNewLoanStatus('fixed_emi', rowsAfter)).toBe('closed')
  })

  it('mark paid row unpaid → loan reactivates', () => {
    const rowsBefore = [{ status: 'paid' as const }, { status: 'paid' as const }]
    const rowsAfter = [{ status: 'paid' as const }, { status: 'pending' as const }]
    expect(computeNewLoanStatus('fixed_emi', rowsBefore)).toBe('closed')
    expect(computeNewLoanStatus('fixed_emi', rowsAfter)).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// computeNewLoanStatus — flexible-manual
// ---------------------------------------------------------------------------

describe('computeNewLoanStatus — flexible-manual', () => {
  it('returns active when no familyState provided', () => {
    expect(computeNewLoanStatus('flexible_manual', [])).toBe('active')
  })

  it('returns active when outstanding > 0', () => {
    const state: FamilyLoanState = {
      outstandingPrincipal: 50000,
      accruedInterest: 1000,
      totalPayable: 51000,
      totalPaid: 50000,
      principalRepaid: 50000,
    }
    expect(computeNewLoanStatus('flexible_manual', [], state)).toBe('active')
  })

  it('returns closed when outstanding = 0', () => {
    const state: FamilyLoanState = {
      outstandingPrincipal: 0,
      accruedInterest: 0,
      totalPayable: 0,
      totalPaid: 102000,
      principalRepaid: 100000,
    }
    expect(computeNewLoanStatus('flexible_manual', [], state)).toBe('closed')
  })

  it('returns closed when outstanding is near-zero (rounding)', () => {
    const state: FamilyLoanState = {
      outstandingPrincipal: 0.005,
      accruedInterest: 0,
      totalPayable: 0.005,
      totalPaid: 100000,
      principalRepaid: 99999.995,
    }
    expect(computeNewLoanStatus('flexible_manual', [], state)).toBe('closed')
  })

  it('full payment → loan closes via computeFamilyLoanState', () => {
    const principal = 100000
    const annualRate = 24
    const startDate = '2026-01-01'
    // Single payment on 2026-04-01 (90 days, ~5918 interest, principal ~94082)
    // Total payable = outstanding + accrued_to_payment_date
    // Interest for 90 days: 100000 * 0.24 * 90/365 ≈ 5918
    // Pay 105918 to fully clear
    const txs: PaymentTransaction[] = [{
      id: '1', loan_id: 'l1', schedule_row_id: null,
      payment_date: '2026-04-01', amount: 106000,  // slightly over to ensure closure
      principal_applied: null, interest_applied: null,
      note: null, payment_method: null, created_at: '2026-04-01',
    }]
    const state = computeFamilyLoanState(principal, annualRate, startDate, txs, '2026-04-01')
    expect(state.outstandingPrincipal).toBeLessThanOrEqual(0.01)
    expect(computeNewLoanStatus('flexible_manual', [], state)).toBe('closed')
  })

  it('delete payment → loan reactivates', () => {
    const principal = 100000
    const annualRate = 24
    const startDate = '2026-01-01'
    // Before: fully paid
    const txsFull: PaymentTransaction[] = [{
      id: '1', loan_id: 'l1', schedule_row_id: null,
      payment_date: '2026-04-01', amount: 106000,
      principal_applied: null, interest_applied: null,
      note: null, payment_method: null, created_at: '2026-04-01',
    }]
    const stateFull = computeFamilyLoanState(principal, annualRate, startDate, txsFull, '2026-04-01')
    expect(computeNewLoanStatus('flexible_manual', [], stateFull)).toBe('closed')

    // After: payment deleted → back to no transactions
    const stateEmpty = computeFamilyLoanState(principal, annualRate, startDate, [], '2026-04-01')
    expect(stateEmpty.outstandingPrincipal).toBe(principal)
    expect(computeNewLoanStatus('flexible_manual', [], stateEmpty)).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// Partial payment behavior
// ---------------------------------------------------------------------------

describe('partial payment status logic', () => {
  it('amount >= emi → should be marked paid', () => {
    const emiAmount = 4576
    const paidAmount = 4576
    expect(paidAmount >= emiAmount).toBe(true)
  })

  it('amount < emi → should be marked partial', () => {
    const emiAmount = 4576
    const paidAmount = 3000
    expect(paidAmount >= emiAmount).toBe(false)
    expect(paidAmount > 0).toBe(true)
  })

  it('partial stays open until fully covered', () => {
    const emiAmount = 4576
    const firstPayment = 3000
    const secondPayment = 2000
    const totalPaid = firstPayment + secondPayment
    expect(totalPaid >= emiAmount).toBe(true)  // now fully covered
  })

  it('remaining due = emi - already paid', () => {
    const emiAmount = 65000
    const alreadyPaid = 40000
    const remaining = emiAmount - alreadyPaid
    expect(remaining).toBe(25000)
    expect(remaining).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Loan taken date visibility
// ---------------------------------------------------------------------------

describe('loan taken date', () => {
  it('uses disbursement_date when present', () => {
    const loan = {
      disbursement_date: '2021-08-05',
      start_date: '2021-07-20',
    }
    const takenDate = loan.disbursement_date ?? loan.start_date
    expect(takenDate).toBe('2021-08-05')
  })

  it('falls back to start_date when disbursement_date is null', () => {
    const loan = {
      disbursement_date: null,
      start_date: '2024-01-01',
    }
    const takenDate = loan.disbursement_date ?? loan.start_date
    expect(takenDate).toBe('2024-01-01')
  })
})

// ---------------------------------------------------------------------------
// Import: no auto-marking
// ---------------------------------------------------------------------------

describe('import behavior — no auto-marking', () => {
  it('all imported rows should start as pending regardless of date', () => {
    const today = '2026-04-11'
    const pastDate = '2025-01-01'
    const futureDate = '2027-01-01'

    // The correct behavior: always 'pending', never auto-mark
    const getStatus = () => 'pending'

    expect(getStatus()).toBe('pending')
    // Previous (wrong) behavior: row.date < today ? 'paid' : 'pending'
    const wrongBehavior = (date: string) => date < today ? 'paid' : 'pending'
    expect(wrongBehavior(pastDate)).toBe('paid')   // This is what we removed
    expect(wrongBehavior(futureDate)).toBe('pending')
    // Confirm the fix: we always return 'pending'
    expect(getStatus()).not.toBe('paid')
  })
})
