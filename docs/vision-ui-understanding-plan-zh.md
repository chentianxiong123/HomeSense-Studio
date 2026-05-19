# HomeSense Studio Plus 识图与 UI 理解方案

> 文档定位：这是后置能力方案，不是当前虚拟设备阶段的实现任务。
> 目标是在未来操控 Android 电视、手机、机顶盒 App、ADB 或无障碍界面时，形成“UI 树优先、OCR/识图补缺、多模态兜底、坐标交叉验证”的可靠执行层。

## 1. 当前判断

不要把安卓电视/手机操控做成“多模态模型看图后直接点坐标”。

正确架构应该是：

```text
截图 + UI 树 + OCR + 局部图像识别 + 多模态语义判断
-> 生成候选目标
-> 交叉验证目标区域
-> 由 UI bounds / OCR box / 模板框计算坐标
-> 点击 / 输入 / 滑动
-> 再观察
```

多模态模型可以兜底理解“这个图标大概是什么”，但不应该独占最终坐标决策。最终执行坐标必须由可验证证据产生。

## 2. 本地参考结论

### 老项目

老项目已经存在这条路线：

```text
截图 / UI 树 / OCR / 多模态观察
-> 判断目标元素
-> 补全真实坐标
-> 点击 / 输入 / 滑动
-> 再次观察
```

对应文档：

- `D:/files/HomeSense/新生/00-老项目评估/00-HomeSense老项目正式总档案.md`
- 其中明确提到 ADB wrapper、UI 树、OCR、多模态、点击、输入、滑动、Observe-Act-Reobserve。

### phone-mcp

`phone-mcp` 的关键规则非常适合直接吸收：

- 操作前先 `get_ui_elements`。
- 屏幕变化后必须 re-observe。
- 优先 `tap_element`，少用裸坐标 `tap`。
- XML/UI 树适合原生 Android。
- OCR 适合 WebView、游戏、Flutter 或 UI 树元素过少时。
- `auto` 模式可以先 XML，失败再 OCR。

对应文档：

- `D:/files/HomeSense/新生/03-参考项目源码级细读/04-phone-mcp.md`
- `D:/files/HomeSense/References/phone-mcp-source/SKILL.md`

### uiautomator2

`uiautomator2` 的价值在于：

- `dump_hierarchy` 导出 UI 层级。
- Selector 支持 text、description、resourceId、className、index 等定位。
- UiObject 能拿 bounds 和 center。
- click、swipe、press、app_start、app_wait 能形成稳定自动化链路。
- Watcher 可以处理弹窗、权限提示等突发 UI。

对应文档：

- `D:/files/HomeSense/新生/03-参考项目源码级细读/09-uiautomator2.md`

### Assists

`Assists` 更适合未来手机端/无障碍端路线：

- AccessibilityService 获取节点树。
- 节点可按 id、text、description、class 查找。
- 可拿节点 bounds。
- 可做节点点击、手势点击、输入、滚动。
- 可整屏截图，也可截取节点区域。
- 可接 OpenCV 模板匹配。
- 可做 OCR。
- 可通过 WebView/JS 形成动态自动化运行平台。

对应文档：

- `D:/files/HomeSense/新生/03-参考项目源码级细读/14-assists.md`
- `D:/files/HomeSense/References/Assists/docs/architecture.md`
- `D:/files/HomeSense/References/Assists/docs/web-framework-api.md`

### Open-AutoGLM

`Open-AutoGLM` 的价值在于手机 GUI Agent 的循环结构：

```text
截图
-> 当前 app
-> 多模态模型思考
-> 解析 action
-> 执行动作
-> 下一轮截图
```

它的问题也很明显：VLM 直接输出相对坐标时，精度和可解释性不够稳定。HomeSense 可以吸收它的 step loop，但不要照搬“模型直接点坐标”。

复核源码后，Open-AutoGLM 本身没有提供 OpenCV、YOLO、ONNX Runtime、PaddleOCR、EasyOCR 这类本地图像检测栈。它的 Python 依赖主要是 `Pillow` 与 OpenAI-compatible 模型客户端；截图后把图片交给视觉模型，再解析模型输出的相对坐标。

因此它适合吸收：

- `screenshot -> model -> action -> execute -> screenshot` 的循环。
- `StepResult` / `ActionResult` 这类步骤结果结构。
- 相对坐标转绝对坐标的动作协议。
- 本地或远程 VLM 服务可切换的部署方式。

不适合直接照搬：

- 让 VLM 独自决定点击坐标。
- 把截图理解当成唯一感知来源。
- 把“视觉模型服务本地部署”误认为“本地 OpenCV/YOLO 检测”。

对应文档：

- `D:/files/HomeSense/新生/03-参考项目源码级细读/10-open-autoglm.md`

## 3. 目标架构

未来新增一个 `ScreenPerceptionService`：

