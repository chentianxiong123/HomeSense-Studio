# HomeSense n8n Runtime Trim Notes

HomeSense uses n8n as an L2 workflow runtime, not as the product surface.

The trimmed runtime keeps enough n8n source to study and execute workflow graphs, while removing the pieces that would make n8n the main platform:

- editor UI and frontend packages
- cloud/collaboration/user-facing platform concerns
- AI/MCP/langchain packages
- enterprise-only packages
- test/playwright/benchmark packages
- most `nodes-base` integrations

## First Cut

Generate the first trimmed copy from the local n8n reference checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-n8n-runtime-trim.ps1
```

Default source:

```text
D:\files\References\workflow\n8n
```

Default target:

```text
D:\files\References\workflow\n8n-homesense-runtime
```

This first cut is intentionally a source boundary cut, not the final buildable runner. It preserves the upstream reference checkout untouched and creates a repeatable runtime candidate that can be tightened further.

## Runtime Node Allowlist

The first retained node set is:

- `ManualTrigger`
- `ExecuteCommand`
- `HttpRequest`
- `If`
- `Switch`
- `Set`
- `Code`
- `Wait`
- `Merge`

This matches the L2 direction:

```text
L3 LLM explores once -> HomeSense stores workflow -> L1/L2 triggers -> n8n runtime executes -> LLM is bypassed
```

## Next Cut

After this copy exists, the next work is:

1. reduce `packages/cli` to execute/import/runtime commands only
2. replace full n8n UI/API entrypoints with a HomeSense-managed local runtime entrypoint
3. make `n8n-nodes-base` package metadata match the node allowlist
4. verify a minimal workflow with `ManualTrigger -> ExecuteCommand`
5. expose HomeSense service methods that spawn the runtime like other CLI packages

