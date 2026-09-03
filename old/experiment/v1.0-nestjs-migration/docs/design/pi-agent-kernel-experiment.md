# Pi Agent Kernel Experiment

> 2026-05-31
> Branch: `experiment/pi-agent-kernel`
> Reference clone: `D:\files\HomeSense\References\pi`
> Reference commit: `3911d6f5 fix(coding-agent): stream large session files`

This is an experiment note, not a migration decision.

## Decision

Do not replace HomeSense Chat runtime with Pi directly.

Use Pi as a reference for a cleaner agent kernel boundary:

- event stream
- turn snapshot
- tool lifecycle hooks
- context transform / compaction
- skill resource loading
- session tree ideas

Do not import Pi's coding-agent product assumptions into HomeSense:

- no default bash / filesystem / coding tools in Chat
- no terminal-first UI model
- no device operation through generic code execution

## Why Pi Is Useful

Pi's repo separates the useful runtime layer from the coding product:

- `packages/agent`: agent runtime, state, tools, events, harness, compaction, skills
- `packages/ai`: multi-provider LLM API
- `packages/coding-agent`: terminal coding agent product
- `packages/tui`: terminal UI

HomeSense should only study the first two, mainly `packages/agent`.

The useful pattern is:

```text
AgentMessage[]
  -> transformContext()
  -> convertToLlm()
  -> provider stream
  -> tool lifecycle
  -> event stream
  -> session/save point
```

This is close to what HomeSense needs, but HomeSense has different domain anchors:

```text
User message
  -> runtime context window
  -> home/device awareness
  -> LLM primary
  -> progressive skills
  -> device capabilities
  -> sandbox rehearsal
  -> real execution / workflow
  -> user-facing trace cards
```

## HomeSense Kernel Boundary

The experiment should introduce an internal contract before swapping implementations.

```ts
interface AgentKernel {
  runTurn(input: AgentTurnInput): AsyncIterable<AgentKernelEvent>
}

interface AgentTurnInput {
  conversationId: number
  userInput: string
  messages: RuntimeMessage[]
  systemPrompt: string
  contextWindow: RuntimeContextWindow
  deviceInventory: DeviceInventorySnapshot[]
  tools: AgentToolDefinition[]
}

type AgentKernelEvent =
  | { type: 'message_delta'; content: string }
  | { type: 'message_end'; content: string }
  | { type: 'tool_start'; callId: string; name: string; args: unknown }
  | { type: 'tool_update'; callId: string; patch: unknown }
  | { type: 'tool_end'; callId: string; result: unknown; error?: string }
  | { type: 'trace'; trace: RuntimeTraceEvent }
  | { type: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number }
```

Current implementation can stay LangGraph. A future `pi-style` implementation can target the same contract.

## Absorb

1. Event model

Pi emits stable events:

- `agent_start`
- `turn_start`
- `message_start`
- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `turn_end`
- `agent_end`

HomeSense should map these to product cards:

- context
- answer
- tool loading
- sandbox rehearsal
- execution
- workflow

2. Context transform

Pi has an explicit `transformContext()` before `convertToLlm()`.

HomeSense equivalent:

```text
chat.db messages
  -> TTL pruning
  -> recent messages
  -> small retrieval hits
  -> current room / current device
  -> device inventory
  -> provider messages
```

This fits our current runtime context window and future compaction.

3. Tool lifecycle hooks

Pi has `beforeToolCall` and `afterToolCall`.

HomeSense can use the same idea:

- before device execution: enforce sandbox rehearsal
- before workflow run: run preview first
- after tool result: build trace cards and path candidates
- after successful path: offer memory / workflow promotion

4. Skills

Pi loads `SKILL.md`, exposes name/description/location first, and loads full content only when invoked.

HomeSense already wants this:

- device type skill index is lightweight
- full device skill is loaded after target device type is known
- skills live under Assets

5. Compaction

Pi uses usage-aware and estimate-aware compaction.

HomeSense target:

- keep recent chat while session is active
- expire context after TTL
- compress older useful context only when window pressure or provider error happens
- do not store or expose chain-of-thought

## Avoid

- Do not make Chat a coding agent.
- Do not expose bash, file edit, or terminal tools in HomeSense Chat.
- Do not let code nodes bypass device capability registry.
- Do not replace Workflow with agent loop.
- Do not persist trace as memory.
- Do not treat Pi's terminal session tree as HomeSense product UI.

## Experiment Steps

### Step 1: Read-only reference mapping

Status: started.

Map Pi concepts to HomeSense concepts:

| Pi | HomeSense |
| --- | --- |
| AgentHarness | Chat runtime orchestrator |
| AgentMessage | runtime message / chat message |
| transformContext | runtime context window |
| convertToLlm | provider message builder |
| tools | device/workflow/system tools |
| beforeToolCall | sandbox / preview gate |
| afterToolCall | trace / path candidate observation |
| skills | device type skills / future assets |
| compaction | context compression |
| session entries | chat.db + memory assets, not trace |

### Step 2: Introduce local kernel interface

Add a small adapter interface around the current Chat runtime without changing behavior.

The goal is not to use Pi yet. The goal is to make the runtime swappable:

```text
chat/routes.ts
  -> AgentKernel.runTurn()
  -> current LangGraph kernel
```

### Step 3: Build a pi-style fake kernel

Build a test-only or dev-only kernel that mimics Pi's event loop shape using existing HomeSense services.

It should support only:

- one user message
- streaming assistant text
- one or more tool calls
- sequential tool execution
- trace events

No Pi package dependency yet.

### Step 4: Optional package import spike

Only after Step 3 is understandable, try importing `@earendil-works/pi-agent-core` in a small isolated spike.

Success means:

- it can use HomeSense LLM provider through a custom `streamFn`
- it can use HomeSense device/workflow tools
- events can map cleanly to current SSE
- it does not force coding-agent assumptions

Failure is acceptable. We can still copy the architectural lessons.

## Acceptance Criteria

The experiment is useful only if these scenarios remain clean:

- `你好` returns a short normal chat answer with only small recent context.
- `打开电视` can still go device awareness -> skill/capability -> rehearsal -> execution.
- `看 B 站` can load device skill only when needed.
- `运行某个 workflow` still goes preview -> run.
- Frontend trace cards stay readable and do not become raw runtime dumps.
- No fake device proof is claimed.

## Current Recommendation

Keep LangGraph as the production runtime for now.

Extract a small `AgentKernel` boundary first. Then use Pi as the shape reference for:

- events
- hooks
- compaction
- skills
- lifecycle/save points

Only consider importing Pi core after the local boundary is stable.
