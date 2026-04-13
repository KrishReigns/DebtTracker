'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'

function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/account/delete', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to delete account')
      // Sign out locally then redirect
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/login')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="text-center space-y-1">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-bold text-slate-800">Delete Account</h2>
          <p className="text-sm text-slate-500">
            This will permanently delete your account and <span className="font-semibold text-red-600">all your loan data</span>. This cannot be undone.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">
            Type <span className="font-bold text-red-600">DELETE</span> to confirm
          </label>
          <input
            type="text"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="DELETE"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
          />
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={confirm !== 'DELETE' || loading}
            className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Deleting…' : 'Delete Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

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

export default function Sidebar({ displayName, userEmail }: { displayName: string; userEmail: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  // Initials avatar from display name
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const header = (
    <div className="p-4 border-b border-gray-200 space-y-3">
      <div className="text-xl font-bold text-gray-900">💰 DebtTracker</div>
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{displayName}</p>
          <p className="text-xs text-gray-400 truncate">{userEmail}</p>
        </div>
      </div>
    </div>
  )

  const footer = (
    <div className="p-3 border-t border-gray-200 space-y-1">
      <button
        onClick={signOut}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      >
        <span>🚪</span> Sign Out
      </button>
      <button
        onClick={() => setShowDeleteModal(true)}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
      >
        <span>🗑</span> Delete Account
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
        <span className="font-bold text-gray-900 text-base flex-1">💰 DebtTracker</span>
        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">
          {initials}
        </div>
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
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {initials}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{displayName}</p>
                  <p className="text-xs text-gray-400 truncate max-w-[140px]">{userEmail}</p>
                </div>
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

      {/* Delete account modal — rendered outside drawer so it's always on top */}
      {showDeleteModal && <DeleteAccountModal onClose={() => setShowDeleteModal(false)} />}
    </>
  )
}
