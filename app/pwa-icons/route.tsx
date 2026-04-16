import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const dynamic = 'force-static'

function IconSVG({ size }: { size: number }) {
  const radius = Math.round(size * 0.2)
  const fontSize = Math.round(size * 0.55)
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
      }}
    >
      💰
    </div>
  )
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const size = Number(searchParams.get('size') ?? '192')
  const clampedSize = [192, 512].includes(size) ? size : 192

  return new ImageResponse(<IconSVG size={clampedSize} />, {
    width: clampedSize,
    height: clampedSize,
  })
}
