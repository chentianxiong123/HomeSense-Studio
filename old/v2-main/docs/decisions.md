# HomeSense 决策记录

> 2026-06-06 起，HomeSense 进入"短路径"阶段。本文件记录拍板的设计决策，每条都要可执行、可验证、可回滚。
> 谁以后（包括 AI 助手）要改 HomeSense 的形状，先读这份文件。

## 1. 设备是 JSON，JSON 是孪生

设备的完整状态就一张 JSON：

```json
{
  "id": 1,
  "name": "客厅电视",
  "props": {
    "mi_did": "ir.xxx",
    "adb_ip": "192.168.31.91:5555",
    "ssh": { "host": "192.168.x", "port": 22, "user": "root" },
    "bluetooth": { "mac": "AA:BB:..." },
    "stream": { "url": "moonlight://..." },
    "capabilities": [
      { "name": "turn_on", "executor": "mi.turn_on" }
    ]
  }
}
```

**没有"孪生数据 vs 设备数据"**。设备 JSON 就是孪生。详情页是孪生的读视图，2D 画布上的节点也是。

## 2. props 完全自由，无白名单

- 不预设 `mi_did / adb_ip / device_type` 这些列
- 不限制 props 里的键，新加 SSH / 串流 / 蓝牙 / 任何东西 = 新加一个键
- 后端**不校验**"这是什么键"——但**做类型安全**（key 是字符串、对象是合法 JSON）
- 没有 `device_type` enum，类型是 props 里的一个自由字符串或直接没有

## 3. 能力来源在 `/authorizations`，绑定在详情页

- **能力源登记**（mi 账号 / ADB 端点 / SSH 凭据 / 串流服务）—— **/authorizations 统一认证中心**
- **设备绑定**（一个具体设备连上一个能力源）—— **/devices/:id 详情页**
- **两个入口，不增不减**

详情页**不"添加能力"**。详情页只**添加端点**——用户从已登记的能力源里选一个，写进 `device.props`。

能力是端点**自带的**。详情页不维护能力清单，能力跟着端点走。

## 4. 详情页按 props 键决定显示什么面板

- 看到 `props.ssh` → 终端面板
- 看到 `props.stream` → 串流面板
- 看到 `props.files` → 文件管理面板
- 看到 `props.screenshot_url` → 图片面板
- 等等

**面板是 .vue 文件，写死在详情页里**。新加面板 = 新加一个 .vue + 一行 `v-if`。**没有注册层**。

理由：HomeSense 是自托管的，不是分发给别人的 SDK；新加面板需要重启服务，是开发时扩展不是运行时扩展。

## 5. 2D 房间画布是数字孪生的第一版

- 节点 = 设备 JSON
- 房间 = 房间 JSON
- 点节点 = 进详情页
- 不做拖拽 / 不做精准户型 / 不做 GPS
- 设备位置手摆

## 6. 老项目留下来的好做法

- 老项目（HomeSense-Stdio）的"外部能力源登记"表单（name / kind / endpoint / capabilities）—— **HomeSense 已经在 /authorizations 做了**。能力源是数据，不是代码。
- 老项目 mi-cli 的 `CAPABILITY_REGISTRY` 字典（key → { kind, name_cn, aliases, value_type, domains }）—— 这套映射思想保留，新 HomeSense 通过 mi-cli 改造对齐

## 7. 不要做的事（持续维护的反模式清单）

- ❌ 不要 `v1 / v2` 这类版本名。HomeSense 是 HomeSense，没有"再来一版"
- ❌ 不要 `device_type` enum。设备类别由 props 里的键决定，不由 enum 决定
- ❌ 不要 `mi_did / adb_ip` 作为表列。都是 props 里的键
- ❌ 不要能力"白名单"。props 自由
- ❌ 不要注册层、契约、注入器、形态——这些词不进 HomeSense
- ❌ 不要"未来兼容"的设计。HomeSense 只解决当前问题
- ❌ 不要"基础能力 + 扩展能力"两层。所有能力扁平存进 `props.capabilities`
- ❌ 不要 capability 的版本号。存的是事实

## 8. 验证方式

- 后端：`pnpm --filter @hs/server typecheck`
- 前端：`pnpm --filter @hs/web exec vite build`
- 端口：server 3000，web 5173

## 9. 待办（已确认方向未动手）

- [ ] /devices 详情页加"绑定面板"（选未绑定的端点 → 写进 props）
- [ ] 2D 房间画布（手摆设备位置）
- [ ] props 完全自由化改造（user_devices 改 props 字段，一次性迁移）
- [ ] mi-cli 改造为返回"能力 + executor 字符串"，不再返回中文名 + 域
- [ ] README 改写对齐本决策
