import { createClient } from '@/lib/supabase-server'

export type SubscriptionTier = 'free' | 'pro'

export interface UserSubscription {
  tier: SubscriptionTier
  status: string | null
  periodEnd: string | null
  stripeCustomerId: string | null
}

/**
 * Returns the current user's subscription tier from user_settings.
 * Falls back to 'free' if no row exists yet.
 * Must be called from a Server Component or Server Action (uses server Supabase client).
 */
export async function getUserSubscription(): Promise<UserSubscription> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('user_settings')
    .select('subscription_tier, subscription_status, subscription_period_end, stripe_customer_id')
    .single()

  return {
    tier: (data?.subscription_tier ?? 'free') as SubscriptionTier,
    status: data?.subscription_status ?? null,
    periodEnd: data?.subscription_period_end ?? null,
    stripeCustomerId: data?.stripe_customer_id ?? null,
  }
}

export function isPro(sub: UserSubscription): boolean {
  if (sub.tier !== 'pro') return false
  // If subscription has lapsed (past_due or canceled and period ended), treat as free
  if (sub.status === 'canceled' && sub.periodEnd) {
    return new Date(sub.periodEnd) > new Date()
  }
  return sub.status === 'active' || sub.status === 'trialing'
}
