'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format, addMonths, differenceInMonths } from 'date-fns'
import { computeFamilyLoanState, formatCurrency, convertCurrency } from '@/lib/calculations'
import { LOAN_TYPE_LABELS, LOAN_TYPE_COLORS, CURRENCY_SYMBOLS } from '@/lib/types'
import { formatDateShort } from '@/lib/utils'
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

export default function DashboardClient({ loans, schedules, transactions, exchangeRates }: Props) {
  const [viewCurrency, setViewCurrency] = useState<'INR' | 'USD'>('INR')
  const today = new Date().toISOString().split('T')[0]

  function getRate(from: 'INR' | 'USD', to: 'INR' | 'USD'): number {
    if (from === to) return 1
    const r = exchangeRates.find(r => r.from_currency === from && r.to_currency === to)
    return r?.rate ?? (from === 'USD' ? 84.5 : 1 / 84.5)
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
      // Credit card: balance is loan.principal; due date from latest statement note
      outstandingPrincipal = loan.principal
      const lastTx = [...loanTx].sort((a, b) => b.payment_date.localeCompare(a.payment_date))[0]
      const dueDateMatch = lastTx?.note?.match(/Due: (\d{4}-\d{2}-\d{2})/)
      if (dueDateMatch) {
        nextDueDate = dueDateMatch[1]
        nextDueAmount = loan.principal
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

  // Donut data — group by loan TYPE (more insightful than per-lender)
  const typeMap: Record<string, { value: number; color: string; label: string; count: number }> = {}
  for (const l of loanStats.filter(s => s.outstandingPrincipal > 0)) {
    const t = l.loan.loan_type
    if (!typeMap[t]) typeMap[t] = { value: 0, color: LOAN_TYPE_COLORS[t] ?? '#94a3b8', label: LOAN_TYPE_LABELS[t] ?? t, count: 0 }
    typeMap[t].value += Math.round(toView(l.outstandingPrincipal, l.loan.currency))
    typeMap[t].count++
  }
  const donutData = Object.values(typeMap).sort((a, b) => b.value - a.value)
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0)

  // Monthly outflow (next 12 months) — single viewCurrency, from all schedule rows
  const monthlyOutflow: { month: string; amount: number }[] = []
  for (let i = 0; i < 12; i++) {
    const d = addMonths(new Date(), i)
    const monthStr = format(d, 'yyyy-MM')
    let total = 0
    for (const sched of schedules) {
      if (sched.contractual_due_date.startsWith(monthStr) && sched.status !== 'paid') {
        const loan = loans.find(l => l.id === sched.loan_id)
        if (loan) total += toView(sched.emi_amount, loan.currency)
      }
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
        // Family loans: use current outstanding (no schedule, assume static for projection)
        total += toView(ls.outstandingPrincipal + ls.accruedInterest, loan.currency)
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

  // Total amount due in next 30 days
  const totalDue30 = upcomingFixed.reduce((s, l) => s + toView(l.nextDueAmount, l.loan.currency), 0)

  const sym = CURRENCY_SYMBOLS[viewCurrency]

  // Overall repayment progress — actual cash paid (payment_transactions = source of truth for real amounts)
  const totalRepaid = transactions.reduce((s, t) => {
    const loan = loans.find(l => l.id === t.loan_id)
    return s + (loan ? toView(t.amount, loan.currency) : 0)
  }, 0)
  // Progress = paid ÷ original principal borrowed (standard bank metric, only goes up when you pay)
  const progressPct = totalOriginal > 0 ? Math.min(100, Math.round((totalRepaid / totalOriginal) * 100)) : 0
  // Interest that has accrued but not yet been paid (family loans only)
  const totalAccruedInterest = loanStats.reduce((s, l) => s + toView(l.accruedInterest, l.loan.currency), 0)

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

  // Y-axis formatter
  function fmtAxis(v: number) {
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
          <p className="text-sm text-gray-500 mt-1">{loans.length} active loans</p>
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
              <span className="text-xl mt-0.5">🚨</span>
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
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-gray-500">Total Debt</p>
                <p className="text-2xl font-bold mt-1 text-red-600">{sym}{Math.round(totalDebt).toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">incl. accrued interest</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-gray-500">Repaid So Far</p>
                <p className="text-2xl font-bold mt-1 text-green-600">{sym}{Math.round(totalRepaid).toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">{progressPct}% of borrowed principal</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-gray-500">Due Next 30 Days</p>
                <p className="text-2xl font-bold mt-1 text-orange-500">{sym}{Math.round(totalDue30).toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {upcomingFixed.length} payment{upcomingFixed.length !== 1 ? 's' : ''}
                  {overdueFixed.length > 0 && <span className="text-red-500"> · {overdueFixed.length} overdue</span>}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-gray-500">Debt-Free Date</p>
                <p className="text-lg font-bold mt-1 text-indigo-600 leading-tight">{debtFreeDateFmt ?? '—'}</p>
                <p className="text-xs text-gray-400 mt-1">{debtFreeDateFmt === 'Ongoing' ? 'flexible loan active' : 'last scheduled EMI'}</p>
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
                  className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-3 rounded-full transition-all duration-500"
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Donut — grouped by loan type */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-sm">Debt by Category</CardTitle>
                  <div className="text-right">
                    <p className="text-lg font-bold text-slate-800">{sym}{donutTotal.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">total outstanding</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={donutData} dataKey="value" innerRadius={50} outerRadius={78} paddingAngle={3} startAngle={90} endAngle={-270}>
                      {donutData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v) => [`${sym}${Number(v).toLocaleString()}`, 'Outstanding']}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Legend with % of total */}
                <p className="text-[10px] text-slate-400 mb-1.5">% share of total debt</p>
                <div className="space-y-1.5">
                  {donutData.map((d, i) => {
                    const pct = donutTotal > 0 ? Math.round((d.value / donutTotal) * 100) : 0
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                        <span className="text-gray-600 flex-1 truncate">{d.label}{d.count > 1 ? ` ×${d.count}` : ''}</span>
                        <div className="w-20 bg-slate-100 rounded-full h-1.5 shrink-0">
                          <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: d.color }} />
                        </div>
                        <span className="text-slate-400 w-7 text-right">{pct}%</span>
                        <span className="font-semibold text-slate-700 w-20 text-right">{sym}{(d.value/1000).toFixed(0)}K</span>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Monthly outflow — single currency, respects INR/USD toggle */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Monthly Commitments · next 12 months</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyOutflow} barSize={18} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
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
              </CardContent>
            </Card>
          </div>

          {/* Projected Payoff */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Debt trajectory chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Debt Trajectory</CardTitle>
                <p className="text-xs text-slate-400 -mt-1">Projected total outstanding over time</p>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={debtTrajectory} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="debtGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                      interval={Math.floor(debtTrajectory.length / 6)} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={fmtAxis} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v) => [`${sym}${Number(v).toLocaleString()}`, 'Outstanding']}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Area type="monotone" dataKey="amount" stroke="#6366f1" strokeWidth={2}
                      fill="url(#debtGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Per-loan payoff timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Payoff Timeline</CardTitle>
                <p className="text-xs text-slate-400 -mt-1">When each loan clears</p>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {loanPayoffs.map(({ loan, payoffDate, monthsLeft, outstanding }) => {
                  const pct = debtTrajectory[0]?.amount > 0
                    ? Math.round((outstanding / debtTrajectory[0].amount) * 100) : 0
                  const color = LOAN_TYPE_COLORS[loan.loan_type] ?? '#6366f1'
                  return (
                    <Link key={loan.id} href={`/loans/${loan.id}`}
                      className="flex items-center gap-3 group rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
                      <div className="w-1.5 h-8 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-700 truncate group-hover:text-indigo-600">
                          {loan.lender_name}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className="flex-1 bg-slate-100 rounded-full h-1">
                            <div className="h-1 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                          </div>
                          <span className="text-[10px] text-slate-400">{pct}%</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {payoffDate ? (
                          <>
                            <p className="text-xs font-semibold text-slate-700">
                              {new Date(payoffDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                            </p>
                            <p className="text-[10px] text-slate-400">{monthsLeft}mo left</p>
                          </>
                        ) : (
                          <>
                            <p className="text-xs font-semibold text-amber-600">Open-ended</p>
                            <p className="text-[10px] text-slate-400">flexible</p>
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
