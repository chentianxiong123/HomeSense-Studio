# Archive: 2026-06-02 overdesign cuts

**Archive date:** 2026-06-02
**Cut from:** `refactor/noun-clustering` branch (commit `f5f216d`)
**Cut on:** `feat/nestjs-migration` branch (commit `00d71dc`)
**Reason:** User direction - stop over-designing for external compatibility, focus on the actual product.

## Why these were cut

The user said:
> "我以前设想要兼容外部力量了，我现在想到不需要这样做，做好自己的项目就够了，不要过度设计"

The five pieces below were "frameworks" built around hypothetical future needs that never materialized:

1. **`agent-adapter/`** - A registry for routing tasks to "agent adapters" (CLI / A2A / local modules). The L3 (pi) IS the agent; an adapter layer on top was redundant.
2. **`approval/`** - A permission system requiring user confirmation for high-risk CLI calls. User explicitly said "工具权限我们现在不必要设计。不做这个".
3. **`channels/`** - Multi-channel scaffolding for feishu / qq / wechat. We have a web chat only; multi-channel is over-engineering.
4. **`compensation/`** - A retry + compensation task system. 297 lines + 56 lines routes + 38 lines test. Heavy for what is just "try again on failure".
5. **`integration/auth.routes.ts` + `auth.schemas.ts`** - HTTP authentication for the API. Local NAS deployment; no HTTP auth needed.

## Net effect

- **-1363 lines / +402 lines** in the cut commit
- 5 modules removed from `modules/`
- `app.ts` registrations removed (8 lines)
- `composition.ts` simplified (one less service)
- `registry/`, `executor-gateway/`, `agent-runtime/`, `workflow/`, `chat/` consumers cleaned

## How to use this archive

This folder is **NOT** compiled by tsc, not registered in `app.ts`, not part of any module graph. It exists so that:

1. If the user later decides one of these was a mistake, the code is recoverable (just copy back to `modules/` and re-wire imports)
2. The git history stays clean (no need to dig through commits)
3. Future developers can see what was considered and rejected, with reasons

## Do not import from here

Any code that imports from `_archive/` should fail CI. Add an ESLint rule to enforce this if you want the strict guarantee.

## Re-introducing one of these

If you need one back:

```bash
# Example: restoring compensation
cp -r _archive/2026-06-02-overdesign-cuts/compensation modules/
# Then re-wire: app.ts, composition.ts, workflow/run-workflow.ts, etc.
# Tests in `compensation/index.test.ts` reference the old structure
```

Be aware that the consumers have been simplified - re-introducing requires re-wiring the
cleanups documented in the cut commit message.
