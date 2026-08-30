# HomeSense System Frame V1

This is the current full-map framework. It is intentionally broad and shallow. Use it to move fast across domains without losing the runtime chain.

## Product Position

HomeSense is an LLM-first smart-home agent:

- It can chat normally.
- It knows the user's current home context.
- It can operate devices through structured capabilities.
- It can rehearse actions in a sandbox before real execution.
- It should expose process cards in Chat without turning Chat into a debug console.

## Full Chain

```text
User
  |
  v
Chat UI
  - message stream
  - context sidebar: current room / current device
  - trace switch
  - tool / rehearsal cards
  |
  v
Chat runtime graph
  - runtime context window
  - light intent hint
  - device inventory snapshot
  - LLM primary
  |
  +--> L1 fast path
  |      - context-aware command aliases
  |      - obvious reversible actions
  |
  +--> LLM tool path
  |      - list_user_devices
  |      - get_device_type_skill
  |      - get_device_capabilities
  |      - rehearse_device_capability
  |      - execute_device_capability
  |
  +--> L2 placeholder
  |      - candidate retrieval / plan selection later
  |      - not the center until runtime is stable
  |
  v
Device management anchor
  - user_devices table
  - rooms
  - ping / online state
  - device card projection
  - binding sources: mi_did / adb_ip / ip_address
  |
  v
Capability registry
  - normalized capability_id
  - input_schema / output_schema
  - risk
  - executor metadata
  |
  +--> Device page
  +--> LLM-visible capability JSON
  +--> Sandbox rehearsal
  +--> Real execution
  |
  v
Integrations
  - mi-cli
  - adb-cli
  - future MCP skills
  - future visual / OpenCV tools
```

## Current Status

Done enough for framework:

- Chat runtime is LLM-first and runs through LangGraph.
- Runtime context window has TTL, recent messages, lightweight retrieval, and usage estimate.
- Device inventory is passed as lightweight awareness.
- Device type skills exist as `SKILL.md` assets.
- Device capability registry exists and is used by LLM tools and device management.
- Device detail page sends `capability_id` and structured `arguments` when available.
- Sandbox rehearsal trace cards exist in Chat.
- Sandbox execution returns `before`, `after`, `changed_fields`, and `effect_summary`.
- Trace is display-only and not persisted.

Still compatibility / cleanup:

- Some devtest and old device-management helpers keep legacy ADB helper exports.
- L1/L2/L3 wording still leaks into trace details.
- Device page still has legacy `params` compatibility for history and older controls.

Not now:

- Long-term memory / RAG evolution.
- SQLite vector / rerank L2.
- Lightweight graph / memory palace.
- Multimodal vision and OpenCV automation.
- Permission model. Rehearsal is the current safety mechanism.

## Module Boundaries

Chat runtime:

- Owns turn orchestration.
- Decides which tools are available.
- Does not own device capability definitions.

Runtime context:

- Owns short-term context, TTL, current room, current device, and context usage.
- Does not own long-term memory.

Device management:

- Owns real devices, rooms, bindings, online checks, and device cards.
- Is the anchor for anything that touches a device.

Capability registry:

- Owns device capability JSON.
- Bridges devices to `mi-cli`, `adb-cli`, sandbox, and LLM tools.

Skills:

- Own device-type operating manuals for the LLM.
- Are loaded progressively after a target device type is known.

Sandbox:

- Owns rehearsal.
- Uses real capability JSON but does not mutate real devices.

Trace:

- Owns user-visible process display.
- Does not store memory or system truth.

L2:

- Will own retrieval and candidate-plan ranking later.
- Should consume successful paths, skills, device capability JSON, and memory.

## Next Build Lanes

Lane A: Chat runtime surface cleanup

- Rename user-visible trace labels away from raw L1/L2/L3 terms.
- Make trace order read like: context -> intent hint -> tools -> rehearsal -> execution -> answer.
- Keep raw JSON only in expandable details.

Lane B: Sandbox projection

- Framework pass done: sandbox runners return before/after state and changed fields.
- Later: move projection closer to capability registry and improve product card copy.

Lane C: Assets / Skills

- Keep page name "Assets".
- Let device skills, future MCP skills, agents, and gateways live there as asset types.
- Avoid turning Assets into another debug panel.

Lane D: L2 later

- Use vector + rerank as an algorithmic retrieval path.
- Inputs should be skills, successful paths, memory, and candidate plans.
- Do this after the LLM -> skill -> capability -> sandbox -> execution chain is stable.

Lane E: Workflow runtime

- Keep workflow as a reusable execution graph, not an old agent/A2A shell.
- Prefer structured device capability nodes over raw CLI executor nodes for smart-home actions.
- Workflow device actions should use the same device capability registry, sandbox rehearsal, and real execution path as Chat.
