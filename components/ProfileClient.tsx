'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  userId: string
  email: string
  displayName: string
  firstName: string
  lastName: string
  isGoogleUser: boolean
}

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
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/login')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="text-center space-y-1">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-bold text-slate-800">Delete Account</h2>
          <p className="text-sm text-slate-500">
            This permanently deletes your account and{' '}
            <span className="font-semibold text-red-600">all your loan data</span>. Cannot be undone.
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
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
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

export default function ProfileClient({ email, displayName, firstName, lastName, isGoogleUser }: Props) {
  const router = useRouter()
  const [first, setFirst] = useState(firstName)
  const [last, setLast]   = useState(lastName)
  const [nameLoading, setNameLoading]   = useState(false)
  const [nameSaved, setNameSaved]       = useState(false)
  const [nameError, setNameError]       = useState('')

  const [currentPw, setCurrentPw]   = useState('')
  const [newPw, setNewPw]           = useState('')
  const [confirmPw, setConfirmPw]   = useState('')
  const [pwLoading, setPwLoading]   = useState(false)
  const [pwSaved, setPwSaved]       = useState(false)
  const [pwError, setPwError]       = useState('')

  const [showDelete, setShowDelete] = useState(false)

  const initials = displayName.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    if (!first.trim()) return
    setNameLoading(true)
    setNameError('')
    setNameSaved(false)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({
      data: {
        first_name: first.trim(),
        last_name: last.trim(),
        full_name: `${first.trim()} ${last.trim()}`.trim(),
      }
    })
    setNameLoading(false)
    if (error) { setNameError(error.message); return }
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 3000)
    router.refresh()
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return }
    if (newPw.length < 6) { setPwError('Password must be at least 6 characters.'); return }
    setPwLoading(true)
    setPwError('')
    setPwSaved(false)
    const supabase = createClient()
    // Re-authenticate first with current password
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: currentPw })
    if (signInErr) { setPwLoading(false); setPwError('Current password is incorrect.'); return }
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setPwLoading(false)
    if (error) { setPwError(error.message); return }
    setPwSaved(true)
    setCurrentPw(''); setNewPw(''); setConfirmPw('')
    setTimeout(() => setPwSaved(false), 3000)
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your account details</p>
      </div>

      {/* Avatar + identity */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-white text-2xl font-bold shrink-0">
              {initials}
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-800">{displayName}</p>
              <p className="text-sm text-slate-500">{email}</p>
              <span className={`inline-flex items-center gap-1 mt-1.5 text-xs px-2.5 py-0.5 rounded-full font-medium ${
                isGoogleUser
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}>
                {isGoogleUser ? (
                  <>
                    <svg className="w-3 h-3" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Signed in with Google
                  </>
                ) : '✉ Email & Password'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit name */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Display Name</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveName} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="first">First Name</Label>
                <Input id="first" value={first} onChange={e => setFirst(e.target.value)} required className="h-10" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="last">Last Name</Label>
                <Input id="last" value={last} onChange={e => setLast(e.target.value)} className="h-10" />
              </div>
            </div>
            {nameError && <p className="text-xs text-red-600">{nameError}</p>}
            {nameSaved && <p className="text-xs text-emerald-600">✓ Name updated successfully</p>}
            <Button type="submit" disabled={nameLoading} className="h-10">
              {nameLoading ? 'Saving…' : 'Save Name'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Change password — email users only */}
      {!isGoogleUser && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Change Password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={savePassword} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="currentPw">Current Password</Label>
                <Input id="currentPw" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} required className="h-10" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="newPw">New Password</Label>
                <Input id="newPw" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} minLength={6} required className="h-10" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirmPw">Confirm New Password</Label>
                <Input id="confirmPw" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required className="h-10" />
              </div>
              {pwError && <p className="text-xs text-red-600">{pwError}</p>}
              {pwSaved && <p className="text-xs text-emerald-600">✓ Password changed successfully</p>}
              <Button type="submit" disabled={pwLoading} className="h-10">
                {pwLoading ? 'Updating…' : 'Update Password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isGoogleUser && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700">
          You signed in with Google. Password management is handled by your Google account.
        </div>
      )}

      {/* Sign out + Danger zone */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Account Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <span>🚪</span> Sign Out
          </button>
          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-400 mb-2">Danger Zone</p>
            <button
              onClick={() => setShowDelete(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <span>🗑</span> Delete Account &amp; All Data
            </button>
          </div>
        </CardContent>
      </Card>

      {showDelete && <DeleteAccountModal onClose={() => setShowDelete(false)} />}
    </div>
  )
}
