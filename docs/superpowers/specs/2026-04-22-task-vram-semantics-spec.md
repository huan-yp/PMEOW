# PMEOW 任务 VRAM 语义重设计（最小可运营版）

## 1. 背景与目标

当前 `--vram` 的“省略 vs 显式填写 0”在内部都落成同一个数值，导致以下问题：

- 调度语义不清晰：无法稳定区分“独占 GPU”与“数值阈值模式”。
- 展示不清晰：Web/Mobile/日志/调度详情容易把 `0` 解释成独占。

本设计只解决语义澄清和可见性问题，不引入 OOM/fallback 策略，不扩展额外调度复杂度。

## 2. 硬约束（已确认）

1. `vram` **省略** => **独占模式**。
2. `vram` **显式提供（包括 0）** => **数值模式**，且**不是独占**。
3. Web/Mobile/日志/调度详情都必须清晰显示该语义。
4. 方案保持最小、可运行；不新增 fallback/OOM 策略。
5. 不展开 RPC / shared abstraction 讨论。

## 3. 关键决策方案（2-3 选 1）

### 方案 A：新增 `vram_explicit: bool`（推荐）

- 现有 `require_vram_mb: int` 保持不变。
- 新增布尔位记录“用户是否显式传了 `--vram`”。
- 语义由 `(vram_explicit, require_vram_mb)` 联合决定。

优点：改动最小、兼容现有数值字段、调度分支清晰。
缺点：语义分散在两个字段（但可接受）。

### 方案 B：`require_vram_mb: Optional[int]`

- `None` 表示省略（独占），`0+` 表示数值模式。

优点：语义集中在一个字段。
缺点：会影响当前大量默认 `int` 的代码路径，改动面偏大。

### 方案 C：新增 `vram_mode: "exclusive" | "numeric"`

- 保留 `require_vram_mb`，并显式存储模式。

优点：可读性最好。
缺点：与现有逻辑重复，状态一致性需要额外约束。

**推荐：方案 A（最小变更，满足全部约束）。**

## 4. 语义契约（Semantic Contract）

以任务维度定义：

- `vram_explicit = false`：
  - 语义 = **独占模式**。
  - 调度要求 = 选中的每张 GPU 必须满足“空闲判定”（现有 idle 规则不变）。
- `vram_explicit = true`：
  - 语义 = **数值模式**。
  - 调度要求 = 按 `require_vram_mb` 走数值阈值判断（`0` 合法，表示阈值为 0，而非独占）。

补充：`require_gpu_count = 0` 仍是 CPU 任务语义，不参与 GPU 调度，此规则不变。

## 5. 内部最小状态字段

仅新增 1 个必要字段：

- `vram_explicit: bool`（新）
  - `false`：提交时未出现 `--vram`
  - `true`：提交时显式出现 `--vram`（含 `--vram 0`）

保留现有字段：

- `require_vram_mb: int`（旧）
- `require_gpu_count: int`（旧）

建议（非必须持久化）派生字段：

- `vram_mode = vram_explicit ? "numeric" : "exclusive"`

## 6. 调度决策规则变更

将当前“`require_vram_mb == 0` 即独占”替换为“`!vram_explicit` 即独占”：

- 旧：`is_exclusive = (require_vram_mb == 0)`
- 新：`is_exclusive = (!vram_explicit)`

具体行为：

- 独占模式：沿用现有 `_eligible_exclusive` 规则。
- 数值模式：沿用现有 `_eligible_shared` 规则，阈值为 `require_vram_mb`（可为 0）。

不改动：

- 优先级竞争逻辑
- sustained window 逻辑
- idle 判定阈值
- 任何 fallback/OOM 策略

## 7. 日志与 UI 展示规则

### 7.1 日志（任务日志 + 调度评估 detail）

提交/调度相关文本统一带上“语义模式”：

- 独占：`vram_mode=exclusive (vram omitted)`
- 数值：`vram_mode=numeric (vram=<N>MB, explicit)`

调度描述模板：

- 独占：`need <G> idle GPU(s) in exclusive mode`
- 数值：`need <G> GPU(s) with >= <N> MB in numeric mode`

要求：当 `N=0` 时必须明确显示 `numeric` 与 `>= 0 MB`，避免被理解成独占。

### 7.2 Web

至少在以下位置明确模式：

- 任务详情“请求资源”
  - 独占：`独占 × <G> GPU（未填写 VRAM）`
  - 数值：`<N> MB × <G> GPU（显式 VRAM，含 0）`
- 调度历史卡片标题/摘要
  - 使用上面的“独占/数值”描述模板，不再仅靠 `requestedVramMb` 推断。

### 7.3 Mobile

至少在以下位置明确模式：

- 任务详情“请求资源”同 Web 语义。
- 队列/任务行摘要中的 VRAM 字样：
  - 独占显示“独占”
  - 数值显示“<N>MB（数值）”，`0` 必须按数值显示。

## 8. 历史数据处理（最小方案）

历史记录无法可靠区分“省略”与“显式 0”，采用最小兼容策略：

- 新任务：必须写入 `vram_explicit`。
- 老任务（无 `vram_explicit`）：读取时按**旧语义兼容推断**：
  - `require_gpu_count > 0 && require_vram_mb == 0` => 视为独占
  - 其他 => 视为数值

不做大规模回填，不引入批量重写迁移。

## 9. 错误处理

- CLI 解析阶段：
  - 仅负责准确记录 `vram_explicit` 与 `require_vram_mb`，不做额外复杂校验策略。
- 展示阶段：
  - 若历史数据缺少 `vram_explicit`，按第 8 节推断并正常渲染。
- 日志阶段：
  - 文本模板缺字段时，回退输出 `mode=unknown(legacy)`，但不影响调度决策。

## 10. 测试策略（最小但完整）

### 10.1 调度单测

覆盖 4 个核心用例：

1. 省略 vram + gpus>0 => 走独占分支。
2. 显式 vram=0 + gpus>0 => 走数值分支（非独占）。
3. 显式 vram>0 + gpus>0 => 走数值分支。
4. gpus=0 => CPU 任务，不走 GPU 分支。

### 10.2 展示单测/组件测试

- Web TaskDetail 文案在三种输入下正确显示：省略 / 显式 0 / 显式正数。
- Mobile 任务详情与队列行文案同样正确显示。
- 调度详情卡片在 `vram=0` 时必须显示“numeric + >=0MB”。

### 10.3 日志断言

- 提交日志、调度日志包含 `vram_mode`。
- `vram=0` 显式时日志不得出现“exclusive”。

## 11. 验收清单（Acceptance Checklist）

- [ ] 省略 `--vram` 的任务被判定为独占。
- [ ] 显式 `--vram 0` 的任务被判定为数值模式，且非独占。
- [ ] Web 任务详情明确显示独占/数值语义。
- [ ] Mobile 任务详情与队列摘要明确显示独占/数值语义。
- [ ] 调度详情文案明确区分独占与数值（含 `0MB`）。
- [ ] 任务日志/调度日志包含 `vram_mode`，且 `vram=0` 时不出现独占文案。
- [ ] 历史数据可读取，缺失字段时按兼容推断正常展示。
- [ ] 未引入 fallback/OOM 策略与额外调度复杂度。

## 12. 范围外（明确不做）

- 不新增 OOM 保护策略。
- 不新增 fallback/retry 调度策略。
- 不做跨端共享抽象重构。
- 不改动现有调度窗口算法与资源模型。
