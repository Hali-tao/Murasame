# 有来源文件摘要与审批保存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. 本文最初为只读设计；主工作线已依据用户自主迭代授权接收为下一轮实施范围。首轮提交后继续，先阅读 docs/14-OVERNIGHT-ITERATION.md 和当前 Git 状态；不需要重复询问方案批准。

**Goal:** 用户指定授权目录内的文本文件，确认读取与模型外发范围后生成能追溯到真实来源的摘要草稿，再确认准确内容和目标路径，最后新建并独立核验文件。

**Architecture:** 保留现有 TaskService、executeGoal、模型快照、两条请求队列和审批 UI；为文件摘要增加一个有固定阶段的受控 workflow。主进程读取真实文件后才允许 Worker 生成草稿，主机核对引用，后续保存只能使用已批准草稿；计划器不能预先编造正文或绕过来源阶段。

**Tech Stack:** Electron、TypeScript、Zod、现有 ModelGateway、SQLCipher SQLite、React、Vitest、Playwright Electron。无需增加库或远程服务。

**Spec:** 用户原始 `G16-murasame-SRS 文档.pdf` FR-16～21、IF-02、IF-09、NFR-P02、NFR-R01～03、NFR-M01；`docs/01-DECISIONS.md` D-06/D-11/D-18/D-24；审计 `previews/overnight-2026-10-29/srs-audit.md` 第 5 项。本文不改写或缩小原始需求；仅定义下一次可验收增量。

## 已核对的代码现状

核对日期 2026-10-29，基线 91d1fd9 加本轮未提交集成改动；实施前应检查主工作线最后提交差异。

| 接线点 | 当前真实行为 | 此增量需要补充 |
| --- | --- | --- |
| `src/main/model/contracts.ts:taskPlanSchema` | 四种工具、固定 steps/args/checks；write.content 在计划阶段已给定 | 可辨别的文件摘要 workflow；独立 Worker 输出 schema |
| `src/main/core/murasame-core.ts:create()` | Planner 仅得到任务及常用目录；`setPlanner(goal,binding)` 使用任务选定模型 | 注入受控摘要回调；传真实 source 数据，继续使用任务绑定 |
| `src/main/core/services/task-service.ts` | 保存 plan/checkpoint/model snapshot；审批后 run；重启中断；未知副作用禁止重放 | 保存摘要阶段/草稿/来源指纹，审核阶段独立批准，恢复分流 |
| `src/main/agent/executor.ts:executeGoal()` | 固定 DAG 运行；read 结果未回到模型；同 scope 可连续调度 | 在普通 DAG 前分派专用 workflow；始终先等待外发批准，生成后再等待保存批准 |
| `src/main/model/gateway.ts` | work/chat 分队列；signal、beforeSend、onDispatch；结构化调用最多 3 次 | 复用这些控制项，在实际每次发送前重查授权/预算；无需改供应商协议 |
| `src/main/tools/filesystem.ts` | resolveInside 拒绝越界及重解析路径；readInside 无大小上限；writeInside 独占新建 | 新的有界快照读取；保存复用 writeInside 和磁盘复核 |
| `src/shared/task-approval.ts`、`ApprovalDetails.tsx` | 已支持可读步骤、范围、精确新建正文预览 | 展示来源、外发对象及用途；阶段 B 显示完整最终正文 |
| `src/main/security/hardening.ts:markUntrusted()` | 只添加不可信标识 | 还需数据与执行协议隔离；标识本身不足以限制模型权限 |

`outboundImages` 只授权截图，不能作为发送文件正文的授权。现有 Permissions 没有文件正文外发开关；本增量以任务中准确来源清单和模型对象的显式批准授权，不能暗用全局图片写入许可 `fileApproval`。

## Global Constraints

