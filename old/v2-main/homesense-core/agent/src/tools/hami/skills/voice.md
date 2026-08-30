---
skill_id: hami.voice
tool: hami
capabilities:
  - home.voice.execute
  - home.voice.speak
exposure_level: progressive
risk_level: medium
preconditions:
  - home_hub_available
---

# HAMI Voice Skills

## Skill ID
`hami.voice`

## Goal
把高层的家庭控制意图转成稳定的语音执行命令。

## Capability focus (v0)
- `home.voice.execute`
- `home.voice.speak`

## Preferred usage
适用于：
- 打开电视 / 机顶盒 / 音箱播放等家庭命令
- 适合通过语音中枢直接完成的动作

## Current mapping
- `home.voice.execute` -> `hami.xiaoai_execute`
- `home.voice.speak` -> `hami.xiaoai_speak`

## Exposure note
高层应理解 capability，不应直接依赖底层 `xiaoai_execute` / `xiaoai_speak` 名称。
