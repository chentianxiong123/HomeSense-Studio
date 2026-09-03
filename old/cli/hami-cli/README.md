# HomeSense HAMI CLI Source

Home Assistant and XiaoAi automation source project for HomeSense.

This project mirrors the structure of a standalone CLI source repository:

- `main.py`: unified CLI entry
- `hami_cli/cli.py`: JSON CLI wrapper
- `config.json`: websocket URL, token, and entity mapping table
- `build.py`: build script placeholder for generating a Windows executable
- `SKILL.md`: source-side workflow notes

## Quick Start

```powershell
cd D:\files\HomeSense\homesense-hami-cli-source
python main.py run "{\"action\":\"xiaoai_speak\",\"text\":\"你好\"}"
```

## Config Import

Fill [config.json](/D:/files/HomeSense/homesense-hami-cli-source/config.json) with:

- `home_assistant.url`
- `home_assistant.token`
- `devices.*.entity_id`
- `device_aliases`

That lets you manually paste websocket address, token, and entity IDs from Home Assistant Developer Tools without editing code.

## How To Find The Values

### 1. Find `home_assistant.url`

If your Home Assistant web address is:

```text
http://192.168.31.204:8123
```

then the websocket URL is usually:

```text
ws://192.168.31.204:8123/api/websocket
```

If you use HTTPS, then use `wss://.../api/websocket`.

### 2. Find `home_assistant.token`

In Home Assistant:

1. Open your profile page
2. Scroll to `Long-Lived Access Tokens`
3. Create a new token
4. Paste it into `config.json`

### 3. Find entity IDs

In Home Assistant:

1. Open `Developer Tools`
2. Open `States`
3. Search the device you want
4. Copy the entity ID

Examples:

- `select.remote_ir_2038224602945437696`
- `select.remote_ir_2038476279661080578`
- `select.remote_ir_2038581922699296768`
- `text.xiaomi_lx5a_5dfb_execute_text_directive`
- `text.xiaomi_lx5a_5dfb_play_text`

Suggested mapping:

- TV remote entities go into `devices.tvs_toshiba`, `devices.stb`, `devices.tv_letv`
- XiaoAi text entities go into `devices.xiaoai_execute_text_directive` and `devices.xiaoai_play_text`

## Project Goal

This source repo wraps the existing implementation in `D:\files\HomeSense\agent\src\tools\hami\hami.py`
and presents it as an independent project that can later produce a release package such as
`homesense-hami-cli-skill-windows-amd64`.
