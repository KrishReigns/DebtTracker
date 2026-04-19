import { addMonths, differenceInDays, format, parseISO } from 'date-fns'
import type { AmortizationRow, FamilyLoanState, InterestType, PaymentTransaction } from './types'

// ---------------------------------------------------------------------------
// EMI & amortization
// ---------------------------------------------------------------------------

/**
 * Standard reducing-balance EMI:  P × r × (1+r)^n / ((1+r)^n - 1)
 */
export function calculateEMI(principal: number, annualRate: number, tenureMonths: number): number {
  if (annualRate === 0) return round(principal / tenureMonths)
  const r = annualRate / 100 / 12
  const n = tenureMonths
  return round((principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1))
}

/** Reducing-balance amortization schedule */
export function generateAmortizationSchedule(
  principal: number,
  annualRate: number,
  tenureMonths: number,
  startDate: string,
  emiOverride?: number
): AmortizationRow[] {
  const r = annualRate / 100 / 12
  const emi = emiOverride ?? calculateEMI(principal, annualRate, tenureMonths)
  const rows: AmortizationRow[] = []
  let balance = principal
  let date = parseISO(startDate)

  for (let i = 1; i <= tenureMonths; i++) {
    const interest = round(balance * r)
    const principalPart = round(Math.min(emi - interest, balance))
    const closing = round(Math.max(balance - principalPart, 0))

    rows.push({
      month: i,
      date: format(date, 'yyyy-MM-dd'),
      openingBalance: round(balance),
      emi: i === tenureMonths ? round(balance + interest) : round(emi),
      interest,
      principal: principalPart,
      closingBalance: closing,
    })

    balance = closing
    date = addMonths(date, 1)
    if (balance < 0.01) break
  }

  return rows
}

/** Flat-rate schedule (interest fixed on original principal) */
export function generateFlatRateSchedule(
  principal: number,
  annualRate: number,
  tenureMonths: number,
  startDate: string,
  emiOverride?: number
): AmortizationRow[] {
  const monthlyInterest = round((principal * annualRate) / 100 / 12)
  const principalPerMonth = round(principal / tenureMonths)
  const emi = emiOverride ?? round(principalPerMonth + monthlyInterest)
  const rows: AmortizationRow[] = []
  let balance = principal
  let date = parseISO(startDate)

  for (let i = 1; i <= tenureMonths; i++) {
    const closing = round(Math.max(balance - principalPerMonth, 0))
    rows.push({
      month: i,
      date: format(date, 'yyyy-MM-dd'),
      openingBalance: round(balance),
      emi,
      interest: monthlyInterest,
      principal: principalPerMonth,
      closingBalance: closing,
    })
    balance = closing
    date = addMonths(date, 1)
  }

  return rows
}

/** Revolving credit card schedule */
export function generateCreditCardSchedule(
  balance: number,
  annualRate: number,
  monthlyPayment: number,
  startDate: string
): AmortizationRow[] {
  const r = annualRate / 100 / 12
  const rows: AmortizationRow[] = []
  let current = balance
  let date = parseISO(startDate)
  let month = 1

  while (current > 0.01 && month <= 360) {
    const interest = round(current * r)
    const principalPart = round(Math.min(monthlyPayment - interest, current))
    const closing = round(Math.max(current - principalPart, 0))

    rows.push({
      month,
      date: format(date, 'yyyy-MM-dd'),
      openingBalance: round(current),
      emi: round(Math.min(monthlyPayment, current + interest)),
      interest,
      principal: principalPart,
      closingBalance: closing,
    })

    current = closing
    date = addMonths(date, 1)
    month++
  }

  return rows
}

/** Simple interest schedule (family loans — interest-only rows, principal at end) */
function generateSimpleInterestSchedule(
  principal: number,
  monthlyRate: number,
  tenureMonths: number,
  startDate: string
): AmortizationRow[] {
  const rows: AmortizationRow[] = []
  const interest = round((principal * monthlyRate) / 100)
  let date = parseISO(startDate)

  for (let i = 1; i <= tenureMonths; i++) {
    const isLast = i === tenureMonths
    rows.push({
      month: i,
      date: format(date, 'yyyy-MM-dd'),
      openingBalance: principal,
      emi: isLast ? round(principal + interest) : interest,
      interest,
      principal: isLast ? principal : 0,
      closingBalance: isLast ? 0 : principal,
    })
    date = addMonths(date, 1)
  }

  return rows
}

/** Bullet repayment — single lump-sum at maturity */
function generateBulletSchedule(
  principal: number,
  annualRate: number,
  tenureMonths: number,
  startDate: string
): AmortizationRow[] {
  const totalInterest = round(principal * (annualRate / 100) * (tenureMonths / 12))
  const dueDate = addMonths(parseISO(startDate), tenureMonths)
  return [{
    month: 1,
    date: format(dueDate, 'yyyy-MM-dd'),
    openingBalance: principal,
    emi: round(principal + totalInterest),
    interest: totalInterest,
    principal,
    closingBalance: 0,
  }]
}

/** Dispatcher: pick schedule generator by interest type.
 *  firstEmiDate: when the first installment is due. If omitted, defaults to
 *  start_date + 1 month (standard bank behaviour — loan taken in April, first
 *  EMI due in May).  Pass an explicit value when the user has set first_emi_date.
 */
