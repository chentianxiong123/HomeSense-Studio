---
name: device_skill.speaker
description: "Operate smart speakers such as XiaoAi through text playback, music playback, volume, and natural-language forwarding."
device_type: speaker
title: "音箱 / 小爱"
status: active
load_policy: on_device_type_match
allowed_tools:
  - get_device_capabilities
  - rehearse_device_capability
  - execute_device_capability
context_mode: inline
---

# 音箱 / 小爱

## When to load
- 播放音乐
- 让小爱说话
- 语音控制家电
- 音量调整
- 播报文本

## Progressive disclosure
1. 先确认目标音箱。
2. 读取真实能力，确认是否支持播放文本、执行文本命令、播放音乐或音量调整。
3. 文本类能力必须先补齐 `text`。
4. 不确定文本是否合适时先沙箱演练。
5. 演练通过后真实执行。

## Common paths
### 播放或播报文本
- 确认音箱设备。
- 补全文本参数。
- 沙箱演练播放文本。
- 真实执行。

### 用音箱转发智能家居指令
- 确认音箱设备。
- 构造短而明确的自然语言指令。
- 沙箱演练 `speaker_execute`。
- 真实执行。

## Argument rules
- `play_text` 需要 `text`。
- `execute_text` 需要 `text`，内容应是给音箱的自然语言指令。
- `play_music` 可选 `text`；没有指定时播放默认音乐。

## Failure recovery
- 音箱无响应时检查 MI 绑定。
- 语音指令失败时改用更短、更明确的文本。
