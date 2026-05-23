import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

// pdf-parse must be required (not imported) to avoid Next.js edge-runtime issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js')

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
    const formData = await req.formData()
    const file = formData.get('pdf') as File | null

    if (!file || file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Please upload a PDF file.' }, { status: 400 })
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'PDF must be under 10 MB.' }, { status: 400 })
    }

    // Extract raw text from PDF
    const buffer = Buffer.from(await file.arrayBuffer())
    const { text } = await pdfParse(buffer)

    if (!text || text.trim().length < 50) {
      return NextResponse.json(
        { error: 'Could not extract text from this PDF. It may be scanned/image-based.' },
        { status: 422 }
      )
    }

    // Truncate to avoid huge token bills (first 12k chars covers most statements)
    const excerpt = text.slice(0, 12000)

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 500 })
    }

    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are a credit card statement parser. Extract structured data from this statement text and return ONLY valid JSON — no markdown, no explanation, no code fences.

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
- For US cards amounts are in USD, for Indian cards in INR — infer from context

Statement text:
${excerpt}`,
        },
      ],
    })

    const raw = (message.content[0] as { type: string; text: string }).text.trim()

    // Strip any accidental markdown fences
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed: ParsedStatement = JSON.parse(jsonStr)

    return NextResponse.json({ statement: parsed })
  } catch (err) {
    console.error('parse-statement error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Failed to parse statement: ${msg}` }, { status: 500 })
  }
}
