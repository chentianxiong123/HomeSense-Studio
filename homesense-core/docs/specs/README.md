# HomeSense

1. 先读 `PROJECT_SUMMARY.md`
2. 再读 `CONTRACT_FREEZE_V0_1_2026-04-08.md`
3. 再读 `PARALLEL_WORKSTREAM_ASSIGNMENT_2026-04-08.md`
4. 按 `AGENTS.md` / `CLAUDE.md` 执行开发

HomeSense is a local-first smart home agent project focused on natural-language control, tool routing, and reusable execution experience.

HomeSense 是一个本地优先的智能家居 Agent 项目，目标是把自然语言控制、工具路由、经验复用和可扩展自动化能力结合在一起。

## Status / 当前状态

This repository is an active prototype.

Current main parts:
- `agent/`: Fastify + LangGraph based backend orchestrator
- `homesense-frontend/`: Vue 3 + Vite frontend
- `docs/specs/ARCHITECTURE_V0_1.md`: current architecture draft
- `PROJECT_SUMMARY.md`: project overview and notes

## Repository Structure / 仓库结构

```text
HomeSense/
├── agent/                              # Backend agent service
├── homesense-frontend/                 # Frontend UI
├── docs/specs/ARCHITECTURE_V0_1.md     # Architecture draft
├── PROJECT_SUMMARY.md                  # Project summary
├── start-backend.ps1                   # Start backend on Windows PowerShell
├── start-frontend.ps1                  # Start frontend on Windows PowerShell
└── start-all.ps1                       # Start both services
```

## Backend / 后端

Backend stack:
- Fastify
- LangGraph / LangChain
- TypeScript
- SQLite / local file persistence
- Python wrappers for device tools

Main routing idea:
- `rule_engine`
- `local_intent`
- `success_paths`
- `llm_agent`
- `tool_executor`
- `write_back`

## Frontend / 前端

Frontend stack:
- Vue 3
- Vite
- TypeScript
- Naive UI
- Pinia

Current pages:
- Chat
- Devices
- Config / Governance

## Quick Start / 快速开始

### 1) Backend

```bash
cd agent
npm install
npm run build
npm start
```

Default backend endpoint:
- `http://127.0.0.1:3000`

### 2) Frontend

```bash
cd homesense-frontend
npm install
npm run dev
```

Default frontend dev server is provided by Vite.

## Configuration / 配置说明

This repository intentionally does **not** include real local tokens, private service addresses, or build artifacts.

本仓库已移除真实密钥、私有地址、本地构建产物与依赖目录。

Before running locally, update these files with your own environment:
- `agent/.env.example`
- `agent/src/tools/adb/config.yaml`
- `agent/src/tools/hami/config.yaml`
- `agent/src/tools/llm_agent/config.yaml`
- `homesense-frontend/.env`

## Publishing Notes / 发布说明

Excluded from this repository:
- `docs/history/References/`
- `.claude/`
- `.trae/`
- `node_modules/`
- `dist/`
- local runtime data
- binary artifacts
- private tokens and local-only config

## Development Notes / 开发说明

This codebase is evolving quickly. The current focus is:
- stabilize the chat mainline
- improve success path retrieval and deep fallback
- keep graph logic thin and tool-first
- avoid noisy auto-persistence from transient test inputs

## License / 许可证

No license file has been added yet.
If you want, add a license before making the repository broadly reusable.
