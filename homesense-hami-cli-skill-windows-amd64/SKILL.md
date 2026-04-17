---
name: homesense-hami-cli
description: "Home Assistant and XiaoAi automation via CLI. Use when the user needs smart-home voice, remote control, or Home Assistant actions."
---

# HomeSense HAMI CLI Skill

Control Home Assistant and XiaoAi actions through a single local launcher.

## Binary Path

The launcher is in the same directory as this skill file.

- Windows dev package: `hami-cli.cmd`
- Future release package: `hami-cli.exe`

## Common Commands

```powershell
<BIN> run "{\"action\":\"tv_remote\",\"device\":\"tvs_toshiba\",\"command\":\"电源\"}"
<BIN> run "{\"action\":\"xiaoai_speak\",\"text\":\"你好，编码测试。\"}"
<BIN> run "{\"action\":\"xiaoai_execute\",\"command\":\"打开客厅电视\"}"
```

## Workflow

1. Pick the action
2. Pass a compact JSON payload
3. Read the JSON result before deciding the next step
