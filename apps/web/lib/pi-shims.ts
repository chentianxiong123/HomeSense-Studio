// v5 砍掉 pi 依赖:统一 shim 模块。
// 所有曾从 @earendil-works/pi-* 导入的名字,都从这里导入。
// 纯类型不走运行时;运行时函数保留为“调用即抛”,因为 Go 后端已接管 agent。
export * from "./pi-stubs"

export function getAgentDir(): string {
  throw new Error("pi 已移除:getAgentDir() 已废弃,请用 tenant-paths.getTenantAgentDir(tenantId)")
}