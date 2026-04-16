'use client'

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <div className="text-6xl">📡</div>
        <h1 className="text-2xl font-bold text-gray-900">You&apos;re offline</h1>
        <p className="text-gray-500 max-w-xs">
          No internet connection. Your loan data is safe — reconnect to sync the latest updates.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl transition-all"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
