import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { stripe, STRIPE_PRO_MONTHLY_PRICE_ID, STRIPE_PRO_ANNUAL_PRICE_ID } from '@/lib/stripe'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await request.json() as { plan: 'monthly' | 'annual' }
  const priceId = plan === 'annual' ? STRIPE_PRO_ANNUAL_PRICE_ID : STRIPE_PRO_MONTHLY_PRICE_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mydebttracker.net'

  // Fetch or create Stripe customer
  const { data: settings } = await supabase
    .from('user_settings')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  let customerId = settings?.stripe_customer_id as string | undefined

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    // Persist customer ID (upsert in case row doesn't exist yet)
    await supabase.from('user_settings').upsert({
      user_id: user.id,
      stripe_customer_id: customerId,
    }, { onConflict: 'user_id' })
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/upgrade?success=1`,
    cancel_url: `${appUrl}/upgrade?canceled=1`,
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { supabase_user_id: user.id },
    },
  })

  return NextResponse.json({ url: session.url })
}
