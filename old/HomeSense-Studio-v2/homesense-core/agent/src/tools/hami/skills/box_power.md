---
skill_id: hami.box_power
tool: hami
capability: home.voice.execute
exposure_level: default
risk_level: medium
---

# 打开机顶盒技能

## 目标
通过小爱音箱的红外功能打开机顶盒。

## 设备
- **IPTV 机顶盒** (运营商盒子)
- **小米小爱音箱** (红外遥控版)

## 命令格式

```bash
{"action": "xiaoai_execute", "command": "打开机顶盒"}
```

## 常用命令

| 意图 | 命令 |
|------|------|
| 打开机顶盒 | "打开机顶盒" |
| 关闭机顶盒 | "关闭机顶盒" |
| 打开电视盒子 | "打开电视盒子" |

## 工作流程

1. 发送 xiaoai_execute 命令
2. 小爱音箱发射红外信号
3. 机顶盒开机

## 注意事项

- 需要确保小爱音箱红外功能已配对
- 机顶盒需要在红外遥控范围内
- 部分机顶盒可能需要等待 5-10 秒完全启动
