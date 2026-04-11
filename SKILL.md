---
name: homesense-hami-cli-source
description: "Source project for HomeSense HAMI CLI. Use when working on the HAMI CLI wrapper itself, packaging it, or exposing Home Assistant actions through JSON CLI."
---

# HomeSense HAMI CLI Source

This directory is the source project, not the installed skill package.

## Commands

```powershell
python main.py run "{\"action\":\"tv_remote\",\"device\":\"tvs_toshiba\",\"command\":\"电源\"}"
python main.py run "{\"action\":\"xiaoai_speak\",\"text\":\"你好\"}"
python build.py
```
