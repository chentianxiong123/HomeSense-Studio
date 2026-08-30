# HomeSense Studio - 交接文档（第二轮）
> 2026-05-31 | Commit: 84fdd24

## 本轮成果概述

在第一轮框架搭建的基础上，完成了 **L2 自增强闭环** 的核心链路、视觉层接入、音箱登录、旧模块清理、Workflow 节点扩展。共 11 个提交，全部测试通过。

## 提交清单

| Commit | 类型 | 内容 |
|--------|------|------|
| `c3c17b6` | feat | L2 召回链路：embedding 激活、intent fingerprint、系统工具、context trim 修复 |
| `62b4c92` | feat | 闭环反馈：confirm_outcome、report_outcome、错误重试 prompt |
| `1f61a8c` | feat | wait_until 条件等待工具（系统层） |
| `5a70312` | feat | PlanStepDefinition 支持 delay_ms 和 wait_condition |
| `2701a18` | feat | 视觉层：真实 vision provider (pie-xian)、OpenCV 模板缓存、模型 seeding |
| `a74dae5` | feat | 音箱登录 UI：集成页小米账号 QR 登录面板 |
| `72b51cb` | refactor | 删除 a2a-client 模块、禁用 devtest 路由 |
| `7e264d5` | feat | Workflow 节点扩展：wait_until、http_request、human_input（19 种节点） |
| `48dff8d` | fix | **L2 写入侧断裂修复** — path candidate 持久化 + knowledge compiler 编译经验路径 |
| `84fdd24` | fix | seedDefaultProviders 修复：强制更新旧 provider key 和 model default 状态 |

## 关键架构变更

### L2 自增强闭环（完整链路）

```
[写入侧]
Chat 执行成功
  → path-candidate.ts 抽取路径 + intent_fingerprint
  → memoryAssetsService.recordExperiencePath() 存入 DB ← 本轮修复
  → knowledgeCompiler.compileExperiencePaths() 编译为 compiled_plan ← 本轮新增
  → memoryKernel.rebuildCompiledKnowledgeEmbeddings() 生成向量
  → 每 10 分钟自动刷新
[召回侧]
用户输入 → intent_fingerprint 精确匹配 (O(1), 零 API)
         → 向量召回 (embedding API, qwen3-embedding-8b)
         → LLM rerank (rerank API, qwen3-reranker-8b)
         → confidence ≥ 0.84 → 直接执行（跳过 LLM）
         → confidence < 0.84 → 注入 system prompt，LLM 决策

[执行侧]
支持 4 种 step 类型：
  - device_agent (rehearse → execute)
  - workflow (run_workflow)
  - adb-cli / mi-cli (CLI bridge)
步骤间支持 wait_condition (条件轮询) 或 delay_ms (固定延迟)

[反馈侧]
  - confirm_outcome: LLM 主动问用户"成功了吗？"
  - report_outcome: 写入 success/failure 计数 + memory observation
  - 失败后 LLM 继续尝试其他路径（不终止）
```

### Intent Fingerprint（第一性原理匹配）

不依赖自然语言相似度，而是从**执行结构**提取确定性标识：
- 写入侧：从 steps 中提取 `{device_id}:{capability_id}:{arg_hash}`
- 召回侧：从 Context Completer 输出构造同样格式的 key
- 精确匹配 → confidence 0.95+，零 API 调用

### 视觉层

```
识图降级链：
  1. DB 缓存 (app_map_elements) → 命中直接返回
  2. OpenCV 模板缓存 (opencv_templates) → 命中直接返回
  3. UI Tree (adb dump) → 结构化匹配
  4. 多模态 LLM (doubao-seed-1.6-flash) → 识别 + 存模板回流到 Level 2
```

### 系统工具（Chat 可调用）

| 工具 | 用途 |
|------|------|
| `set_timer` | 延时执行动作 |
| `remember` | LLM 主动写入长期记忆 |
| `confirm_outcome` | 执行后主动问用户结果 |
| `report_outcome` | 记录成功/失败到经验路径 + memory observation |
| `wait_until` | 条件轮询（app_foreground / ui_element_visible / device_online） |

### LLM 提供商

| 模型 | 用途 | API |
|------|------|-----|
| doubao-seed-1.6-flash | Vision（识图） | api.pie-xian.com |
| qwen3-embedding-8b | Embedding（向量化） | api.pie-xian.com |
| qwen3-reranker-8b | Rerank（重排序） | api.pie-xian.com |

三个模型在启动时由 `seedDefaultProviders()` 自动注册并设为默认。

### Workflow 节点（19 种）

