/**
 * HomeSense tenant configuration page.
 *
 * Replaces the upstream single-node config panel with a per-tenant view:
 *   - high-risk tool toggles (default off; tenants opt in per their own copy)
 *   - MCP servers (the tenant's own devices / executor endpoints)
 *   - memory settings (long-term memory, daily notes, history search)
 *   - raw config.json editor for advanced tenants
 */
import { IconDeviceFloppy } from "@tabler/icons-react"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  getMemoryConfig,
  saveMemoryConfig,
  type MemoryConfig,
  DEFAULT_MEMORY_CONFIG,
} from "@/api/memory-config"
import {
  listMemoryNotes,
  readMemoryFile,
  type DailyNote,
} from "@/api/memory-notes"
import {
  readAgentFile,
  writeAgentFile,
} from "@/api/agent-file"
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
import { ScrollArea } from "@/components/ui/scroll-area"
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
  const [memCfg, setMemCfg] = useState<MemoryConfig>(DEFAULT_MEMORY_CONFIG)
  const [userId, setUserId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [drafts, setDrafts] = useState<MCPServerDraft[]>([])
  const [notes, setNotes] = useState<DailyNote[]>([])
  const [memoryMd, setMemoryMd] = useState("")
  const [selectedNote, setSelectedNote] = useState<DailyNote | null>(null)
  const [notesLoading, setNotesLoading] = useState(false)
  const [agentMd, setAgentMd] = useState("")
  const [agentMdDirty, setAgentMdDirty] = useState(false)
  const [memoryProfile, setMemoryProfile] = useState("")
  const [profileLoading, setProfileLoading] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const uid = await getCurrentUserId()
        const [loaded, memLoaded] = await Promise.all([
          getUserConfig(),
          getMemoryConfig().catch(() => DEFAULT_MEMORY_CONFIG),
        ])
        if (!alive) return
        setUserId(uid)
        setCfg(loaded)
        setDrafts(serversToDrafts(loaded))
        setMemCfg(memLoaded)
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

  // Load memory notes, MEMORY.md, AGENT.md, and memory profile on mount.
  useEffect(() => {
    let alive = true
    ;(async () => {
      setNotesLoading(true)
      setProfileLoading(true)
      try {
        const [notesRes, memFile, agentFile, profileFile] = await Promise.all([
          listMemoryNotes().catch(() => ({ notes: [], total: 0 })),
          readMemoryFile("MEMORY.md").catch(() => ({ content: "" })),
          readAgentFile("AGENT.md").catch(() => ({ content: "", exists: false })),
          readMemoryFile("MEMORY_PROFILE.md").catch(() => ({ content: "" })),
        ])
        if (!alive) return
        setNotes(notesRes.notes || [])
        setMemoryMd(memFile.content || "")
        setAgentMd(agentFile.content || "")
        setMemoryProfile(profileFile.content || "")
      } finally {
        if (alive) {
          setNotesLoading(false)
          setProfileLoading(false)
        }
      }
    })()
    return () => { alive = false }
  }, [])

  const save = useCallback(async () => {
    if (!cfg) return
    setSaving(true)
    try {
      const next = structuredClone(cfg)
      draftsToConfig(next, drafts)
      await Promise.all([
        saveUserConfigFor(userId, next),
        saveMemoryConfig(memCfg),
        agentMdDirty ? writeAgentFile("AGENT.md", agentMd) : Promise.resolve(),
      ])
      setCfg(next)
      setAgentMdDirty(false)
      toast.success(t("pages.config.saved"))
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }, [cfg, userId, drafts, memCfg, agentMd, agentMdDirty, t])

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
  const cur = cfg

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={t("navigation.config")} />

      {/* ── Tools ── */}
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

      {/* ── MCP Servers ── */}
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

      {/* ── Memory ── */}
      <Card>
        <CardHeader>
          <CardTitle>记忆</CardTitle>
          <CardDescription>
            控制 agent 的记忆行为。修改后下一条消息生效。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Long-term memory */}
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <div className="text-sm font-medium">长期记忆 (MEMORY.md)</div>
              <div className="text-xs text-muted-foreground">
                agent 跨会话记住的稳定事实
              </div>
            </div>
            <Switch
              checked={memCfg.enabled}
              onCheckedChange={(on) =>
                setMemCfg((c) => ({ ...c, enabled: on }))
              }
            />
          </div>

          {/* Daily notes */}
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <div className="text-sm font-medium">每日笔记</div>
              <div className="text-xs text-muted-foreground">
                每天自动记录，永久保存
              </div>
            </div>
            <Switch
              checked={memCfg.daily_notes.enabled}
              onCheckedChange={(on) =>
                setMemCfg((c) => ({
                  ...c,
                  daily_notes: { ...c.daily_notes, enabled: on },
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Memory Content ── */}
      <Card>
        <CardHeader>
          <CardTitle>记忆内容</CardTitle>
          <CardDescription>
            agent 的规则、记忆、笔记和画像。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* AGENT.md editor */}
          <div>
            <div className="text-sm font-medium mb-2">AGENT.md（行为规则）</div>
            <Textarea
              rows={8}
              className="font-mono text-xs"
              placeholder={"# Agent 规则\n\n例如：\n- 你是我的家庭助手\n- 回复简洁\n- 不要执行危险命令"}
              value={agentMd}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                setAgentMd(e.target.value)
                setAgentMdDirty(true)
              }}
            />
            {agentMdDirty && (
              <div className="text-xs text-orange-500 mt-1">已修改，点击保存生效</div>
            )}
          </div>

          {/* MEMORY.md read-only */}
          <div>
            <div className="text-sm font-medium mb-2">MEMORY.md（长期记忆）</div>
            <ScrollArea className="h-32 rounded-md border p-3">
              <pre className="text-xs whitespace-pre-wrap font-mono">
                {memoryMd || "（暂无内容）"}
              </pre>
            </ScrollArea>
          </div>

          {/* Memory profile read-only */}
          <div>
            <div className="text-sm font-medium mb-2">记忆画像</div>
            {profileLoading ? (
              <div className="text-xs text-muted-foreground">加载中…</div>
            ) : memoryProfile ? (
              <ScrollArea className="h-32 rounded-md border p-3">
                <pre className="text-xs whitespace-pre-wrap font-mono">
                  {memoryProfile}
                </pre>
              </ScrollArea>
            ) : (
              <div className="text-xs text-muted-foreground">暂无画像</div>
            )}
          </div>

          {/* Daily notes list */}
          <div>
            <div className="text-sm font-medium mb-2">
              每日笔记 {notes.length > 0 && `(${notes.length} 篇)`}
            </div>
            {notesLoading ? (
              <div className="text-xs text-muted-foreground">加载中…</div>
            ) : notes.length === 0 ? (
              <div className="text-xs text-muted-foreground">暂无笔记</div>
            ) : (
              <div className="flex flex-col gap-2">
                {notes.map((n) => (
                  <div
                    key={n.date}
                    className="rounded-md border px-3 py-2 cursor-pointer hover:bg-accent transition-colors"
                    onClick={() =>
                      setSelectedNote(selectedNote?.date === n.date ? null : n)
                    }
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono">{n.date}</span>
                      <span className="text-xs text-muted-foreground">
                        {(n.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    {selectedNote?.date === n.date ? (
                      <ScrollArea className="mt-2 h-40">
                        <pre className="text-xs whitespace-pre-wrap font-mono">
                          {n.content}
                        </pre>
                      </ScrollArea>
                    ) : (
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {n.content.slice(0, 100)}…
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
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
