/**
 * Module: memory
 *
 * The memory noun: long-term memory kernel, asset view, and HTTP surface.
 * Was the consolidation of three legacy modules:
 *   - memory           (HTTP routes for /api/memory/...)
 *   - memory-assets    (asset CRUD + experience path recording)
 *   - memory-kernel    (the brain: search, recall, embed, write, compile)
 *
 * Public surface (re-exported here):
 *   - kernel: MemoryKernelService, memoryKernel, types
 *   - kernel-repository: SqlMemoryRepository, MemoryRepository
 *   - assets: MemoryAssetsService, memoryAssetsService, types
 *   - kernel.routes: memoryRoutes (the /api/memory/* routes)
 *   - assets.routes: memoryAssetsRoutes (the /api/assets/memory/* routes)
 */

export * from './kernel.js'
export * from './kernel-repository.js'
export * from './assets.js'
export { memoryRoutes } from './kernel.routes.js'
export { memoryAssetsRoutes } from './assets.routes.js'
