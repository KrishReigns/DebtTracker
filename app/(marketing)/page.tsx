import Link from 'next/link'

const FEATURES = [
  {
    icon: '📊',
    title: 'Smart EMI Schedules',
    desc: 'Auto-generate full amortization tables for any loan. See exactly how much goes to interest vs principal every month.',
  },
  {
    icon: '🤝',
    title: 'Family Loan Tracker',
    desc: 'Track informal loans with daily simple interest. No spreadsheets — just record payments and let the app do the math.',
  },
  {
    icon: '📅',
    title: 'Payment Calendar',
    desc: 'See all upcoming EMIs in one place. Set planned pay dates and never lose track of what\'s due next.',
  },
  {
    icon: '📤',
    title: 'Export Anywhere',
    desc: 'Download your loan data as PDF, CSV or Excel. Share with your CA or keep for your own records.',
  },
  {
    icon: '🔒',
    title: 'Private & Secure',
    desc: 'Your data belongs to you. Row-level security ensures nobody else can ever see your loan data.',
  },
  {
    icon: '📱',
    title: 'Works Everywhere',
    desc: 'Use on your phone, tablet or laptop. Install as an app on your home screen — no app store needed.',
  },
]

const LOAN_TYPES = [
  { icon: '🏠', label: 'Home Loan' },
  { icon: '🚗', label: 'Vehicle' },
  { icon: '🎓', label: 'Education' },
  { icon: '🪙', label: 'Gold Loan' },
  { icon: '💳', label: 'Credit Card' },
  { icon: '🤝', label: 'Family Loan' },
  { icon: '👤', label: 'Personal' },
  { icon: '💼', label: 'Business' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-sm border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">💰</span>
            <span className="font-bold text-slate-900 text-lg">DebtTracker</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors px-3 py-2"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="text-sm font-semibold bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        {/* Background blobs */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-200/30 rounded-full blur-3xl -translate-y-1/2 pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-200/30 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />

        <div className="relative max-w-5xl mx-auto px-4 py-20 md:py-28 text-center">
          <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-full px-4 py-1.5 text-xs font-medium text-indigo-700 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            Free to use · No credit card required
          </div>

          <h1 className="text-4xl md:text-6xl font-extrabold text-slate-900 leading-tight tracking-tight">
            Track Every Rupee<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">
              You Owe
            </span>
          </h1>

          <p className="mt-6 text-lg md:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed">
            Manage all your EMIs, family loans and repayments in one place.
            See exactly where your money goes — and when you&apos;ll be debt-free.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-8 py-3.5 rounded-xl text-base transition-all shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:-translate-y-0.5"
            >
              Start Tracking Free
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <Link
              href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-slate-200 text-slate-700 font-semibold px-8 py-3.5 rounded-xl text-base hover:bg-slate-50 transition-all"
            >
              Sign In
            </Link>
          </div>

          {/* Loan type chips */}
          <div className="mt-14 flex flex-wrap items-center justify-center gap-2">
            {LOAN_TYPES.map(t => (
              <span
                key={t.label}
                className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm"
              >
                {t.icon} {t.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      <section className="border-y border-slate-100 bg-slate-50">
        <div className="max-w-5xl mx-auto px-4 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { value: '8',    label: 'Loan Types' },
            { value: '₹+$',  label: 'Currencies' },
            { value: '100%', label: 'Free to Start' },
            { value: '0',    label: 'Spreadsheets Needed' },
          ].map(s => (
            <div key={s.label}>
              <p className="text-2xl md:text-3xl font-extrabold text-indigo-600">{s.value}</p>
              <p className="text-sm text-slate-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-900">Everything you need</h2>
          <p className="mt-3 text-slate-500 text-lg">Built specifically for how Indians manage debt</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map(f => (
            <div
              key={f.title}
              className="group bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
            >
              <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">
                {f.icon}
              </div>
              <h3 className="font-semibold text-slate-800 text-base">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-slate-50 to-indigo-50/40 py-20">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900">Up and running in minutes</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '1', title: 'Add your loans', desc: 'Enter loan details — amount, rate, tenure. The app builds the full repayment schedule instantly.' },
              { step: '2', title: 'Record payments', desc: 'Mark EMIs as paid with one tap. Partial payments and flexible loans are fully supported.' },
              { step: '3', title: 'Stay on track', desc: 'See your remaining balance, interest paid and payoff date at a glance — always up to date.' },
            ].map(s => (
              <div key={s.step} className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-indigo-600 text-white font-bold text-lg flex items-center justify-center shrink-0 mt-0.5">
                  {s.step}
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800 text-base">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 py-20 text-center">
        <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-3xl px-6 py-16 shadow-2xl shadow-indigo-200">
          <h2 className="text-3xl md:text-4xl font-extrabold text-white">
            Ready to take control?
          </h2>
          <p className="mt-4 text-indigo-200 text-lg max-w-xl mx-auto">
            Start tracking your loans today — free, private, no app store needed.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white text-indigo-700 font-bold px-8 py-3.5 rounded-xl text-base hover:bg-indigo-50 transition-all shadow-lg"
            >
              Create Free Account
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <Link
              href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center text-white/80 hover:text-white font-medium px-6 py-3.5 rounded-xl transition-colors border border-white/20 hover:border-white/40"
            >
              Already have an account? Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 bg-slate-50">
        <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">💰</span>
            <span className="font-semibold text-slate-700">DebtTracker</span>
          </div>
          <p className="text-sm text-slate-400">© 2026 DebtTracker · Your data stays yours</p>
          <div className="flex gap-4 text-sm text-slate-400">
            <Link href="/login" className="hover:text-slate-600 transition-colors">Sign In</Link>
            <Link href="/signup" className="hover:text-slate-600 transition-colors">Sign Up</Link>
          </div>
        </div>
      </footer>

    </div>
  )
}
