# LLM Agent Tooling Skills

## Goal
当 Deep Layer 需要真正执行时，把规划转成候选动作。

## Current state
当前已经支持：
- 输出 suggested_actions
- graph 可根据 suggested_actions 进入 tool_executor

## Typical use
- 回到主界面 -> adb.home
- 返回上一页 -> adb.back
- 打开电视 / 机顶盒 -> hami.xiaoai_execute

## Future direction
- 不只给建议动作
- 要支持真实 tool use 循环
