import { NextResponse } from "next/server"
import { resolveAuthFromRequest } from "@/lib/auth-resolve"

export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await resolveAuthFromRequest()
  if (!auth) return NextResponse.json({ authenticated: false, available: true })
  return NextResponse.json({
    authenticated: true,
    available: true,
    user: {
      userId: auth.userId,
      tenantId: auth.tenantId,
      username: auth.username,
      displayName: auth.displayName,
      role: auth.role,
    },
  })
}