```text
packages/backend/src/modules/screen-perception/
  index.ts
  types.ts
  observe.ts
  groundTarget.ts
  rankCandidates.ts
  adapters/
    adb.ts
    uiautomator2.ts
    accessibility.ts
    mock-screen.ts
```

Python 侧新增 `screen-cli` 或并入 `mi-cli` 的 Android backend：

```text
packages/mi-cli/src/mi_cli/backends/android/
  adb.py
  ui_tree.py
  screenshot.py
  ocr.py
  vision.py
  actions.py
```

第一版可以仍然通过 CLIBridge 调 Python，不需要新建复杂服务。

## 3.1 本地视觉兜底选择

本地视觉兜底优先级建议是：

1. UI 树 / Accessibility / UiAutomator  
   最稳定，能拿 bounds、text、description、resourceId。

2. ML Kit OCR / OCR  
   用于 UI 树没有文本、WebView、Flutter、自绘页面。

3. OpenCV 模板匹配  
   用于无文本但形状稳定的图标，例如播放、返回、设置、HDMI、确认、菜单。

4. 多模态视觉模型  
   用于解释“这个图标语义上像什么”，但只产出 hint，不单独决定最终坐标。

5. YOLO / 本地目标检测  
   暂不作为第一选择。YOLO 更适合固定类别检测，需要标签、训练或合适的预训练类别。Android/电视 UI 图标变化大、风格碎，本阶段用模板匹配比 YOLO 更轻、更可控。

本地参考里真正可直接吸收的本地视觉方案是 Assists：

- `assists-opcv`：OpenCV 模板匹配、mask、截图转 Mat。
- `assists-web/mlkit`：ML Kit 中文 OCR，能返回文字位置。
- `assists-mp`：截图与节点区域截图。

## 4. 核心数据结构

```ts
type ScreenSnapshot = {
  id: string
  deviceId: string
  app?: string
  width: number
  height: number
  screenshotPath?: string
  uiTree?: UiNode[]
  ocrBoxes?: OcrBox[]
  createdAt: string
}

type UiNode = {
  nodeId: string
  text?: string
  contentDescription?: string
  resourceId?: string
  className?: string
  bounds: Bounds
  clickable: boolean
  visible: boolean
  parentId?: string
}

type OcrBox = {
  text: string
  bounds: Bounds
  confidence: number
}

type VisionHint = {
  label: string
  description: string
  approximateBounds?: Bounds
  confidence: number
}

type GroundedTarget = {
  targetId: string
  source: "ui_tree" | "ocr" | "template" | "vision_cross_checked"
  bounds: Bounds
  clickPoint: { x: number; y: number }
  confidence: number
  evidence: string[]
}
```

## 5. 定位策略

目标定位按优先级走：

1. UI 树精确匹配  
   text、contentDescription、resourceId、className。

2. UI 树结构推断  
   找到文字后，向上找 clickable parent；或根据兄弟节点确定按钮区域。

3. OCR 匹配  
   UI 树缺文本、WebView、Flutter、电视 App、自绘界面时使用。

4. 图标/模板识别  
   针对无文本图标、播放键、返回键、设置齿轮、HDMI 图标等。

5. 多模态语义兜底  
   让视觉模型解释“哪个区域像目标”，但输出只作为 hint。

6. Grounding 交叉验证  
   用 UI bounds、OCR box、模板框、截图尺寸统一验证，最后算点击点。

## 6. 执行规则

必须遵守：

- 不盲猜坐标。
- 每次点击、滑动、输入后都 re-observe。
- 能用 UI node 就不用 OCR。
- 能用 OCR/template 就不让 VLM 独自给坐标。
- VLM 输出必须结构化。
- 坐标必须绑定证据来源。
- 点击前记录 snapshot id。
- 点击后验证状态变化。

## 7. 和当前阶段的关系

当前虚拟设备阶段不做这套。

现在只需要在架构上留接口：

- `vision_model` slot 已配置为 `qwen3.5-4b`。
- Trace 事件类型预留 `screen.observe`、`screen.ground`、`screen.action`。
- ToolAction 预留 `screen.tap_target`、`screen.input_text`、`screen.swipe`。
- KnowledgeCompiler 未来可以沉淀“某 App 某界面按钮定位经验”。

等进入真实 Android 电视/手机测试，再开始实现 `ScreenPerceptionService`。

## 8. 未来最小实现切片

第一版真实识图能力可以只做：

1. ADB 截图。
2. ADB 或 uiautomator2 拉 UI 树。
3. OCR 识别文字框。
4. 简单图标模板匹配。
5. 调用视觉模型给语义 hint。
6. Grounding 合并候选。
7. 点击后 re-observe。

验收场景：

```text
打开安卓电视 App
-> 拉 UI 树
-> 找不到某个无文本图标
-> 截图 + OCR + vision hint
-> 与 UI 树 bounds 交叉确定
-> 点击
-> 再观察确认页面变化
```

这条路线比“纯多模态点坐标”更适合 HomeSense，因为它可解释、可回放、可修正，也能把成功定位策略写回经验层。
