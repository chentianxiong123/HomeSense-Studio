# Baseline (refactor/noun-clustering @ 28b9f11)
Captured: 2026-06-02

## Test counts
- Backend: 4 failed / 197 passed (201 total) across 32 files
- Frontend: 1 failed / 83 passed (84 total) across 27 files
- Total: 5 failed / 280 passed (285 total)

## Known failures (will be addressed in phase 4)
1. `src/heart/heart.integration.test.ts` — chain: experience write -> compile -> search finds it
2. `src/modules/chat/graph.test.ts` — chat graph context policy: uses the runtime context window instead of stale request history
3. `src/modules/memory-kernel/decoupling.test.ts` — memory-kernel heart writes pass through repository: upsertCompiledKnowledge + FTS roundtrip via repository
4. `src/modules/runtime-capability-map/index.test.ts` — aggregates real registry-shaped capability surfaces into one map (mcp-registry db init issue)
5. `src/features/studio/detailNavigation.test.ts` — buildSkillDetailTabs encodes skill names and keeps overview/prompt tabs stable

## Module count
- 47 backend module directories under `packages/backend/src/modules`
- 5 files over 1000 lines (chat/graph.ts 1617, remote-workspace 1363, memory-assets 1133, memory-kernel 1130, agent-runtime 1035)

## Target after refactor
- 28 noun-clustered modules
- 6 core ports in shared/ports/
- Mega-files split
- All 285 tests passing (or skipped with reason)
