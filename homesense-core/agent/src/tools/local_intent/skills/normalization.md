# Local Intent Normalization Skills

## Goal
把模糊但常见的说法归一到标准 intent。

## Current examples
- 返回 / 退回 -> navigate_back
- 主页 / 首页 -> go_home
- 打开电视 -> open_device
- 放歌 -> play_media

## Output shape
- intent
- confidence
- actions
- message

## Best fit
- 高频口语表达
- 轻度模糊输入
- 不需要大模型深度理解