- 沿用 D-06 的 10 分钟审批期限；拒绝或过期保留可恢复状态，重新批准前零新增请求/写入。
- 沿用 D-09：隐藏继续任务但停止媒体输入；退出及取消停止后续派发，不声称撤回已发送正文或回滚已保存文件。
- 沿用 D-11：重启不自动外发、不自动写入；先核对已有事实，再由用户选择恢复。
- 模型绑定遵循现有 `boundModel()`/fingerprint。默认模型变更不漂移旧任务；重启后原配置不匹配则受阻。
- 主进程是权限与哈希判断的权威；渲染进程文本、模型返回值、文件正文不能改变目录、目标、模型或预算。
- 仅使用用户明确指定文件。目录、文件集、目标名或用途不清时进入待确认，不能递归猜选文件。
- 不保存完整来源到普通 tool_calls、日志、通知、会话或长期记忆；不从该任务自动提取记忆。

以下限制是此次实现选择，不是原始 SRS 的新增限制：一次 1～5 个 `.txt`/`.md` UTF-8 普通文件；每文件最多 32 KiB，总计最多 64 KiB；正文累计最多 24,000 Unicode 字符；输出单个 `.md` 文件，正文最多 12,000 字符，且只能新建。超限/非 UTF-8/二进制/空来源明确受阻，不能静默截断再声称完整总结。更大文档、PDF、Office、网页和代码执行留在原需求待完成清单。

## 交互与阶段

1. 用户在现有任务入口给出目录、具体输入文件和输出名；信息不够先补充。任务创建与第一项敏感批准在文案上区分。
2. **批准 A：读取并发送来源。** 显示精确路径、当前大小/修改时间、文件数和字节上限、任务绑定模型名称/服务商/脱敏接口地址、用途“生成摘要”。写明模型服务会收到这些文件的正文，当前阶段不会写文件。默认本次，不设置永久批准。
3. 批准后才读取有界内容快照；逐源检查路径、普通文件、编码、大小；读取前后文件身份/大小/mtime 不一致则停止。每份快照生成 SHA-256、行号和 sourceId；向 Worker 发送确定快照，使用 basename/sourceId，默认不向模型传主机绝对路径。
4. **Worker：根据真实来源生成结构化草稿。** 仅传本次用户摘要要求和来源数据，不给工具调用能力。输出引用 sourceId、行区间和来源原文；本地主机验证所有引用属于该次快照且原文精确匹配，再生成 Markdown 草稿和引用清单。
5. **批准 B：保存这份草稿。** 完整可读正文、引用及已核对来源、准确新建路径；明确不会覆盖。草稿不足或引用不通过则失败/待补充，不进入保存。批准 A 的 once/task 选择都不能授予保存权。
6. 保存前再验取消、期限、workflow/草稿/来源指纹、目录、目标不存在；以已批准的准确 UTF-8 字节独占新建，再从磁盘重新读取验证大小/哈希。真正生成并核验后才显示完成、文件链接和证据。

对用户的完成含义是“这份已审阅摘要已保存，来源引用和字节一致性已核对”。自动检查不能证明摘要的所有语义判断绝对正确，不应把“引用存在”包装成通用事实正确性认证。

## 数据与接口设计

### Plan：显式 workflow，拒绝预造输出

在 `TaskPlan`/`taskPlanSchema` 增加可选字段：

```ts
interface GroundedSummaryWorkflow {
  kind: 'summarize-files'
  sources: string[]       // 1–5 个 root 内相对路径
  instruction: string    // <= 2,000 字符，只描述摘要用途
  outputPath: string     // root 内准确 .md 相对路径
}
```

此分支必须 `tool: 'filesystem'`，禁止额外 terminal/git/browser steps、write.content、动态路径和自定义执行代码。主进程校验后构造固定 read-and-summarize / review-and-save 两阶段；不得将模型给定 steps 当作可执行旁路。通用四工具任务沿原路径执行。模型只能建议路径，用户的明确范围及最终批准仍为准。

### Worker 输入输出与本地 Critic

建议新增 `src/main/agent/grounded-summary.ts`，包括有界读取、快照校验、结构化输出验证和 Markdown 渲染；新增 `src/shared/grounded-summary.ts` 放纯共享类型与上限，避免 UI 导入 Node 模块。

