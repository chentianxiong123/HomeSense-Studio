// HomeSense v5 — 租户云大脑按需冷启动。
//
// 每个租户一个独立 gateway 进程（tenant-brain.sh 管理，独立 workspace / db /
// token / port / PICOCLAW_HOME）。这里提供"按需拉起"逻辑：
//   - ensureTenantBrain(): 若租户还没分配 gateway → 挑端口/生成 token/建目录；
//     若进程没在跑 → 启动并等 /ready；返回 { port, token }。
// Go 网关侧配置了 idle_shutdown_minutes：无活跃连接一段时间后自动退出，
// 下次用户再来时由这里重新冷启动。这样"用户用的时候才启动"。

import { execFile } from "node:child_process"
import net from "node:net"
import crypto from "node:crypto"
import { getTenant, listTenants, setTenantGateway } from "@/lib/tenant-store"

const BRAIN_SCRIPT =
  process.env.HS_BRAIN_SCRIPT ??
  "/home/a1/HomeSense-Studio-v3/v5/scripts/tenant-brain.sh"
const DATA_DIR = process.env.HS_BRAIN_DATA ?? "/home/a1/HomeSense-Studio-v3/.hs-brain"
const PORT_RANGE_START = 18800
const PORT_RANGE_END = 18950
const READY_TIMEOUT_MS = 30_000
const READY_POLL_MS = 500

export interface EnsureBrainResult {
  gatewayPort: number
  gatewayToken: string
  gatewayDir: string
  coldStarted: boolean
}

function runScript(args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      BRAIN_SCRIPT,
      args,
      { timeout: timeoutMs, env: { ...process.env, HS_BRAIN_DATA: DATA_DIR } },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${BRAIN_SCRIPT} ${args.join(" ")}: ${stderr || err.message}`))
          return
        }
        resolve(stdout.trim())
      },
    )
  })
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once("error", () => resolve(false))
    srv.listen(port, "127.0.0.1", () => {
      srv.close(() => resolve(true))
    })
  })
}

async function pickPort(): Promise<number> {
  // 除了端口要空闲，还得避开 tenants 表里已分配(哪怕当前未运行)的 gateway_port，
  // 否则两个租户会拿到同一个端口，同时冷启动时冲突。
  const taken = new Set(
    listTenants()
      .map((t) => t.gatewayPort)
      .filter((p): p is number => p != null),
  )
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (taken.has(p)) continue
    if (await isPortFree(p)) return p
  }
  throw new Error("no free gateway port in range")
}

async function isReady(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ready`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function waitReady(port: number): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isReady(port)) return true
    await new Promise((r) => setTimeout(r, READY_POLL_MS))
  }
  return false
}

/** gateway 目录名：新租户一律 ten_<tenantId>；老数据兼容（已有端口则沿用）。 */
function gatewayDirFor(tenantId: string): string {
  if (tenantId.startsWith("ten_")) return tenantId
  return `ten_${tenantId}`
}

/**
 * 为新租户分配专属云大脑：挑端口、生成 token、tenant-brain.sh create 建目录、
 * 回填 tenants 表。只分配 **不启动** 进程（保持"用户用的时候才启动"的弹性）。
 * 已分配的租户直接返回现有映射。幂等。
 */
export async function provisionTenantBrain(tenantId: string): Promise<EnsureBrainResult> {
  const tenant = getTenant(tenantId)
  if (!tenant) throw new Error(`tenant not found: ${tenantId}`)

  if (tenant.gatewayPort != null && tenant.gatewayToken && tenant.gatewayDir) {
    return {
      gatewayPort: tenant.gatewayPort,
      gatewayToken: tenant.gatewayToken,
      gatewayDir: tenant.gatewayDir,
      coldStarted: false,
    }
  }

  const dir = gatewayDirFor(tenantId)
  const newPort = await pickPort()
  const newToken = crypto.randomBytes(16).toString("hex")
  await runScript(["create", dir, String(newPort), newToken])
  setTenantGateway(tenantId, {
    gatewayPort: newPort,
    gatewayToken: newToken,
    gatewayDir: dir,
  })
  return { gatewayPort: newPort, gatewayToken: newToken, gatewayDir: dir, coldStarted: false }
}

/**
 * 保证某租户的云大脑 gateway 可用：
 *  1. 无映射 → 分配端口 + 生成 token + tenant-brain.sh create
 *  2. 进程未运行 → tenant-brain.sh start + 等 /ready
 * 返回 { port, token, dir, coldStarted }。
 */
export async function ensureTenantBrain(tenantId: string): Promise<EnsureBrainResult> {
  const provisioned = await provisionTenantBrain(tenantId)
  const { gatewayPort, gatewayToken, gatewayDir } = provisioned

  if (await isReady(gatewayPort)) {
    return { ...provisioned, coldStarted: false }
  }

  await runScript(["start", gatewayDir])
  const ok = await waitReady(gatewayPort)
  if (!ok) throw new Error(`tenant brain ${gatewayDir} did not become ready on :${gatewayPort}`)
  return { gatewayPort, gatewayToken, gatewayDir, coldStarted: true }
}
