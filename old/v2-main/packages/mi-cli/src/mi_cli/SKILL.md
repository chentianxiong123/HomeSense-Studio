---
name: mi-cli
description: "小米智能家居设备控制 CLI。用于控制米家设备、获取设备状态、管理认证。"
allowed_tools:
  - mi-cli
context_mode: inline
---

# mi-cli 技能

## Binary Path
`mi-cli` binary is in the same directory as this SKILL.md file.

## Actions

### 认证
| Action | 描述 | 参数 |
|--------|------|------|
| `login_qr` | 生成扫码登录二维码 | 无 |
| `prepare_login` | 兼容别名，准备二维码登录 | 无 |
| `login_status` | 查询登录状态 | 无 |
| `login_logout` | 退出登录 | 无 |

### 设备发现（AI 推荐）
| Action | 描述 | 参数 |
|--------|------|------|
| `discover` | 发现设备，`summary_only=true` 只返回摘要 | renew?, **summary_only?** |
| `device_info` | 查询单个设备详情 | **did?** 或 **name?** |

示例：
```json
{"action": "discover", "summary_only": true}
{"action": "device_info", "name": "东芝"}
{"action": "device_info", "did": "108654953"}
```

`discover` 返回：
```json
{
  "status": "success",
  "data": {
    "summary": [{"did": "...", "name": "东芝电视", "capabilities": {"actions": ["turn_on", ...], "properties": []}}],
    "count": 7
  }
}
```

`device_info` 返回：设备名、型号、厂商、房间、home、capability 列表 + 详细 siid/aiid/piid 映射。

### 设备控制

使用 capability 名称控制设备，无需关心底层 MIoT 协议 ID。

| Action | 描述 | 参数 |
|--------|------|------|
| `device_action` | **执行设备能力**（如 turn_on、volume_up、play） | did, capability, params? |
| `device_prop` | **读取或写入属性**（如 power、brightness、temperature） | did, capability, value? |

示例：
```json
{"action": "device_action", "did": "108654953", "capability": "play"}
{"action": "device_prop", "did": "2022039970", "capability": "power"}
{"action": "device_prop", "did": "2022039970", "capability": "power", "value": false}
```

可用 capability 列表：
- **动作**: turn_on, turn_off, volume_up, volume_down, channel_up, channel_down, mute_on, mute_off, input_source, toggle, play, pause, next, previous, play_music, play_radio, execute_directive
- **属性**: power, brightness, color_temperature, target_temperature, mode, fan_speed, cover_position, volume, temperature, humidity, pm2_5, download_speed, upload_speed, connected_devices

### 设备控制（底层 — 调试用）
| Action | 描述 | 参数 |
|--------|------|------|
| `get_prop` | 获取设备属性值 | did, siid, piid |
| `set_prop` | 设置设备属性值 | did, siid, piid, value |
| `run_action` | 执行设备动作 | did, siid, aiid, params? |
| `discover_ir` | 发现红外子设备 | parent_did |
| `scene_execute` | 执行米家手动场景 | scene_id? / scene_name?, home_id? |

### 小爱音箱
| Action | 描述 | 参数 |
|--------|------|------|
| `speaker_list` | 列出小爱音箱 | 无 |
| `speaker_execute` | 执行语音指令（发中文） | text, silent?, did? |
| `speaker_play` | 朗读文本 | text, did? |
| `speaker_status` | 播放状态（实验） | did? |

**重要**: 小爱音箱控制用 `speaker_execute text:"暂停"` 而不是 `device_action capability:"pause"`。

### 红外控制
| Action | 描述 | 参数 |
|--------|------|------|
| `ir_discover` | 发现红外遥控器 | parent_did |
| `ir_get_keys` | 获取按键列表 | controller_id / did |
| `ir_press_key` | 发送红外按键 | controller_id / did, key_id |

### 其他
| Action | 描述 | 参数 |
|--------|------|------|
| `scene_list` | 列出米家手动场景 | home_id? |
| `spec_parse` | 解析设备规格 | model |
| `config_get` | 获取配置 | key? |
| `config_set` | 设置配置 | key, value |

## Batch Execution
传 JSON 数组，**遇错停止**。
```bash
mi-cli run '[{"action":"discover","summary_only":true},{"action":"device_info","name":"东芝"}]'
```

## Error Handling
| Error | 说明 | 下一步 |
|-------|------|--------|
| AUTH_FAILED | 认证失败 | login_qr |
| TOKEN_EXPIRED | Token 过期 | login_qr |
| DEVICE_OFFLINE | 设备离线 | 检查设备 |
| DEVICE_NOT_FOUND | 设备未找到 | discover |
| AMBIGUOUS | 多个设备匹配 name | 用 did 精确指定 |
| NETWORK_TIMEOUT | 网络超时 | 重试 |
| INVALID_PARAMS | 参数无效 | 检查参数 |
| ACTION_NOT_FOUND | Action 不存在 | 检查 capability 名称 |
| CAPABILITY_NOT_FOUND | 设备不支持该能力 | discover 查看设备 capabilities |
| CLI_ERROR | CLI 内部错误 | 重试 |