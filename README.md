# DebtTracker

Personal loan and EMI tracker — live at **[mydebttracker.net](https://mydebttracker.net)**

A PWA-first web app for tracking every loan you owe: bank EMIs, credit cards, family debts. Automatically generates repayment schedules, surfaces overdue payments, and exports everything to CSV / XLSX / PDF.

---

## Features

- **All loan types** — Personal, Home, Car, Student, Gold, Credit Card, Family / informal
- **Amortization engine** — Reducing balance, flat rate, simple interest, revolving (credit card), bullet
- **Smart schedules** — Auto-generates full payment schedule on loan creation; regenerates from last paid row on edits
- **Dashboard** — KPI cards (outstanding debt, overdue count, next EMI), donut chart, 12-month repayment bar chart, debt-free date
- **Flexible / manual loans** — Family loans accrue daily simple interest; record ad-hoc payments anytime
- **Payments page** — Tabbed view (overdue / upcoming / all), one-tap mark-paid via record modal
- **Import** — Upload any CSV or Excel file; fuzzy column mapper auto-detects your headers
- **Export** — Per-loan CSV, XLSX (schedule + transactions), PDF (coloured status rows)
- **PWA** — Installable on iOS and Android; offline fallback page; service worker caches static assets
- **Email reminders** — Daily cron sends EMI reminders N days before due date (configurable per user)
- **Auth** — Email + password or Google OAuth via Supabase; avatar upload to Supabase Storage

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| UI Components | shadcn/ui |
| Database + Auth | Supabase (PostgreSQL + GoTrue + Storage) |
| Hosting | Vercel |
| Email | Resend |
| Charts | Recharts |
| Exports | jsPDF · jspdf-autotable · xlsx |

---

## Local Development

### 1. Clone and install

```bash
git clone https://github.com/KrishReigns/DebtTracker.git
cd DebtTracker
npm install
```

### 2. Environment variables

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

RESEND_API_KEY=re_your-resend-key
RESEND_FROM_EMAIL=reminders@yourdomain.com

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployment

Hosted on **Vercel** with automatic deploys from the `main` branch.

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Build command | `next build` |
| Production domain | `mydebttracker.net` |

A Vercel Cron job runs daily at 07:00 UTC (`/api/cron/reminders`) to send EMI reminder emails.

Set the same environment variables listed above in Vercel → Project → Settings → Environment Variables.

---

## Project Structure

```
app/
  (app)/          # Authenticated routes (dashboard, loans, payments, profile, import)
  (marketing)/    # Public landing page
  api/            # API routes (account delete, Stripe hooks, cron reminders)
  auth/           # Supabase auth callback
components/
  loans/          # LoanForm, LoanCard, LoanDetailClient, ExportToolbar, …
  payments/       # PaymentsClient, RecordPaymentModal
  DashboardClient.tsx
  ProfileClient.tsx
  Sidebar.tsx
lib/
  calculations.ts # EMI, amortization, family loan state
  export.ts       # CSV / XLSX / PDF export engine
  types.ts        # Shared TypeScript types
  utils.ts        # Formatters, colour maps
public/
  sw.js           # Service worker (cache-first static, network-first pages)
  manifest.json   # PWA manifest
__tests__/        # Vitest unit tests
```

---

## Running Tests

```bash
npm test
```

Tests cover the amortization engine (`calculations.test.ts`) and payment allocation logic (`loan-actions.test.ts`).
