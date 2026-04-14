'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format, addMonths } from 'date-fns'
import { computeFamilyLoanState, formatCurrency, convertCurrency } from '@/lib/calculations'
import { LOAN_TYPE_LABELS, LOAN_TYPE_COLORS, CURRENCY_SYMBOLS } from '@/lib/types'
import { formatDateShort } from '@/lib/utils'
import type { Loan, PaymentSchedule, PaymentTransaction, ExchangeRate } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Legend } from 'recharts'

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
    } else {
      // Fixed-EMI: outstanding = opening_balance of first pending schedule row
      const pendingRows = loanSchedule.filter(r => r.status !== 'paid')
      outstandingPrincipal = pendingRows[0]?.opening_balance ?? 0
      if (pendingRows[0]) {
        nextDueDate = pendingRows[0].contractual_due_date
        nextDueAmount = pendingRows[0].emi_amount
        isOverdue = nextDueDate < today
      }
    }

    return { loan, outstandingPrincipal, accruedInterest, nextDueDate, nextDueAmount, isOverdue }
  })

  const totalDebt = loanStats.reduce((s, l) => s + toView(l.outstandingPrincipal + l.accruedInterest, l.loan.currency), 0)
  const totalOriginal = loans.reduce((s, l) => s + toView(l.principal, l.currency), 0)

  // Donut data — group loans < 3% of total into "Others"
  const rawDonut = loanStats
    .filter(l => l.outstandingPrincipal > 0)
    .map(l => ({
      name: `${l.loan.lender_name} (${LOAN_TYPE_LABELS[l.loan.loan_type]})`,
      value: Math.round(toView(l.outstandingPrincipal, l.loan.currency)),
      color: LOAN_TYPE_COLORS[l.loan.loan_type],
    }))
    .sort((a, b) => b.value - a.value)

  const donutTotal = rawDonut.reduce((s, d) => s + d.value, 0)
  const threshold = donutTotal * 0.03
  const mainSlices = rawDonut.filter(d => d.value >= threshold)
  const otherSlices = rawDonut.filter(d => d.value < threshold)
  const othersValue = otherSlices.reduce((s, d) => s + d.value, 0)
  const donutData = othersValue > 0
    ? [...mainSlices, { name: `Others (${otherSlices.length} loans)`, value: othersValue, color: '#94a3b8' }]
    : mainSlices

  // Monthly outflow (next 12 months) — fixed-EMI only, from schedule
  const monthlyOutflow: { month: string; INR: number; USD: number }[] = []
  for (let i = 0; i < 12; i++) {
    const monthStr = format(addMonths(new Date(), i), 'yyyy-MM')
    let inr = 0, usd = 0
    for (const sched of schedules) {
      if (sched.contractual_due_date.startsWith(monthStr) && sched.status !== 'paid') {
        const loan = loans.find(l => l.id === sched.loan_id)
        if (!loan) continue
        if (loan.currency === 'INR') inr += sched.emi_amount
        else usd += sched.emi_amount
      }
    }
    monthlyOutflow.push({ month: monthStr.slice(5), INR: Math.round(inr), USD: Math.round(usd) })
  }

  // Upcoming overdue / due-soon (fixed-EMI pending rows in next 30 days)
  const in30 = new Date(new Date(today).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const upcomingFixed = loanStats
    .filter(l => l.loan.repayment_mode === 'fixed_emi' && l.nextDueDate && l.nextDueDate <= in30)
    .sort((a, b) => (a.nextDueDate ?? '').localeCompare(b.nextDueDate ?? ''))

  const sym = CURRENCY_SYMBOLS[viewCurrency]

  // Overall repayment progress
  const totalRepaid = transactions.reduce((s, t) => {
    const loan = loans.find(l => l.id === t.loan_id)
    return s + (loan ? toView(t.amount, loan.currency) : 0)
  }, 0)
  const progressPct = totalOriginal > 0 ? Math.min(100, Math.round((totalRepaid / totalOriginal) * 100)) : 0

  // Debt-free date — latest contractual_due_date among all active pending schedule rows
  const pendingDates = schedules
    .filter(s => s.status === 'pending')
    .map(s => s.contractual_due_date)
    .sort()
  const debtFreeDate = pendingDates.length > 0 ? pendingDates[pendingDates.length - 1] : null
  const debtFreeDateFmt = debtFreeDate
    ? new Date(debtFreeDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : null

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
                <p className="text-xs text-gray-400 mt-1">{progressPct}% of principal</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-gray-500">Due Next 30 Days</p>
                <p className="text-2xl font-bold mt-1 text-orange-500">{upcomingFixed.length} EMIs</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-gray-500">Debt-Free Date</p>
                <p className="text-lg font-bold mt-1 text-indigo-600 leading-tight">{debtFreeDateFmt ?? '—'}</p>
                <p className="text-xs text-gray-400 mt-1">last scheduled EMI</p>
              </CardContent>
            </Card>
          </div>

          {/* Overall progress bar */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Overall Repayment Progress</p>
                <p className="text-sm font-bold text-indigo-600">{progressPct}%</p>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1.5">
                <span>{sym}{Math.round(totalRepaid).toLocaleString()} repaid</span>
                <span>{sym}{Math.round(totalOriginal).toLocaleString()} total</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Donut */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Debt Breakdown</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={donutData} dataKey="value" innerRadius={60} outerRadius={90} paddingAngle={2}>
                      {donutData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => `${sym}${Number(v).toLocaleString()}`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {donutData.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                        <span className="text-gray-600 truncate max-w-40">{d.name}</span>
                      </div>
                      <span className="font-medium">{sym}{d.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Monthly outflow */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Monthly Outflow (next 12 months)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyOutflow} barSize={12}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtAxis} />
                    <Tooltip formatter={(v) => `${Number(v).toLocaleString()}`} />
                    <Legend />
                    <Bar dataKey="INR" fill="#6366f1" name="₹ INR" radius={[3,3,0,0]} />
                    <Bar dataKey="USD" fill="#10b981" name="$ USD" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Upcoming payments */}
          {upcomingFixed.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Upcoming EMIs (next 30 days)</CardTitle></CardHeader>
              <CardContent>
                <div className="divide-y divide-gray-100">
                  {upcomingFixed.map(({ loan, nextDueDate, nextDueAmount, isOverdue }) => (
                    <div key={loan.id} className="flex items-center justify-between py-2">
                      <div>
                        <Link href={`/loans/${loan.id}`} className="text-sm font-medium hover:text-indigo-600">
                          {loan.lender_name}
                        </Link>
                        <p className="text-xs text-gray-500">
                          {nextDueDate && formatDateShort(nextDueDate)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{formatCurrency(nextDueAmount, loan.currency)}</span>
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
