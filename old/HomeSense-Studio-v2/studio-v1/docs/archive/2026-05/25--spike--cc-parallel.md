# 2026-05-25 · CC 并行尝试

> ❌ 废弃 | 自动化测试

## 探索成果
- 尝试用 Claude Code `-p` 模式跑 HomeSense 自动化任务
- 全失败：429 限流、文件读取问题、npm install approval 超时
- 结论：Windows（git-bash + CcSwitch）环境下 CC `-p` 模式不稳定

## 技术栈
- Claude Code CLI（`-p` 模式）
- CcSwitch 代理（127.0.0.1:15721）

## 关键决策
- 放弃 CC 自动化，改为手写 → 更稳定，token 计数不受干扰

文件: 无（未修改代码）