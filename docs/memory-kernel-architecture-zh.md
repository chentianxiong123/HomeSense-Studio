# MemoryKernel 架构说明

## 设计定位

HomeSense 的记忆系统不应只是“向量检索模块”。

它更准确的角色是：

- `ConversationSession` 负责短期上下文
- `MemoryKernel` 负责长期事实、经验索引、家庭知识图谱
- `KnowledgeCompiler` 负责把原始记忆和经验编译成可运行时消费的 `Wiki / Plan / Candidate`

这意味着记忆在代码边界上必须独立，但实现上可以继续使用 SQLite 全家桶。

## 当前实现

当前后端已经具备三层结构：

1. `embedding_profiles`
   负责记录 embedding 坐标系。
   系统会在首次启动时，根据 `embedding` 模型槽位创建 canonical profile。

2. `memory_entities / memory_attributes / memory_triples`
   负责持久化长期家庭知识。

3. `compiled_knowledge_items`
   负责承载编译后的知识结果。
   当前包含：
   - `wiki_page`
   - `compiled_plan`
   - `experience_note`
   - `workflow_candidate`

## embedding 规则

这个项目明确采用：

**embedding 可缺省停机，不可静默切换。**

也就是说：

- embedding 服务没准备好时，系统仍可运行
- 一旦 canonical profile 建立，后续不能因为供应商波动就自动换模型去查旧索引
- 如果以后真的要换 embedding 模型，应视为一次显式重建

这条规则比“是否本地部署”更关键，因为它保证长期记忆坐标系稳定。

## compiled wiki 的作用

`KnowledgeCompiler` 不是为了做大而全的离线管线，而是为了把系统从“运行时临时理解”往“运行前已整理好的知识”推进。

当前它会把这些东西编译出来：

- memory entity -> `wiki_page`
- experience -> `experience_note`
- high-importance experience -> `compiled_plan`
- workflow -> `workflow_candidate`

以后还可以继续扩展：

- `skill_candidate`
- `rule_candidate`
- `failure_playbook`
- `device_boot_sequence`

## 为什么这层重要

这层正好把你前面说的几条线串起来：

- 老项目三层机制
- LLM Wiki / compiler mode
- 家庭场景的低延迟与低 LLM 依赖
- Hermes 风格的经验沉淀
- Orra 风格的失败预演与补偿

一句话说：

**Chat 不应该背着所有历史跑；它应该站在 MemoryKernel 和 Compiled Wiki 上说话。**
