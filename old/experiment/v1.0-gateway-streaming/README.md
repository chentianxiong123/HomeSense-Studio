# HomeSense Studio

家庭智能体平台 — 双入口体验：Chat Surface（自然语言控制）+ Studio Surface（可视化工作流编排）。

## 快速启动

```bash
# 安装依赖
npm install

# 安装 Python CLI 依赖
cd packages/mi-cli && uv sync && cd ../..

# 启动开发环境
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3000

## 项目结构

```
packages/
├── backend/     # TS 后端 (Fastify + better-sqlite3 + Zod)
├── frontend/    # Vue 3 前端 (Vite + NaiveUI + Vue Flow)
└── mi-cli/      # Python CLI (米家设备控制, phone-mcp 风格 run+JSON)
```

## 技术栈

- **后端**：TypeScript + Fastify + better-sqlite3 + @fastify/websocket + Zod + OpenAI SDK
- **前端**：Vue 3 + Vue Flow + NaiveUI + Vite
- **Python CLI**：Python 3.11+ + uv + httpx + pydantic
- **存储**：SQLite (better-sqlite3) + sqlite-vss + FTS5
