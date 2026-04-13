import { createClient } from '@/lib/supabase-server'
import ProfileClient from '@/components/ProfileClient'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const meta = user?.user_metadata ?? {}
  const displayName =
    meta.full_name || meta.name ||
    (meta.first_name ? `${meta.first_name} ${meta.last_name ?? ''}`.trim() : '') ||
    user?.email?.split('@')[0] || 'User'

  const isGoogleUser = user?.app_metadata?.provider === 'google' ||
    (user?.identities ?? []).some((id: { provider: string }) => id.provider === 'google')

  const avatarUrl: string | null = meta.avatar_url ?? null

  return (
    <ProfileClient
      userId={user?.id ?? ''}
      email={user?.email ?? ''}
      displayName={displayName}
      firstName={meta.first_name ?? ''}
      lastName={meta.last_name ?? ''}
      isGoogleUser={isGoogleUser}
      avatarUrl={avatarUrl}
    />
  )
}
