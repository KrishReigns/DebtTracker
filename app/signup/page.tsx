'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const NAME_RE = /^[a-zA-Z\s'\-\.]+$/

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0
  if (pw.length >= 8)              score++
  if (pw.length >= 12)             score++
  if (/[A-Z]/.test(pw))           score++
  if (/[0-9]/.test(pw))           score++
  if (/[^a-zA-Z0-9]/.test(pw))   score++
  if (score <= 1) return { score, label: 'Weak',   color: 'bg-red-500' }
  if (score <= 3) return { score, label: 'Fair',   color: 'bg-amber-400' }
  return             { score, label: 'Strong', color: 'bg-emerald-500' }
}

// Map raw Supabase / network errors → friendly messages
function friendlyError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('user already registered') || m.includes('already been registered'))
    return 'An account with this email already exists. Try signing in instead.'
  if (m.includes('invalid email'))
    return 'Please enter a valid email address.'
  if (m.includes('password') && m.includes('short'))
    return 'Password must be at least 6 characters.'
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Too many attempts. Please wait a minute and try again.'
  if (m.includes('network') || m.includes('fetch'))
    return 'Network error. Check your connection and try again.'
  return msg // fallback: show as-is
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SignupPage() {
  const [googleLoading, setGoogleLoading] = useState(false)
  const [firstName, setFirstName]       = useState('')
  const [lastName, setLastName]         = useState('')
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [confirmPassword, setConfirm]   = useState('')
  const [errors, setErrors]             = useState<Record<string, string>>({})
  const [serverError, setServerError]   = useState('')
  const [loading, setLoading]           = useState(false)
  const [done, setDone]                 = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm]   = useState(false)

  const strength = passwordStrength(password)

  // ── Client-side field validation ────────────────────────────────────────────
  function validate(): boolean {
    const e: Record<string, string> = {}

    if (!firstName.trim())
      e.firstName = 'First name is required.'
    else if (!NAME_RE.test(firstName.trim()))
      e.firstName = 'Only letters, spaces, hyphens and apostrophes allowed.'

    if (!lastName.trim())
      e.lastName = 'Last name is required.'
    else if (!NAME_RE.test(lastName.trim()))
      e.lastName = 'Only letters, spaces, hyphens and apostrophes allowed.'

    if (!email.trim())
      e.email = 'Email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      e.email = 'Please enter a valid email address.'

    if (!password)
      e.password = 'Password is required.'
    else if (password.length < 6)
      e.password = 'Password must be at least 6 characters.'
    else if (strength.score <= 1)
      e.password = 'Password is too weak. Add uppercase letters, numbers or symbols.'

    if (!confirmPassword)
      e.confirm = 'Please confirm your password.'
    else if (password !== confirmPassword)
      e.confirm = 'Passwords do not match.'

    setErrors(e)
    return Object.keys(e).length === 0
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleGoogleSignup() {
    setGoogleLoading(true)
    setServerError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${location.origin}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) {
      setServerError(friendlyError(error.message))
      setGoogleLoading(false)
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setServerError('')
    if (!validate()) return

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
        data: {
          first_name: firstName.trim(),
          last_name:  lastName.trim(),
          full_name:  `${firstName.trim()} ${lastName.trim()}`.trim(),
        },
      },
    })

    if (error) {
      setServerError(friendlyError(error.message))
      setLoading(false)
    } else {
      setDone(true)
    }
  }

  // ── Success screen ───────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-slate-100 px-4">
        <Card className="w-full max-w-sm text-center shadow-lg">
          <CardHeader className="pb-4">
            <div className="text-5xl mb-3">✅</div>
            <CardTitle className="text-xl">Check your email</CardTitle>
            <CardDescription className="mt-1">
              We sent a confirmation link to{' '}
              <span className="font-semibold text-slate-700">{email}</span>.
              <br />Click it to activate your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-400">
              Didn&apos;t receive it? Check your spam folder or{' '}
              <Link href="/signup" className="text-indigo-600 hover:underline">
                try again
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Form ─────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-slate-100 px-4 py-8">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="text-4xl mb-2">💰</div>
          <CardTitle className="text-2xl">Create Account</CardTitle>
          <CardDescription>Track all your loans in one place</CardDescription>
        </CardHeader>

        <CardContent>
          {/* Google Sign Up */}
          <Button
            type="button"
            variant="outline"
            className="w-full flex items-center gap-2 h-10"
            onClick={handleGoogleSignup}
            disabled={googleLoading || loading}
          >
            {googleLoading ? (
              <svg className="w-4 h-4 animate-spin text-slate-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            ) : <GoogleIcon />}
            <span>{googleLoading ? 'Redirecting…' : 'Continue with Google'}</span>
          </Button>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs text-slate-400 uppercase">
              <span className="bg-white px-2">or sign up with email</span>
            </div>
          </div>

          <form onSubmit={handleSignup} className="space-y-3" noValidate>

            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  placeholder="Ravi"
                  value={firstName}
                  onChange={e => { setFirstName(e.target.value); setErrors(v => ({ ...v, firstName: '' })) }}
                  className={errors.firstName ? 'border-red-400 focus-visible:ring-red-300' : ''}
                />
                {errors.firstName && <p className="text-xs text-red-500">{errors.firstName}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  placeholder="Kumar"
                  value={lastName}
                  onChange={e => { setLastName(e.target.value); setErrors(v => ({ ...v, lastName: '' })) }}
                  className={errors.lastName ? 'border-red-400 focus-visible:ring-red-300' : ''}
                />
                {errors.lastName && <p className="text-xs text-red-500">{errors.lastName}</p>}
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                autoComplete="email"
                onChange={e => { setEmail(e.target.value); setErrors(v => ({ ...v, email: '' })) }}
                className={errors.email ? 'border-red-400 focus-visible:ring-red-300' : ''}
              />
              {errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
            </div>

            {/* Password */}
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Min 6 characters"
                  value={password}
                  autoComplete="new-password"
                  onChange={e => { setPassword(e.target.value); setErrors(v => ({ ...v, password: '' })) }}
                  className={errors.password ? 'border-red-400 focus-visible:ring-red-300 pr-10' : 'pr-10'}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {/* Strength bar */}
              {password.length > 0 && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[1,2,3,4,5].map(i => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                          i <= strength.score ? strength.color : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs font-medium ${
                    strength.score <= 1 ? 'text-red-500' :
                    strength.score <= 3 ? 'text-amber-500' : 'text-emerald-600'
                  }`}>
                    {strength.label} password
                  </p>
                </div>
              )}
              {errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
            </div>

            {/* Confirm password */}
            <div className="space-y-1">
              <Label htmlFor="confirm">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirm"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  onChange={e => { setConfirm(e.target.value); setErrors(v => ({ ...v, confirm: '' })) }}
                  className={errors.confirm ? 'border-red-400 focus-visible:ring-red-300 pr-10' : 'pr-10'}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowConfirm(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showConfirm ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {/* Live match indicator */}
              {confirmPassword.length > 0 && (
                <p className={`text-xs font-medium ${password === confirmPassword ? 'text-emerald-600' : 'text-red-500'}`}>
                  {password === confirmPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                </p>
              )}
              {errors.confirm && <p className="text-xs text-red-500">{errors.confirm}</p>}
            </div>

            {/* Server error */}
            {serverError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">
                {serverError}
                {serverError.includes('already exists') && (
                  <span> <Link href="/login" className="underline font-medium">Sign in instead?</Link></span>
                )}
              </div>
            )}

            <Button
              type="submit"
              className="w-full mt-1"
              disabled={loading || (confirmPassword.length > 0 && password !== confirmPassword)}
            >
              {loading ? 'Creating account…' : 'Create Account'}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center text-sm text-muted-foreground pt-0">
          Already have an account?{' '}
          <Link href="/login" className="ml-1 text-primary hover:underline font-medium">
            Sign in
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}