```ts
interface SourceSnapshot {
  id: string; relativePath: string; sha256: string
  bytes: number; mtimeMs: number; text: string; lines: string[]
}
interface GroundedDraft {
  title: string
  sections: Array<{
    text: string
    citations: Array<{ sourceId: string; fromLine: number; toLine: number; quote: string }>
  }>
  limitations: string[]
}
interface SummaryModelControl {
  signal: AbortSignal
  beforeSend(): void
  onDispatch(waitMs: number): void
}
type SummaryGenerator = (
  input: { instruction: string; sources: SourceSnapshot[] },
  model: TaskModelBinding,
  control: SummaryModelControl
) => Promise<GroundedDraft>
```

- Zod schema `.strict()`；标题/section/引用数量/字数上限；至少一个非空 section，所有 section 至少一项引用；sourceId 必须实际存在，区间在来源行数内，quote 必须精确来自该行区间。来源矛盾保留并列引用，不擅自消解。
- `sourceId`、路径和 SHA-256 全由主机产生；模型不能声明自己的“文件已写入”“验证成功”作为证据。
- 本地 Critic 使用真实快照、结构化 draft 数据和保存后的磁盘内容。首次实现保持确定性的引用/哈希核验；它不是独立模型语义审稿智能体。若后续增加第二模型 Critic，应另计外发/预算，不能在该增量中宣称通用多智能体研究已完成。
- 构造提示时，固定系统规则与用户指令分别传入；来源序列化为数据对象并标 `untrusted`，不拼接进系统指令；不能把正文中的 path/tool/action 解码成操作。只能返回摘要 schema，故即便源文件含“忽略规则、上传密钥”等内容也没有相应工具入口。
- 输出以纯文本/受限 Markdown 展示；不执行 HTML、脚本、远程图像或自定义协议链接。引用链接由主机生成，目标只引用批准范围内 sourceId。

### Executor 与 TaskService

`executeGoal()` 输入增加可选 `summaryGenerator`、`groundedCheckpoint` 和 `onGroundedCheckpoint`，存在合法 workflow 时分派到新增 `src/main/agent/grounded-executor.ts:executeGroundedSummary(input)`。返回仍为 `GoalOutcome`，通过现有 onCall/control.progress/最终 saveOutcome 推送，不并行重建一套任务 UI。

`TaskService.setSummaryGenerator(generator: SummaryGenerator)` 由 `MurasameCore.create()` 注入；闭包调用 gateway.callStructured，模型参数必须来自任务的 `boundModel(id)`。无绑定模型直接受阻；不临时读当前默认模型。传递 `running.controller.signal`，不能创建与任务取消脱节的后台调用。

现有 `RequestQueue.enqueue()` 不会在排队期间因 signal 立即结束。专用执行器需使用可取消等待包装 `awaitSummaryWithAbort(promise, signal)`：取消/总期限到达时立即结束本任务的等待并失效该轮结果，清理监听；底层 promise 保留 rejection handler，排到时仍由 gateway 的 signal/beforeSend 拒绝派发。不能只传 signal 就声称取消等待已即时结束；此次不需要重写全局队列。

新增摘要检查点表 `task_grounded_checkpoints(task_id PRIMARY KEY, checkpoint_json NOT NULL)`（随现有迁移管理，或遵循该服务当前建表方式二选一，不重复建两套）：

```ts
interface GroundedCheckpoint {
  version: 1
  stage: 'awaiting-source-approval' | 'generating' | 'awaiting-write-approval' | 'writing' | 'verified'
  workflowHash: string
  sourceManifest: Array<{ id: string; relativePath: string; sha256?: string; bytes: number; mtimeMs: number }>
  draft?: { markdown: string; sha256: string; citations: GroundedDraft['sections'] }
  modelSnapshotId: string
  dispatchCount: number
  traceId?: string
  outcomeKnown: boolean
}
```

来源正文仅保存在生成轮次内存；检查点保留元数据、用户需要审核/恢复的草稿和引用片段。草稿在现有 SQLCipher 库中持久化。不要把 text/lines 透传给普通 StepCheckpoint.output、AgentCall.args/raw 或完整 request 日志。引用片段按必要最小长度/总量限制，避免复制整本来源。

