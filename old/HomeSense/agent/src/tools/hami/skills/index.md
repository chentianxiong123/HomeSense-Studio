---
skill_id: hami.index
tool: hami
capabilities:
  - home.voice.execute
  - home.voice.speak
  - device.tv.remote.send
exposure_level: default
risk_level: medium
preconditions:
  - home_hub_available
---

# HAMI Skills Index

## Skill ID
`hami.index`

## Tool role
HAMI / Home Assistant 是 HomeSense 中负责家庭中枢、语音执行和部分遥控能力的能力域。

## Capability surface (v0)
- `home.voice.execute`
- `home.voice.speak`
- `device.tv.remote.send`

## Exposure policy
- 默认优先暴露中粒度家庭能力
- 不向上层暴露底层 websocket / service 调用细节
- 当命令可以通过家庭语音中枢稳定完成时，优先走本层，而不是让 planner 直接关注底层实现

## Progressive disclosure
优先只暴露：
- 执行家庭语音命令
- 让语音助手播报
- 发送电视遥控命令

更细的设备路由和家庭平台适配细节，后续再拆出子 skill。
