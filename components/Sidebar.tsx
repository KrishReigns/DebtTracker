'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/',        label: 'Dashboard',   icon: '📊' },
  { href: '/loans',   label: 'Loans',       icon: '🏦' },
  { href: '/payments',label: 'Payments',    icon: '📅' },
  { href: '/import',  label: 'Import Sheet',icon: '📥' },
]

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 p-3 space-y-1">
      {NAV.map(({ href, label, icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              active
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            )}
          >
            <span className="text-base">{icon}</span>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

export default function Sidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const header = (
    <div className="p-4 border-b border-gray-200">
      <div className="text-xl font-bold text-gray-900">💰 DebtTracker</div>
      <div className="text-xs text-gray-500 mt-0.5 truncate">{userEmail}</div>
    </div>
  )

  const footer = (
    <div className="p-3 border-t border-gray-200">
      <button
        onClick={signOut}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      >
        <span>🚪</span> Sign Out
      </button>
    </div>
  )

  return (
    <>
      {/* ── Desktop sidebar (md and above) ─────────────────────────── */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col shrink-0">
        {header}
        <NavLinks pathname={pathname} />
        {footer}
      </aside>

      {/* ── Mobile top bar ──────────────────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center gap-3 bg-white border-b border-gray-200 px-4 h-14 shadow-sm">
        <button
          onClick={() => setOpen(true)}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Open menu"
        >
          <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="font-bold text-gray-900 text-base">💰 DebtTracker</span>
      </div>

      {/* ── Mobile drawer overlay ────────────────────────────────────── */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* Drawer panel */}
          <aside className="relative w-64 max-w-[80vw] bg-white flex flex-col h-full shadow-xl animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <div className="text-lg font-bold text-gray-900">💰 DebtTracker</div>
                <div className="text-xs text-gray-500 mt-0.5 truncate max-w-[180px]">{userEmail}</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Close menu"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            {footer}
          </aside>
        </div>
      )}
    </>
  )
}
