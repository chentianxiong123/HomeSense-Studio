# Agent / Skill / CLI 模式定调

日期：2026-06-13
状态：当前阶段收尾。下一步专注于媒体和智能家居的稳定性。

## 项目核心定位

HomeSense 是一个浏览器驱动的家庭智能操作系统，**核心永远是 Agent / AI**，其他一切（设备、媒体、文件、终端、workflow、n8n）都是 Agent 可调用的舞台。

- Agent 是主角。
- Skill 是 Agent 看到的抽象。
- CLI / Driver / Service 是 Skill 的实现细节。
- Workflow / n8n / 录制系统 是后续的副产物，不是这一阶段的目标。

## 已经定下的方向

1. **Skill + CLI 模式**
   - Agent 不直接看到底层 CLI 工具，也不会以 MCP 或"系统工具"的形式暴露。
   - Agent 只认识 Skill。每个 Skill 描述一组相关能力，对应一个或多个 CLI 包的 action。
   - 调用时 Agent 说"用 media-cli 的 resource_search"，HomeSense 翻译为 `cliBridge.run(...)`。

2. **Skill 描述落地**
   - 每个 `packages/xxx-cli/` 自带一个 `SKILL.md` 或 `skill.json`。
   - HomeSense 启动时扫描 `packages/*/SKILL.md`，动态形成 Agent 可见的能力清单。
   - 不发明注册中心、不发明总线、不发明插件系统。

3. **稳定优先**
   - 在 Skill 模式没跑通、媒体和智能家居没稳定之前，不引入新体系。
   - 暂缓的复杂方向后续再回来评估。

## 暂缓 / 不做（这一阶段）

- n8n 嵌入或 B' 方案。`packages/n8n-runtime/` 不进主流程，裁剪包保留在 `D:\files\References\workflow\n8n-homesense-runtime` 作参考。
- 录制 + 修剪工作流。
- Agent 自动生成并固化 workflow。
- 向量小模型意图归一。
- 自定义 n8n 节点。
- 跨协议文件系统复制在 L2 workflow 层的暴露。
- LLM Studio / Memory / Studio / Chat 的改动（v2 核心冻结）。

## 当前 CLI / Driver 状态

| 工具 | 形态 | Skill 描述 | 备注 |
|---|---|---|---|
| `mi-cli` | Python CLI | `packages/mi-cli/SKILL.md` | 已有人写的 Markdown skill |
| `adb-cli` | Python CLI | 缺 | `capabilities` 已存在于 `cli.py` |
| `media-cli` | Python CLI | 缺 | `ACTION_MAP` 已存在于 `cli.py` |
| `alist-driver` | Go CLI | 缺 | 5 个 action 是固定的：health/list/get/remove/copy |
| 终端 SSH / Local / ADB | NestJS 协议 | 缺 | 通过 WebSocket 网关 |
| SFTP / WebDAV / SMB / NFS | NestJS 存储层 | 缺 | 通过 `/api/storage/*` |

## 下一步路线（只做这一件事）

让媒体和智能家居先稳定。

具体落地：

1. **补 Skill 描述（机器可读）**
   - `media-cli` 补 `SKILL.md` / `skill.json`，覆盖 `search`、`resolve_audio`、`dlna_*`、`resource_*`、`sniff_url`。
   - `adb-cli` 补 `SKILL.md` / `skill.json`，覆盖 `device_*`、`tap_*`、`scrcpy_*`、文件类。
   - `alist-driver` 补 `SKILL.md` / `skill.json`，5 个 action + 2 个 driver（local / webdav）。
   - 终端协议和存储层可以之后再补，优先级低于媒体 / 智能家居。

2. **媒体稳定性**
   - DLNA 投屏：发现、播放、暂停、音量、状态查询在小爱音箱 / 标准 DLNA 渲染器上反复跑。
   - Bilibili 代理音频：解析、缓存、代理 URL、过期。
   - 资源嗅探：URL 嗅探成功率、解析后 URL 在本机 / DLNA / 投屏链路上的可用性。
   - 播放队列持久化：刷新、关闭浏览器后状态恢复。

3. **智能家居稳定性**
   - 米家登录：二维码、ticket 验证、token 持久化、token 过期重登。
   - 设备发现 + 能力缓存：缓存失效后的恢复路径。
   - 设备控制：开关、调光、空调、风扇、覆盖类等典型能力的小时级长稳。
   - 小爱音箱：speaker_list、speaker_status、play_url、control 多次重试下的稳定性。
   - 红外：IR 设备发现 + 按键缓存 + 重复按键抖动。

4. **不要做的事**
   - 不要在稳定性没出来之前改任何 v2 核心代码。
   - 不要碰 LLM Studio / Memory / Studio / Chat。
   - 不要开始 n8n / workflow / 录制 / 修剪 / 意图归一。

## 待办（按优先级）

- [ ] `packages/media-cli/SKILL.md` —— 最优先，媒体稳定性之前要写。
- [ ] `packages/adb-cli/SKILL.md` —— 第二优先，ADB 设备使用前要写。
- [ ] `packages/alist-driver/SKILL.md` —— 第三，文件管理上线前补。
- [ ] 媒体 / 智能家居稳定性用例清单。
- [ ] 媒体 / 智能家居的回归记录表（手动跑过的步骤 + 结果）。

## 复盘点

- 之前一度想把 n8n 接入做成 L2 workflow 的执行后端，又要做"录制+修剪"。这条路本身合理，但**当前阶段没有能力支撑**。放弃，保留裁剪包作参考。
- 之前讨论过"统一工作流执行器"，被自己写的 350 行玩具 vs n8n 重引擎拉扯。结论：**当前阶段不解决，等到有真正的可沉淀场景时再回来。**
- 之前讨论过"统一能力发现"做成 Agent 工具注册。**否决**：用户明确 Agent 只认 Skill + CLI，不做 MCP / 系统工具注册。
- 之前讨论过"Action Trace Recorder"。**暂缓**：录制是工作流固化的前置，但工作流固化整体暂缓，所以录制系统也暂缓。

## 复盘原则

- **核心永远在 Agent**。任何方案如果让 Agent 失去主体地位，拒绝。
- **不加新概念**。Skill、CLI、Action 三层已经够，再加就是负担。
- **不复用就暂缓**。某个能力在 v2 核心没稳定之前不要引入新依赖。
- **稳定性先于新功能**。能稳定跑一天再说。
