# HomeSense Studio · 当前状态
> 更新: 2026-05-26

## 当前主线
聊天入口 + LLM 流式对话（纯聊天，无工具调用/agent 编排）

## 正在做
*（无）*

## 短期功能（已确定要做）
- [ ] 暂无

## 技术探索（不确定，可能做）
- [ ] Mimo Proxy 推理链修复（DeepSeek-V4 工具调用断裂）
- [ ] 多设备联动场景

## 已知问题
- Claude Code -p 模式在 Windows（git-bash + CcSwitch）上不稳定（429 限流 / npm install approval 超时）

## 关键决策
- 思考链不存 DB，SSE 实时展示
- 纯聊天模式，不走 agent runtime
- 独立 chat.db（与 homesense.db 分离）
- 不分会话，消息平铺——单用户助手场景不需要会话概念
- 游标分页（基于 message id），不用 OFFSET
- 普通滚动，不用虚拟滚动

## 归档
- `archive/2026-05/25--design--chat-architecture.md`
- `archive/2026-05/25--feat--chat2-backend.md`
- `archive/2026-05/25--feat--chatview-frontend.md`
- `archive/2026-05/25--spike--cc-parallel.md`
- `archive/2026-05/26--feat--llm-management.md`
- `archive/2026-05/26--feat--chat-module-migration.md`
- `archive/2026-05/26--feat--llm-usage-stats.md`
- `archive/2026-05/26--feat--history-lazy-load.md`
- `archive/2026-05/26--feat--remove-conversation.md`
