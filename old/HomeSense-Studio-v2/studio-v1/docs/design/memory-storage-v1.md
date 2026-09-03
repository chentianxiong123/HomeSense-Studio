# Memory Storage V1

This is the current storage boundary for HomeSense memory, skills, and experience paths.

## Reference Takeaway

Hermes separates three ideas that should stay separate here too:

- Memory: small durable facts and preferences.
- Skills: procedural manuals in `SKILL.md`, loaded progressively.
- Skill creation / update: a review step after difficult or successful work, not a blind transcript dump.

HomeSense should keep that split, but specialize it for smart-home devices.

## Storage Classes

```text
runtime trace
  display only, never persisted

runtime context window
  short-term, TTL based
  current room / current device / recent turns / small recall
  not long-term memory

memory_items
  common searchable envelope
  title / summary / search_text / scope / source / confidence / status / priority
  future FTS + vector entry point

memory_experience_paths
  proven procedural routes
  intent_pattern / preconditions / steps / skill_refs / device_refs
  success_count / failure_count / last_success_at

skills/*.md
  reusable instructions
  device type skills, general skills, future MCP skills
  loaded only when needed

memory_entities + memory_triples + memory_attributes
  future lightweight graph / memory palace
  rooms, devices, places, app states, relationships

compiled_knowledge_items
  external RAG / imported knowledge
  not the same thing as user memory
```

## What Goes Where

| Content | Store | Reason |
| --- | --- | --- |
| Current room / current device | `user_context` + runtime context window | Needs TTL and can expire. |
| Chat trace | SSE only | It is a process display, not memory. |
| Successful device operation route | `memory_items` + `memory_experience_paths` | Recalled as a candidate path. |
| Device type operating guide | `skills/device-*/SKILL.md` + device skill index | A manual, not a memory row. |
| User correction like "this TV is in living room" | future `memory_items.kind=device_preference` or graph attribute | Durable preference/fact. |
| Spatial layout / memory palace | future graph tables | Relationship-heavy, not flat text. |
| Imported documents / wiki / old docs | `compiled_knowledge_items` | RAG knowledge, separate from user memory. |
| Raw chain of thought | nowhere | Do not store. |

## L2 Recall Shape

L2 should be an algorithm over multiple sources, not a single table:

```text
query + runtime context
  -> exact / rule candidates
  -> memory experience paths
  -> compiled knowledge FTS
  -> vector hits
  -> lightweight graph hits
  -> dedupe + score fusion
  -> rerank
  -> LLM validates device, skill, capability, and arguments
```

Fast candidates can come from `memory_experience_paths`, but execution still needs the current device context and capability registry.

## Evolution Loop

Current manual version:

```text
successful chat execution
  -> frontend path card
  -> user saves as memory / experience path
  -> later L2 can recall it
```

Future assisted version:

```text
successful or corrected task
  -> background review asks:
     - should this become a path?
     - should this patch a SKILL.md?
     - should this become user/device memory?
  -> propose first, then write
```

This keeps the assistant capable of learning without turning every conversation into permanent clutter.

## Current Decision

Do not build deep L2 yet. The current priority is:

1. Keep Chat runtime readable.
2. Keep device management as the anchor.
3. Save successful paths as memory assets.
4. Use skills as progressive manuals.
5. Add vector/rerank and graph recall after the chain is stable.
