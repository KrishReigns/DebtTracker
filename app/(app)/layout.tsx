import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import Sidebar from '@/components/Sidebar'

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

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar displayName={displayName} userEmail={user.email ?? ''} avatarUrl={avatarUrl} />
      <main className="flex-1 overflow-y-auto">
        {/* Spacer for mobile top bar */}
        <div className="h-14 md:hidden" />
        <div className="max-w-6xl mx-auto p-4 md:p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
