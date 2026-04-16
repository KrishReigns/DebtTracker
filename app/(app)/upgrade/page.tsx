import { Suspense } from 'react'
import { getUserSubscription, isPro } from '@/lib/subscription'
import UpgradeClient from '@/components/UpgradeClient'

export default async function UpgradePage() {
  const sub = await getUserSubscription()
  const proActive = isPro(sub)

  return (
    <Suspense fallback={<div className="h-32 animate-pulse bg-gray-100 rounded-xl" />}>
      <UpgradeClient
        tier={sub.tier}
        isPro={proActive}
        status={sub.status}
        periodEnd={sub.periodEnd}
        hasCustomer={!!sub.stripeCustomerId}
      />
    </Suspense>
  )
}
