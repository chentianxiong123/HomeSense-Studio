---
name: adb-cli
description: "Virtual Android TV / ADB executor for HomeSense demo flows."
allowed_tools:
  - adb-cli
context_mode: inline
---

# adb-cli

## Actions

### Device Runtime
| Action | Description | Params |
|--------|-------------|--------|
| `wait` | Wait for a number of seconds in the virtual device runtime. | seconds |
| `ensure_connected` | Ensure the virtual Android TV session is connected. | initial_wait_seconds?, max_attempts?, backoff_seconds? |
| `list_packages` | List installed packages or filter by keyword. | keyword? |
| `launch_app` | Launch an Android TV package in the virtual runtime. | package |
