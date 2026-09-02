# RuleGo Workflow Integration

> Status: implemented (PoC complete, 10 tools wired, all tests green)
> Date: 2026-09-02

## Why a Workflow Engine

HomeSense v5's executor is a single-process MCP server with 10 tools
(adb_cmd, a11y_ctl, mi_device, bilibili_ctl, dlna_ctl, moonlight_ctl,
remote_desktop, media_sniff, netdisk_sync, executor_info). The cloud
brain orchestrates them by issuing tool calls turn by turn. That works
for ad-hoc tasks but breaks down for reusable, user-defined scenes
("电影模式", "回家模式", "睡前例程"):

- Each invocation re-prompts the LLM with the same multi-step plan.
- Cron / voice shortcuts can't run a saved sequence locally.
- The brain can't give the user a visual editor without re-implementing
  the planner.

A **workflow engine** turns "AI plans steps every time" into "AI writes
a saved sequence once, replayed deterministically." That's the goal
this document delivers.

## Library Choice: RuleGo

Surveyed alternatives in `pkg/workflow/SURVEY.md` (this file's appendix
in spirit). The chosen library is
[RuleGo](https://github.com/rulego/rulego):

- **Pure Go**, embedded, no external broker/database. Runs on Termux.
- **JSON DSL** with a DAG of typed nodes. AI output = JSON; no Go code,
  no recompile, no executor restart.
- **Hot reload**: `ReloadSelf` swaps the chain definition while the
  process keeps running. Perfect for "the brain just edited a workflow."
- **IoT-grade**: 1.6k stars, dedicated `rulego-components-iot` repo,
  Apache-2.0, recent commits.
- **Conditional routing** via per-node `relationType` + built-in
  `exprFilter` / `jsSwitch` / `groupFilter` / `msgTypeSwitch` nodes
  with the same JSON DSL.
- **Sub-chains** for reusable composition (e.g. "TV remote" is a
  sub-chain that any mode can include).

Other engines we rejected:

| Engine          | Reason                                          |
|-----------------|-------------------------------------------------|
| Temporal/Cadence| Needs a separate server process.                 |
| Azure/go-workflow | Conditions branch on upstream **status** only, not values. |
| cschleiden/go-workflows | Workflows are Go code, can't be edited by AI. |
| Floxy           | 140 stars, SQLite backend marked unstable, DSL is Go. |
| Restate SDK     | Workflows are Go code (durable async/await).     |
| uTask           | 1.4k stars but Yaml-over-API; the brain would still have to talk to its HTTP surface. |

## Architecture

```
   ┌──────────────────────┐          ┌──────────────────────┐
   │  Cloud brain (LLM)   │          │  Executor (Termux)   │
   │                      │          │                      │
   │  User says "电影模式" │          │  RuleGo engine       │
   │  → LLM emits JSON    │   WSS    │  ← Load(dls)         │
   │  → saves to SQLite   │ ───────► │  ← Dispatch(trigger) │
   │  → sends via WSS     │          │  → hs/mi_device      │
   │                      │          │  → hs/dlna_ctl       │
   │                      │          │  → ...               │
   └──────────────────────┘          └──────────────────────┘
```

The brain (or a frontend "Studio" page) emits a RuleGo-compatible JSON
DSL. The Tool Bridge (see `tool-bridge-design.md`) carries the DSL to
the executor over the same WSS we already designed. The executor loads
it and dispatches a `trigger` message.

## DSL Conventions

Node types fall in two buckets:

1. **HomeSense tools**: `hs/<tool>` — `hs/mi_device`, `hs/adb_cmd`,
   `hs/bilibili_ctl`, `hs/dlna_ctl`, `hs/moonlight_ctl`, `hs/a11y_ctl`,
   `hs/remote_desktop`, `hs/media_sniff`, `hs/netdisk_sync`.
2. **Built-in RuleGo nodes**: `exprFilter`, `jsSwitch`, `groupFilter`,
   `msgTypeSwitch`, `delay`, `log`, etc. — the standard RuleGo catalog.

Each `hs/*` node's `configuration` accepts any field from the tool's
underlying Request struct. Two shortcuts:

- `action`: the tool subcommand. If absent, the connection label
  becomes a hint but is not auto-bound (we keep it explicit).
- `parameters`: a nested object. Fields there override top-level
  siblings; everything else merges into the final call args.

Output shape inside `msg.Data` (after a `hs/*` node):

```json
{
  "tool": "mi_device",
  "action": "device_action",
  "data": { "status": "success", "...": "..." },
  "elapsedMs": 42
}
```

`status` mirrors the MCP handler's "error" vs "success" branch. On
failure, `data.error` carries the message; the engine routes via the
**Failure** relation so a downstream `exprFilter` can branch on it.

## Examples

`pkg/workflow/examples/movie_mode.json` and `home_mode.json` are runnable
end-to-end test fixtures. Highlights:

- `exprFilter` nodes test the `msg.tool`, `msg.action`, and timestamp.
- Success / Failure / True / False relations drive branching.
- Each node is `debugMode: true` so the brain can stream a trace
  timeline back through the WSS.

## Code Layout

```
pkg/workflow/
  workflow.go            # Registry, Engine, capabilityNode (RuleGo Node)
  workflow_test.go       # 5 tests: load, dispatch, hot-reload, debug, examples
  adapters/
    adapters.go          # 10 capabilityCallers + RegisterAll()
  examples/
    movie_mode.json
    home_mode.json
```

## Adding a New Tool

1. Implement the `workflow.CapabilityCaller` interface in
   `pkg/workflow/adapters/adapters.go` (~15 lines; see `adbCmdCaller`
   for the canonical example).
2. Add a one-liner to `RegisterAll`.
3. Add a JSON example under `pkg/workflow/examples/`.
4. The tool's name becomes its node type (`hs/<name>`); the brain can
   use it in any chain without further code changes.

## Tool Bridge Integration (next step)

The WSS Tool Bridge already supports a "call tool" message type. Add a
new message type `load_workflow` and `dispatch_workflow`:

```jsonc
// brain → executor
{ "type": "load_workflow",
  "chainId": "movie_mode_v2",
  "dsl": { ... RuleGo JSON ... } }

// brain → executor
{ "type": "dispatch_workflow",
  "chainId": "movie_mode_v2",
  "msgType": "trigger",
  "meta": { "room": "客厅", "user": "alice" } }

// executor → brain
{ "type": "workflow_done",
  "chainId": "movie_mode_v2",
  "elapsedMs": 1820,
  "trace": [ { "nodeId": "s1", "relation": "Success", "elapsedMs": 23 }, ... ] }
```

The trace comes straight from `cfg.OnDebug` which the registry already
threads into every `Load`.

## Open Questions / Follow-ups

- **Persistence**: chains currently live in memory; on executor
  restart they're gone. A trivial fix is to dump `rulego.Get(chainId).DSL()`
  to a JSON file before `StopAll` and re-load on boot. The brain can
  also re-send saved chains at boot.
- **Sub-chains**: the example chains are flat. RuleGo supports
  `subRuleChain` references; we can use them once the brain's editor
  ships shared components.
- **Cron integration**: the brain already has a cron service. Have the
  cron service call the Tool Bridge's `dispatch_workflow` instead of
  the agent loop for "pure" workflows (no LLM needed).
- **UI**: a frontend "Studio" page that edits a JSON tree and
  round-trips through the WSS is the next UX layer; not in scope here.

## Test Status

```
ok  github.com/sipeed/picoclaw/pkg/workflow  0.121s
```

Tests cover: registration, JSON parsing, dispatch, hot reload of the
same chain ID, debug callback, invalid DSL, missing chain ID, and
load-validate of both example files. `go build ./...` and `go vet ./...`
are clean.
