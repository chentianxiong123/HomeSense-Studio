---
skill_id: hami.tv_power
tool: hami
capability: home.voice.execute
exposure_level: default
risk_level: medium
---

# 打开电视技能

## 目标
通过小爱音箱的红外功能打开电视。

## 设备
- **东芝电视** (Toshiba)
- **小米小爱音箱** (红外遥控版)

## 命令格式

```bash
{"action": "xiaoai_execute", "command": "打开电视"}
```

或使用完整的红外命令：

```bash
{"action": "xiaoai_execute", "command": "开机"}
```

## 常用命令

| 意图 | 命令 |
|------|------|
| 打开电视 | "打开电视" |
| 关闭电视 | "关闭电视" |
| 开机 | "开机" |
| 关机 | "关机" |

## 工作流程

1. 发送 xiaoai_execute 命令
2. 小爱音箱接收红外信号
3. 电视/机顶盒开机

## 注意事项

- 需要确保小爱音箱红外功能已配对
- 电视和机顶盒需要在红外遥控范围内
