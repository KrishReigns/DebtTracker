import { describe, it, expect } from 'vitest'
import {
  computeDailyAccruedInterest,
  allocatePayment,
  computeFamilyLoanState,
  calculateEMI,
  generateAmortizationSchedule,
  generateFlatRateSchedule,
  buildFlexiblePlanner,
} from '../lib/calculations'
import type { PaymentTransaction } from '../lib/types'

// ---------------------------------------------------------------------------
// Daily accrual — Actual/365
// ---------------------------------------------------------------------------

describe('computeDailyAccruedInterest', () => {
  it('accrues zero interest for same day', () => {
    expect(computeDailyAccruedInterest(100000, 24, '2026-01-01', '2026-01-01')).toBe(0)
  })

  it('accrues 1 day of interest correctly', () => {
    // 100000 * 24/100 / 365 = 65.75 → round to 65.75
    const result = computeDailyAccruedInterest(100000, 24, '2026-01-01', '2026-01-02')
    expect(result).toBeCloseTo(65.75, 1)
  })

  it('accrues ~2% per month for a 24% annual loan over 30 days', () => {
    // ~100000 * 0.24 * 30/365 = ~1972.6
    const result = computeDailyAccruedInterest(100000, 24, '2026-01-01', '2026-01-31')
    expect(result).toBeGreaterThan(1900)
    expect(result).toBeLessThan(2100)
  })

  it('accrues proportionally for a partial year', () => {
    // 365 days should equal annual rate × principal
    const result = computeDailyAccruedInterest(100000, 24, '2025-01-01', '2026-01-01')
    expect(result).toBeCloseTo(24000, 0)
  })

  it('returns 0 for future start date', () => {
    expect(computeDailyAccruedInterest(100000, 24, '2027-01-01', '2026-01-01')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Interest-first payment allocation
// ---------------------------------------------------------------------------

describe('allocatePayment', () => {
  it('pays interest first, then principal', () => {
    const { principalApplied, interestApplied, remainingBalance } =
      allocatePayment(100000, 2000, 5000)
    expect(interestApplied).toBe(2000)
    expect(principalApplied).toBe(3000)
    expect(remainingBalance).toBe(97000)
  })

  it('partial payment — only covers interest', () => {
    const { principalApplied, interestApplied, remainingBalance } =
      allocatePayment(100000, 2000, 1500)
    expect(interestApplied).toBe(1500)
    expect(principalApplied).toBe(0)
    expect(remainingBalance).toBe(100000)
  })

  it('overpayment — principal goes to zero', () => {
    const { principalApplied, interestApplied, remainingBalance } =
      allocatePayment(1000, 200, 5000)
    expect(interestApplied).toBe(200)
    expect(principalApplied).toBe(1000)
    expect(remainingBalance).toBe(0)
  })

  it('exact payment — clears both interest and principal', () => {
    const { principalApplied, interestApplied, remainingBalance } =
      allocatePayment(100000, 2000, 102000)
    expect(interestApplied).toBe(2000)
    expect(principalApplied).toBe(100000)
    expect(remainingBalance).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Family loan state computation
// ---------------------------------------------------------------------------

describe('computeFamilyLoanState', () => {
  const principal = 200000
  const annualRate = 24
  const startDate = '2024-01-01'

  it('no transactions — outstanding equals principal, accrues interest', () => {
    const state = computeFamilyLoanState(principal, annualRate, startDate, [], '2024-07-01')
    expect(state.outstandingPrincipal).toBe(principal)
    expect(state.accruedInterest).toBeGreaterThan(0)
    expect(state.totalPaid).toBe(0)
  })

  it('payment reduces outstanding principal after interest paid', () => {
    const tx: PaymentTransaction[] = [{
      id: '1', loan_id: 'l1', schedule_row_id: null,
      payment_date: '2024-02-01', amount: 10000,
      principal_applied: null, interest_applied: null,
      note: null, payment_method: null, created_at: '2024-02-01',
    }]
    const state = computeFamilyLoanState(principal, annualRate, startDate, tx, '2024-02-01')
    expect(state.outstandingPrincipal).toBeLessThan(principal)
    expect(state.totalPaid).toBe(10000)
    expect(state.principalRepaid).toBeGreaterThan(0)
  })

  it('multiple payments reduce principal progressively', () => {
    const txs: PaymentTransaction[] = [
      { id: '1', loan_id: 'l1', schedule_row_id: null, payment_date: '2024-02-01', amount: 15000, principal_applied: null, interest_applied: null, note: null, payment_method: null, created_at: '2024-02-01' },
      { id: '2', loan_id: 'l1', schedule_row_id: null, payment_date: '2024-03-01', amount: 15000, principal_applied: null, interest_applied: null, note: null, payment_method: null, created_at: '2024-03-01' },
    ]
    const state = computeFamilyLoanState(principal, annualRate, startDate, txs, '2024-03-01')
    expect(state.outstandingPrincipal).toBeLessThan(principal)
    expect(state.totalPaid).toBe(30000)
  })
})

// ---------------------------------------------------------------------------
// Fixed-EMI: EMI calculation
// ---------------------------------------------------------------------------

describe('calculateEMI', () => {
  it('calculates SBI education loan EMI at ₹30L@11.6% over 62 months', () => {
    const emi = calculateEMI(3000000, 11.6, 62)
    // Should be approximately ₹65,000
    expect(emi).toBeGreaterThan(64000)
    expect(emi).toBeLessThan(66000)
  })

  it('returns principal/tenure for 0% rate', () => {
    expect(calculateEMI(120000, 0, 12)).toBeCloseTo(10000, 0)
  })

  it('Axis Bank PL1: ₹2L @ 13.25%, 60 months → ~₹4,576', () => {
    const emi = calculateEMI(200000, 13.25, 60)
    expect(emi).toBeGreaterThan(4500)
    expect(emi).toBeLessThan(4650)
  })

  it('Axis Bank PL2: ₹9.03L @ 14.99%, 60 months → ~₹21,478', () => {
    const emi = calculateEMI(903000, 14.99, 60)
    expect(emi).toBeGreaterThan(21000)
    expect(emi).toBeLessThan(22000)
  })
})

// ---------------------------------------------------------------------------
// Fixed-EMI: amortization schedule accuracy
// ---------------------------------------------------------------------------

describe('generateAmortizationSchedule', () => {
  it('first EMI interest = P × r/12', () => {
    const principal = 1000000
    const rate = 12
    const schedule = generateAmortizationSchedule(principal, rate, 12, '2026-01-01')
    const firstRow = schedule[0]
    const expectedInterest = Math.round(principal * rate / 100 / 12 * 100) / 100
    expect(firstRow.interest).toBeCloseTo(expectedInterest, 0)
  })

  it('closing balance of last row is zero', () => {
    const schedule = generateAmortizationSchedule(100000, 10, 12, '2026-01-01')
    expect(schedule[schedule.length - 1].closingBalance).toBeCloseTo(0, 0)
  })

  it('total interest is positive and less than principal', () => {
    const schedule = generateAmortizationSchedule(500000, 11.6, 60, '2025-01-01')
    const totalInterest = schedule.reduce((s, r) => s + r.interest, 0)
    expect(totalInterest).toBeGreaterThan(0)
    expect(totalInterest).toBeLessThan(500000)
  })

  it('produces the correct number of rows', () => {
    const schedule = generateAmortizationSchedule(100000, 10, 24, '2026-01-01')
    expect(schedule.length).toBeLessThanOrEqual(24)
  })

  it('each opening balance equals previous closing balance', () => {
    const schedule = generateAmortizationSchedule(200000, 13.25, 60, '2021-08-05')
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].openingBalance).toBeCloseTo(schedule[i - 1].closingBalance, 0)
    }
  })
})

// ---------------------------------------------------------------------------
// Flat rate schedule
// ---------------------------------------------------------------------------

describe('generateFlatRateSchedule', () => {
  it('interest is constant each month', () => {
    const schedule = generateFlatRateSchedule(120000, 12, 12, '2026-01-01')
    const firstInterest = schedule[0].interest
    schedule.forEach(row => {
      expect(row.interest).toBeCloseTo(firstInterest, 0)
    })
  })

  it('principal per month is constant', () => {
    const schedule = generateFlatRateSchedule(120000, 0, 12, '2026-01-01')
    const firstPrincipal = schedule[0].principal
    schedule.forEach(row => {
      expect(row.principal).toBeCloseTo(firstPrincipal, 0)
    })
  })
})

// ---------------------------------------------------------------------------
// Stub period / first-EMI calculation
// ---------------------------------------------------------------------------

describe('stub period — first EMI handling', () => {
  it('schedule with first_emi_date different from start generates correct month count', () => {
    // Axis Bank: started 2021-08-05, 60 months → ends 2026-07-05
    const schedule = generateAmortizationSchedule(200000, 13.25, 60, '2021-08-05', 4576)
    expect(schedule.length).toBe(60)
    expect(schedule[0].date).toBe('2021-08-05')
    expect(schedule[59].date).toBe('2026-07-05')
  })
})

// ---------------------------------------------------------------------------
// Partial payments
// ---------------------------------------------------------------------------

describe('partial payment behavior', () => {
  it('payment less than accrued interest leaves principal unchanged', () => {
    const accrued = 5000
    const { principalApplied, remainingBalance } = allocatePayment(100000, accrued, 3000)
    expect(principalApplied).toBe(0)
    expect(remainingBalance).toBe(100000)
  })

  it('payment exactly covering interest reduces principal to zero extra', () => {
    const { principalApplied, interestApplied, remainingBalance } = allocatePayment(100000, 5000, 5000)
    expect(interestApplied).toBe(5000)
    expect(principalApplied).toBe(0)
    expect(remainingBalance).toBe(100000)
  })

  it('prepayment (large payment) clears principal', () => {
    const { remainingBalance } = allocatePayment(50000, 1000, 200000)
    expect(remainingBalance).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Planner recalculation
// ---------------------------------------------------------------------------

describe('buildFlexiblePlanner', () => {
  it('computes closing balance correctly for a single plan row', () => {
    const planRows = [{ planned_date: '2026-06-01', planned_amount: 10000 }]
    const rows = buildFlexiblePlanner(100000, 24, '2026-04-11', planRows, [])
    expect(rows.length).toBe(1)
    expect(rows[0].openingBalance).toBe(100000)
    expect(rows[0].closingBalance).toBeLessThan(100000)
    expect(rows[0].interestApplied).toBeGreaterThan(0)
  })

  it('each row opening balance equals previous closing balance', () => {
    const planRows = [
      { planned_date: '2026-05-01', planned_amount: 15000 },
      { planned_date: '2026-06-01', planned_amount: 15000 },
      { planned_date: '2026-07-01', planned_amount: 15000 },
    ]
    const rows = buildFlexiblePlanner(100000, 24, '2026-04-11', planRows, [])
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].openingBalance).toBeCloseTo(rows[i - 1].closingBalance, 0)
    }
  })

  it('marks row as paid when transaction exists on planned date', () => {
    const planRows = [{ planned_date: '2026-05-01', planned_amount: 10000 }]
    const tx: PaymentTransaction[] = [{
      id: '1', loan_id: 'l1', schedule_row_id: null,
      payment_date: '2026-05-01', amount: 10000,
      principal_applied: null, interest_applied: null,
      note: null, payment_method: null, created_at: '2026-05-01',
    }]
    const rows = buildFlexiblePlanner(100000, 24, '2026-04-11', planRows, tx)
    expect(rows[0].isPaid).toBe(true)
  })

  it('plan with no rows returns empty array', () => {
    const rows = buildFlexiblePlanner(100000, 24, '2026-04-11', [], [])
    expect(rows).toEqual([])
  })
})
