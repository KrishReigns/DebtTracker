export type LoanType =
  | 'student_loan'
  | 'personal_loan'
  | 'family'
  | 'credit_card'
  | 'gold_loan'
  | 'home_loan'
  | 'car_loan'

export type LoanStatus = 'active' | 'closed' | 'paused'
export type Currency = 'INR' | 'USD'
export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'partial'
export type ScheduleStatus = 'pending' | 'paid' | 'partial' | 'skipped'
export type InterestType = 'reducing' | 'flat' | 'simple' | 'revolving' | 'bullet'
export type RepaymentMode = 'fixed_emi' | 'flexible_manual'

export interface Loan {
  id: string
  user_id: string
  loan_type: LoanType
  lender_name: string
  principal: number
  interest_rate: number
  start_date: string
  tenure_months: number | null
  emi_amount: number | null
  payment_day: number | null
  status: LoanStatus
  currency: Currency
  interest_type: InterestType
  repayment_mode: RepaymentMode
  account_number: string | null
  disbursement_date: string | null
  first_emi_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Contractual lender schedule row */
export interface PaymentSchedule {
  id: string
  loan_id: string
  installment_number: number
  contractual_due_date: string
  planned_pay_date: string | null   // user-set reminder, separate from contractual
  opening_balance: number
  emi_amount: number
  principal_amount: number
  interest_amount: number
  closing_balance: number
  amount_paid: number | null        // sum of linked transactions; null = unpaid
  rate: number | null
  status: ScheduleStatus
  created_at: string
}

/** Actual payment transaction */
export interface PaymentTransaction {
  id: string
  loan_id: string
  schedule_row_id: string | null
  payment_date: string
  amount: number
  principal_applied: number | null
  interest_applied: number | null
  note: string | null
  payment_method: string | null
  created_at: string
}

/** Editable forecast row for flexible-manual loans */
export interface PaymentPlanRow {
  id: string
  loan_id: string
  planned_date: string | null
  planned_amount: number | null
  note: string | null
  sort_order: number
  created_at: string
}

/** Legacy payments table — kept for backward compat during transition */
export interface Payment {
  id: string
  loan_id: string
  due_date: string
  paid_date: string | null
  amount_due: number
  amount_paid: number | null
  principal_component: number | null
  interest_component: number | null
  status: PaymentStatus
  notes: string | null
  created_at: string
}

export interface ExchangeRate {
  from_currency: Currency
  to_currency: Currency
  rate: number
  fetched_at: string
}

export interface AmortizationRow {
  month: number
  date: string
  openingBalance: number
  emi: number
  interest: number
  principal: number
  closingBalance: number
}

/** Computed family loan state derived from transactions */
export interface FamilyLoanState {
  outstandingPrincipal: number
  accruedInterest: number
  totalPayable: number
  totalPaid: number
  principalRepaid: number
}

export const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  student_loan: 'Education Loan',
  personal_loan: 'Personal Loan',
  family: 'Family Loan',
  credit_card: 'Credit Card',
  gold_loan: 'Gold Loan',
  home_loan: 'Home Loan',
  car_loan: 'Car Loan',
}

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  INR: '₹',
  USD: '$',
}

export const LOAN_TYPE_COLORS: Record<LoanType, string> = {
  student_loan: '#6366f1',
  personal_loan: '#f59e0b',
  family: '#10b981',
  credit_card: '#ef4444',
  gold_loan: '#f97316',
  home_loan: '#3b82f6',
  car_loan: '#8b5cf6',
}

export const ACTIVE_LOAN_TYPES: LoanType[] = [
  'student_loan',
  'personal_loan',
  'family',
  'credit_card',
  'gold_loan',
]

export const FUTURE_LOAN_TYPES: LoanType[] = ['home_loan', 'car_loan']
