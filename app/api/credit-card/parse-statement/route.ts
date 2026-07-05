import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { DocumentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { createClient } from '@/lib/supabase-server'

export interface ParsedStatementTransaction {
  date: string        // YYYY-MM-DD
  description: string
  amount: number      // positive = payment/credit to card, negative = charge
  type: 'payment' | 'charge' | 'credit' | 'fee' | 'interest'
}

export interface ParsedStatement {
  bank: string
  statementDate: string | null   // YYYY-MM-DD closing date
  dueDate: string | null         // YYYY-MM-DD payment due date
  newBalance: number | null      // total amount owed
  minimumDue: number | null
  currency: string               // USD or INR
  transactions: ParsedStatementTransaction[]
}

export async function POST(req: NextRequest) {
  try {
    // Auth gate — extraction burns paid API credits, signed-in users only
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('pdf') as File | null

    if (file && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Please upload a PDF file.' }, { status: 400 })
    }

    if (file && file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'PDF must be under 10 MB.' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 500 })
    }

    const client = new Anthropic({ apiKey })

    const PROMPT = `You are a credit card statement parser. Extract structured data from this statement and return ONLY valid JSON — no markdown, no explanation, no code fences.

Return this exact shape:
{
  "bank": "<bank or card name>",
  "statementDate": "<YYYY-MM-DD or null>",
  "dueDate": "<YYYY-MM-DD or null>",
  "newBalance": <number or null>,
  "minimumDue": <number or null>,
  "currency": "<USD or INR or other ISO code>",
  "transactions": [
    {
      "date": "<YYYY-MM-DD>",
      "description": "<merchant or description>",
      "amount": <number — POSITIVE for payments/credits to card, NEGATIVE for charges/purchases>,
      "type": "<payment|charge|credit|fee|interest>"
    }
  ]
}

Rules:
- All amounts must be plain numbers (no currency symbols, no commas)
- Payments made TO the card are POSITIVE (they reduce debt)
- Purchases/charges are NEGATIVE (they increase debt)
- If a field cannot be determined, use null
- Include ALL transactions found in the statement
- For US cards amounts are in USD, for Indian cards in INR — infer from context`

    // Two modes: pre-extracted text (password-protected PDFs) OR raw PDF
    const extractedText = formData.get('text') as string | null

    let messageContent: Parameters<typeof client.messages.create>[0]['messages'][0]['content']

    if (extractedText) {
      // Text was extracted client-side (password-protected PDF)
      const textBlock: TextBlockParam = {
        type: 'text',
        text: `${PROMPT}\n\nStatement text:\n${extractedText.slice(0, 15000)}`,
      }
      messageContent = [textBlock]
    } else {
      // Raw PDF — Claude reads it natively (better accuracy for non-protected PDFs)
      if (!file) {
        return NextResponse.json({ error: 'No PDF or text provided.' }, { status: 400 })
      }
      const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
      const docBlock: DocumentBlockParam = {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 },
      }
      const textBlock: TextBlockParam = { type: 'text', text: PROMPT }
      messageContent = [docBlock, textBlock]
    }

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 8192, // busy statements have 40+ transactions; 2048 truncated the JSON mid-array
      messages: [{ role: 'user', content: messageContent }],
    })

    const first = message.content[0]
    if (!first || first.type !== 'text') {
      return NextResponse.json({ error: 'Could not read this statement — try a clearer PDF.' }, { status: 422 })
    }
    const raw = first.text.trim()
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed: ParsedStatement = JSON.parse(jsonStr)

    // Model output is untrusted — normalize before the client writes it to the DB
    parsed.bank = typeof parsed.bank === 'string' && parsed.bank.trim() ? parsed.bank.trim().slice(0, 80) : 'Unknown Card'
    parsed.currency = parsed.currency === 'INR' ? 'INR' : 'USD'
    parsed.transactions = Array.isArray(parsed.transactions) ? parsed.transactions : []
    parsed.newBalance = typeof parsed.newBalance === 'number' && isFinite(parsed.newBalance) ? parsed.newBalance : null
    parsed.minimumDue = typeof parsed.minimumDue === 'number' && isFinite(parsed.minimumDue) ? parsed.minimumDue : null
    const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
    parsed.statementDate = isDate(parsed.statementDate) ? parsed.statementDate : null
    parsed.dueDate = isDate(parsed.dueDate) ? parsed.dueDate : null

    return NextResponse.json({ statement: parsed })
  } catch (err) {
    console.error('parse-statement error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Failed to parse statement: ${msg}` }, { status: 500 })
  }
}
