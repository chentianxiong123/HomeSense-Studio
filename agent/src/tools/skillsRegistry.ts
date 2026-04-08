import { existsSync, readFileSync } from "fs";
import { join } from "path";
import YAML from "yaml";

export interface SkillMetadata {
  skill_id?: string;
  tool?: string;
  capabilities?: string[];
  exposure_level?: string;
  risk_level?: string;
  preconditions?: string[];
}

export interface SkillRegistryEntry {
  tool: string;
  section: string;
  ref: string;
  content: string;
  metadata?: SkillMetadata;
}

function parseSkillFrontmatter(content: string): { metadata?: SkillMetadata; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { body: content };

  const metadata: SkillMetadata = {};
  const lines = match[1].split("\n");
  let currentArrayKey: keyof SkillMetadata | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1] as keyof SkillMetadata;
      const value = keyMatch[2].trim();
      if (value === "") {
        currentArrayKey = key;
        metadata[key] = [] as never;
      } else {
        currentArrayKey = undefined;
        metadata[key] = value as never;
      }
      continue;
    }

    const itemMatch = line.match(/^\-\s+(.*)$/);
    if (itemMatch && currentArrayKey) {
      const current = Array.isArray(metadata[currentArrayKey]) ? metadata[currentArrayKey] as string[] : [];
      current.push(itemMatch[1].trim());
      metadata[currentArrayKey] = current as never;
    }
  }

  return { metadata, body: match[2] };
}

export function readSkillSection(toolsDir: string, toolName: string, section: string): SkillRegistryEntry | null {
  const skillsPath = join(toolsDir, toolName, "skills", `${section}.md`);
  if (!existsSync(skillsPath)) return null;
  const raw = readFileSync(skillsPath, "utf-8");
  const parsed = parseSkillFrontmatter(raw);
  return {
    tool: toolName,
    section,
    ref: `${toolName}/${section}`,
    content: parsed.body,
    metadata: parsed.metadata,
  };
}

export function selectSkillSectionsByCapability(toolsDir: string, tool: string, requestedCapabilities: string[], allowProgressive: boolean, candidateSections = ["index", "targeting", "perception", "voice", "context", "matching", "retrieval", "planning", "tooling", "writeback", "normalization", "handoff", "promotion", "limitations", "authoring", "fallback"]) {
  const matches = requestedCapabilities.flatMap((capability) => {
    return candidateSections
      .map((section) => readSkillSection(toolsDir, tool, section))
      .filter((item): item is SkillRegistryEntry => Boolean(item))
      .filter((item) => item.metadata?.capabilities?.includes(capability))
      .filter((item) => allowProgressive || item.metadata?.exposure_level !== "progressive")
      .map((item) => item.section);
  });
  return Array.from(new Set(matches));
}

export function buildCapabilityRegistryV0() {
  return {
    "device.tv.navigate.back": { preferredTool: "adb", action: "back", riskLevel: "low", requiredInputs: [] },
    "device.tv.navigate.home": { preferredTool: "adb", action: "home", riskLevel: "low", requiredInputs: [] },
    "device.tv.ui.inspect.tree": { preferredTool: "adb", action: "get_ui_tree", riskLevel: "low", requiredInputs: [] },
    "device.tv.ui.inspect.screenshot": { preferredTool: "adb", action: "screenshot", riskLevel: "low", requiredInputs: [] },
    "device.tv.ui.find_text": { preferredTool: "adb", action: "find_text", riskLevel: "low", requiredInputs: ["keyword"] },
    "device.tv.ui.click_element": { preferredTool: "adb", action: "click_element", riskLevel: "low", requiredInputs: [] },
    "device.tv.app.open": { preferredTool: "adb", action: "open_app", riskLevel: "medium", requiredInputs: ["package"] },
    "home.voice.execute": { preferredTool: "hami", action: "xiaoai_execute", riskLevel: "medium", requiredInputs: ["command"] },
    "home.voice.speak": { preferredTool: "hami", action: "xiaoai_speak", riskLevel: "low", requiredInputs: ["text"] },
    "device.tv.remote.send": { preferredTool: "hami", action: "tv_remote", riskLevel: "medium", requiredInputs: ["command"] },
  } as const;
}

export function validateCapabilityCommandInput(capability: string, input: Record<string, unknown>) {
  const registry = buildCapabilityRegistryV0();
  const entry = registry[capability as keyof typeof registry];
  if (!entry) return { ok: false, reason: "capability_not_registered" } as const;
  for (const key of entry.requiredInputs) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      return { ok: false, reason: `missing_input:${key}` } as const;
    }
  }
  return { ok: true, entry } as const;
}

