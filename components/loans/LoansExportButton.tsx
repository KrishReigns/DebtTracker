'use client'

import { useState } from 'react'
import { exportLoansCSV, exportLoansXLSX, exportLoansPDF } from '@/lib/export-client'
import type { LoansExportRow } from '@/lib/export'

export default function LoansExportButton({ data }: { data: LoansExportRow[] }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)

  async function run(key: string, fn: () => Promise<void> | void) {
    setLoading(key); setOpen(false)
    try { await fn() } finally { setLoading(null) }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={!!loading || data.length === 0}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
      >
        {loading ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        )}
        Export
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-36 text-sm">
            {[
              { key: 'csv',  label: '📄 CSV',   fn: () => exportLoansCSV(data) },
              { key: 'xlsx', label: '📊 Excel',  fn: () => exportLoansXLSX(data) },
              { key: 'pdf',  label: '📑 PDF',    fn: () => exportLoansPDF(data) },
            ].map(({ key, label, fn }) => (
              <button
                key={key}
                onClick={() => run(key, fn)}
                className="w-full text-left px-4 py-2 hover:bg-slate-50 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
