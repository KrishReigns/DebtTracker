import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { stripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe'
import Stripe from 'stripe'

// Stripe requires the raw body for signature verification — disable body parsing
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig  = request.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature verification failed', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Admin client (bypasses RLS)
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  async function updateSubscription(subscription: Stripe.Subscription) {
    const userId = subscription.metadata?.supabase_user_id
    if (!userId) {
      // Fallback: look up by customer ID
      const customer = subscription.customer as string
      const { data } = await admin
        .from('user_settings')
        .select('user_id')
        .eq('stripe_customer_id', customer)
        .single()
      if (!data) return
    }

    const customerId = subscription.customer as string
    const tier: 'free' | 'pro' =
      subscription.status === 'active' || subscription.status === 'trialing'
        ? 'pro'
        : 'free'

    // Look up user by customer ID if no metadata
    const targetUserId = userId ?? (await admin
      .from('user_settings')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .single()
      .then(r => r.data?.user_id))

    if (!targetUserId) return

    // In Stripe API v2026+, current_period_end lives on the subscription item
    const periodEnd = subscription.items?.data?.[0]?.current_period_end
    await admin.from('user_settings').upsert({
      user_id: targetUserId,
      stripe_customer_id: customerId,
      subscription_tier: tier,
      subscription_status: subscription.status,
      subscription_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    }, { onConflict: 'user_id' })
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await updateSubscription(event.data.object as Stripe.Subscription)
      break

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string
      const periodEnd = sub.items?.data?.[0]?.current_period_end
      await admin
        .from('user_settings')
        .update({
          subscription_tier: 'free',
          subscription_status: 'canceled',
          subscription_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        })
        .eq('stripe_customer_id', customerId)
      break
    }
  }

  return NextResponse.json({ received: true })
}
