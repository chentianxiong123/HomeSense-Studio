---
name: adb
description: "Android TV/设备控制 via ADB CLI。用于控制安卓电视、机顶盒等设备，包括截图、UI元素获取、点击、启动应用等。触发词：电视、机顶盒、ADB、安卓、截图、打开应用。"
---

# ADB CLI - Android Device Control

通过 ADB CLI 控制安卓设备（电视、机顶盒等）。使用 JSON 格式命令。

> **前置条件**: 设备已通过网络 ADB 连接，IP 默认 `192.168.31.124:5555`

## CLI 路径

ADB CLI 位于当前目录的 `adb.py` 文件。

**PowerShell 用法**（推荐使用 stdin 方式）：

```powershell
# 方式1: 使用 stdin（推荐）
echo '{"action":"list_devices"}' | python adb.py run -

# 方式2: 使用临时文件
'{"action":"list_devices"}' | Out-File -FilePath temp.json -Encoding utf8
python adb.py run (Get-Content temp.json -Raw)
```

## Step 0: 检查设备连接

任何操作前，先确认设备已连接：

```powershell
echo '{"action":"ensure_connected"}' | python adb.py run -
```

如果返回 `"status": "error"`，请检查设备网络和 ADB 调试是否开启。

## 核心工作流

每个设备操作遵循这个循环：

1. **观察**: `get_ui_elements` 查看屏幕内容
2. **行动**: `tap_element`, `input_text`, `press_key` 等
3. **再观察**: 屏幕变化后重新获取 UI 元素

```powershell
# 1. 观察 - 查看屏幕内容
echo '{"action":"get_ui_elements"}' | python adb.py run -
# 输出: 元素列表，包含 index, text, center, clickable 等

# 2. 行动 - 通过文本点击元素
echo '{"action":"tap_element","text":"设置"}' | python adb.py run -

# 3. 再观察 - 屏幕变化后重新获取
echo '{"action":"get_ui_elements"}' | python adb.py run -
```

## 批量执行

传入 JSON 数组可顺序执行多个命令，**遇到错误即停止**：

```powershell
echo '[{"action":"launch_app","package":"com.dangbeimarket"},{"action":"wait","seconds":2},{"action":"get_ui_elements"}]' | python adb.py run -
```

## 命令参考

### 设备管理

```powershell
echo '{"action":"list_devices"}' | python adb.py run -
echo '{"action":"connect"}' | python adb.py run -
echo '{"action":"disconnect"}' | python adb.py run -
echo '{"action":"ensure_connected"}' | python adb.py run -
```

### 屏幕观察

```powershell
# 获取 UI 元素列表（推荐用于交互决策）
echo '{"action":"get_ui_elements"}' | python adb.py run -

# 截图（保存到文件，返回路径）
echo '{"action":"screenshot"}' | python adb.py run -
echo '{"action":"screenshot","path":"C:/temp/screen.jpg"}' | python adb.py run -

# 获取屏幕尺寸
echo '{"action":"get_display_size"}' | python adb.py run -
```

### 元素交互（推荐）

```powershell
echo '{"action":"tap_element","index":5}' | python adb.py run -        # 通过索引
echo '{"action":"tap_element","text":"确认"}' | python adb.py run -     # 通过文本（模糊匹配）
echo '{"action":"find_element","text":"搜索"}' | python adb.py run -    # 只查找不点击
```

### 坐标操作

```powershell
echo '{"action":"tap","x":500,"y":800}' | python adb.py run -
echo '{"action":"tap_ratio","x_ratio":0.5,"y_ratio":0.3}' | python adb.py run -  # 按比例点击
echo '{"action":"swipe","start_x":500,"start_y":1000,"end_x":500,"end_y":200}' | python adb.py run -
```

### 文本输入

```powershell
echo '{"action":"input_text","text":"Hello"}' | python adb.py run -
```

### 系统按键

```powershell
echo '{"action":"back"}' | python adb.py run -
echo '{"action":"home"}' | python adb.py run -
echo '{"action":"enter"}' | python adb.py run -
echo '{"action":"press_key","key":"dpad_center"}' | python adb.py run -
```

按键名称: `enter`, `back`, `home`, `dpad_up`, `dpad_down`, `dpad_left`, `dpad_right`, `dpad_center`, `volume_up`, `volume_down`, `menu`, `power`

### 应用控制

```powershell
echo '{"action":"launch_app","package":"com.dangbeimarket"}' | python adb.py run -
echo '{"action":"get_current_app"}' | python adb.py run -
echo '{"action":"list_packages"}' | python adb.py run -
echo '{"action":"list_packages","keyword":"bilibili"}' | python adb.py run -
echo '{"action":"check_package","package":"com.xiaodianshi.tv.yst"}' | python adb.py run -
```

### 等待

```powershell
echo '{"action":"wait","seconds":2}' | python adb.py run -
```

## 错误处理

所有响应都是 JSON 格式，包含 `"status": "success"` 或 `"status": "error"`。

| 错误 | 解决方案 |
|------|----------|
| Element not found | 先运行 `get_ui_elements` 刷新，确认 text/index |
| No devices | 检查网络连接，运行 `ensure_connected` |
| uiautomator failed | 设备可能在安全界面，重试或手动操作 |

## 关键规则

1. **交互前先 `get_ui_elements`** - 不要猜测坐标或元素名称
2. **屏幕变化后重新观察** - 点击、滑动后之前的元素已失效
3. **优先使用 `tap_element`** - 基于文本/索引比坐标更可靠
4. **启动应用后加 `wait`** - 应用需要 1-3 秒加载
5. **不要硬编码 UI 流程** - 不同设备 UI 不同，始终读取 `get_ui_elements` 输出并适应
