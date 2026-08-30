# Runtime Chain V1

This document is the current framework map for HomeSense Chat runtime. It is not a final architecture spec. Keep it short and update it when the chain changes.

## Goal

HomeSense Chat is an LLM-first smart-home agent. The runtime should stay simple for users:

- Users chat normally.
- The system always gives the LLM lightweight home awareness.
- Tools are opened only when the turn looks like a device action or device query.
- Device skills and concrete capabilities are loaded progressively.
- Execution is rehearsed before touching real devices when uncertainty exists.

## Current Chain

```text
User message
  -> runtime context window
     - recent conversation
     - current room
     - current device
     - light retrieval
     - context usage estimate
  -> light intent hint
     - chat / device_control / device_query / memory_note / meta
     - decides whether tools are available, not what the user "really meant"
  -> device inventory snapshot
     - always available as awareness
     - id, name, type, room, online, bindings only
  -> LLM primary
     - chats directly when no tool is needed
     - calls tools when device operation is clear
  -> progressive device disclosure
     - get_device_type_skill(device_type)
     - get_device_capabilities(device_id)
  -> rehearsal
     - rehearse_device_capability(...)
  -> real execution
     - execute_device_capability(...)
  -> trace cards
     - intent
     - context / device inventory
     - tool loading
     - sandbox rehearsal
     - execution result
```

## Context Rules

The LLM receives these every turn:

- Active runtime context: current room and current device, if session TTL is active.
- Recent messages: clipped by the runtime context window.
- Small retrieval hits: from compiled knowledge, capped by `retrieval_limit`.
- Device inventory snapshot: lightweight device list, not full capabilities.

The frontend shows approximate usage as:

```text
Context used_tokens/max_tokens
```

If the LLM API rejects the request for context length, the runtime compresses older conversation context and retries once.

## Skill Rules

A skill is a `SKILL.md` guide. It is a layered instruction manual for the LLM.

Device type skills live under:

```text
skills/device-tv-box/SKILL.md
skills/device-phone/SKILL.md
skills/device-speaker/SKILL.md
skills/device-computer/SKILL.md
```

Asset pages read the skill index. Runtime reads full skill detail only when needed:

```text
device inventory -> get_device_type_skill -> get_device_capabilities
```

This keeps the first prompt small while still giving the LLM operational guidance before concrete execution.

## Trace Rules

Trace is display-only and should not become persistent memory.

Useful trace stages:

- `runtime.intent`
- `runtime.context`
- `runtime.l1.command`
- `runtime.decision`
- `runtime.l3.llm`
- `runtime.execution`

Trace should be readable by humans first. Raw JSON stays behind expandable details.
User-facing trace labels should use product language such as context, candidate path, rehearsal, execution, and answer. Internal names like L1/L2/L3 may remain as code stage identifiers but should not be the primary UI copy.

## Current Boundaries

- L1: context-aware fast path. It may execute obvious device shortcuts when target device and capability are already clear.
- L2: candidate retrieval and plan selection. Keep the interface, but do not make it the center before the LLM-led runtime is stable.
- L3: unified LLM primary. It handles both chat and agent behavior. The runtime only decides what context and tools are available.
- Memory/RAG: external module. Short-term runtime context is not long-term memory.
- Skills: assets. They are `SKILL.md` manuals loaded by device type when the LLM needs operational guidance.
- Sandbox: rehearsal layer. It uses real device capability schemas and projected device state, but does not mutate real devices.

## Near-Term Build Order

1. Keep this runtime map current while code changes.
2. Make trace cards human-readable: stage summary first, raw JSON expandable.
3. Consolidate device capability registration around device-management cards/projections.
4. Connect sandbox rehearsal to the same capability registry used by real execution.
5. Move to L2 only after the LLM -> skill -> capability -> rehearsal -> execution path is understandable.

## Next Domains

The runtime chain is now clear enough to move forward. Good next areas:

- Sandbox home consistency: make rehearsal state visible and reliable.
- Device capability registry: reduce duplicated capability definitions.
- L2 retrieval/planning: use skills and successful paths as indexed candidate plans.
- Memory module: add long-term recall later, outside the short-term runtime context window.
