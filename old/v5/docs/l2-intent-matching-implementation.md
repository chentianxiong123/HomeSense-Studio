# L2 意图匹配 — 混合检索实现（BM25 + embedding + 意图卡片）

> 状态：已实现（混合检索 + 意图卡片，回归 55/55 通过）
> 关联：docs/l1-l2-local-mcp-tools.md
> 日期：2026-09-02

---

## 1. 结论速览

| 项目 | 决策 |
|------|------|
| 嵌入模型 | `bge-small-zh-v1.5` INT8 ONNX（24M 参数，512 维，中文优化） |
| 运行时 | `onnxruntime-purego`（纯 Go，无 cgo）+ `libonnxruntime.so 1.23.1` |
| 部署体积 | 模型 24MB + libonnxruntime 18MB ≈ **42MB** |
| 输入长度 | `maxLen=128`（意图文本短，512→128 提速 5 倍） |
| 延迟 | x86_64 ~33ms / 次；手机 ARM64 预估 150-300ms |
| 检索策略 | **fingerprint + BM25 + embedding 三通道，RRF 融合 + 意图卡片否决** |
| 默认阈值 | 0.65 |
| **回归结果** | **55/55 (100%)，0 误报**（此前纯 embedding 88% 召回 / 4 FP） |

---

## 2. 混合检索架构（v2）

```
workflow_match:
  ① fingerprint SHA256          精确命中即返回        (0.1ms)
  ② BM25 词面重叠 (CJK 二元组)  召回「回家/到家了」类   (~0ms)
  ③ embedding 语义 (512 维)     召回换词说法            (~33ms)
      ↓
  RRF 融合 (k=60) 按 chain 聚合 → 意图卡片校准 → top1 + confidence
```

### 2.1 通道设计
- **fingerprint**：`ComputeFingerprint(text)` SHA256，`store.GetByFingerprint` 命中即返回 conf=1.0。意图卡片每个 positive 短语都是独立锚点记录。
- **BM25**：`bm25.go` 手写索引（CJK 转 2-gram + 拉丁词小写），`k1=1.2, b=0.75`。**仅用于 RRF 排序**。
- **lexical coverage**（新）：查询自身词命中文档的比例（0..1 绝对值），替代归一化 BM25 作为词面置信度 —— 修掉了「打开电视→开空调(1.0)」这种单 bigram 假高分的坑。
- **embedding**：cosine，绝对 0..1。
- **confidence** = `max(cos, cover)`（保留旧阈值语义，0.65 依旧可过滤无关输入）。

### 2.2 RRF 融合
`rankChannels` 对 BM25 与 cosine 各自产出 1-based 排名（0=通道无信号），
`fused = Σ 1/(60+rank)`，按 `chain_id` 取组内最高，再取 top 候选。

### 2.3 意图卡片（Intent Card）
```json
{
  "ruleChain": {"id":"home_mode","name":"回家模式"},
  "intents": ["回家模式","我要回家了","我到家了","到家了","回家了"],
  "negative_examples": ["离家模式","我要出门了","出去了"],
  "confusable": ["away_mode"]
}
```
- `intents`：每个 positive 短语独立入库（fingerprint+embedding），解决「小声点/开冷气/我到家了」漏报 —— 这些短话直接 fingerprint 命中。
- `negative_examples`：**反例否决**。候选 chain 的任一反例与 query 的 cos ≥ 该 chain 最佳正例 - 0.02 且 ≥ 0.55 时整链否决，杀掉「离家模式→回家」「打开灯→关灯」反义误报。
- `confusable`：存于 snapshot，预留给后续链路（当前主要靠 negative 否决）。
- `LoadWorkflows` 每启动扫描 `workspace/workflows/*.json`，逐短语嵌入入库，构建内存 `Snapshot`（热路径零 SQLite）。

### 2.4 L1 方向拦截（职责划分）
`打开电视/关电视/开空调` 这类「开/关+设备」由 `rule_engine` 直接拦截（`reActionOn/Off` + `reDeviceTV/AC/Light`），不进入 L2。方向性误报第一道防线在 L1。

---

## 3. 关键坑（已踩过，别重踩）

1. **CLS/SEP 缺失**：`EncodeSingle(text, true)` 必须带 `true`（`embedder.go`）。
2. **`NewTokenizerFromFile` 是空 TODO**：用 `pretrained.FromFile`。
3. **ONNX external data 不能改名**：`model_quantized.onnx` 配对 `model_quantized.onnx_data`。
4. **onnxruntime-purego 只支持 ORT 1.23.x**（C-API v23），需 `replace` 本地目录。
5. **平台库区分**：`third_party/ort` 为 ARM64，本地测试换 x64。
6. **归一化 BM25 当置信度是坑**：单个共享 bigram 会让归一化分冲到 1.0 → 改用 lexical coverage。

---

## 4. 效果实测（10 意图 × 55 说法，本机 x86_64）

| 版本 | 召回 | 误报 |
|------|------|------|
| v1 纯 embedding (thr 0.60) | 43/49 (88%) | 4/14 |
| **v2 混合 + 意图卡片 (thr 0.65)** | **55/55 (100%)** | **0** |

覆盖亮点：
- 「小声点」「开冷气」「我到家了」「到家了」→ 全部 fingerprint 直接命中（v1 全部漏报）
- 「离家模式」→ away_mode 正确，且被 home_mode 的 negative 否决不会再撞回家
- 「调高空调温度」→ 新增 ac_temp 卡片正确命中（v1 无此意图）
- 无关输入（天气/外卖/新闻联播）全部拒绝
- L1 拦截「打开电视/关电视」验证通过（`TestL1InterceptsDirectionCommands`）

### 延迟
- fingerprint：0.1ms；BM25+RRF：~0ms；embedding：~33ms
- 55 例全量 ~186ms（大多数走 fingerprint 快路径）

---

## 5. 相关文件
- `pkg/workflowmatch/bm25.go` — CJK bigram tokenizer + BM25 索引
- `pkg/workflowmatch/matcher.go` — 混合管线（fingerprint→BM25→embedding→RRF→否决）
- `pkg/workflowmatch/store.go` — intent 卡片解析 + negative 表 + Snapshot
- `pkg/workflowmatch/hybrid_regression_test.go` — 55 例回归 + L1 拦截 + 基准
- `cmd/executor/tools.go` — `workflow_match` 工具（默认阈值 0.65）
- `pkg/workflow/examples/{home_mode,movie_mode}.json` — 卡片示例
- 模型源：`onnx-community/bge-small-zh-v1.5-ONNX` (HuggingFace)
