import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { stripe } from '@/lib/stripe'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: settings } = await supabase
    .from('user_settings')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  const customerId = settings?.stripe_customer_id as string | undefined
  if (!customerId) {
    return NextResponse.json({ error: 'No Stripe customer found' }, { status: 404 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mydebttracker.net'
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/upgrade`,
  })

  return NextResponse.json({ url: session.url })
}
