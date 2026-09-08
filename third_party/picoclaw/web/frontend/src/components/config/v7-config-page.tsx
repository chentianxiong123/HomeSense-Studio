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
  { name: "exec", hint: "Shell command execution on the host" },
  { name: "cron", hint: "Scheduled commands" },
  { name: "spawn", hint: "Spawn sub-agents" },
  { name: "spawn_status", hint: "Sub-agent status" },
  { name: "subagent", hint: "Sub-agent tool" },
  { name: "send_file", hint: "Send files out" },
  { name: "message", hint: "Send messages to channels" },
  { name: "reaction", hint: "React to messages" },
  { name: "load_image", hint: "Load local images" },
  { name: "send_tts", hint: "Text-to-speech" },
  { name: "skills", hint: "Skill registries" },
  { name: "find_skills", hint: "Search skills" },
  { name: "install_skill", hint: "Install skills" },
  { name: "i2c", hint: "I2C hardware" },
  { name: "spi", hint: "SPI hardware" },
  { name: "serial", hint: "Serial ports" },
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

function agentDefault(
  cfg: TenantConfig,
  key: string,
  fallback = "",
): string {
  const agents = asObj(cfg.agents)
  const defs = asObj(agents.defaults)
  const v = defs[key]
  return v === undefined || v === null ? fallback : String(v)
}

function setAgentDefault(
  cfg: TenantConfig,
  key: string,
  value: string,
) {
  const agents = asObj(cfg.agents)
  const defs = asObj(agents.defaults)
  if (value.trim() === "") {
    delete defs[key]
  } else {
    defs[key] = maybeNumber(value)
  }
  agents.defaults = defs
  cfg.agents = agents
}

function maybeNumber(v: string): string | number {
  const t = v.trim()
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t)
  return v
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
        <PageHeader title="Configuration" />
      </div>
    )
  }
  if (error || !cfg) {
    return (
      <div className="p-6">
        <PageHeader title={error || "unavailable"} />
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
          <CardTitle>Runtime parameters</CardTitle>
          <CardDescription>
            Applied to this tenant's agent on the next message.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            label="Max tokens"
            value={agentDefault(cur, "max_tokens")}
            onChange={(v) => setCfg((c) => patchAgent(c ?? cur, "max_tokens", v))}
          />
          <NumberField
            label="Context window"
            value={agentDefault(cur, "context_window")}
            onChange={(v) => setCfg((c) => patchAgent(c ?? cur, "context_window", v))}
          />
          <NumberField
            label="Max tool iterations"
            value={agentDefault(cur, "max_tool_iterations")}
            onChange={(v) => setCfg((c) => patchAgent(c ?? cur, "max_tool_iterations", v))}
          />
          <NumberField
            label="Summarize threshold"
            value={agentDefault(cur, "summarize_message_threshold")}
            onChange={(v) => setCfg((c) => patchAgent(c ?? cur, "summarize_message_threshold", v))}
          />
          <NumberField
            label="Summarize token %"
            value={agentDefault(cur, "summarize_token_percent")}
            onChange={(v) => setCfg((c) => patchAgent(c ?? cur, "summarize_token_percent", v))}
          />
          <NumberField
            label="Temperature"
            value={agentDefault(cur, "temperature")}
            onChange={(v) => setCfg((c) => patchAgent(c ?? cur, "temperature", v))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tools</CardTitle>
          <CardDescription>
            High-risk tools default to off. Toggle to enable for this tenant
            only.
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
          <CardTitle>MCP servers</CardTitle>
          <CardDescription>
            Your own devices (e.g. phone executor) that the cloud agent
            connects to as an MCP client.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {drafts.map((d, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <Input
                placeholder="name (e.g. phone)"
                value={d.name}
                onChange={(e) =>
                  setDrafts((ds) =>
                    ds.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
              />
              <Input
                placeholder="type (sse|http|stdio)"
                value={d.type}
                onChange={(e) =>
                  setDrafts((ds) =>
                    ds.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)),
                  )
                }
              />
              <Input
                placeholder="url (http://phone:51122/executor)"
                value={d.url}
                onChange={(e) =>
                  setDrafts((ds) =>
                    ds.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                  )
                }
              />
              <Input
                placeholder="Bearer token (optional)"
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
                  Enabled
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
                >
                  Remove
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
            + Add server
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Raw config.json</CardTitle>
          <CardDescription>
            Full tenant configuration (advanced). Fields not written inherit
            the platform defaults.
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
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}

function patchAgent(
  cfg: TenantConfig,
  key: string,
  value: string,
): TenantConfig {
  const next = structuredClone(cfg)
  setAgentDefault(next, key, value)
  return next
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}