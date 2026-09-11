/**
 * HomeSense tenant configuration page.
 *
 * Replaces the upstream single-node config panel with a per-tenant view:
 *   - runtime parameters (tokens / iterations / summarize / temperature)
 *   - high-risk tool toggles (default off; tenants opt in per their own copy)
 *   - MCP servers (the tenant's own devices / executor endpoints)
 *   - raw config.json editor for advanced tenants
 */
import { IconDeviceFloppy } from "@tabler/icons-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  getUserConfig,
  getCurrentUserId,
  saveUserConfigFor,
  type TenantConfig,
} from "@/api/user-config"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

interface MCPServerDraft {
  name: string
  enabled: boolean
  type: string
  url: string
  command: string
  args: string
  token: string
}

const HIGH_RISK_TOOLS: { name: string; hint: string }[] = [
  { name: "exec", hint: "在主机上执行命令" },
  { name: "cron", hint: "定时任务" },
  { name: "spawn", hint: "派生子代理" },
  { name: "spawn_status", hint: "子代理状态" },
  { name: "subagent", hint: "子代理工具" },
  { name: "send_file", hint: "向外发送文件" },
  { name: "message", hint: "向频道发送消息" },
  { name: "reaction", hint: "对消息作出反应" },
  { name: "load_image", hint: "加载本地图片" },
  { name: "send_tts", hint: "文本转语音" },
  { name: "skills", hint: "技能注册表" },
  { name: "find_skills", hint: "搜索技能" },
  { name: "install_skill", hint: "安装技能" },
  { name: "i2c", hint: "I2C 硬件" },
  { name: "spi", hint: "SPI 硬件" },
  { name: "serial", hint: "串口" },
]

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

function toolEnabled(cfg: TenantConfig, tool: string): boolean {
  const tools = asObj(cfg.tools)
  const t = asObj(tools[tool])
  if (typeof t.enabled === "boolean") return t.enabled
  // Absent in the tenant file = inherits the platform default. Report the
  // conservative value (off) for high-risk tools; treat the presence of an
  // explicit true as on.
  return t.enabled === true
}

function setToolEnabled(cfg: TenantConfig, tool: string, enabled: boolean) {
  const tools = asObj(cfg.tools)
  const t = asObj(tools[tool])
  t.enabled = enabled
  tools[tool] = t
  cfg.tools = tools
}

function serversToDrafts(cfg: TenantConfig): MCPServerDraft[] {
  const tools = asObj(cfg.tools)
  const mcp = asObj(tools.mcp)
  const servers = asObj(mcp.servers)
  return Object.entries(servers).map(([name, raw]) => {
    const s = asObj(raw)
    const header =
      (asObj(s.headers)["Authorization"] as string) ||
      (asObj(s.headers)["authorization"] as string) ||
      ""
    const token = header.replace(/^(?:Bearer\s+)+/i, "")
    return {
      name,
      enabled: s.enabled !== false,
      type: (s.type as string) || "",
      url: (s.url as string) || "",
      command: (s.command as string) || "",
      args: Array.isArray(s.args) ? (s.args as string[]).join(" ") : "",
      token,
    }
  })
}

function draftsToConfig(cfg: TenantConfig, drafts: MCPServerDraft[]) {
  const servers: Record<string, unknown> = {}
  for (const d of drafts) {
    if (!d.name.trim()) continue
    const entry: Record<string, unknown> = { enabled: d.enabled }
    if (d.type) entry.type = d.type
    if (d.url) entry.url = d.url
    if (d.command) entry.command = d.command
    const args = d.args
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (args.length > 0) entry.args = args
    const headers: Record<string, string> = {}
    if (d.token.trim()) {
      headers["Authorization"] = `Bearer ${d.token.replace(/^(?:Bearer\s+)+/i, "")}`
    }
    if (Object.keys(headers).length > 0) entry.headers = headers
    servers[d.name.trim()] = entry
  }
  const tools = asObj(cfg.tools)
  const mcp = asObj(tools.mcp)
  mcp.servers = servers
  if (Object.keys(servers).length > 0) {
    mcp.enabled = true
  }
  tools.mcp = mcp
  cfg.tools = tools
}

