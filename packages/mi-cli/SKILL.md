---
name: mi-cli
description: "小米智能家居设备控制 CLI。AI Agent 通过此工具控制米家设备、获取设备状态、管理认证。"
allowed_tools:
  - mi-cli
context_mode: inline
---

# mi-cli 技能

## 工具入口

此目录包含 `mi-cli` 二进制包和本 SKILL.md。AI Agent 通过 `mi-cli run '<json>'` 调用。

## 快速工作流

```
1. login_qr          → 扫码登录（首次）
2. discover summary_only → 发现所有设备 + 能力
3. device_info       → 查单个设备详情
4. device_action / device_prop → 控制设备
```

## Actions

### 认证
| Action | 描述 |
|--------|------|
| `login_qr` | 生成二维码，扫码登录米家账号 |
| `login_status` | 查询当前登录状态 |
| `login_logout` | 退出登录 |

### 设备发现
| Action | 描述 | 参数 |
|--------|------|------|
| `discover` | 发现所有设备 | `summary_only?` 返回摘要 |
| `device_info` | 查询单个设备 | `did?` 或 `name?` |

### 设备控制（AI 推荐）
| Action | 描述 | 参数 |
|--------|------|------|
| `device_action` | 执行设备动作 | `did`, `capability`, `params?` |
| `device_prop` | 读写设备属性 | `did`, `capability`, `value?`（空=读，有=写） |

### 小爱音箱
| Action | 描述 | 参数 |
|--------|------|------|
| `speaker_list` | 列出音箱 | — |
| `speaker_execute` | 执行语音指令 | `text`, `did?`, `silent?` |
| `speaker_play` | 朗读文本 | `text`, `did?` |

### 红外控制
| Action | 描述 | 参数 |
|--------|------|------|
| `discover_ir` | 发现红外子设备 | `parent_did` |
| `ir_get_keys` | 获取按键列表 | `controller_id` / `did` |
| `ir_press_key` | 发送红外按键 | `controller_id` / `did`, `key_id` |

### 底层（调试用）
`get_prop`, `set_prop`, `run_action`, `spec_parse`, `scene_execute`

## 输出格式

所有命令返回统一结构：

```json
{"status": "success", "data": {...}}
{"status": "error", "error": "DEVICE_NOT_FOUND", "message": "..."}
```

**status=success 时**：返回结果在 `data`
**status=error 时**：`error` 是错误码，`message` 是中文说明

## 错误处理

| 错误码 | 含义 | 下一步 |
|--------|------|--------|
| AUTH_FAILED | 未登录 | login_qr |
| TOKEN_EXPIRED | Token 过期 | login_qr |
| DEVICE_NOT_FOUND | 设备不存在 | discover |
| CAPABILITY_NOT_FOUND | 设备不支持该能力 | discover 查看 capabilities |
| AMBIGUOUS | name 匹配多台设备 | 用 did 精确指定 |
| DEVICE_OFFLINE | 设备离线 | 检查设备电源 |
| NETWORK_TIMEOUT | 网络超时 | 重试 |

## 使用示例

### 发现设备
```json
{"action": "discover", "summary_only": true}
```
返回：
```json
{
  "status": "success",
  "data": {
    "summary": [
      {"did": "ir.xxx", "name": "东芝电视", "device_type": "television",
       "capabilities": {"actions": ["turn_on","turn_off","volume_up"], "properties": []}}
    ],
    "count": 7
  }
}
```

### 查单个设备
```json
{"action": "device_info", "name": "东芝"}
```

### 控制设备
```json
{"action": "device_action", "did": "ir.2038224602945437696", "capability": "turn_on"}
{"action": "device_action", "did": "ir.2038224602945437696", "capability": "volume_up"}
{"action": "device_prop", "did": "2022039970", "capability": "power", "value": false}
```

### 小爱音箱放音乐
```json
{"action": "speaker_execute", "text": "放点流行音乐", "did": "108654953"}
{"action": "speaker_execute", "text": "暂停", "did": "108654953"}
```

## 设备能力参考

**通用动作**：turn_on, turn_off, toggle, volume_up, volume_down, channel_up, channel_down, mute_on, mute_off, play, pause, next, previous

**通用属性**：power, brightness, volume, temperature, humidity, mode, fan_speed, cover_position

**音箱专属**：play_music, play_radio, execute_directive（发中文语音指令）