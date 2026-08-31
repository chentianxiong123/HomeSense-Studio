import { NextResponse } from "next/server"
import { resolveAuthFromRequest } from "@/lib/auth-resolve"
import { getTenant } from "@/lib/tenant-store"

export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await resolveAuthFromRequest()
  if (!auth) return NextResponse.json({ authenticated: false, available: true })
  const tenant = getTenant(auth.tenantId)
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
    activeSessionId: tenant?.activeSessionId ?? null,
  })
}
