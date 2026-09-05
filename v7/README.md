# v7 —— one-api 血统网关

v7 是 v6 架构的换代：**网关从 new-api 换成 one-api 血统**，v6 其余组件（picoclaw agent 引擎、每用户 SQLite 会话、前端、v6server 控制面）原样复用。

## 决策依据

- new-api 耦合度极低（v6server 仅 5 处 HTTP 触点），网关可整体替换
- one-api 原版 ~2.2 万行，代码面小、易魔改，符合平台诉求
- one-api 业务覆盖完全满足：多租户账号 / per-user token / 渠道管理 / 预扣计费 / 充值卡 / 自注册 / OAuth / SQLite+MySQL+PG

## 目录

- `v7/third_party/one-api`：one-api 源码（vendor，无 .git，上游 main 冻结于 2025-02-21，自行维护）
- 待建：v7 控制面（v6server 移植，网关触点指向 one-api）

## 迁移路线（v6 -> v7）

1. 搭建 one-api 实例：admin、CPA 渠道（Type=1 OpenAI, base `http://192.168.31.82:8317`, key `123456`, model `auto`）
2. 移植 v6server：`ModelList` 指向 one-api base；登录代理指向 one-api `/api/user/login`（同形）
3. 注册流程：用户在 one-api 注册 -> 自动签发 per-user key -> v6 元库存储
4. 复用 picoclaw/SQLite 会话/前端，验证链路：浏览器 -> v7控制面 -> one-api -> CPA

## 冻结基准

- v6 基准：tag `v6.0-newapi`（`0d8f6c1`），生产兜底，本目录开发期间 v6 保持不动