export function capabilityExists(capability: string) {
  const registry = buildCapabilityRegistryV0();
  return capability in registry;
}

export function getCapabilityEntry(capability: string) {
  const registry = buildCapabilityRegistryV0();
  return registry[capability as keyof typeof registry] ?? null;
}

export function findCapabilityByToolAction(tool: string, action: string) {
  const registry = buildCapabilityRegistryV0();
  const match = Object.entries(registry).find(([, entry]) => entry.preferredTool === tool && entry.action === action);
  return match ? { capability: match[0], entry: match[1] } : null;
}

export function toolActionToCapabilityDraft(tool: string, action: string, params?: Record<string, unknown>) {
  const match = findCapabilityByToolAction(tool, action);
  if (!match) return null;
  return {
    capability: match.capability,
    input: params ?? {},
    entry: match.entry,
  };
}

export function buildCapabilityRegistryPreview() {
  const registry = buildCapabilityRegistryV0();
  return Object.entries(registry).map(([capability, value]) => ({ capability, ...value }));
}

export function buildSkillRegistryPreview(toolsDir: string) {
  return buildSkillRegistryV0(toolsDir).map((item) => ({ ref: item.ref, metadata: item.metadata }));
}

export function readSkillSectionsByRefs(toolsDir: string, refs: string[]) {
  const uniqueRefs = Array.from(new Set(refs.filter((item) => typeof item === "string" && item.length > 0)));
  return uniqueRefs
    .map((ref) => {
      const [tool, section] = ref.split("/");
      if (!tool || !section) return null;
      return readSkillSection(toolsDir, tool, section);
    })
    .filter((item): item is SkillRegistryEntry => Boolean(item));
}

export function buildRegistryPreviewV0(toolsDir: string) {
  return {
    capabilities: buildCapabilityRegistryPreview(),
    skills: buildSkillRegistryPreview(toolsDir),
  };
}

export function buildRuntimeRegistryPreview(toolsDir: string, refs: string[], input = "", intent?: string) {
  const selected = readSkillSectionsByRefs(toolsDir, refs);
  return {
    input,
    intent: intent ?? null,
    refs: Array.from(new Set(refs.filter((item) => typeof item === "string" && item.length > 0))),
    registry: buildRegistryPreviewV0(toolsDir),
    metadata: selected.map((item) => ({
      skill_id: item.metadata?.skill_id ?? `${item.tool}.${item.section}`,
      tool: item.metadata?.tool ?? item.tool,
      section: item.section,
      capabilities: item.metadata?.capabilities ?? [],
      exposure_level: item.metadata?.exposure_level ?? null,
      risk_level: item.metadata?.risk_level ?? null,
      preconditions: item.metadata?.preconditions ?? [],
    })),
  };
}

export function summarizeCapabilityCommands(commands: Array<{ commandId?: string; capability?: string; input?: Record<string, unknown>; execution?: { preferredTool?: string; riskLevel?: string } }>) {
  return commands
    .filter((item) => typeof item?.capability === "string")
    .map((item) => {
      const entry = getCapabilityEntry(item.capability as string);
      return {
        commandId: item.commandId ?? null,
        capability: item.capability ?? null,
        preferredTool: item.execution?.preferredTool ?? entry?.preferredTool ?? null,
        action: entry?.action ?? null,
        riskLevel: item.execution?.riskLevel ?? entry?.riskLevel ?? null,
        input: item.input ?? {},
      };
    });
}

export function buildSkillRegistryV0(toolsDir: string) {
  const refs = [
    ["adb", "index"],
    ["adb", "targeting"],
    ["adb", "perception"],
    ["hami", "index"],
    ["hami", "voice"],
  ] as const;

  return refs
    .map(([tool, section]) => readSkillSection(toolsDir, tool, section))
    .filter((item): item is SkillRegistryEntry => Boolean(item));
}

export function capabilityIsExposedBySkills(toolsDir: string, capability: string, refs: string[]) {
  const registry = buildSkillRegistryV0(toolsDir);
  const refSet = new Set(refs);
  return registry
    .filter((item) => refSet.has(item.ref))
    .some((item) => item.metadata?.capabilities?.includes(capability));
}

export function getCapabilityRiskLevel(capability: string) {
  return getCapabilityEntry(capability)?.riskLevel ?? null;
}

