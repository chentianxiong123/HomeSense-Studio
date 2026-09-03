---
skill_id: adb.dangbei_market
tool: adb
capabilities:
  - device.tv.market.search
  - device.tv.market.download
  - device.tv.market.install
exposure_level: default
risk_level: medium
preconditions:
  - tv_connection_available
---

# 当贝市场 Skill

## Skill ID
`adb.dangbei_market`

## 功能描述
当贝市场应用商店操作 - 搜索、下载、安装应用

## Capabilities

### device.tv.market.search
在当贝市场搜索应用。

**ADB 命令**:
```bash
adb shell am start -a android.intent.action.VIEW -d "dangbeimarket://search?keyword={keyword}"
```

**参数**:
- `keyword`: 搜索关键词

### device.tv.market.download
下载当贝市场中的应用。

**流程**:
1. 在搜索结果页定位目标应用
2. 点击下载按钮
3. 等待下载完成

### device.tv.market.install
安装已下载的应用。

**流程**:
1. 确认下载完成
2. 触发安装
3. 确认安装成功

## URI Schemes
- 搜索: `dangbeimarket://search?keyword={keyword}`
- 应用详情: `dangbeimarket://detail?id={package_name}`

## 使用场景
当目标应用未安装时，通过当贝市场下载安装。

## 风险等级
medium - 涉及应用安装操作
