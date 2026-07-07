import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import Sidebar from '@/components/Sidebar'
import { todayISO } from '@/lib/utils'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const meta = user.user_metadata ?? {}
  // Google OAuth sends 'name' or 'full_name'; email signup sends 'first_name'+'last_name'
  const displayName =
    meta.full_name ||
    meta.name ||
    (meta.first_name ? `${meta.first_name} ${meta.last_name ?? ''}`.trim() : '') ||
    user.email?.split('@')[0] ||
    'User'

  const avatarUrl: string | null = meta.avatar_url ?? null

  // Count overdue payments for badge — active loans only, and include
  // half-paid (partial) rows past their due date, matching the Payments page
  const today = todayISO()
  const { count: overdueCount } = await supabase
    .from('payment_schedules')
    .select('id, loans!inner(status)', { count: 'exact', head: true })
    .eq('loans.status', 'active')
    .in('status', ['pending', 'partial'])
    .lt('contractual_due_date', today)

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        displayName={displayName}
        userEmail={user.email ?? ''}
        avatarUrl={avatarUrl}
        overdueCount={overdueCount ?? 0}
      />
      {/* min-w-0 lets this flex child shrink below its content width — without it a
          single wide descendant (a chart, a long number) blows past the viewport and
          mobile browsers shrink-to-fit the whole page ("zoomed" look). overflow-x-hidden
          is the safety net; wide tables scroll inside their own wrappers. */}
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        {/* Spacer for mobile top bar */}
        <div className="h-14 md:hidden" />
        <div className="max-w-6xl mx-auto p-4 md:p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
