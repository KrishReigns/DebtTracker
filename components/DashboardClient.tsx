'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Scale, PiggyBank, CalendarClock, Flag, AlertTriangle } from 'lucide-react'
import { format, addMonths, differenceInMonths } from 'date-fns'
import { computeFamilyLoanState, formatCurrency, convertCurrency } from '@/lib/calculations'
import { LOAN_TYPE_LABELS, LOAN_TYPE_COLORS, CURRENCY_SYMBOLS } from '@/lib/types'
import { formatDateShort, formatMonthYear, todayISO } from '@/lib/utils'
import type { Loan, PaymentSchedule, PaymentTransaction, ExchangeRate } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, AreaChart, Area, CartesianGrid } from 'recharts'

interface Props {
  loans: Loan[]
  schedules: PaymentSchedule[]
  transactions: PaymentTransaction[]
  exchangeRates: ExchangeRate[]
}

interface LoanStats {
  loan: Loan
  outstandingPrincipal: number
  accruedInterest: number
  nextDueDate: string | null
  nextDueAmount: number
  isOverdue: boolean
}

/** Ease a number toward its target — KPI count-up. Respects prefers-reduced-motion. */
function useCountUp(target: number, ms = 700): number {
  const [display, setDisplay] = useState(target)
  const prevRef = useRef(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      prevRef.current = target
      setDisplay(target)
      return
    }
    const from = prevRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (target - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else prevRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return display
}

export default function DashboardClient({ loans, schedules, transactions, exchangeRates }: Props) {
  const [viewCurrency, setViewCurrency] = useState<'INR' | 'USD'>('INR')
  const [extraMonthly, setExtraMonthly] = useState(0)
  const today = todayISO()

  function getRate(from: 'INR' | 'USD', to: 'INR' | 'USD'): number {
    if (from === to) return 1
    const direct = exchangeRates.find(r => r.from_currency === from && r.to_currency === to)
    if (direct) return direct.rate
    // Invert the stored reverse rate before falling back to the hardcoded default
    const reverse = exchangeRates.find(r => r.from_currency === to && r.to_currency === from)
    if (reverse && reverse.rate > 0) return 1 / reverse.rate
    return from === 'USD' ? 84.5 : 1 / 84.5
  }

  function toView(amount: number, currency: 'INR' | 'USD'): number {
    return convertCurrency(amount, currency, viewCurrency, getRate(currency, viewCurrency))
  }

  // Compute real outstanding balance per loan from transactions + schedules
  const loanStats: LoanStats[] = loans.map(loan => {
    const loanTx = transactions
      .filter(t => t.loan_id === loan.id)
      .sort((a, b) => a.payment_date.localeCompare(b.payment_date))

    const loanSchedule = schedules
      .filter(s => s.loan_id === loan.id)
      .sort((a, b) => a.installment_number - b.installment_number)

    let outstandingPrincipal: number
    let accruedInterest = 0
    let nextDueDate: string | null = null
    let nextDueAmount = 0
    let isOverdue = false

    if (loan.repayment_mode === 'flexible_manual') {
      const state = computeFamilyLoanState(loan.principal, loan.interest_rate, loan.start_date, loanTx, today)
      outstandingPrincipal = state.outstandingPrincipal
      accruedInterest = state.accruedInterest
      // No fixed due date for flexible loans
    } else if (loan.loan_type === 'credit_card') {
      // Credit card: balance is loan.principal; due date from the PENDING statement
      // row (a stale imported statement whose row was paid must not flag overdue)
      outstandingPrincipal = loan.principal
      const duePending = loanSchedule.find(r => r.status === 'pending' || r.status === 'partial')
      if (duePending && loan.status === 'active') {
        nextDueDate = duePending.contractual_due_date
        nextDueAmount = Math.max(0, duePending.emi_amount - (duePending.amount_paid ?? 0))
        isOverdue = nextDueDate < today
      }
    } else {
      // Fixed-EMI: outstanding = opening_balance of first non-paid, non-skipped row
      const pendingRows = loanSchedule.filter(r => r.status !== 'paid' && r.status !== 'skipped')
      outstandingPrincipal = pendingRows[0]?.opening_balance ?? 0
      if (pendingRows[0] && loan.status === 'active') {
        nextDueDate = pendingRows[0].contractual_due_date
        nextDueAmount = pendingRows[0].emi_amount
        isOverdue = nextDueDate < today
      }
    }

    return { loan, outstandingPrincipal, accruedInterest, nextDueDate, nextDueAmount, isOverdue }
  })

  const totalDebt = loanStats.reduce((s, l) => s + toView(l.outstandingPrincipal + l.accruedInterest, l.loan.currency), 0)
  const totalOriginal = loans.reduce((s, l) => s + toView(l.principal, l.currency), 0)

  // Donut data — group by loan TYPE; include accrued interest so the donut
  // total matches the Total Debt KPI above it
  const typeMap: Record<string, { value: number; color: string; label: string; count: number }> = {}
  for (const l of loanStats.filter(s => s.outstandingPrincipal > 0)) {
    const t = l.loan.loan_type
    if (!typeMap[t]) typeMap[t] = { value: 0, color: LOAN_TYPE_COLORS[t] ?? '#94a3b8', label: LOAN_TYPE_LABELS[t] ?? t, count: 0 }
    // Accumulate unrounded — rounding per loan made the donut total drift ₹1 off the Total Debt KPI
    typeMap[t].value += toView(l.outstandingPrincipal + l.accruedInterest, l.loan.currency)
    typeMap[t].count++
  }
  const donutData = Object.values(typeMap)
    .map(d => ({ ...d, value: Math.round(d.value) }))
    .sort((a, b) => b.value - a.value)
  const donutTotal = Math.round(Object.values(typeMap).reduce((s, d) => s + d.value, 0))

  // Monthly outflow (next 12 months) — single viewCurrency, from all schedule rows.
  // Skipped rows aren't owed; partial rows only owe the remainder.
  const monthlyOutflow: { month: string; amount: number }[] = []
  for (let i = 0; i < 12; i++) {
    const d = addMonths(new Date(), i)
    const monthStr = format(d, 'yyyy-MM')
    let total = 0
    for (const sched of schedules) {
      if (!sched.contractual_due_date.startsWith(monthStr)) continue
      if (sched.status === 'paid' || sched.status === 'skipped') continue
      const loan = loans.find(l => l.id === sched.loan_id)
      if (!loan) continue
      const owed = sched.status === 'partial'
        ? Math.max(0, sched.emi_amount - (sched.amount_paid ?? 0))
        : sched.emi_amount
      total += toView(owed, loan.currency)
    }
    monthlyOutflow.push({ month: format(d, 'MMM'), amount: Math.round(total) })
  }

  // Projected debt trajectory (month-by-month total outstanding across all loans)
  const now = new Date()
  const pendingRows = schedules.filter(s => s.status === 'pending' || s.status === 'partial')
  const lastPending = pendingRows.map(s => s.contractual_due_date).sort().at(-1)
  const horizonMonths = lastPending
    ? Math.min(60, Math.max(12, differenceInMonths(new Date(lastPending), now) + 2))
    : 12

  const debtTrajectory: { month: string; amount: number }[] = []
  for (let i = 0; i <= horizonMonths; i++) {
    const d = addMonths(now, i)
    const monthStr = format(d, 'yyyy-MM')
    let total = 0
    for (const loan of loans) {
      const ls = loanStats.find(s => s.loan.id === loan.id)
      if (!ls) continue
      if (loan.repayment_mode === 'flexible_manual') {
        // Family loans accrue simple interest daily — project that growth forward
        // (linear on outstanding principal; these loans don't compound)
        const monthlyAccrual = ls.outstandingPrincipal * loan.interest_rate / 100 / 12
        total += toView(ls.outstandingPrincipal + ls.accruedInterest + monthlyAccrual * i, loan.currency)
      } else {
        // Fixed-EMI / CC: find opening_balance of earliest pending row due >= this month
        const upcoming = pendingRows
          .filter(s => s.loan_id === loan.id && s.contractual_due_date >= `${monthStr}-01`)
          .sort((a, b) => a.installment_number - b.installment_number)
        total += toView(upcoming[0]?.opening_balance ?? 0, loan.currency)
      }
    }
    debtTrajectory.push({ month: format(d, 'MMM yy'), amount: Math.round(total) })
  }

  // Accelerated trajectory: what if user pays extra each month?
  // We apply extraMonthly on top of scheduled reductions each month.
  const accelTrajectory = useMemo<number[] | null>(() => {
    if (extraMonthly <= 0 || debtTrajectory.length === 0) return null
    const result: number[] = []
    let balance = debtTrajectory[0].amount
    for (let i = 0; i < debtTrajectory.length; i++) {
      result.push(Math.round(Math.max(0, balance)))
      // How much does the base schedule reduce debt this month?
      const baseReduction = i < debtTrajectory.length - 1
        ? Math.max(0, debtTrajectory[i].amount - debtTrajectory[i + 1].amount)
        : debtTrajectory[i].amount
      balance = Math.max(0, balance - baseReduction - extraMonthly)
    }
    return result
  }, [extraMonthly, debtTrajectory])

  // Honest savings claim: "X months sooner" only when the base path actually
  // clears within the projection window. If it doesn't (open-ended family
  // loans), the claim would be measured against an arbitrary horizon cap.
  const accelSummary = useMemo<
    | { kind: 'sooner'; months: number }
    | { kind: 'accel-only'; months: number }
    | { kind: 'reduction'; amount: number }
    | null
  >(() => {
    if (!accelTrajectory || accelTrajectory.length === 0) return null
    const basePayoff = debtTrajectory.findIndex(p => p.amount <= 0)
    const accelPayoff = accelTrajectory.findIndex(v => v <= 0)
    if (basePayoff !== -1 && accelPayoff !== -1) {
      return { kind: 'sooner', months: Math.max(0, basePayoff - accelPayoff) }
    }
    if (accelPayoff !== -1) {
      return { kind: 'accel-only', months: accelPayoff }
    }
    // Neither clears — report the balance reduction at the end of the window
    const lastBase = debtTrajectory[debtTrajectory.length - 1]?.amount ?? 0
    const lastAccel = accelTrajectory[accelTrajectory.length - 1] ?? 0
    return { kind: 'reduction', amount: Math.max(0, lastBase - lastAccel) }
  }, [accelTrajectory, debtTrajectory])

  const trajectoryData = useMemo(() =>
    debtTrajectory.map((p, i) => ({
      month: p.month,
      current: p.amount,
      ...(accelTrajectory ? { accelerated: accelTrajectory[i] ?? 0 } : {}),
    })),
  [debtTrajectory, accelTrajectory])

  // Per-loan payoff dates
  const loanPayoffs = loans.map(loan => {
    const loanPending = pendingRows
      .filter(s => s.loan_id === loan.id)
      .sort((a, b) => a.installment_number - b.installment_number)
    const lastRow = loanPending.at(-1)
    const ls = loanStats.find(s => s.loan.id === loan.id)
    return {
      loan,
      payoffDate: loan.repayment_mode === 'flexible_manual' ? null : (lastRow?.contractual_due_date ?? null),
      monthsLeft: lastRow ? Math.max(0, differenceInMonths(new Date(lastRow.contractual_due_date), now)) : null,
      outstanding: ls ? toView(ls.outstandingPrincipal + ls.accruedInterest, loan.currency) : 0,
      // What an open-ended family loan costs per day — makes the rate visceral
      dailyInterest: loan.repayment_mode === 'flexible_manual' && ls
        ? toView(ls.outstandingPrincipal * loan.interest_rate / 100 / 365, loan.currency)
        : null,
    }
  }).sort((a, b) => {
    if (!a.payoffDate && !b.payoffDate) return 0
    if (!a.payoffDate) return 1
    if (!b.payoffDate) return -1
    return a.payoffDate.localeCompare(b.payoffDate)
  })

  // Upcoming (due in next 30 days) + overdue — includes CC loans with due dates
  const in30 = new Date(new Date(today).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const upcomingFixed = loanStats
    .filter(l => (l.loan.repayment_mode === 'fixed_emi' || l.loan.loan_type === 'credit_card')
      && l.nextDueDate && l.nextDueDate >= today && l.nextDueDate <= in30)
    .sort((a, b) => (a.nextDueDate ?? '').localeCompare(b.nextDueDate ?? ''))
  const overdueFixed = loanStats
    .filter(l => l.isOverdue)
    .sort((a, b) => (a.nextDueDate ?? '').localeCompare(b.nextDueDate ?? ''))

  // Total due in next 30 days — from ALL unpaid rows in the window, not just each
  // loan's first pending row (a loan with an overdue EMI also owes the next one)
  let totalDue30 = 0
  let due30Count = 0
  for (const row of schedules) {
    if (row.status !== 'pending' && row.status !== 'partial') continue
    if (row.contractual_due_date < today || row.contractual_due_date > in30) continue
    const loan = loans.find(l => l.id === row.loan_id)
    if (!loan || loan.status !== 'active') continue
    const owed = row.status === 'partial'
      ? Math.max(0, row.emi_amount - (row.amount_paid ?? 0))
      : row.emi_amount
    totalDue30 += toView(owed, loan.currency)
    due30Count++
  }

  const sym = CURRENCY_SYMBOLS[viewCurrency]

  // Overall repayment progress — actual cash paid (payment_transactions = source of truth for real amounts).
  // Skip statement_import aggregates: they summarize payments already counted when
  // the statement row was marked paid, so including them double-counts CC payments.
  const totalRepaid = transactions.reduce((s, t) => {
    if (t.payment_method === 'statement_import') return s
    const loan = loans.find(l => l.id === t.loan_id)
    return s + (loan ? toView(t.amount, loan.currency) : 0)
  }, 0)
  // Progress = paid ÷ original principal borrowed (standard bank metric, only goes up when you pay)
  const progressPct = totalOriginal > 0 ? Math.min(100, Math.round((totalRepaid / totalOriginal) * 100)) : 0
  // Interest that has accrued but not yet been paid (family loans only)
  const totalAccruedInterest = loanStats.reduce((s, l) => s + toView(l.accruedInterest, l.loan.currency), 0)

  // Animated KPI numbers
  const totalDebtAnim = useCountUp(totalDebt)
  const totalRepaidAnim = useCountUp(totalRepaid)
  const totalDue30Anim = useCountUp(totalDue30)

  // Debt-free date — latest due date among unpaid rows (pending + partial)
  const pendingDates = schedules
    .filter(s => s.status === 'pending' || s.status === 'partial')
    .map(s => s.contractual_due_date)
    .sort()
  const debtFreeDate = pendingDates.length > 0 ? pendingDates[pendingDates.length - 1] : null
  const hasActiveFlexible = loans.some(l => l.repayment_mode === 'flexible_manual' && l.status === 'active')
  const debtFreeDateFmt = debtFreeDate
    ? new Date(debtFreeDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : hasActiveFlexible ? 'Ongoing' : null

  // Y-axis formatter — lakhs for INR, K/M for USD
  function fmtAxis(v: number) {
    if (viewCurrency === 'USD') {
      if (v >= 1000000) return `${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M`
      if (v >= 1000) return `${(v / 1000).toFixed(0)}K`
      return String(v)
    }
    if (v >= 100000) return `${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L`
    if (v >= 1000) return `${(v / 1000).toFixed(0)}K`
    return String(v)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            {loans.filter(l => l.status === 'active').length} active loans
            {loans.some(l => l.status === 'paused') && ` · ${loans.filter(l => l.status === 'paused').length} paused`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-10 px-4" variant={viewCurrency === 'INR' ? 'default' : 'outline'} onClick={() => setViewCurrency('INR')}>₹ INR</Button>
          <Button size="sm" className="h-10 px-4" variant={viewCurrency === 'USD' ? 'default' : 'outline'} onClick={() => setViewCurrency('USD')}>$ USD</Button>
        </div>
      </div>

      {/* Overdue Alert Banner */}
      {(() => {
        const overdue = loanStats.filter(l => l.isOverdue)
        if (overdue.length === 0) return null
        const totalOverdue = overdue.reduce((s, l) => s + toView(l.nextDueAmount, l.loan.currency), 0)
        return (
          <Link href="/payments" className="block">
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 hover:bg-red-100 transition-colors cursor-pointer">
              <span className="relative flex w-8 h-8 shrink-0 mt-0.5 items-center justify-center rounded-lg bg-red-100">
                <span className="absolute inline-flex h-2 w-2 -top-0.5 -right-0.5 rounded-full bg-red-500 animate-ping" />
                <span className="absolute inline-flex h-2 w-2 -top-0.5 -right-0.5 rounded-full bg-red-500" />
                <AlertTriangle className="w-4 h-4 text-red-600" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-red-700 text-sm">
                  {overdue.length} overdue EMI{overdue.length > 1 ? 's' : ''} — immediate attention needed
                </p>
                <p className="text-xs text-red-500 mt-0.5">
                  {overdue.map(l => l.loan.lender_name).join(', ')} · Total overdue: {sym}{Math.round(totalOverdue).toLocaleString()}
                </p>
              </div>
              <span className="text-red-400 text-sm font-medium shrink-0 mt-0.5">View →</span>
            </div>
          </Link>
        )
      })()}

      {loans.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">📊</div>
          <p className="text-lg font-medium">No loans yet</p>
          <p className="text-sm mt-1 mb-4">Add your first loan to see your dashboard</p>
          <Link href="/loans/new" className={cn(buttonVariants())}>Add Loan</Link>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="transition-shadow duration-200 hover:shadow-md">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <p className="text-xs text-gray-500">Total Debt</p>
                  <span className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                    <Scale className="w-3.5 h-3.5 text-red-500" />
                  </span>
                </div>
                <p className="text-2xl font-bold text-red-600 tabular-nums">{sym}{Math.round(totalDebtAnim).toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">incl. accrued interest</p>
              </CardContent>
            </Card>
            <Card className="transition-shadow duration-200 hover:shadow-md">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <p className="text-xs text-gray-500">Repaid So Far</p>
                  <span className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <PiggyBank className="w-3.5 h-3.5 text-emerald-500" />
                  </span>
                </div>
                <p className="text-2xl font-bold text-green-600 tabular-nums">{sym}{Math.round(totalRepaidAnim).toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">{progressPct}% of borrowed principal</p>
              </CardContent>
            </Card>
            <Card className="transition-shadow duration-200 hover:shadow-md">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <p className="text-xs text-gray-500">Due Next 30 Days</p>
                  <span className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
                    <CalendarClock className="w-3.5 h-3.5 text-orange-500" />
                  </span>
                </div>
                <p className="text-2xl font-bold text-orange-500 tabular-nums">{sym}{Math.round(totalDue30Anim).toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {due30Count} payment{due30Count !== 1 ? 's' : ''}
                  {overdueFixed.length > 0 && (
                    <span className="text-red-500">
                      {' '}+ {sym}{Math.round(overdueFixed.reduce((s, l) => s + toView(l.nextDueAmount, l.loan.currency), 0)).toLocaleString()} overdue
                    </span>
                  )}
                </p>
              </CardContent>
            </Card>
            <Card className="transition-shadow duration-200 hover:shadow-md">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <p className="text-xs text-gray-500">Debt-Free Date</p>
                  <span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                    <Flag className="w-3.5 h-3.5 text-indigo-500" />
                  </span>
                </div>
                <p className="text-lg font-bold text-indigo-600 leading-tight">{debtFreeDateFmt ?? '—'}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {debtFreeDateFmt === 'Ongoing' ? 'flexible loan active'
                    : hasActiveFlexible ? 'last EMI · family loans excl.'
                    : 'last scheduled EMI'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Overall progress bar */}
          <Card>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Overall Repayment Progress</p>
                <p className="text-sm font-bold text-indigo-600">{progressPct}%</p>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3">
                <div
                  className="progress-shimmer relative overflow-hidden bg-gradient-to-r from-indigo-500 to-emerald-500 h-3 rounded-full transition-all duration-700"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {/* Three numbers that add up correctly */}
              <div className="grid grid-cols-3 gap-2 text-center pt-1">
                <div>
                  <p className="text-xs font-semibold text-emerald-600">{sym}{Math.round(totalRepaid).toLocaleString()}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">paid so far</p>
                </div>
                <div className="border-x border-gray-100">
                  <p className="text-xs font-semibold text-slate-700">{sym}{Math.round(totalDebt - totalAccruedInterest).toLocaleString()}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">principal left</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-amber-500">{sym}{Math.round(totalAccruedInterest).toLocaleString()}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">interest owed</p>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 text-center">
                {progressPct}% of {sym}{Math.round(totalOriginal).toLocaleString()} originally borrowed · interest grows daily on family loans
              </p>
            </CardContent>
          </Card>

          {/* Row 1: Donut + Monthly Commitments — equal height, charts fill the card */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Donut — natural height set by chart + legend */}
            <Card className="flex flex-col">
              <CardHeader className="pb-2 shrink-0">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-sm">Debt by Category</CardTitle>
                  <div className="text-right">
                    <p className="text-base font-bold text-slate-800">{sym}{donutTotal.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">total outstanding</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 flex flex-col flex-1">
                {/* Chart fills available space, min height so it looks good standalone */}
                <div className="flex-1 min-h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} dataKey="value" innerRadius={50} outerRadius={80} paddingAngle={3} startAngle={90} endAngle={-270}>
                        {donutData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip
                        formatter={(v) => [`${sym}${Number(v).toLocaleString()}`, 'Outstanding']}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend pinned below chart */}
                <div className="shrink-0 space-y-2 pt-2">
                  <p className="text-[10px] text-slate-400">% share of total debt</p>
                  {donutData.map((d, i) => {
                    const pct = donutTotal > 0 ? Math.round((d.value / donutTotal) * 100) : 0
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                        <span className="text-gray-600 flex-1 truncate">{d.label}{d.count > 1 ? ` ×${d.count}` : ''}</span>
                        <div className="w-16 bg-slate-100 rounded-full h-1.5 shrink-0">
                          <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: d.color }} />
                        </div>
                        <span className="text-slate-400 w-7 text-right">{pct}%</span>
                        <span className="font-semibold text-slate-700 w-20 text-right">
                          {d.value >= 1000 ? `${sym}${fmtAxis(d.value)}` : `${sym}${d.value.toLocaleString()}`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Monthly Commitments — chart grows to fill same height as donut card */}
            <Card className="flex flex-col">
              <CardHeader className="pb-2 shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">Monthly Commitments</CardTitle>
                    <p className="text-xs text-slate-400 mt-0.5">next 12 months · {viewCurrency}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold text-slate-800">
                      {sym}{Math.round(monthlyOutflow.reduce((s, m) => s + m.amount, 0)).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-slate-400">12-month total</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 flex flex-col flex-1">
                {/* Chart grows to fill — matches donut card height automatically */}
                <div className="flex-1 min-h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyOutflow} barSize={20} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={fmtAxis} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(v) => [`${sym}${Number(v).toLocaleString()}`, 'Due']}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                        cursor={{ fill: '#f8fafc' }}
                      />
                      <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Stats pinned at the bottom — mirrors the legend area on the donut card */}
                <div className="shrink-0 grid grid-cols-3 gap-3 pt-3 mt-2 border-t border-slate-100">
                  {(() => {
                    const amounts = monthlyOutflow.map(m => m.amount).filter(a => a > 0)
                    const avg = amounts.length ? Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length) : 0
                    const peak = Math.max(...(amounts.length ? amounts : [0]))
                    return [
                      { label: 'This month', value: monthlyOutflow[0]?.amount ?? 0 },
                      { label: 'Monthly avg', value: avg },
                      { label: 'Peak month', value: peak },
                    ].map(({ label, value }) => (
                      <div key={label} className="text-center">
                        <p className="text-xs font-semibold text-slate-700">{sym}{value.toLocaleString()}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
                      </div>
                    ))
                  })()}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Debt Trajectory + Payoff Timeline — equal height, trajectory fills */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Debt Trajectory — chart fills to match payoff list height */}
            <Card className="flex flex-col">
              <CardHeader className="pb-2 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm">Debt Trajectory</CardTitle>
                    <p className="text-xs text-slate-400 mt-0.5">Projected outstanding · {viewCurrency}</p>
                    {/* Extra payment input + quick presets */}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <span className="text-[10px] text-slate-400 shrink-0">Pay extra/month:</span>
                      <span className="text-[10px] text-slate-500 shrink-0">{sym}</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={extraMonthly || ''}
                        onChange={e => setExtraMonthly(Math.max(0, Number(e.target.value) || 0))}
                        className="w-24 text-xs border border-slate-200 rounded px-1.5 py-0.5 text-slate-700 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
                      />
                      {(viewCurrency === 'INR' ? [10000, 25000, 50000] : [100, 250, 500]).map(amt => (
                        <button
                          key={amt}
                          onClick={() => setExtraMonthly(extraMonthly === amt ? 0 : amt)}
                          className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                            extraMonthly === amt
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                          }`}
                        >
                          +{amt >= 1000 ? `${amt / 1000}K` : amt}
                        </button>
                      ))}
                    </div>
                  </div>
                  {debtFreeDate && (
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold text-indigo-600">{debtFreeDateFmt}</p>
                      <p className="text-[10px] text-slate-400">debt-free date</p>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0 flex flex-col flex-1">
                <div className="flex-1 min-h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trajectoryData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="debtGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="accelGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.12} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                        interval={Math.floor(trajectoryData.length / 6)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={fmtAxis} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(v, name) => [
                          `${sym}${Number(v).toLocaleString()}`,
                          name === 'current' ? 'Current path' : `+${sym}${extraMonthly.toLocaleString()}/mo`
                        ]}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                      />
                      <Area type="monotone" dataKey="current" stroke="#6366f1" strokeWidth={2}
                        fill="url(#debtGrad)" dot={false} />
                      {accelTrajectory && (
                        <Area type="monotone" dataKey="accelerated" stroke="#10b981" strokeWidth={2}
                          strokeDasharray="6 3" fill="url(#accelGrad)" dot={false} />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {/* Savings callout — claim depends on whether the base path clears */}
                {accelSummary && (accelSummary.kind !== 'sooner' || accelSummary.months > 0) ? (
                  <div className="shrink-0 mt-3 flex items-center gap-2.5 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                    <span className="text-lg shrink-0">🎯</span>
                    <div className="flex-1 min-w-0">
                      {accelSummary.kind === 'sooner' && (
                        <p className="text-xs font-semibold text-emerald-700">
                          Debt-free {accelSummary.months} month{accelSummary.months !== 1 ? 's' : ''} sooner
                        </p>
                      )}
                      {accelSummary.kind === 'accel-only' && (
                        <p className="text-xs font-semibold text-emerald-700">
                          Debt-free in ~{accelSummary.months} months — current path doesn&apos;t clear within {horizonMonths} months
                        </p>
                      )}
                      {accelSummary.kind === 'reduction' && (
                        <p className="text-xs font-semibold text-emerald-700">
                          {sym}{Math.round(accelSummary.amount).toLocaleString()} lower balance after {horizonMonths} months
                        </p>
                      )}
                      <p className="text-[10px] text-emerald-600 mt-0.5">
                        with {sym}{extraMonthly.toLocaleString()} extra per month · <span className="text-slate-400">green dashed line · approximation, incl. simple interest on family loans</span>
                      </p>
                    </div>
                  </div>
                ) : accelSummary ? (
                  <div className="shrink-0 mt-3 px-3 py-2 bg-slate-50 rounded-lg">
                    <p className="text-[10px] text-slate-400 text-center">
                      Extra payment too small to accelerate payoff within projection window
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Payoff Timeline — natural height from list, trajectory matches it */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Payoff Timeline</CardTitle>
                <p className="text-xs text-slate-400 -mt-1">When each loan clears</p>
              </CardHeader>
              <CardContent className="pt-0 space-y-0.5">
                {loanPayoffs.map(({ loan, payoffDate, monthsLeft, outstanding, dailyInterest }) => {
                  const pct = debtTrajectory[0]?.amount > 0
                    ? Math.round((outstanding / debtTrajectory[0].amount) * 100) : 0
                  const color = LOAN_TYPE_COLORS[loan.loan_type] ?? '#6366f1'
                  return (
                    <Link key={loan.id} href={`/loans/${loan.id}`}
                      className="flex items-center gap-3 group rounded-lg px-2 py-2.5 hover:bg-slate-50 transition-colors">
                      <div className="w-1 h-8 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-700 truncate group-hover:text-indigo-600">
                          {loan.lender_name}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className="flex-1 bg-slate-100 rounded-full h-1">
                            <div className="h-1 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                          </div>
                          <span className="text-[10px] text-slate-400 w-6 text-right">{pct}%</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {payoffDate ? (
                          <>
                            <p className="text-xs font-semibold text-slate-700">
                              {formatMonthYear(payoffDate)}
                            </p>
                            <p className="text-[10px] text-slate-400">{monthsLeft === 0 ? 'this month' : `${monthsLeft}mo left`}</p>
                          </>
                        ) : (
                          <>
                            <p className="text-xs font-semibold text-amber-600">Flexible</p>
                            <p className="text-[10px] text-slate-400">
                              {dailyInterest && dailyInterest >= 1
                                ? `costs ${sym}${Math.round(dailyInterest).toLocaleString()}/day`
                                : 'open-ended'}
                            </p>
                          </>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </CardContent>
            </Card>
          </div>

          {/* Overdue + upcoming payments */}
          {(overdueFixed.length > 0 || upcomingFixed.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  {overdueFixed.length > 0 ? 'Overdue & Upcoming Payments' : 'Upcoming Payments (next 30 days)'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-gray-100">
                  {[...overdueFixed, ...upcomingFixed].map(({ loan, nextDueDate, nextDueAmount, isOverdue }) => (
                    <div key={loan.id} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <Link href={`/loans/${loan.id}`} className="text-sm font-medium hover:text-indigo-600 truncate block">
                          {loan.lender_name}
                        </Link>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {LOAN_TYPE_LABELS[loan.loan_type]}
                          {nextDueDate && <> · {formatDateShort(nextDueDate)}</>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <span className="text-sm font-semibold">{formatCurrency(nextDueAmount, loan.currency)}</span>
                        {isOverdue
                          ? <Badge variant="destructive" className="text-xs">Overdue</Badge>
                          : <Badge variant="outline" className="text-xs">Due Soon</Badge>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