export function V7ConfigPage() {
  const { t } = useTranslation()
  const [cfg, setCfg] = useState<TenantConfig | null>(null)
  const [userId, setUserId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [drafts, setDrafts] = useState<MCPServerDraft[]>([])

  useMemo(() => {
    let alive = true
    ;(async () => {
      try {
        const uid = await getCurrentUserId()
        const loaded = await getUserConfig()
        if (!alive) return
        setUserId(uid)
        setCfg(loaded)
        setDrafts(serversToDrafts(loaded))
      } catch (e) {
        if (alive) setError(String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="配置" />
      </div>
    )
  }
  if (error || !cfg) {
    return (
      <div className="p-6">
        <PageHeader title={error || "配置不可用"} />
      </div>
    )
  }
  // Non-null alias: closures don't inherit the guard's narrowing.
  const cur = cfg

  const save = async () => {
    setSaving(true)
    try {
      const next = structuredClone(cur)
      draftsToConfig(next, drafts)
      await saveUserConfigFor(userId, next)
      setCfg(next)
      toast.success(t("pages.config.saved"))
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={t("navigation.config")} />

      <Card>
        <CardHeader>
          <CardTitle>工具</CardTitle>
          <CardDescription>
            高危工具默认关闭。仅为本租户开启。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {HIGH_RISK_TOOLS.map((tool) => (
            <div
              key={tool.name}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div>
                <div className="text-sm font-medium">{tool.name}</div>
                <div className="text-xs text-muted-foreground">{tool.hint}</div>
              </div>
              <Switch
                checked={toolEnabled(cur, tool.name)}
                onCheckedChange={(on) => {
                  setCfg((c) => {
                    const next = structuredClone(c ?? cur)
                    setToolEnabled(next, tool.name, on)
                    return next
                  })
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>MCP 服务器</CardTitle>
          <CardDescription>
            你自己的设备（如手机执行器），云端 agent 作为 MCP 客户端接入。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {drafts.map((d, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <Input
                placeholder="名称（如 phone）"
                value={d.name}
                onChange={(e) =>
                  setDrafts((ds) =>
                    ds.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
              />
              <Input
                placeholder="类型（sse|http|stdio）"
                value={d.type}
                onChange={(e) =>
                  setDrafts((ds) =>
                    ds.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)),
                  )
                }
              />
              <Input
                placeholder="地址（http://phone:51122/executor）"
                value={d.url}
                onChange={(e) =>
                  setDrafts((ds) =>
                    ds.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                  )
                }
              />
              <Input
                placeholder="访问令牌（可选）"
                value={d.token}
                onChange={(e) =>
                  setDrafts((ds) =>
                    ds.map((x, j) => (j === i ? { ...x, token: e.target.value } : x)),
                  )
                }
              />
              <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
                <Label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={d.enabled}
                    onCheckedChange={(on) =>
                      setDrafts((ds) =>
                        ds.map((x, j) => (j === i ? { ...x, enabled: on } : x)),
                      )
                    }
                  />
                  启用
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
                >
                  移除
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDrafts((ds) => [
                ...ds,
                { name: "", enabled: true, type: "sse", url: "", command: "", args: "", token: "" },
              ])
            }
          >
            + 添加服务器
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>原始 config.json</CardTitle>
          <CardDescription>
            完整租户配置（高级）。未填写的字段沿用平台默认值。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={12}
            className="font-mono text-xs"
            value={JSON.stringify(cur, null, 2)}
            onChange={(e) => {
              try {
                setCfg(JSON.parse(e.target.value))
              } catch {
                /* keep last valid while typing */
              }
            }}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          <IconDeviceFloppy className="size-4" />
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  )
}

