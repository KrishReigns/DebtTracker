import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

// Vercel Cron calls this endpoint daily with Authorization: Bearer <CRON_SECRET>
export async function GET(request: NextRequest) {
  // ── Auth guard ────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const resendKey    = process.env.RESEND_API_KEY!
  const fromEmail    = process.env.RESEND_FROM_EMAIL ?? 'reminders@mydebttracker.net'
  const appUrl       = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mydebttracker.net'

  if (!serviceKey || !resendKey) {
    return NextResponse.json({ error: 'Missing env vars' }, { status: 500 })
  }

  // Admin Supabase client (bypasses RLS)
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const resend = new Resend(resendKey)

  // ── Query: find pending payments due exactly `reminder_days_before` days from today ──
  // Join: user_settings → loans → payment_schedules → auth.users
  const { data: reminders, error: queryErr } = await admin
    .rpc('get_due_reminders')

  if (queryErr) {
    console.error('Reminder query failed:', queryErr)
    return NextResponse.json({ error: queryErr.message }, { status: 500 })
  }

  if (!reminders || reminders.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No reminders due today' })
  }

  // Group by user email
  type ReminderRow = {
    user_email: string
    display_name: string
    lender_name: string
    loan_type: string
    currency: string
    due_date: string
    amount_due: number
  }

  const grouped = (reminders as ReminderRow[]).reduce<Record<string, { name: string; payments: ReminderRow[] }>>(
    (acc, row) => {
      if (!acc[row.user_email]) acc[row.user_email] = { name: row.display_name, payments: [] }
      acc[row.user_email].payments.push(row)
      return acc
    }, {}
  )

  let sent = 0
  const errors: string[] = []

  for (const [email, { name, payments }] of Object.entries(grouped)) {
    const paymentRows = payments.map(p => {
      const amount = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: p.currency,
        maximumFractionDigits: 0,
      }).format(p.amount_due)
      const due = new Date(p.due_date).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">${p.lender_name}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;">${p.loan_type.replace('_', ' ')}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;">${amount}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#ef4444;">${due}</td>
        </tr>`
    }).join('')

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 32px 24px;">
      <div style="font-size:28px;margin-bottom:8px;">💰</div>
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">EMI Reminder</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Upcoming payment${payments.length > 1 ? 's' : ''} due soon</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;color:#334155;font-size:15px;">Hi ${name}, here ${payments.length > 1 ? 'are your upcoming EMIs' : 'is your upcoming EMI'}:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Lender</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Type</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Amount</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Due Date</th>
          </tr>
        </thead>
        <tbody>${paymentRows}</tbody>
      </table>
      <div style="margin-top:28px;text-align:center;">
        <a href="${appUrl}/payments" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;font-size:14px;">View Payments →</a>
      </div>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #f1f5f9;text-align:center;">
      <p style="margin:0;color:#94a3b8;font-size:12px;">
        You're receiving this because you enabled EMI reminders in DebtTracker.<br>
        <a href="${appUrl}/profile" style="color:#6366f1;text-decoration:none;">Manage reminder settings</a>
      </p>
    </div>
  </div>
</body>
</html>`

    const { error: sendErr } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `💰 EMI Reminder: ${payments.length} payment${payments.length > 1 ? 's' : ''} due soon`,
      html,
    })

    if (sendErr) {
      errors.push(`${email}: ${sendErr.message}`)
    } else {
      sent++
    }
  }

  return NextResponse.json({ sent, errors: errors.length ? errors : undefined })
}
