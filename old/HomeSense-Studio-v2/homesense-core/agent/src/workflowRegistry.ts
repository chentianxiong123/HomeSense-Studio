import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createWorkflowV0, type CapabilityCommandV0, type WorkflowEdgeV0, type WorkflowNodeV0, type WorkflowV0 } from "./state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_REGISTRY_PATH = join(__dirname, "data", "workflow_registry.json");

function ensureWorkflowRegistryDir() {
  const dir = dirname(WORKFLOW_REGISTRY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function normalizeWorkflowRecord(input: Record<string, unknown>): WorkflowV0 {
  return createWorkflowV0({
    workflowId: typeof input.workflowId === "string" ? input.workflowId : `workflow_${Date.now()}`,
    name: typeof input.name === "string" ? input.name : "untitled workflow",
    description: typeof input.description === "string" ? input.description : undefined,
    goal: typeof input.goal === "string" ? input.goal : undefined,
    inputs: Array.isArray(input.inputs) ? input.inputs as unknown as WorkflowV0["inputs"] : undefined,
    nodes: Array.isArray(input.nodes) ? input.nodes as unknown as WorkflowV0["nodes"] : [],
    edges: Array.isArray(input.edges) ? input.edges as unknown as WorkflowV0["edges"] : [],
    metadata: typeof input.metadata === "object" && input.metadata !== null
      ? input.metadata as WorkflowV0["metadata"]
      : undefined,
  });
}

function readPersistedWorkflowRegistry(): WorkflowV0[] {
  ensureWorkflowRegistryDir();
  if (!existsSync(WORKFLOW_REGISTRY_PATH)) return [];

  try {
    const raw = JSON.parse(readFileSync(WORKFLOW_REGISTRY_PATH, "utf-8")) as { workflows?: Record<string, unknown>[] };
    return Array.isArray(raw.workflows)
      ? raw.workflows.map(normalizeWorkflowRecord)
      : [];
  }
  catch {
    return [];
  }
}

function writePersistedWorkflowRegistry(workflows: WorkflowV0[]) {
  ensureWorkflowRegistryDir();
  writeFileSync(
    WORKFLOW_REGISTRY_PATH,
    JSON.stringify({ workflows }, null, 2),
    "utf-8",
  );
}

export function buildWorkflowDraftFromCommands(input: string, commands: CapabilityCommandV0[], options?: { workflowId?: string; name?: string; description?: string; source?: "human_authored" | "ai_drafted" | "self_orchestrated" }): WorkflowV0 | null {
  if (!Array.isArray(commands) || commands.length === 0) return null;

  const capabilityNodes = commands.map((command, index) => ({
    nodeId: `cmd_${index + 1}`,
    type: "capability" as const,
    label: command.capability,
    capability: command.capability,
    command,
    policy: {
      riskLevel: command.execution?.riskLevel,
      requiresApproval: command.execution?.requiresConfirmation,
      timeoutMs: command.execution?.timeoutMs,
    },
  }));

  const nodes: WorkflowV0["nodes"] = [
    { nodeId: "start_1", type: "start", label: "开始" },
    ...capabilityNodes,
    { nodeId: "end_1", type: "end", label: "结束" },
  ];

  const edges = capabilityNodes.map((node, index) => {
    const previousNodeId = index === 0 ? "start_1" : capabilityNodes[index - 1].nodeId;
    return {
      edgeId: `e_${index + 1}`,
      from: previousNodeId,
      to: node.nodeId,
      when: index === 0 ? undefined : { result: "success" as const },
    };
  });

  edges.push({
    edgeId: `e_${capabilityNodes.length + 1}`,
    from: capabilityNodes[capabilityNodes.length - 1].nodeId,
    to: "end_1",
    when: { result: "success" as const },
  });

  return createWorkflowV0({
    workflowId: options?.workflowId || `draft_${Date.now()}`,
    name: options?.name || input.slice(0, 24) || "临时编排草稿",
    description: options?.description || `由当前对话生成的最小 workflow 草稿：${input}`,
    goal: input,
    nodes,
    edges,
    metadata: {
      source: options?.source || "self_orchestrated",
      tags: ["draft", "chat"],
      createdBy: "chat_runtime",
    },
  });
}

export function buildWorkflowExamplesV0(): WorkflowV0[] {
  return [
    createWorkflowV0({
      workflowId: "wf_go_home",
      name: "回到主界面",
      description: "最小 capability workflow 示例",
      goal: "返回电视主页",
      nodes: [
        { nodeId: "start_1", type: "start", label: "开始" },
        {
          nodeId: "go_home",
          type: "capability",
          label: "返回主页",
          capability: "device.tv.navigate.home",
          policy: { riskLevel: "low" },
        },
        { nodeId: "end_1", type: "end", label: "结束" },
      ],
      edges: [
        { edgeId: "e1", from: "start_1", to: "go_home" },
        { edgeId: "e2", from: "go_home", to: "end_1", when: { result: "success" } },
      ],
      metadata: { source: "human_authored", tags: ["example", "navigation"] },
    }),
    createWorkflowV0({
      workflowId: "wf_find_and_click",
      name: "查找并点击文本",
      description: "观察 + 条件 + capability 示例",
      goal: "查找文本后点击元素",
      nodes: [
        { nodeId: "start_1", type: "start", label: "开始" },
        { nodeId: "observe_tree", type: "observe", label: "读取 UI Tree", capability: "device.tv.ui.inspect.tree" },
        { nodeId: "check_ui", type: "condition", label: "是否有足够 UI 信息" },
        { nodeId: "find_text", type: "capability", label: "查找文本", capability: "device.tv.ui.find_text" },
        { nodeId: "click_text", type: "capability", label: "点击元素", capability: "device.tv.ui.click_element" },
        { nodeId: "end_1", type: "end", label: "结束" },
      ],
      edges: [
        { edgeId: "e1", from: "start_1", to: "observe_tree" },
        { edgeId: "e2", from: "observe_tree", to: "check_ui" },
        { edgeId: "e3", from: "check_ui", to: "find_text", when: { expression: "ui_context_available == true" } },
        { edgeId: "e4", from: "find_text", to: "click_text", when: { result: "success" } },
        { edgeId: "e5", from: "click_text", to: "end_1" },
      ],
      metadata: { source: "human_authored", tags: ["example", "ui"] },
    }),
  ];
}

export function listWorkflowsV0(): WorkflowV0[] {
  const builtins = buildWorkflowExamplesV0();
  const persisted = readPersistedWorkflowRegistry();
  const merged = new Map<string, WorkflowV0>();

  [...builtins, ...persisted].forEach((workflow) => {
    merged.set(workflow.workflowId, workflow);
  });

  return Array.from(merged.values());
}

export function upsertWorkflowRegistryEntry(workflow: WorkflowV0): WorkflowV0 {
  const persisted = readPersistedWorkflowRegistry();
  const next = persisted.filter((item) => item.workflowId !== workflow.workflowId);
  next.unshift(workflow);
  writePersistedWorkflowRegistry(next);
  return workflow;
}

function semanticNodeKey(node: WorkflowNodeV0): string {
  if (node.type === "start") return "type:start";
  if (node.type === "end") return "type:end";
  if (node.capability) return `capability:${node.type}:${node.capability}`;
  return `shape:${node.type}:${node.label.trim().toLowerCase()}`;
}

function cloneNodeWithId(node: WorkflowNodeV0, nodeId: string): WorkflowNodeV0 {
  return { ...node, nodeId };
}

function cloneEdge(edge: WorkflowEdgeV0, edgeId: string, from: string, to: string): WorkflowEdgeV0 {
  return {
    ...edge,
    edgeId,
    from,
    to,
    when: edge.when ? { ...edge.when } : undefined,
  };
}

function buildCanonicalNodeId(type: WorkflowNodeV0["type"], fallbackId: string): string {
  if (type === "start") return "start_1";
  if (type === "end") return "end_1";
  return fallbackId;
}

function ensureUniqueNodeId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) return baseId;
  let index = 2;
  while (usedIds.has(`${baseId}_m${index}`)) index += 1;
  return `${baseId}_m${index}`;
}

