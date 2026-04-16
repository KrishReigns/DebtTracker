import Stripe from 'stripe'

// Singleton Stripe server client — only instantiated when key is present
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' })
  : null as unknown as Stripe

export const STRIPE_PRO_MONTHLY_PRICE_ID = process.env.STRIPE_PRO_MONTHLY_PRICE_ID!
export const STRIPE_PRO_ANNUAL_PRICE_ID  = process.env.STRIPE_PRO_ANNUAL_PRICE_ID!
export const STRIPE_WEBHOOK_SECRET       = process.env.STRIPE_WEBHOOK_SECRET!

/** Free-tier hard limits */
export const FREE_LOAN_LIMIT = 3