function readToolConfig(toolsDir: string, tool: string) {
  const configPath = join(toolsDir, tool, "config.yaml");
  if (!existsSync(configPath)) return {} as Record<string, unknown>;
  try {
    return YAML.parse(readFileSync(configPath, "utf-8")) || {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function checkPrecondition(toolsDir: string, precondition: string) {
  if (precondition === "tv_connection_available") {
    const adbConfig = readToolConfig(toolsDir, "adb");
    return Boolean((adbConfig as { device?: { ip?: string } }).device?.ip);
  }
  if (precondition === "home_hub_available") {
    const hamiConfig = readToolConfig(toolsDir, "hami");
    return Boolean((hamiConfig as { ha_url?: string; ha_token?: string }).ha_url)
      && (hamiConfig as { ha_token?: string }).ha_token !== "YOUR_HOME_ASSISTANT_TOKEN";
  }
  if (precondition === "ui_context_available") {
    const adbConfig = readToolConfig(toolsDir, "adb");
    return Boolean((adbConfig as { perception?: { ui_tree?: { enabled?: boolean } } }).perception?.ui_tree?.enabled);
  }
  return true;
}

function capabilityPreconditionsSatisfied(toolsDir: string, capability: string, refs: string[]) {
  const registry = buildSkillRegistryV0(toolsDir);
  const refSet = new Set(refs);
  const matchingSkills = registry.filter((item) => refSet.has(item.ref) && item.metadata?.capabilities?.includes(capability));
  const required = Array.from(new Set(matchingSkills.flatMap((item) => item.metadata?.preconditions ?? [])));
  const failed = required.filter((precondition) => !checkPrecondition(toolsDir, precondition));
  return {
    ok: failed.length === 0,
    required,
    failed,
  } as const;
}

export function shouldAllowCapabilityByRefs(toolsDir: string, capability: string, refs: string[]) {
  const entry = getCapabilityEntry(capability);
  if (!entry) return { ok: false, reason: "capability_not_registered" } as const;
  const exposed = capabilityIsExposedBySkills(toolsDir, capability, refs);
  if (!exposed) return { ok: false, reason: "capability_not_exposed" } as const;
  const preconditions = capabilityPreconditionsSatisfied(toolsDir, capability, refs);
  if (!preconditions.ok) {
    return { ok: false, reason: "preconditions_not_satisfied", failedPreconditions: preconditions.failed } as const;
  }
  return { ok: true, riskLevel: entry.riskLevel, preconditions: preconditions.required } as const;
}

export function filterCommandsBySkillExposure(toolsDir: string, commands: Array<{ capability?: string }>, refs: string[]) {
  return commands.filter((command) => typeof command.capability === "string" && shouldAllowCapabilityByRefs(toolsDir, command.capability, refs).ok);
}

export function filterToolActionsBySkillExposure(toolsDir: string, actions: Array<{ tool?: string; action?: string; params?: Record<string, unknown> }>, refs: string[]) {
  return actions.filter((action) => {
    if (typeof action.tool !== "string" || typeof action.action !== "string") return false;
    const draft = toolActionToCapabilityDraft(action.tool, action.action, action.params);
    if (!draft) return false;
    return shouldAllowCapabilityByRefs(toolsDir, draft.capability, refs).ok;
  });
}

export function enforceToolActionsByPolicy(toolsDir: string, actions: Array<{ tool?: string; action?: string; params?: Record<string, unknown> }>, refs: string[]) {
  const allowed: Array<{ tool?: string; action?: string; params?: Record<string, unknown> }> = [];
  const blocked: Array<{ tool?: string; action?: string; capability?: string; reason: string; failedPreconditions?: string[] }> = [];

  for (const action of actions) {
    if (typeof action.tool !== "string" || typeof action.action !== "string") continue;
    const draft = toolActionToCapabilityDraft(action.tool, action.action, action.params);
    if (!draft) {
      blocked.push({ ...action, reason: "capability_reverse_mapping_missing" });
      continue;
    }
    const decision = shouldAllowCapabilityByRefs(toolsDir, draft.capability, refs);
    if (decision.ok) {
      allowed.push(action);
    } else {
      blocked.push({
        ...action,
        capability: draft.capability,
        reason: decision.reason,
        failedPreconditions: "failedPreconditions" in decision ? decision.failedPreconditions : undefined,
      });
    }
  }

  return {
    allowed,
    blocked,
    gatedBySkills: blocked.length > 0,
    gatedActionCount: blocked.length,
    gatingReason: blocked[0]?.reason ?? null,
  } as const;
}
