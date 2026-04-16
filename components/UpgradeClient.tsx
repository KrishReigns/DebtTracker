'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { FREE_LOAN_LIMIT } from '@/lib/stripe'

interface Props {
  tier: 'free' | 'pro'
  isPro: boolean
  status: string | null
  periodEnd: string | null
  hasCustomer: boolean
}

const PRO_FEATURES = [
  { icon: '🏦', text: 'Unlimited loans (free: up to 3)' },
  { icon: '📤', text: 'Export to CSV, Excel & PDF' },
  { icon: '🔔', text: 'Email EMI reminders' },
  { icon: '📈', text: 'Projected payoff charts' },
  { icon: '⚡', text: 'Priority support' },
]

export default function UpgradeClient({ tier, isPro, status, periodEnd, hasCustomer }: Props) {
  const [plan, setPlan] = useState<'monthly' | 'annual'>('annual')
  const [loading, setLoading] = useState<'monthly' | 'annual' | 'portal' | null>(null)
  const params = useSearchParams()
  const [banner, setBanner] = useState<'success' | 'canceled' | null>(null)

  useEffect(() => {
    if (params.get('success') === '1') setBanner('success')
    if (params.get('canceled') === '1') setBanner('canceled')
  }, [params])

  async function handleCheckout(selectedPlan: 'monthly' | 'annual') {
    setLoading(selectedPlan)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan }),
      })
      const { url } = await res.json()
      if (url) window.location.href = url
    } catch {
      setLoading(null)
      alert('Something went wrong. Please try again.')
    }
  }

  async function handlePortal() {
    setLoading('portal')
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const { url } = await res.json()
      if (url) window.location.href = url
    } catch {
      setLoading(null)
      alert('Could not open billing portal. Please try again.')
    }
  }

  const periodEndFmt = periodEnd
    ? new Date(periodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Plans & Billing</h1>
        <p className="text-sm text-gray-500 mt-1">
          {isPro ? 'You\'re on Pro — all features unlocked.' : `You\'re on the free plan (up to ${FREE_LOAN_LIMIT} loans).`}
        </p>
      </div>

      {/* Success / canceled banners */}
      {banner === 'success' && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <span className="text-xl">🎉</span>
          <div>
            <p className="font-semibold text-green-700 text-sm">Welcome to Pro!</p>
            <p className="text-xs text-green-600 mt-0.5">All features are now unlocked. Enjoy unlimited loans, exports and reminders.</p>
          </div>
        </div>
      )}
      {banner === 'canceled' && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <span className="text-xl">↩️</span>
          <p className="text-sm text-amber-700">Checkout canceled — you haven&apos;t been charged.</p>
        </div>
      )}

      {/* Current plan card */}
      {isPro ? (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white text-lg">⚡</div>
              <div>
                <p className="font-bold text-gray-900">Pro Plan</p>
                <p className="text-xs text-gray-500 capitalize">{status ?? 'active'}{periodEndFmt ? ` · renews ${periodEndFmt}` : ''}</p>
              </div>
            </div>
            <span className="bg-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-full">Active</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PRO_FEATURES.map(f => (
              <div key={f.text} className="flex items-center gap-2 text-sm text-gray-700">
                <span className="text-base">{f.icon}</span>
                <span>{f.text}</span>
              </div>
            ))}
          </div>
          {hasCustomer && (
            <button
              onClick={handlePortal}
              disabled={loading === 'portal'}
              className="w-full mt-2 py-2.5 rounded-lg border border-indigo-300 text-indigo-700 text-sm font-medium hover:bg-indigo-50 transition-colors disabled:opacity-60"
            >
              {loading === 'portal' ? 'Opening…' : 'Manage Subscription →'}
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Free plan info */}
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gray-200 flex items-center justify-center text-lg">🆓</div>
              <div>
                <p className="font-bold text-gray-900">Free Plan</p>
                <p className="text-xs text-gray-500">Up to {FREE_LOAN_LIMIT} loans · Basic features</p>
              </div>
            </div>
            <div className="space-y-1.5 text-sm text-gray-500">
              <div className="flex items-center gap-2"><span className="text-green-500">✓</span> {FREE_LOAN_LIMIT} active loans</div>
              <div className="flex items-center gap-2"><span className="text-green-500">✓</span> Full payment tracking</div>
              <div className="flex items-center gap-2"><span className="text-green-500">✓</span> Dashboard & charts</div>
              <div className="flex items-center gap-2 text-gray-300"><span>✗</span> Export (CSV / Excel / PDF)</div>
              <div className="flex items-center gap-2 text-gray-300"><span>✗</span> Email reminders</div>
              <div className="flex items-center gap-2 text-gray-300"><span>✗</span> Unlimited loans</div>
            </div>
          </div>

          {/* Plan toggle */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-900 text-base">Upgrade to Pro</h2>
              <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-1">
                <button
                  onClick={() => setPlan('monthly')}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${plan === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setPlan('annual')}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${plan === 'annual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Annual
                  <span className="ml-1.5 bg-green-100 text-green-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">-16%</span>
                </button>
              </div>
            </div>

            {/* Pricing */}
            <div className="text-center py-2">
              {plan === 'monthly' ? (
                <>
                  <p className="text-4xl font-extrabold text-gray-900">₹199</p>
                  <p className="text-sm text-gray-400 mt-1">per month</p>
                </>
              ) : (
                <>
                  <p className="text-4xl font-extrabold text-gray-900">₹1,999</p>
                  <p className="text-sm text-gray-400 mt-1">per year · <span className="text-green-600 font-semibold">save ₹389</span></p>
                </>
              )}
            </div>

            {/* Features */}
            <div className="space-y-2.5">
              {PRO_FEATURES.map(f => (
                <div key={f.text} className="flex items-center gap-3 text-sm text-gray-700">
                  <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">✓</span>
                  {f.text}
                </div>
              ))}
            </div>

            {/* CTA */}
            <button
              onClick={() => handleCheckout(plan)}
              disabled={loading !== null}
              className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base transition-all shadow-lg shadow-indigo-200 disabled:opacity-60 hover:-translate-y-0.5"
            >
              {loading === plan ? 'Redirecting to Stripe…' : `Upgrade to Pro · ${plan === 'monthly' ? '₹199/mo' : '₹1,999/yr'}`}
            </button>

            <p className="text-center text-xs text-gray-400">
              Secure payment via Stripe · Cancel anytime
            </p>
          </div>
        </>
      )}
    </div>
  )
}