function ensureUniqueEdgeId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) return baseId;
  let index = 2;
  while (usedIds.has(`${baseId}_m${index}`)) index += 1;
  return `${baseId}_m${index}`;
}

function incomingStartTargets(workflow: WorkflowV0): string[] {
  const startIds = new Set(workflow.nodes.filter((node) => node.type === "start").map((node) => node.nodeId));
  return workflow.edges
    .filter((edge) => startIds.has(edge.from))
    .map((edge) => edge.to);
}

function incomingEndSources(workflow: WorkflowV0): string[] {
  const endIds = new Set(workflow.nodes.filter((node) => node.type === "end").map((node) => node.nodeId));
  return workflow.edges
    .filter((edge) => endIds.has(edge.to))
    .map((edge) => edge.from);
}

function mergeWorkflowStructures(target: WorkflowV0, incomingWorkflow: WorkflowV0) {
  const mergedNodes = new Map<string, WorkflowNodeV0>();
  const nodeKeyToId = new Map<string, string>();
  const nodeIdMap = new Map<string, string>();
  const usedNodeIds = new Set<string>();

  const registerNode = (node: WorkflowNodeV0, origin: "target" | "incoming") => {
    const canonicalKey = semanticNodeKey(node);
    const preferredId = buildCanonicalNodeId(node.type, node.nodeId);
    const existingId = nodeKeyToId.get(canonicalKey);

    if (existingId) {
      nodeIdMap.set(`${origin}:${node.nodeId}`, existingId);
      if (origin === "incoming") {
        const existingNode = mergedNodes.get(existingId);
        if (existingNode) {
          mergedNodes.set(existingId, {
            ...existingNode,
            ...node,
            nodeId: existingId,
            type: existingNode.type,
          });
        }
      }
      return existingId;
    }

    const finalId = ensureUniqueNodeId(preferredId, usedNodeIds);
    usedNodeIds.add(finalId);
    nodeKeyToId.set(canonicalKey, finalId);
    nodeIdMap.set(`${origin}:${node.nodeId}`, finalId);
    mergedNodes.set(finalId, cloneNodeWithId(node, finalId));
    return finalId;
  };

  target.nodes.forEach((node) => registerNode(node, "target"));
  incomingWorkflow.nodes.forEach((node) => registerNode(node, "incoming"));

  const mergedEdges = new Map<string, WorkflowEdgeV0>();
  const edgeSignatureToId = new Map<string, string>();
  const usedEdgeIds = new Set<string>();

  const registerEdge = (edge: WorkflowEdgeV0, origin: "target" | "incoming") => {
    const from = nodeIdMap.get(`${origin}:${edge.from}`) ?? edge.from;
    const to = nodeIdMap.get(`${origin}:${edge.to}`) ?? edge.to;
    if (from === to) return null;

    const signature = JSON.stringify({ from, to, when: edge.when ?? null, label: edge.label ?? null });
    if (edgeSignatureToId.has(signature)) return edgeSignatureToId.get(signature) ?? null;

    const preferredId = ensureUniqueEdgeId(edge.edgeId, usedEdgeIds);
    usedEdgeIds.add(preferredId);
    edgeSignatureToId.set(signature, preferredId);
    const nextEdge = cloneEdge(edge, preferredId, from, to);
    mergedEdges.set(preferredId, nextEdge);
    return preferredId;
  };

  target.edges.forEach((edge) => registerEdge(edge, "target"));
  incomingWorkflow.edges.forEach((edge) => registerEdge(edge, "incoming"));

  const targetEndId = nodeKeyToId.get("type:end") ?? "end_1";
  const incomingStarts = incomingStartTargets(incomingWorkflow)
    .map((nodeId) => nodeIdMap.get(`incoming:${nodeId}`))
    .filter((nodeId): nodeId is string => Boolean(nodeId) && nodeId !== targetEndId);
  const targetTerminalNodes = incomingEndSources(target)
    .map((nodeId) => nodeIdMap.get(`target:${nodeId}`))
    .filter((nodeId): nodeId is string => Boolean(nodeId) && nodeId !== "start_1");

  const hasDirectTargetEndEdge = Array.from(mergedEdges.values())
    .some((edge) => edge.to === targetEndId && targetTerminalNodes.includes(edge.from));

  if (incomingStarts.length > 0 && targetTerminalNodes.length > 0 && hasDirectTargetEndEdge) {
    targetTerminalNodes.forEach((fromNodeId) => {
      incomingStarts.forEach((toNodeId) => {
        registerEdge({
          edgeId: `bridge_${fromNodeId}_${toNodeId}`,
          from: fromNodeId,
          to: toNodeId,
          when: { result: "success" },
          label: "merged_flow",
        }, "target");
      });
    });
  }

  return {
    nodes: Array.from(mergedNodes.values()),
    edges: Array.from(mergedEdges.values()),
    mergedNodeCount: Array.from(mergedNodes.values()).filter((node) => !target.nodes.some((existing) => semanticNodeKey(existing) === semanticNodeKey(node))).length,
    mergedEdgeCount: Array.from(mergedEdges.values()).filter((edge) => !target.edges.some((existing) => {
      const from = nodeIdMap.get(`target:${existing.from}`) ?? existing.from;
      const to = nodeIdMap.get(`target:${existing.to}`) ?? existing.to;
      return from === edge.from
        && to === edge.to
        && JSON.stringify(existing.when ?? null) === JSON.stringify(edge.when ?? null)
        && (existing.label ?? null) === (edge.label ?? null);
    })).length,
  };
}