审批 impact 的 JSON 增加 `workflowKind`、`stage`、`workflowHash`、`sourceManifest`、`recipient`、`draftHash`（阶段 B），仍保持现有 next/remaining 数据供可读 UI 展示。两阶段 scopeKey 必须不同且包含 stage、精确范围和对应哈希；不复用“filesystem + workspace”作为整流程授权。TaskService 的执行 guard 除 plan 不变外，还核对该阶段 envelope/hash；计划、目标、模型、草稿一旦变更就作废审批。

来源在批准 A 前仅取用户列明文件的 metadata，不读取正文。发送前复查同一快照的来源身份/哈希；当前文件变化则不发送，重新确认。**不把变化后新读的字节偷偷替换进旧批准。** 阶段 B 保存前重新有界读取并核对来源 SHA-256；变化则说明草稿基于旧版本并回到来源确认，绝不自动重生成并保存。

## 取消、预算、日志和恢复

| 边界 | 必须做到 |
| --- | --- |
| 排队等待 | control.signal 在实际出队前检查；取消后不得调用 fetch；UI 显示“等待模型服务”且聊天仍可用 |
| 每次发送 | beforeSend 检查 A 授权、期限、workflow/model 指纹、来源未变、剩余预算；检查失败 abort 本轮，不能被结构化自动重试再发送 |
| 请求计数 | onDispatch 递增真实发送次数，最多 3 次（包含 callStructured 的 2 次重试）；不以外层一次调用掩盖三次发送 |
| 耗时 | 本轮从批准到草稿有 120 秒总期限，覆盖排队与重试；超时 abort 并保留事实。网关自身单次 120 秒不是总预算 |
| 成本展示 | 仅准确报告实际次数、字节/字符、耗时；当前网关没有 token/金额结算，不编造成本或声称预算包含精确价格 |
| 响应迟到 | await 返回后再次检查 signal、run generation 与 workflowHash；旧响应不能替换草稿、创建 B 审批或写文件 |
| 取消与写入竞态 | 写前检查；写后无论是否刚取消，都独立核验并记实际效果，状态可为已取消但仍显示已存在文件 |
| 日志 | Planner 记录计划摘要；Worker 记录 sourceId/hash/大小、模型脱敏快照、请求序号、开始/结束、错误分类；Critic 记录引用检查和目标哈希。无正文请求 dump、密钥、全量原始模型响应 |
| 中途失败 | 未写入时如实注明未生成文件；已生成草稿时保留；写入结果未知时先核对，不盲重放 |

恢复分支：

- **A 未批准/生成未完成**：现有 recover 标已中断；用户继续后重新核对来源并给出新 A 批准。旧网络请求不能自动重发。
- **B 待批准**：保留准确 draft/hash，不重调模型；用户继续时核对来源和目标，再新建 B 批准。B 过期/拒绝同理。
- **writing 时退出**：读取目标事实。存在且哈希等于已批准 draft 时记录已发生的结果；不存在时也先转显式批准，不能仅凭“未看到文件”自动重放；不匹配则未知/冲突受阻。
- **verified 后继续**：复核已完成结果而不重写；与现有已完成检查点语义一致。
- **用户补充更改来源、目标或摘要要求**：旧 draft 不适用于新 workflowHash；保留可查看的历史事实，重新 A，不把旧 task-scope 授权带入新计划。

## Review Focus

1. 文件正文含伪系统消息、工具 JSON 或请求读密钥：最多成为摘要数据，权限/路径/目标不变（任务 1、2 测试）。
2. A 排队时源文件变更、B 待批准时再次变更：不能发送或保存新版本，明确重新批准（任务 1、2、3）。
3. Windows junction/symlink、大小越界、编码错误、重复路径：不越界、不无限读、不把部分来源包装成完整来源（任务 1）。
4. 取消、10 分钟过期、退出后迟到响应：无新外发/草稿污染/自动写入；实际发生效果保留（任务 2、3）。
5. 旧模型被改地址/删配置、输出目标并发出现：不漂移模型、不覆盖；可恢复事实清楚可见（任务 2、3）。

## 实施任务与验收

### Task 1：受控真实来源与可追溯草稿（约 60–90 分钟）

