# Local Intent Context Skills

## Goal
在 Fast Layer 内直接利用最近上下文做最小补全。

## Current context usage
- recentMentionedDevices
- 最近提到的电视 / 机顶盒 / 小爱音箱

## Current examples
- 打开它
- 让它继续播放
- 刚刚那个设备

## Important boundary
如果上下文依赖过强、歧义过大、或需要跨设备复杂推理，应继续进入：
- success_paths
- llm_agent