export function generateSchedule(
  principal: number,
  annualRate: number,
  tenureMonths: number,
  startDate: string,
  interestType: InterestType,
  emiOverride?: number,
  firstEmiDate?: string
): AmortizationRow[] {
  // The date that schedule rows are anchored to: first EMI date if supplied,
  // otherwise one month after the loan start date.
  const scheduleStart = firstEmiDate && firstEmiDate.trim()
    ? firstEmiDate.trim()
    : format(addMonths(parseISO(startDate), 1), 'yyyy-MM-dd')

  switch (interestType) {
    case 'flat':
      return generateFlatRateSchedule(principal, annualRate, tenureMonths, scheduleStart, emiOverride)
    case 'revolving':
      return generateCreditCardSchedule(principal, annualRate, emiOverride ?? principal / 12, scheduleStart)
    case 'simple':
      return generateSimpleInterestSchedule(principal, annualRate / 12, tenureMonths || 12, scheduleStart)
    case 'bullet':
      return generateBulletSchedule(principal, annualRate, tenureMonths || 12, startDate) // bullet uses start+tenure
    default:
      return generateAmortizationSchedule(principal, annualRate, tenureMonths, scheduleStart, emiOverride)
  }
}

// ---------------------------------------------------------------------------
// Daily accrual for flexible / family loans (Actual/365)
// ---------------------------------------------------------------------------

/**
 * Compute daily simple interest accrued:
 *   daily_interest = outstanding_principal × annual_rate / 100 / 365
 * Returns total interest from startDate to asOfDate (inclusive).
 */
export function computeDailyAccruedInterest(
  principal: number,
  annualRate: number,
  startDate: string,
  asOfDate: string = format(new Date(), 'yyyy-MM-dd')
): number {
  const days = differenceInDays(parseISO(asOfDate), parseISO(startDate))
  if (days <= 0) return 0
  return round(principal * (annualRate / 100) * (days / 365))
}

/**
 * Apply a payment to a flexible loan using interest-first allocation.
 * Returns { principalApplied, interestApplied, remainingBalance }.
 */
export function allocatePayment(
  outstandingPrincipal: number,
  accruedInterest: number,
  paymentAmount: number
): { principalApplied: number; interestApplied: number; remainingBalance: number } {
  const interestApplied = round(Math.min(paymentAmount, accruedInterest))
  const remainder = round(paymentAmount - interestApplied)
  const principalApplied = round(Math.min(remainder, outstandingPrincipal))
  const remainingBalance = round(Math.max(outstandingPrincipal - principalApplied, 0))
  return { principalApplied, interestApplied, remainingBalance }
}

/**
 * Compute the current state of a family/flexible loan from its transactions.
 * Transactions must be sorted by payment_date ascending.
 */
export function computeFamilyLoanState(
  principal: number,
  annualRate: number,
  startDate: string,
  transactions: PaymentTransaction[],
  asOfDate: string = format(new Date(), 'yyyy-MM-dd')
): FamilyLoanState {
  let outstandingPrincipal = principal
  let totalPaid = 0
  let principalRepaid = 0
  let lastDate = startDate

  for (const tx of transactions) {
    const accrued = computeDailyAccruedInterest(outstandingPrincipal, annualRate, lastDate, tx.payment_date)
    const { principalApplied } = allocatePayment(outstandingPrincipal, accrued, tx.amount)
    outstandingPrincipal = round(outstandingPrincipal - principalApplied)
    totalPaid += tx.amount
    principalRepaid += principalApplied
    lastDate = tx.payment_date
  }

  const accruedInterest = computeDailyAccruedInterest(outstandingPrincipal, annualRate, lastDate, asOfDate)

  return {
    outstandingPrincipal,
    accruedInterest,
    totalPayable: round(outstandingPrincipal + accruedInterest),
    totalPaid,
    principalRepaid,
  }
}

/**
 * Build a planner-style forecast table for a flexible loan.
 * Starts from current outstanding principal and projects planRows forward.
 */
export interface PlannerRow {
  index: number
  date: string | null
  openingBalance: number
  plannedPayment: number
  interestApplied: number
  principalApplied: number
  closingBalance: number
  isPaid: boolean
}

export function buildFlexiblePlanner(
  outstandingPrincipal: number,
  annualRate: number,
  asOfDate: string,
  planRows: Array<{ planned_date: string | null; planned_amount: number | null }>,
  transactions: PaymentTransaction[]
): PlannerRow[] {
  const rows: PlannerRow[] = []
  let balance = outstandingPrincipal
  let lastDate = asOfDate
  const txDates = new Set(transactions.map(t => t.payment_date))

  planRows.forEach((plan, i) => {
    const plannedAmt = plan.planned_amount ?? 0
    const accrued = plan.planned_date
      ? computeDailyAccruedInterest(balance, annualRate, lastDate, plan.planned_date)
      : 0
    const { principalApplied, interestApplied, remainingBalance } = allocatePayment(balance, accrued, plannedAmt)
    const isPaid = plan.planned_date ? txDates.has(plan.planned_date) : false

    rows.push({
      index: i + 1,
      date: plan.planned_date,
      openingBalance: round(balance),
      plannedPayment: plannedAmt,
      interestApplied,
      principalApplied,
      closingBalance: remainingBalance,
      isPaid,
    })

    if (plan.planned_date) lastDate = plan.planned_date
    balance = remainingBalance
  })

  return rows
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatCurrency(amount: number, currency: 'INR' | 'USD'): string {
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function convertCurrency(
  amount: number,
  from: 'INR' | 'USD',
  to: 'INR' | 'USD',
  rate: number
): number {
  if (from === to) return amount
  return round(amount * rate)
}

export function totalInterestCost(schedule: AmortizationRow[]): number {
  return round(schedule.reduce((s, r) => s + r.interest, 0))
}

export function payoffDate(schedule: AmortizationRow[]): string {
  return schedule[schedule.length - 1]?.date ?? ''
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
