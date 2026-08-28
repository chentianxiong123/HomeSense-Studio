---
skill_id: adb.bilibili
tool: adb
capability: device.tv.app.bilibili
exposure_level: default
risk_level: low
---

# B站 (Bilibili) 技能

## 目标
在安卓电视上打开或安装 B站应用。

## 包名候选
- `com.xiaodianshi.tv.yst` (云视听小电视，电视版 B站)
- `tv.danmaku.bili`

## 流程

### 1. 检查是否已安装

```powershell
echo '{"action":"check_package","package":"com.xiaodianshi.tv.yst"}' | python adb.py run -
```

如果 `"installed": true`，跳到步骤 3 直接启动。

### 2. 未安装时：通过当贝市场安装

```powershell
# 2.1 打开当贝市场
echo '{"action":"launch_app","package":"com.dangbeimarket"}' | python adb.py run -
echo '{"action":"wait","seconds":3}' | python adb.py run -

# 2.2 获取 UI 元素，找到搜索入口
echo '{"action":"get_ui_elements"}' | python adb.py run -

# 2.3 点击搜索（通常在右上角）
echo '{"action":"tap_element","text":"搜索"}' | python adb.py run -
# 或使用坐标比例
echo '{"action":"tap_ratio","x_ratio":0.92,"y_ratio":0.09}' | python adb.py run -

# 2.4 输入搜索词
echo '{"action":"input_text","text":"bilibili"}' | python adb.py run -
echo '{"action":"press_key","key":"enter"}' | python adb.py run -
echo '{"action":"wait","seconds":2}' | python adb.py run -

# 2.5 获取搜索结果
echo '{"action":"get_ui_elements"}' | python adb.py run -

# 2.6 点击 B站结果
echo '{"action":"tap_element","text":"B站"}' | python adb.py run -
# 或
echo '{"action":"tap_element","text":"哔哩"}' | python adb.py run -

# 2.7 点击安装按钮
echo '{"action":"wait","seconds":2}' | python adb.py run -
echo '{"action":"get_ui_elements"}' | python adb.py run -
echo '{"action":"tap_element","text":"安装"}' | python adb.py run -

# 2.8 等待安装完成
echo '{"action":"wait","seconds":30}' | python adb.py run -

# 2.9 再次检查是否安装成功
echo '{"action":"check_package","package":"com.xiaodianshi.tv.yst"}' | python adb.py run -
```

### 3. 启动 B站

```powershell
echo '{"action":"launch_app","package":"com.xiaodianshi.tv.yst"}' | python adb.py run -
echo '{"action":"wait","seconds":3}' | python adb.py run -
echo '{"action":"get_current_app"}' | python adb.py run -
```

## 批量执行示例

如果确认 B站已安装，可以直接启动：

```powershell
echo '[{"action":"launch_app","package":"com.xiaodianshi.tv.yst"},{"action":"wait","seconds":3},{"action":"get_current_app"}]' | python adb.py run -
```

## 注意事项

1. 电视版 B站 包名是 `com.xiaodianshi.tv.yst`，不是手机版
2. 当贝市场的 UI 可能因版本不同而变化，始终先 `get_ui_elements` 确认
3. 安装过程可能需要确认弹窗，注意检查界面
