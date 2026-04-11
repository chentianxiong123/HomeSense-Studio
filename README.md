# HomeSense HAMI CLI Source

Home Assistant and XiaoAi automation source project for HomeSense.

This project mirrors the structure of a standalone CLI source repository:

- `main.py`: unified CLI entry
- `hami_cli/cli.py`: JSON CLI wrapper
- `build.py`: build script placeholder for generating a Windows executable
- `SKILL.md`: source-side workflow notes

## Quick Start

```powershell
cd D:\files\HomeSense\homesense-hami-cli-source
python main.py run "{\"action\":\"xiaoai_speak\",\"text\":\"你好\"}"
```

## Project Goal

This source repo wraps the existing implementation in `D:\files\HomeSense\agent\src\tools\hami\hami.py`
and presents it as an independent project that can later produce a release package such as
`homesense-hami-cli-skill-windows-amd64`.
