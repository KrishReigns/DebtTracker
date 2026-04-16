'use client'

import Link from 'next/link'

export default function UpgradeClient() {
  return (
    <div className="max-w-lg mx-auto mt-16 text-center space-y-5">
      <div className="text-6xl">⚡</div>
      <h1 className="text-2xl font-bold text-gray-900">Pro Plan — Coming Soon</h1>
      <p className="text-gray-500 leading-relaxed">
        Paid plans with unlimited loans, bulk export, and email reminders are in the works.
        For now, everything is free and fully unlocked.
      </p>
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5 text-left space-y-2.5 mt-4">
        {[
          { icon: '🏦', text: 'Unlimited loans' },
          { icon: '📤', text: 'Export to CSV, Excel & PDF' },
          { icon: '🔔', text: 'Email EMI reminders' },
          { icon: '📈', text: 'Projected payoff charts' },
          { icon: '📊', text: 'Full dashboard & analytics' },
        ].map(f => (
          <div key={f.text} className="flex items-center gap-3 text-sm text-gray-700">
            <span className="text-base">{f.icon}</span>
            <span>{f.text}</span>
            <span className="ml-auto text-xs text-green-600 font-semibold">Free ✓</span>
          </div>
        ))}
      </div>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl transition-all mt-4"
      >
        Back to Dashboard →
      </Link>
    </div>
  )
}