| 类别 | 节点类型 |
|------|----------|
| trigger | start |
| device | device_control, xiaoai, ir_control, scene_execute, device_capability |
| logic | if_else |
| compute | llm, code, knowledge_retrieve, candidate_plan_resolve, rerank_score |
| control | delay, parallel, subflow, executor_call, agent_dispatch, wait_until, http_request, human_input |
| output | answer |

前端编辑器使用 Vue Flow，支持拖拽、连线、节点配置、运行、预览。

## 构建与测试

```bash
cd D:\files\HomeSense-Stdio

npm run -w backend build   # tsc 无错误
npm run -w backend test    # 25/25 测试文件，166/166 用例通过

npm run -w frontend build  # vite build 成功
npm run -w frontend test   # 26/26 测试文件，82/82 用例通过
```

## 新增文件

| 文件 | 用途 |
|------|------|
| `packages/backend/src/modules/intent-fingerprint/index.ts` | Intent fingerprint 生成和匹配 |
| `packages/backend/src/modules/system-tools/index.ts` | 系统工具：set_timer, remember, confirm_outcome, report_outcome, wait_until |

## 修改文件（关键）

| 文件 | 变更 |
|------|------|
| `packages/backend/src/app.ts` | 启动时 seed providers + embedding rebuild + 10 分钟定时刷新 |
| `packages/backend/src/modules/chat/graph.ts` | resolveExecutionStep 支持 device_agent/workflow；system tools 注入；wait_condition/delay_ms 执行；system prompt 增加闭环反馈指令 |
| `packages/backend/src/modules/chat/routes.ts` | path candidate 持久化到 DB |
| `packages/backend/src/modules/chat/path-candidate.ts` | 写入 intent_fingerprint 到 metadata |
| `packages/backend/src/modules/candidate-plan/index.ts` | collectCandidates 加入 fingerprint 匹配 |
| `packages/backend/src/modules/intent-router/index.ts` | gatherEvidence 加入 semanticSearch |
| `packages/backend/src/modules/knowledge-compiler/index.ts` | 新增 compileExperiencePaths() |
| `packages/backend/src/modules/knowledge-compiler/repository.ts` | 新增 listActiveExperiencePaths() |
| `packages/backend/src/modules/llm-provider/service.ts` | seedDefaultProviders 修复 key 和 default 更新 |
| `packages/backend/src/modules/vision-tools/opencv.ts` | OpenCV 模板缓存实现 |
| `packages/backend/src/modules/screen-understand/index.ts` | 接入模板缓存 + vision provider |
| `packages/backend/src/modules/workflow/node-definitions.ts` | 新增 wait_until, http_request, human_input 定义 |
| `packages/backend/src/modules/workflow/built-in-nodes.ts` | 新增 3 个节点实现 |
| `packages/backend/src/modules/workflow/node-factory.ts` | 注册新节点 |
| `packages/backend/src/modules/plan-library/index.ts` | PlanStepDefinition 增加 delay_ms, wait_condition |
| `packages/backend/src/modules/memory-assets/index.ts` | 新增 recordOutcome() |
| `packages/backend/src/modules/event-bus/index.ts` | 新增 TIMER_FIRED, OUTCOME_REPORTED 事件 |
| `packages/backend/src/db/index.ts` | 新增 opencv_templates 表 |
| `packages/frontend/src/views/IntegrationsView.vue` | 小米账号 QR 登录面板 |

## 删除文件

| 文件 | 原因 |
|------|------|
| `packages/backend/src/modules/a2a-client/index.ts` | 零引用，从未使用 |

## 已知限制和下一步

### 当前限制
- `graph_nodes` / `graph_edges`（记忆宫殿）表和 CRUD 存在，但未用于 UI 导航地图
- OpenCV 模板缓存是纯 DB 存储，没有真正的像素级模板匹配（需要 native OpenCV 或 JS 图像处理库）
- `human_input` workflow 节点是同步返回的，没有真正的暂停等待用户输入机制
- 经验模块的 `indexAllExperiences` 只在启动时运行，不在运行时触发

### 下一步建议
1. **视觉层深化**：把 screen-understand 的结果写入 graph_nodes/edges，构建 UI 导航地图
2. **端到端测试**：发真实消息 → 执行 → 确认 → 验证路径存储 → 再发同样意图 → 验证 fingerprint 命中
3. **Workflow 前端完善**：节点拖拽交互细节、运行历史页面、实时状态推送
4. **human_input 真正暂停**：workflow 运行时支持暂停等待用户输入后继续
5. **更新 docs/STATUS.md**：反映当前进度