**Files:** 新增 `src/shared/grounded-summary.ts`、`src/main/agent/grounded-summary.ts`；修改 `src/main/model/contracts.ts`、`src/main/agent/executor.ts` 中类型；新增 `tests/unit/grounded-summary.test.ts`。

**Interfaces:** 导出 `GroundedSummaryWorkflow`、`SourceSnapshot`、`GroundedDraft`；`readSummarySources(root, paths, signal): Promise<SourceSnapshot[]>`；`validateAndRenderSummary(draft, sources): {markdown:string;sha256:string}`。

- [x] 写真实临时目录测试：两份已知文本生成快照；越界/junction、33 KiB 单文件、总量、非 UTF-8、空来源和重复真实路径拒绝；行引用不存在或 quote 不匹配拒绝；来源含恶意指令只作为 text。
- [x] 跑 `npx vitest run tests/unit/grounded-summary.test.ts`，确认行为断言失败而非 fixture 错误。
- [x] 实现异步有界读取、每次读取前后校验和严格 schema；不得沿用无上限 readInside。Markdown 引用由主机生成。
- [x] 复跑该专属文件；阅读生成的真实 Markdown，核对引用确实指向原句。

### Task 2：两阶段执行、模型接线与持久恢复（约 90–150 分钟）

**Files:** 新增 `src/main/agent/grounded-executor.ts`；修改 `src/main/agent/executor.ts`、`src/main/core/services/task-service.ts`、`src/main/core/murasame-core.ts`；新增 `tests/unit/grounded-task-service.test.ts`。

**Interfaces:** `SummaryGenerator` 按上文；`executeGroundedSummary` 消费现有执行控制并产出 GoalOutcome；检查点回调只持久化允许字段。

- [x] 写实际 TaskService + SQLite + 临时磁盘测试，仅控制模型边界：A 前请求数 0/输出不存在；A 后模型收到真实文件特有句；伪引用失败；好草稿进入 B 且输出仍不存在；B 后精确文件哈希通过。
- [x] 加取消在排队/请求/响应后、来源变化、最多 3 次实际 dispatch、总体超时、模型绑定变更、B 过期/拒绝、目标并发出现、restart during writing 的断言。
- [x] 跑该专属文件见红；实现 stage 分派、授权指纹、gateway controls、恢复分流和引用/写入独立核验。
- [x] 复跑两个专属文件；数据库检查 tool_calls/checkpoint 不含整份 source sentinel，草稿和必要引用保留在专用字段。

### Task 3：可读两次批准和真实 Electron 闭环（约 60–90 分钟）

**Files:** 修改 `src/shared/task-approval.ts`、`src/renderer/src/components/ApprovalDetails.tsx`，必要时 `dialogs.tsx`/`TasksPage.tsx`；新增 `tests/unit/grounded-approval.test.tsx`、`tests/e2e/grounded-summary.spec.ts`。

**Interfaces:** 使用现有 Task.approval 和 task approve/deny/continue IPC；impact 新字段解析在共享展示模块中；不让 UI 自己计算权威授权。

- [x] UI 测试：A 可见全部来源、外发对象/用途；B 可见最终完整正文、引用、准确路径和不会覆盖；选择 task 范围不能隐藏第二次批准；错误/超限有下一步处理入口。
- [x] Electron E2E：临时真实 source 文件和本地受控模型 HTTP 服务；捕获请求确认来源正文真正发送且只有 A 后发送；模型返回来自文件的确定草稿，真实 UI 批准 B 后磁盘字节准确，查看成果链接有效。
- [x] 独立慢响应测试同时正常聊天、取消或隐藏窗口：聊天可响应，隐藏继续该任务，取消不再保存。测试运行使用临时 userData 和专属 output。
- [x] 主工作线统一 build 后跑专项 E2E；最终统一 typecheck/test/lint/build 由集成线一次执行。未通过之前不声称能力完成，不提交与本任务无关文件。

预计总计约 3.5～5.5 小时，取决于现有恢复 API 适配。若可用窗口不足，应在 Task 2/3 之前停止并保留设计，不交付半条会绕过审批的路径。此增量完成后仍保留原审计中的一般任务规划、模型 Critic、多智能体动态分工、隔离办公/编程与自然图像能力缺口。
