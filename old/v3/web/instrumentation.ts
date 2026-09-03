export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // 多租户基线(Phase 1.1):首次启动时把现存的 homesense-timeline.db 自动
  // 注册为"默认租户"(id=default,name=我的家),后续 user/记忆等表加在该
  // 现有 db 上,messages 历史不丢。新用户/新租户走 createTenant() 独立库。
  // 见 docs/v3/CLOUD-EDGE-BLUEPRINT.md §5.3。
  const { ensureDefaultTenant } = await import("@/lib/tenant-store");
  const ensured = ensureDefaultTenant();
  if (ensured) {
    console.log(`[tenant] 默认租户已就绪: id=${ensured.id} name=${ensured.name} db=${ensured.dbPath}`);
  }
}