export function mergeWorkflowRegistryEntry(targetWorkflowId: string, incomingWorkflow: WorkflowV0): WorkflowV0 {
  const all = listWorkflowsV0();
  const target = all.find((item) => item.workflowId === targetWorkflowId);
  if (!target) return upsertWorkflowRegistryEntry(incomingWorkflow);

  const merged = mergeWorkflowStructures(target, incomingWorkflow);
  const mergedTags = Array.from(new Set([
    ...(target.metadata?.tags || []),
    ...(incomingWorkflow.metadata?.tags || []),
    "merged",
  ]));

  const mergedWorkflow = createWorkflowV0({
    workflowId: target.workflowId,
    name: target.name,
    description: incomingWorkflow.description || target.description,
    goal: incomingWorkflow.goal || target.goal,
    inputs: incomingWorkflow.inputs || target.inputs,
    nodes: merged.nodes,
    edges: merged.edges,
    metadata: {
      source: target.metadata?.source || incomingWorkflow.metadata?.source,
      tags: mergedTags,
      createdBy: incomingWorkflow.metadata?.createdBy || target.metadata?.createdBy,
    },
  });

  return upsertWorkflowRegistryEntry(mergedWorkflow);
}

export function previewWorkflowMerge(targetWorkflowId: string, incomingWorkflow: WorkflowV0) {
  const target = getWorkflowById(targetWorkflowId);
  if (!target) {
    return {
      target: null,
      mergedNodeCount: incomingWorkflow.nodes.length,
      mergedEdgeCount: incomingWorkflow.edges.length,
    };
  }

  const merged = mergeWorkflowStructures(target, incomingWorkflow);
  return {
    target,
    mergedNodeCount: merged.mergedNodeCount,
    mergedEdgeCount: merged.mergedEdgeCount,
  };
}

export function getWorkflowById(workflowId: string): WorkflowV0 | null {
  return listWorkflowsV0().find((item) => item.workflowId === workflowId) ?? null;
}
