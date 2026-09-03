---
name: sandbox-adb-cli
description: "Sandbox Android TV / ADB executor for HomeSense demo flows."
allowed_tools:
  - sandbox-adb-cli
context_mode: inline
---

# sandbox-adb-cli

## Actions

### Device Runtime
| Action | Description | Params |
|--------|-------------|--------|
| `wait` | Wait for a number of seconds in the virtual device runtime. | seconds |
| `ensure_connected` | Ensure the virtual Android TV session is connected. | initial_wait_seconds?, max_attempts?, backoff_seconds? |
| `list_packages` | List installed packages or filter by keyword. | keyword? |
| `launch_app` | Launch an Android TV package in the virtual runtime. | package |
