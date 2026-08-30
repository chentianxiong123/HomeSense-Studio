# Skills and MCP V1

## Position

HomeSense uses `Skill` as the unified name for layered instruction manuals.

A Skill can describe a device, a task, a tool, a workflow pattern, or an external capability. It is not the same thing as a device type and it is not the executable capability itself.

## Separation

```text
Capability
  Real executable action or tool schema.

Device Profile
  Real device facts: room, online state, bindings, and available capabilities.

Skill
  Layered manual for the LLM. It explains when and how to use capabilities.

MCP Server
  External tool surface. It registers transport, endpoint, tools, and auth metadata.

Workflow
  Editable and runnable automation graph.

Experience Path
  Historical execution fact. It can reference skills and capabilities.
```

## Progressive Disclosure

The LLM should not receive full manuals or raw tool dumps upfront.

Runtime should expose:

1. Device/context summary.
2. Skill index.
3. MCP server/tool index.
4. Specific Skill section only when needed.
5. Concrete capability schema only before planning or execution.

## MCP Boundary

MCP is a registered external tool surface, not a replacement for Skills.

```text
MCP server registry
  -> lightweight server/tool index
  -> matching Skill explains usage
  -> runtime bridge executes the MCP tool later
```

The current implementation only adds the registry and API:

```text
GET /api/mcp/servers
POST /api/mcp/servers
DELETE /api/mcp/servers/:id
```

Execution is intentionally out of scope for this first skeleton.

## Claude Code Reference

Claude Code keeps Skills and MCP as separate concepts:

- Skills are reusable instruction packs.
- MCP tools are external tool surfaces.
- Tool discovery can be deferred so the model does not need every tool upfront.
- Invoked skills are tracked so context compaction can preserve important manuals.

HomeSense should copy the shape, not the whole runtime:

```text
Assets
  Skills
  MCP
  Memory
  Capabilities

Runtime
  device/context summary
  -> skill/MCP lightweight index
  -> load specific manual/tool schema
  -> execute through capability registry or MCP bridge
```

## Naming Rule

Use `Skill` in product language.

Allowed precise subtypes:

- device manual skill
- task skill
- tool skill
- MCP skill guide
- workflow authoring skill

Avoid:

- device type skill as the top-level concept
- raw MCP tools as the model's only instruction
- duplicating capability schemas inside every Skill
