import LoanForm from '@/components/loans/LoanForm'

export default function NewLoanPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Add New Loan</h1>
        <p className="text-sm text-gray-500 mt-1">
          Fill in the details — the EMI and full payment schedule will be generated automatically.
        </p>
      </div>
      <LoanForm />
    </div>
  )
}
