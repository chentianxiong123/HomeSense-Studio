import { NextResponse } from "next/server"
import { getIndexDb, listTenants } from "@/lib/tenant-store"
import { resolveAuthFromRequest } from "@/lib/auth-resolve"

export const dynamic = "force-dynamic"

export async function GET() {
  const tenants = listTenants()
  let hasAnyUser = false
  try {
    const row = getIndexDb()
      .prepare("SELECT 1 AS one FROM tenant_users LIMIT 1")
      .get() as { one: number } | undefined
    hasAnyUser = Boolean(row)
  } catch {
    /* index db not ready */
  }
  const auth = await resolveAuthFromRequest()
  return NextResponse.json({
    available: true,
    initialized: hasAnyUser,
    authenticated: Boolean(auth),
    tenantCount: tenants.length,
  })
}
