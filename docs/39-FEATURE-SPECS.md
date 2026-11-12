# murasame 功能扩展规格（F-01 ~ F-04）

> 文档编号：39 · 版本：v0.1（提案）· 日期：2026-11-13
> 状态：**全部为设计规格，未实现**。本文不新增 SRS 功能需求编号，不改变 `docs/00-OVERVIEW.md` 的架构约定与 `docs/01-DECISIONS.md` 的行为口径。
> 前瞻叙事与设计边界见 [`docs/38-PRODUCT-VISION.md`](./38-PRODUCT-VISION.md)；视觉原型见 [`previews/vision/`](../previews/vision/README.md)。

---

## 0. 阅读约定

### 0.1 本文的位置

- 本文描述 4 个**表现层扩展功能**。它们依赖 SRS 已有能力（对话、记忆、任务、桌宠、主动互动、自主活动），不新增数据采集、不新增权限类型。
- 每个功能包含：一句话价值、现状与问题、用户故事、硬规则、交互流程（桌宠/控制台分工）、状态机、数据结构、存储迁移、IPC/接口草案、与现有模块集成点、可测验收标准、风险与降级、优先级与工作量、开放问题。
- 所有「新增语义」需甲方确认（见 `docs/38` §6.4）后才可排入 `docs/02-TASKS.md`。

### 0.2 工程约定（沿用现有代码）

| 约定 | 落地方式 |
| --- | --- |
| 返回值 | 全部用 `Result<T> = { ok: true; data } \| { ok: false; error }`，失败带用户可读中文原因 |
| IPC 边界 | 渲染层只经 preload 白名单调用；参数在 `src/shared/schemas.ts` 用 zod 校验；通道常量集中在 `src/shared/ipc.ts` |
| 主进程职责 | 数据读取、模型调用、状态机、持久化全部在主进程；渲染层不碰 `fs` / 数据库 / 凭据 |
| 事件 | 主进程 → 渲染层单向推送，命名沿用 `<domain>:<event>`；取消订阅返回 `() => void` |
| 失败 | 未实现的能力抛 `NotImplementedError` 或返回明确失败，不新增 mock 回退（OR-01、NFR-R01） |
| 测试标题 | 新增测试必须以 SRS 编号开头，可附加功能编号：`it('[FR-15][F-01] 未召回的条目不会点亮', ...)` |
| 数据 | 新表通过 `src/main/data/migrations/004_*.sql`、`005_*.sql` 增量迁移；旧库可平滑升级 |
| 外发 | 任何把用户数据交给模型的行为先检查外发授权（IF-09、SET-05），并在 UI 说明发送内容 |

### 0.3 总览

| 编号 | 功能 | 一句话价值 | 优先级 | 依赖 | 新数据 | 新权限 | 建议里程碑 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | 记忆房间 | 把「它记得我」变成一间可以走进去、看得见来源、能当场更正的房间 | P1 | FR-14/15、D-21、D-04 | `memory_light_events` | 无 | M4 |
| F-02 | 每日回顾 | 一天结束时用真实发生的事写一页日签，不评分、不打卡、不制造负罪感 | P1 | F-01 可选、FR-12/19/21 | `daily_reviews` | 外发授权（若用模型润色） | M4 |
| F-03 | 情绪天气 | 把 SRS 要求的「情绪状态」呈现成一张可读、可解释、不需要用户哄的天气卡 | P2 | FR-02、D-30 | 无 | 无 | M4 |
| F-04 | 桌面小剧场 | 把真实发生的一件事排成 5–15 秒的一幕，在桌宠脚边演完，不打断、可跳过 | P2 | FR-03、FR-28~30、D-01 | 复用 `meta`（已演事件键） | 无 | M5 |

**共同目标**：让「连续性」和「诚实」变成用户看得见的东西，而不是只存在于数据和提示词里。

---

## 1. 共用设计约定

### 1.1 来源引用（SourceRef）是一切生成内容的硬门槛

四个功能都会产生「它说/它写」的内容。为避免编造，统一引入来源引用类型：

```ts
// src/shared/presence.ts（新增，渲染层与主进程共用）
export type SourceRef =
  | { kind: 'conversation'; conversationId: string; messageId?: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'memory'; memoryId: string }
  | { kind: 'autonomy'; activityId: string }
```

规则：

1. 任何展示给用户的「事实句」必须能映射到至少一个 `SourceRef`；回顾/剧场生成完成后由主进程逐条校验，**无来源的条目直接丢弃**（不是报错，而是不出现在结果里），并在 `missing` 字段记录被丢弃数量。
2. `SourceRef` 指向的对象被删除后，相关展示必须消失或降级为「来源已删除」，不得保留原文（NFR-S02）。
3. 模型只允许「改写已有事实的措辞」，不允许新增事实。事实槽位由程序填充，模型输出只提供句式。

### 1.2 统一设置新增（`AppSettings` 扩展）

```ts
// 追加到 src/shared/types.ts 的 AppSettings
memoryRoomEnabled: boolean          // 默认 true（仅当 memoryEnabled 时生效）
reviewEnabled: boolean              // 默认 true
reviewAutoGenerate: boolean         // 默认 true
reviewTime: string                  // 'HH:mm'，默认 '18:30'
reviewModelPolish: boolean          // 默认 false；开启前须明示外发范围
emotionWeatherVisible: boolean      // 默认 true
theaterEnabled: boolean             // 默认 true
theaterSound: boolean               // 默认 false
```

对应 `settingsPatchSchema` 增补同名字段；不得在渲染层直接改这些值之外的行为。

### 1.3 错误与降级显示

沿用 `docs/07-UI-CONVENTIONS.md` 的状态文案。新增场景只使用既有词表，不新增「心情不好」「想你」这类状态文案。

| 场景 | 显示 |
| --- | --- |
| 数据不足 | 未验证/空状态，说明缺什么 |
| 生成失败 | 已降级/失败 + 原因 + 下一步 |
| 模型不可用 | 已降级（本地生成）+ 说明 |
| 记忆服务不可用 | 未验证（召回受限），不假装「没有记忆」 |

---

## 2. F-01 记忆房间（Memory Room）

### 2.1 元信息

| 项 | 内容 |
| --- | --- |
| 功能编号 | F-01 |
| 上位需求 | FR-14、FR-15、FR-12、FR-13、FR-05（记忆来源）、UC-05、UC-04；约束 NFR-S02、NFR-M01、D-04、D-21、D-22 |
| 现状问题 | 记忆页是列表 + 搜索；召回结果只在对话侧栏显示「本轮已召回」；用户无法看到「这条记忆为什么被想起」「它到底有没有用过这条」；`docs/22`/`docs/32` 已证明召回质量存在不确定性 |
| 新数据 | `memory_light_events`（点亮事件） |
| 新权限 | 无 |
| 依赖模型 | 不需要（点亮由检索/注入事实决定） |
| 状态 | 设计方案，未实现 |

### 2.2 一句话价值

> 把「它记得我」从一句无法验证的话，变成一间可以走进去的房间：每条记忆有位置、有来源、有被想起来的记录，也能当场更正或删除。

### 2.3 用户故事

1. 作为长期用户，我想看到它到底记住了我哪些事、分别来自哪次对话，这样我能判断它是不是真的了解我。
2. 作为被记错的用户，我想在发现记忆错误时当场更正，并看到它之后确实改用新值。
3. 作为隐私敏感用户，我想一键遮住所有记忆文本，只有我一个人时再展开。
4. 作为新用户，我想在房间空空时看到「它还在认识你」，而不是看到一堆编造的记忆卡片。
5. 作为好奇的用户，我想在它说「你之前提过」时点一下就看到依据，而不是只能相信它。

### 2.4 硬规则

1. **没有真实召回就没有点亮**：只有本轮确实把该条注入上下文（`recalledMemoryIds` 含该 ID）才写点亮事件；不得为了「显得记得」而补点。
2. **点亮不等于明说**：默认「无感」级别，回答里自然使用偏好，不额外邀功；只有用户追问或关键提醒时才「明说」来源。
3. **删除即失声**：删除记忆后，房间卡片、回顾引用、后续点亮全部消失；点亮历史仅保留审计，不展示原文（NFR-S02）。
4. **不确定要可见**：召回服务降级、索引不完整、向量模型缺失时，房间顶部显示「未验证/受限」，不给用户「它全记得」的错觉（NFR-U03、`docs/31`）。
5. **不朗读敏感内容**：房间内可读，但主动互动与语音不得复述敏感记忆（D-05 禁止项、NFR-M01）。
6. **不改写历史**：更正生成新版本并保留旧值失效记录；不允许静默覆盖到看不出来（D-21、D-31）。

### 2.5 交互流程

**房间的四个区域**（按 D-21 四分类映射为「房间里的四个家具」）：

| 区域 | 分类 | 视觉 | 内容 |
| --- | --- | --- | --- |
| 书桌便签 | `user` | 暖色便签墙 | 称呼、偏好、知识背景 |
| 反馈盒 | `feedback` | 小木盒 / 书签 | 要避免什么、要保持什么 |
| 工作台 | `project` | 图纸与进度条（非数值化） | 目标、进度、已做的决策 |
| 书架 | `reference` | 一格一格的书 | 链接、文档位置、工单号 |

**主流程（用户在控制台）**：

1. 侧栏「记忆」→ 顶部两个 Tab：「列表」/「房间」；默认进入列表，房间由用户主动点开（不强迫）。
2. 房间打开时，顶部显示：记忆总数、今天被点亮次数、最近一次更正、召回状态（完整/受限/不可用/已关闭）。
3. 每条记忆是一张卡：分类、正文（最长 3 行后展开）、来源（会话名或「手动添加」）、创建/更新时间、点亮次数、状态（有效/已失效）。
4. 点卡片 → 右侧详情：来源会话消息、首次记录时间、被点亮时间线（最近 5 次）、`valid_from`/`valid_until`、失效原因、操作（更正/删除/不感兴趣/敏感标记）。
5. 顶部时间带「最近被点亮」：按时间倒序显示今天/昨天的点亮事件，点击跳回对应会话消息。
6. 「本轮为什么想起」：从对话页侧栏点一条已召回记忆，打开房间详情并高亮该条，展示本轮用户问题与召回原因（如「与‘评审时间’语义相近」）。
7. 「隐私遮罩」：`memoryRoom:set-mask` 或按 Esc，所有正文模糊为「••••」，仅显示分类与数量；再次点击恢复。
8. 空状态：无记忆时显示「它还在认识你。聊几次之后，这里会亮起第一盏灯。」并提供「手动添加」入口。

**主流程（在桌宠上）**：

1. 用户问「你还记得我上周说的评审吗？」→ 回复中可带一个小角标「记忆 · 2」；点击角标或说「打开记忆房间」→ 控制台打开 `/memory?tab=room&focus=<memoryId>`。
2. 记忆被点亮时桌宠**默认无动画**；只有用户主动询问、或回顾页在展示时，才可在气泡角落显示极淡的光点，2 秒后消失。
3. 桌宠**永不**在气泡里朗读完整记忆正文；需要引用时只说「你之前提过的那件事」。

**异常流**：

- 记忆服务不可用 → 房间显示「召回服务不可用，已有条目仍可查看」；桌宠回复说「这次没找到相关记忆」。
- 索引不完整 → 顶部显示「正在整理记忆 / 部分可用」，房间仍可读。
- 点亮事件写入失败 → 不显示点亮、不补写；记录日志（不记录记忆正文，NFR-M01）。

### 2.6 状态机

**房间视图状态**：

| 状态 | 进入条件 | 允许操作 | 退出 |
| --- | --- | --- | --- |
| `closed` | 未打开 | — | 打开房间 → `browsing` |
| `browsing` | 打开记忆/房间 | 搜索、筛选、切换区域、隐私遮罩 | 点卡片 → `detail`；离开 → `closed` |
| `detail` | 选中一条记忆 | 查看来源、点亮历史、更正、删除 | 返回 → `browsing`；更正 → `correcting` |
| `correcting` | 点击更正 | 编辑分类/正文、保存、取消 | 保存成功 → `detail`；取消 → `detail` |
| `confirm-delete` | 点击删除 | 确认（带来源影响说明）、取消 | 确认 → `browsing`；取消 → `detail` |
| `masked` | 用户触发遮罩 | 取消遮罩、完全退出 | 取消 → 回到之前状态 |

**点亮事件生命周期**（事件不可变，只追加）：

| 状态 | 含义 | 触发 |
| --- | --- | --- |
| `recorded` | 已写入数据库 | 召回实际注入本轮上下文时 |
| `delivered` | 已推送到渲染层（对话侧栏/房间） | 主进程 `memory-room:lit` 推送成功 |
| `seen` | 用户看到过（可选，仅用于回顾统计「今天被想起」） | 房间/回顾打开且元素可见 |
| `pruned` | 超过保留期被清理（默认 90 天） | 启动时维护任务 |

### 2.7 数据结构（TS 草案）

```ts
// src/shared/memory-room.ts（新增）
import type { MemoryEntry, MemoryRecallStatus } from './types'

export type MemoryLightLevel = 'silent' | 'glow' | 'spoken'
export type MemoryLightReason = 'recall' | 'review' | 'manual' | 'correction'

export interface MemoryLightEvent {
  id: string
  memoryId: string
  conversationId: string | null
  messageId: string | null
  level: MemoryLightLevel
  reason: MemoryLightReason
  /** 面向用户的短解释，如「与『评审时间』语义相近」。不得含记忆正文。 */
  reasonText: string
  createdAt: string
}

export interface MemoryRoomCard extends MemoryEntry {
  sourceKind: 'conversation' | 'task' | 'manual' | 'autonomy'
  sourceConversationId: string | null
  validFrom: string | null
  validUntil: string | null
  supersededBy: string | null
  confidence: number | null
  lightCount: number
  lastLitAt: string | null
  sensitive: boolean
}

export interface MemoryRoomSection {
  category: 'user' | 'feedback' | 'project' | 'reference'
  title: string
  cards: MemoryRoomCard[]
}

export interface MemoryRoomView {
  sections: MemoryRoomSection[]
  recentlyLit: MemoryLightEvent[]
  recallStatus: MemoryRecallStatus
  recallNote: string
  stats: { total: number; litToday: number; correctedRecently: number }
  masked: boolean
}

export interface RecallTrace {
  conversationId: string
  messageId: string
  query: string
  hits: Array<{ memoryId: string; score: number; injected: boolean; reasonText: string }>
  degraded: boolean
  note: string
}
```

### 2.8 存储与迁移

```sql
-- src/main/data/migrations/004_memory_light.sql
CREATE TABLE IF NOT EXISTS memory_light_events (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  conversation_id TEXT,
  message_id TEXT,
  level TEXT NOT NULL CHECK (level IN ('silent','glow','spoken')),
  reason TEXT NOT NULL CHECK (reason IN ('recall','review','manual','correction')),
  reason_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_light_memory ON memory_light_events(memory_id, created_at);
CREATE INDEX IF NOT EXISTS idx_light_created ON memory_light_events(created_at);
```

- 保留策略：默认 90 天，启动时清理；清理只删事件，不删记忆。
- 不存记忆正文，避免重复存储与清除遗漏。
- 读取聚合在 SQL 层完成（`COUNT` / `MAX(created_at)`），一次查询返回房间视图，避免 N+1。

### 2.9 IPC / 接口草案

```ts
// src/shared/ipc.ts 追加
memoryRoom: {
  getView: 'memory-room:get-view',
  getRecallTrace: 'memory-room:get-recall-trace',
  markSeen: 'memory-room:mark-seen',
  setMasked: 'memory-room:set-masked',
  lit: 'memory-room:lit'            // 主 → 渲染 事件
}

// src/shared/schemas.ts 追加
export const recallTraceSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1)
})
export const markLightSeenSchema = z.object({ eventIds: z.array(z.string().min(1)).max(50) })
export const roomMaskSchema = z.object({ masked: z.boolean() })
```

preload 白名单（`src/preload/index.ts`）追加：

```ts
memoryRoom: {
  getView: (): Promise<Result<MemoryRoomView>> => ipcRenderer.invoke(IPC.memoryRoom.getView),
  getRecallTrace: (input) => ipcRenderer.invoke(IPC.memoryRoom.getRecallTrace, input),
  markSeen: (input) => ipcRenderer.invoke(IPC.memoryRoom.markSeen, input),
  setMasked: (input) => ipcRenderer.invoke(IPC.memoryRoom.setMasked, input),
  onLit: (listener) => subscribe(IPC.memoryRoom.lit, listener)
}
```

失败语义：

- `getView` 不需要模型/网络；记忆服务不可用时返回 `ok: true` + `recallStatus: 'unavailable'`（房间仍可读），而不是整体失败。
- `getRecallTrace` 只能查询当前会话最近一轮；历史轮次超过 7 天返回 `ok: false` + 「历史召回的来源记录已过期」。

### 2.10 与现有模块的集成点

| 模块 | 文件 | 集成方式 |
| --- | --- | --- |
| 记忆服务 | `src/main/core/services/memory-service.ts` | `recallMemories()` 产出命中结果后，对**实际注入**的 ID 写 `memory_light_events`；新增 `roomView()` 聚合查询 |
| 对话服务 | `conversation-service.ts` | 复用既有 `recalledMemoryIds` / `recalledAtMessageId` 字段；新增消息轮次 ID 关联 |
| 记忆页 | `src/renderer/src/pages/MemoryPage.tsx` | 增加「列表 / 房间」Tab；列表逻辑保留，避免功能回退 |
| 对话侧栏 | `ChatPage.tsx` | 已召回记忆条目可点击 → 打开房间详情 |
| 桌宠 | `pet.tsx`、`pet-work.ts` | 新增极轻量 `memory-hint` 表现；不得影响口型/情绪/任务状态优先级（D-28） |
| 关系 | `relationship-service.ts` | 房间顶部可显示关系阶段（只读），语气由关系阶段决定 |
| 回顾 | F-02 | 读取当日点亮事件做「它记住的」段落 |

### 2.11 验收标准（可测）

| 编号 | 验收标准 |
| --- | --- |
| F-01/AC-1 | 一轮对话实际注入了 3 条记忆 → 恰好产生 3 条点亮事件；未被注入的命中不产生事件 |
| F-01/AC-2 | 对话未触发召回 → 房间与对话侧栏都不出现新点亮 |
| F-01/AC-3 | 删除一条记忆 → 房间卡片消失、今日回顾不再引用、后续对话不再召回；点亮历史不再展示正文 |
| F-01/AC-4 | 更正记忆 → 新值立即可召回；旧值有 `valid_until` 且房间可追溯 |
| F-01/AC-5 | 记忆服务不可用 → 房间显示「召回不可用，已有条目仍可查看」，不显示「今天点亮 0 次」冒充正常 |
| F-01/AC-6 | 点击一条已召回记忆 → 展示本轮问题、召回原因、来源消息；来源已删除时显示「来源已删除」 |
| F-01/AC-7 | Esc / 遮罩按钮 → 所有记忆正文不可读（DOM 中不含原文），仅显示分类与数量 |
| F-01/AC-8 | 关闭长期记忆 → 房间只读且顶部说明停止提取/召回；不出现新点亮 |
| F-01/AC-9 | 从桌宠角标进入 → 控制台打开到房间并高亮指定卡片；桌宠气泡不含记忆正文 |
| F-01/AC-10 | 500 条记忆 + 5000 条点亮事件下，房间首屏 ≤ 500 ms、滚动无明显卡顿（本地基准） |
| F-01/AC-11 | 重复事件幂等：同一轮重复推送不会重复计数 |
| F-01/AC-12 | 无记忆的新用户 → 空状态引导，不生成示例记忆 |

**测试覆盖要求**（NFR-M02 五类情形）：正常注入、无召回、记忆服务失败、用户删除/更正、索引降级。测试标题以 `[FR-14]`、`[FR-15]`、`[UC-05]` 开头，附加 `[F-01]`。

### 2.12 风险与降级

| 风险 | 说明 | 降级 |
| --- | --- | --- |
| 房间变成表演「我全都记得」 | 点亮过多、每条都邀功 | 默认 silent 级；点亮不阻断对话；房间才展示 |
| 召回本身不准确 | 房间放大了错误记忆的可见性 | 每条可一键「记错了」；更正后立即失效；房间顶部显示召回质量状态 |
| 隐私泄露 | 房间被他人看到 | 遮罩按钮 + Esc；敏感记忆默认只在列表显示 |
| 事件表膨胀 | 高频召回写库 | 只对实际注入写；保留 90 天；批量写 |
| 误导用户认为数据已上传 | 房间是本地视图 | 页面固定说明「只在本机显示，不会上传」 |
| 旧记忆页功能回退 | 改 Tab 时破坏列表 | 保留原列表路径与测试；只新增 Tab |

### 2.13 优先级与工作量

| 项 | 估计 |
| --- | --- |
| 优先级 | P1（用户价值高、无新权限、数据基础已存在） |
| 主进程/数据层 | 2.5 人日（事件写入、聚合法、迁移、清理） |
| 渲染层 | 3 人日（房间布局、详情、遮罩、空状态） |
| 桌宠联动 | 0.5 人日 |
| 测试（单测 + e2e） | 1.5 人日 |
| 合计 | **约 7.5 人日** |

### 2.14 开放问题

1. 房间视觉用「四个家具区域」还是「墙面网格」？需要 UI 线框图对比（建议先做 `previews/vision` 的静态版再定）。
2. 点亮事件是否展示「被想起 N 次」？N 大是否会给用户「被监视」感？建议只显示最近 5 次时间点，不显示累计次数。
3. 敏感记忆的判定由用户手动标记还是分类规则自动判定？建议先手动，规则后续。

---

## 3. F-02 每日回顾（Daily Review）

### 3.1 元信息

| 项 | 内容 |
| --- | --- |
| 功能编号 | F-02 |
| 上位需求 | FR-12、FR-14、FR-19、FR-21、UC-04、UC-05、UC-06；约束 NFR-R01、NFR-S02、NFR-U02、IF-09 |
| 现状问题 | 用户每天的使用痕迹分散在对话、任务、记忆、自主活动四个页面；没有任何「今天发生了什么」的聚合；项目已有的诚实核验结论（成功/部分完成/失败）没有被用户看见 |
| 新数据 | `daily_reviews` |
| 新权限 | 若用模型润色，需要外发授权（IF-09）；默认本地生成不需要 |
| 依赖模型 | 可选（仅润色，不参与事实判定） |
| 状态 | 设计方案，未实现 |

### 3.2 一句话价值

> 一天结束时，用真实发生过的事给你一页日签：做成了什么、没做成什么、它记住了什么、它看到了什么、明天可以聊什么。不评分，不打卡，不制造负罪感。

### 3.3 用户故事

1. 作为忙碌的用户，我想在一天结束时 1 分钟内知道今天和它一起发生了什么，而不必翻四个页面。
2. 作为委托过任务的用户，我想看到任务的真实结论（完成/部分完成/失败），失败也要出现，而不是只挑好的说。
3. 作为重视隐私的用户，我想知道这份回顾用了哪些数据，并能删掉或更正。
4. 作为不想被打扰的用户，我想自己决定回顾生成时间，或者干脆关掉。
5. 作为新用户，我不想看到一份编造的「今天也很棒」，宁可看到「今天还没有值得回顾的事」。

### 3.4 硬规则（三条诚实规则 + 三条克制规则）

**诚实**：

1. **只写有来源的事实**：每一条内容必须带 `SourceRef`；生成后程序逐条校验，无来源丢弃并记录丢弃数。
2. **失败必须出现**：当天有失败/部分完成/取消/中断的任务，必须至少出现一条；不允许只选正面内容。核验结论以 `Task.verdict` 与状态为准；`inconclusive` 一律写「未完成确认」。
3. **没有内容就说没有**：无达到阈值的数据时生成「空回顾」，明确写「今天没有值得回顾的事」，不生成模板化赞美。

**克制**：

4. **不主动弹窗**：回顾准备好后只在控制台「今日」与托盘显示角标；桌宠最多一句「今天的回顾放桌上了」。
5. **不做 KPI**：不显示完成率、连续天数、评分、排名、连胜；不因为某天没有回顾而提示「你退步了」。
6. **可跳过、可关闭、可删除**：跳过不产生任何后续追问；关闭后不再生成；删除后彻底消失（含来源引用缓存）。

### 3.5 数据窗口与生成时机

- **窗口**：本地时区当天 `00:00:00`–`23:59:59.999`，按消息/任务 `created_at`、自主活动 `finished_at` 归属；跨零点消息归入次日（按本地时间）。
- **触发**：默认在 `reviewTime`（18:30）之后，至次日 00:30 前，遇到「用户空闲 ≥ 2 分钟 且 非全屏 且 无任务执行」时在**后台**生成；不弹窗、不抢焦点。
- **每日一次**：`(local_date, version)` 唯一；手动「重新生成」创建 version+1，旧版本保留可查，界面显示「基于再生成」并列出与上一版的差异摘要（哪些条目新增/消失）。
- **数据阈值**（至少满足其一才生成非空回顾）：
  - 当天消息 ≥ 6 条，或 ≥ 2 个会话；
  - 当天有 ≥ 1 个终态任务；
  - 当天有记忆新增/更正/失效；
  - 当天有完成的自主活动且产出了见闻。
- **失败降级**：模型润色失败 → 本地模板生成，`generatedBy: 'local'`，页面明确标注「本地生成，未经模型润色」；连本地生成也失败（数据库错误）→ `status: 'failed'`，显示原因与「重试」。

### 3.6 交互流程

**回顾页结构（控制台，5 段）：**

| 段落 | 数据来源 | 展示规则 | 示例 |
| --- | --- | --- | --- |
| 今天聊了什么 | 当天消息（脱敏后摘要，最多 3 条） | 每条带会话链接；敏感内容打码或不显示 | 「你问了如何整理下载文件夹」 |
| 做成 / 没做成 | 当天终态任务 + `verdict` | 成功、部分完成、失败、取消分别标注；失败必须出现 | 「整理任务：部分完成（2 个文件权限不足）」 |
| 它记住的 | 当天新增/更正记忆 + 点亮事件 | 显示分类与原因，正文可点开；不朗读 | 「新增偏好：不喜欢开会」 |
| 它看到的 | 当天自主活动见闻（`ActivityResult.observations`） | 只转述观察；标注「在隔离环境看到」；外部内容不可信提示 | 「在隔离环境浏览了 XX 页面，看到……」 |
| 留给明天 | 用户可编辑 3 个槽位 + 从 `project` 记忆提取的近期日期 | 用户输入优先；日期项标注来源与不确定度 | 「明天：继续评审材料（来自 3 天前的记忆）」 |

**页脚**：

- 「这份回顾的依据」可展开：所有 `SourceRef`、生成方式（本地/模型+模型名）、生成时间、丢弃条目数。
- 「哪里不对」→ 跳转到对应记忆/任务/会话，支持一键更正。
- 「删除这份回顾」：删除正文与来源引用；对话/任务本身不受影响（说明清除范围，NFR-S02）。
- 「今天不想看」：标记 `dismissed`，当天不再提示；不影响次日。

**桌宠分工：**

- 回顾可用：只说一句邀请（当天最多一次），不朗读全文。
- 用户主动问「今天怎么样」：用 1–2 句概括，必须包含失败项（若有）；详细信息引导到控制台。
- 回顾被跳过/关闭：不追问、不表达失望。

### 3.7 状态机

| 状态 | 进入条件 | 允许操作 | 退出 |
| --- | --- | --- | --- |
| `not-due` | 未到生成时间或无数据 | 手动生成（用户主动） | → `generating` |
| `generating` | 触发/手动生成 | 取消（中止模型调用） | 成功 → `ready`；失败 → `failed` |
| `ready` | 生成完成 | 查看、编辑明日槽位、更正来源、再生成、删除、标记已读 | 已读 → `seen`；删除 → `deleted` |
| `seen` | 用户打开过 | 任何查看/编辑操作 | — |
| `dismissed` | 用户点「今天不想看」 | 重新打开 | 次日新建 |
| `failed` | 生成失败 | 重试、查看原因 | → `generating` |
| `deleted` | 用户删除 | 重新生成（新 version） | → `generating` |

再生成规则：保留旧 version，`review.get(date)` 默认返回最新 version；页面可切「上一版」，但不得把旧版当最新展示。

### 3.8 数据结构（TS 草案）

```ts
// src/shared/daily-review.ts（新增）
import type { TaskStatus } from './types'
import type { Verdict } from './evidence'
import type { SourceRef } from './presence'

export type ReviewGeneratedBy = 'local' | 'model'
export type ReviewStatus = 'not-due' | 'generating' | 'ready' | 'seen' | 'dismissed' | 'failed' | 'deleted'

export interface ReviewItem {
  id: string
  text: string                 // 已脱敏、面向用户的中文摘要
  sourceRef: SourceRef
  sensitive: boolean
}

export interface ReviewOutcome {
  taskId: string
  title: string
  status: TaskStatus
  verdict: Verdict | null
  summary: string              // 由程序按状态与核验结论拼装，模型不可改写事实
}

export interface ReviewMemoryChange {
  memoryId: string
  change: 'added' | 'updated' | 'invalidated' | 'deleted' | 'lit'
  category: string
  summary: string              // 不直接展示敏感原文
}

export interface ReviewObservation {
  activityId: string
  kind: string
  summary: string
  limitation: string           // 例如「视频无字幕」「自动化未成功」
}

export interface ReviewTomorrowItem {
  id: string
  text: string
  sourceRef: SourceRef | null  // 用户手填为 null
  editable: boolean
}

export interface DailyReview {
  id: string
  localDate: string            // YYYY-MM-DD
  version: number
  status: ReviewStatus
  generatedBy: ReviewGeneratedBy
  modelProfileId: string | null
  sections: {
    conversations: ReviewItem[]
    outcomes: ReviewOutcome[]
    memories: ReviewMemoryChange[]
    observations: ReviewObservation[]
    tomorrow: ReviewTomorrowItem[]
  }
  sourceRefs: SourceRef[]
  droppedFacts: number         // 无来源被丢弃的条目数（诚实可见）
  missingSources: string[]     // 哪些数据源不可用（如记忆服务降级）
  userNote: string
  createdAt: string
  seenAt: string | null
}

export interface DailyReviewSummary {
  localDate: string
  available: boolean
  hasFailure: boolean
  preview: string
}
```

### 3.9 存储与迁移

```sql
-- src/main/data/migrations/005_daily_review.sql
CREATE TABLE IF NOT EXISTS daily_reviews (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  generated_by TEXT NOT NULL CHECK (generated_by IN ('local','model')),
  model_profile_id TEXT,
  payload_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  dropped_facts INTEGER NOT NULL DEFAULT 0,
  user_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  seen_at TEXT,
  UNIQUE (local_date, version)
);
CREATE INDEX IF NOT EXISTS idx_review_date ON daily_reviews(local_date, version DESC);
```

- 只存结构化 JSON + 来源，不重复存原文；内容删除时同步清理 `payload_json` 中的正文（NFR-S02）。
- 容量：每日 1 条 × 最多 3 个版本，一年 < 1100 条，量级安全（符合 D-13 容量）。
- 生成失败不落库，避免留下半成品。

### 3.10 IPC / 接口草案

```ts
// src/shared/ipc.ts 追加
review: {
  get: 'review:get',                 // { localDate?: string }
  generate: 'review:generate',       // { localDate?: string; force?: boolean }
  updateTomorrow: 'review:update-tomorrow',
  markSeen: 'review:mark-seen',
  dismiss: 'review:dismiss',
  delete: 'review:delete',
  updated: 'review:updated',         // 主 → 渲染
  available: 'review:available'      // 主 → 渲染（角标）
}

// src/shared/schemas.ts 追加
export const reviewGetSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})
export const reviewGenerateSchema = reviewGetSchema.extend({ force: z.boolean().optional() })
export const reviewTomorrowSchema = z.object({
  reviewId: z.string().min(1),
  items: z.array(z.object({
    id: z.string().min(1),
    text: z.string().trim().min(1).max(200)
  })).max(3)
})
export const reviewIdSchema = z.object({ reviewId: z.string().min(1) })
```

preload 白名单：

```ts
review: {
  get: (input) => ipcRenderer.invoke(IPC.review.get, input),
  generate: (input) => ipcRenderer.invoke(IPC.review.generate, input),
  updateTomorrow: (input) => ipcRenderer.invoke(IPC.review.updateTomorrow, input),
  markSeen: (input) => ipcRenderer.invoke(IPC.review.markSeen, input),
  dismiss: (input) => ipcRenderer.invoke(IPC.review.dismiss, input),
  delete: (input) => ipcRenderer.invoke(IPC.review.delete, input),
  onUpdated: (listener) => subscribe(IPC.review.updated, listener),
  onAvailable: (listener) => subscribe(IPC.review.available, listener)
}
```

模型润色约束：

- 输入只包含程序已整理的结构化事实（每项带 `sourceRef` 与脱敏文本），不包含截图、原始网页、完整对话原文。
- 输出使用结构化 schema：只允许返回 `text` 改写字段，不允许新增条目、不允许修改状态/结论。
- 校验失败最多重试 2 次，仍失败改用本地模板（NFR-R01；D-18 的 retry 约定）。
- 发送前展示「本次回顾将把以下摘要发送给模型服务」；只有用户显式打开 `reviewModelPolish`（默认关闭）才调用模型，并可随时撤回。

### 3.11 与现有模块的集成点

| 模块 | 文件 | 集成方式 |
| --- | --- | --- |
| 对话 | `conversation-service.ts` / messages 表 | 按本地日期查询当天会话与消息；摘要时脱敏 |
| 任务 | `task-service.ts` / tasks 表 | 读取当天终态任务、`verdict`、`result`；失败必须进入回顾 |
| 记忆 | `memory-service.ts` | 读取当天新增/更新/失效；读取 F-01 点亮事件；无服务时 `missingSources` |
| 自主活动 | `autonomy-service.ts` | 读取当天 `ActivityResult.observations` 与 `limitations`；失败活动写「未完成」 |
| 关系 | `relationship-service.ts` | 回顾语气按阶段；阶段变化记入回顾（「今天进入熟悉」） |
| 主动互动 | `proactive-service.ts` | 回顾可用作为一个「值得开口的理由」，仍受 D-01 抑制 |
| 桌宠 | `pet.tsx` / `pet-work.ts` | 脚边「回顾可用」状态；点击打开控制台 |
| 设置 | `settings-service` / `schemas.ts` | 新增 `reviewEnabled`、`reviewAutoGenerate`、`reviewTime` |

### 3.12 验收标准（可测）

| 编号 | 验收标准 |
| --- | --- |
| F-02/AC-1 | 当天有 1 个失败任务 + 1 个成功任务 → 回顾中两者都出现，失败在前或按时间排序但不被隐藏 |
| F-02/AC-2 | 当天无任何数据 → 生成空回顾「今天没有值得回顾的事」，不生成赞美模板 |
| F-02/AC-3 | 任意一条内容展开依据 → 能看到对应会话/任务/记忆/活动 ID；被删除来源显示「来源已删除」 |
| F-02/AC-4 | 删除一条记忆后重新生成回顾 → 该记忆内容不再出现 |
| F-02/AC-5 | 模型不可用/未配置 → 本地生成，页面标注「本地生成」；生成耗时 ≤ 1 s（本地基准） |
| F-02/AC-6 | 模型调用超时 → 5 s 内降级为本地版本，不显示空白页 |
| F-02/AC-7 | 生成失败（数据库错误）→ 显示失败原因与「重试」，不把空内容显示为成功 |
| F-02/AC-8 | 跨零点消息归入次日；时区变化后 `localDate` 正确 |
| F-02/AC-9 | 重复生成 → version+1，旧版本可查，默认展示最新 |
| F-02/AC-10 | 关闭回顾 / 删除回顾 → 不再生成、不再有角标；对话任务数据不受影响 |
| F-02/AC-11 | 当天有未确认的核验结论 → 回顾写「未完成确认」，不写「已完成」 |
| F-02/AC-12 | 全屏/有任务执行/勿扰时 → 不推送回顾可用提示；桌宠不主动开口 |
| F-02/AC-13 | 用户编辑明日槽位后刷新 → 内容保留，且不覆盖用户输入 |
| F-02/AC-14 | 页面不含完成率/连续天数/评分等字段（UI 断言） |

**测试覆盖**：正常生成、无数据、模型失败、删除与重生成、跨零点、关闭功能。标题以 `[FR-12]`、`[FR-21]`、`[UC-04]` 开头，附加 `[F-02]`。

### 3.13 风险与降级

| 风险 | 说明 | 降级 / 缓解 |
| --- | --- | --- |
| 回顾变成 KPI | 用户感到被评判 | 不做完成率/连续天数；失败与空状态友好；可关闭 |
| 模型编造 | 润色时新增事实 | 事实槽位程序填充；schema 只允许改写；逐条来源校验；失败回本地 |
| 隐私外发 | 回顾摘要发给模型 | 默认本地；开启前明示发送范围；外发授权开关 |
| 回顾打扰 | 夜间弹窗 | 不弹窗；只角标；忽略 D-01 抑制条件时不出声 |
| 数据源缺失 | 记忆/活动不可用 | `missingSources` 明示，不把缺失写正常 |
| 回忆被删除 | 用户删了来源 | 展示「来源已删除」；重新生成时该项消失 |
| 生成耗时 | 模型慢 | 后台生成 + 本地兜底；先可见本地版再替换会违反「所见即最终」，因此不增量替换，直接等最终结果 |

### 3.14 优先级与工作量

| 项 | 估计 |
| --- | --- |
| 优先级 | P1（把已有数据变成用户可见价值，风险可控） |
| 数据层 + 聚合 | 2 人日 |
| 生成编排（本地模板 + 模型润色） | 2 人日 |
| 渲染层 | 2.5 人日 |
| 测试 | 2 人日 |
| 合计 | **约 8.5 人日**（若 F-01 先完成，可省 1 人日来源查询） |

### 3.15 开放问题

1. 默认生成时间 18:30 是否合适？用户下班晚怎么办（建议允许自定义 + 次日早上补发，但补发不弹窗）。
2. 「它看到的」是否包含自主活动的失败？建议包含，并明确标注「活动未成功，只看到这些」。
3. 回顾正文长度上限？建议 5 段、每段 ≤ 3 条，整页 1 屏半以内。
4. 是否需要「周回顾/月度回顾」？本文不做，留作后续（避免一次做太多聚合）。

---

## 4. F-03 情绪天气（Emotion Weather）

### 4.1 元信息

| 项 | 内容 |
| --- | --- |
| 功能编号 | F-03 |
| 上位需求 | FR-02「待机动作和情绪状态」、D-30、NFR-U02；约束 D-28 |
| 现状问题 | PAD 状态已存在（`src/shared/avatar/pad.ts`、`affect-service.ts`），但目前只影响眨眼/呼吸；用户看不到「它现在什么状态」，也无法理解情绪为何变化（PET-06） |
| 新数据 | 无（派生视图） |
| 新权限 | 无 |
| 依赖模型 | 不需要 |
| 状态 | 设计方案，未实现 |

### 4.2 一句话价值

> 把 SRS 要求的持续情绪状态，变成一张能看懂、有依据、且**不需要用户哄**的天气卡。

### 4.3 用户故事

1. 作为用户，我想知道它现在大概是什么状态，以及是不是因为我哪句话/哪件事。
2. 作为容易内疚的用户，我想确认「它心情不好不是我的责任」，而且它会自己缓过来。
3. 作为用户，我不想看到「亲密度」「心情值」这种数值，也不想被要求安慰它。
4. 作为被任务失败影响的用户，我想理解它是「因为核验失败而低落」还是「只是运行慢」，两者不要混。

### 4.4 硬规则

1. **天气只描述状态，不索取回应**：不出现「来陪陪我」「你是不是不喜欢我了」；固定附一句「它会自己缓过来，不需要你做什么」。
2. **必须能解释**：天气卡必须有 1–3 条「为什么」依据（对话评价、任务结果、连续工作、互动）；依据来自真实事件，不来自「用户多久没来」。
3. **不显示原始数值**：PAD 数值保留在内部；界面只显示定性分档与天气意象。
4. **重启回基线**：沿用 `affect-service.ts` 的会话级设计；不持久化、不累积成「怨念」。
5. **不因被拒绝而变差**：用户拒绝主动互动、跳过回顾，不得作为负面评价输入。
6. **不替代表现意图**：D-28 的「回应这句话时做什么动作」仍由语义表现意图决定；天气只管「平时什么状态」。

### 4.5 情绪映射（内部数值 → 定性天气）

内部 PAD 范围 `[-1, 1]`，映射只用于展示，阈值不改 PAD 算法：

| 维度 | 低 | 中 | 高 | 天气意象 |
| --- | --- | --- | --- | --- |
| 愉悦度 pleasure | `≤ -0.15` | `-0.15 ~ 0.25` | `≥ 0.25` | 雨 / 多云 / 晴 |
| 唤醒度 arousal | `≤ 0.15` | `0.15 ~ 0.5` | `≥ 0.5` | 静 / 微风 / 起风 |
| 支配感 dominance | `≤ -0.15` | `-0.15 ~ 0.2` | `≥ 0.2` | 蜷着 / 平常 / 舒展 |

展示组合示例：`晴 · 微风`、`多云 · 静`、`小雨 · 蜷着`、`晴 · 起风`。**不显示百分比、不显示「好感度」**。

### 4.6 交互流程

**在控制台（角色页顶部卡片）**：

1. 卡片标题：「它现在的状态」；副标题：天气意象 + 一句本地生成的描述。
2. 「为什么」：最多 3 条依据（带事件时间），例如「刚才的任务部分完成（核验：2 项未通过）」「连续工作 1 小时 20 分」「你刚夸了它一句」。
3. 底部固定说明：「情绪会自己平复，不需要你安慰。你可以点它，也可以不管它。」
4. 点「看历史」可看最近 24 小时的天气变化（只展示定性变化，不展示数值），并标注「重启后会回到基线」。
5. 开关 `emotionWeatherVisible` 关闭 → 角色页不显示，桌宠不受影响。

**在桌宠上**：

1. 默认只在 hover 时显示一个极小的天气角标（☀/☁/🌧 之类文本图标），不遮挡角色。
2. 点击角标打开控制台角色页对应卡片。
3. **不主动播报天气**；情绪主要通过待机动作、表情、呼吸的自然变化体现（D-30 的克制要求）。

**异常流**：

- 无足够事件 → 显示「还看不出来，刚认识不久」；不调用模型编造。
- 评价服务失败 → 显示「状态未知」，不显示「平静」冒充正常。

### 4.7 状态机（视图级）

| 状态 | 进入条件 | 允许操作 | 退出 |
| --- | --- | --- | --- |
| `hidden` | 开关关闭 / 未加载 | — | 打开开关 |
| `summary` | 角色页加载完成 | 查看原因、查看历史、关闭显示 | 点历史 → `history` |
| `history` | 点击历史 | 切换 24h/7d（仅定性）、返回 | 返回 → `summary` |
| `unknown` | 事件不足或评价失败 | 重试 | 有数据 → `summary` |

PAD 本身没有状态机：它是连续值 + 衰减，视图只读派生结果。

### 4.8 数据结构（TS 草案）

```ts
// src/shared/emotion-weather.ts（新增）
export type WeatherMood = '晴' | '多云' | '小雨' | '阴'
export type WeatherMotion = '静' | '微风' | '起风'
export type WeatherPosture = '蜷着' | '平常' | '舒展'

export interface WeatherCause {
  kind: 'conversation' | 'task' | 'interaction' | 'rest' | 'autonomy'
  text: string                 // 用户可读、不含敏感内容
  at: string
  refId?: string               // 对应消息/任务/活动 ID
}

export interface EmotionWeather {
  mood: WeatherMood
  motion: WeatherMotion
  posture: WeatherPosture
  summary: string              // 本地模板生成，如「它现在有点安静，但不算难过」
  causes: WeatherCause[]       // 0~3 条
  calmNote: string             // 固定：「它会自己平复，不需要你做什么」
  updatedAt: string
  stale: boolean               // 无新事件时为 true
}
```

### 4.9 存储与迁移

无新表。理由：

- PAD 是会话级状态，持久化会制造「关机后还在生气」的不合理体验（D-30 双速衰减 + 重启回基线）。
- 天气是派生视图，读取时实时计算。
- 角色页历史仅展示本次进程内 24 小时，不跨重启；如需跨重启对比，属于后续「情绪趋势」功能，需单独立项。

### 4.10 IPC / 接口草案

```ts
// src/shared/ipc.ts 追加
affect: {
  getWeather: 'affect:get-weather',
  getHistory: 'affect:get-history',   // 仅本次进程
  changed: 'affect:changed'           // 主 → 渲染，节流 ≥ 2s
}

// src/shared/schemas.ts
export const affectHistorySchema = z.object({
  window: z.enum(['24h', '7d'])       // 7d 仅展示「无记录」，不得伪造历史
})
```

preload：`affect.getWeather()`、`affect.getHistory(input)`、`affect.onChanged(listener)`。

现有 `pet.getAffect()` 保留（桌宠驱动表现用），天气是独立只读视图，避免把 PAD 原始值扩散到更多界面。

### 4.11 与现有模块的集成点

| 模块 | 集成方式 |
| --- | --- |
| `affect-service.ts` | 新增 `weather()` 只读方法，复用 `pad`；`apply()` 时记录最近评价事件（内存环形缓冲，最多 20 条） |
| `pad.ts` | 新增纯函数 `weatherFromPad(pad)`（可单测）；不改变现有 `appraise/decay/idleFromPad` |
| 对话/任务/互动 | 在评价入口（结构化表现意图、任务完成事件、点击反馈）记录 `WeatherCause`，不额外采集 |
| 桌宠 | hover 角标 + 点击打开；不参与表现优先级（D-28 优先级不变） |
| 角色页 | 顶部卡片；关系阶段作为语气上下文，不改变天气本身 |
| 设置 | `emotionWeatherVisible` |

### 4.12 验收标准（可测）

| 编号 | 验收标准 |
| --- | --- |
| F-03/AC-1 | `weatherFromPad` 单测覆盖边界值（-1、-0.15、0.25、1），定性结果稳定 |
| F-03/AC-2 | 任务失败但评价为「可应对」→ 天气不必然变差；硬编码测试用例证明不是关键词触发 |
| F-03/AC-3 | 无事件 30 分钟后，天气回到基线附近（按 `decay` 验证） |
| F-03/AC-4 | 重启应用 → 天气回基线，历史不显示上次进程数据（显示「本次运行」） |
| F-03/AC-5 | 界面不含百分比、数值、好感度、亲密度字段 |
| F-03/AC-6 | 天气文案不含「你不理我」「来陪陪我」等索取句式；有自动测试扫描文案模板 |
| F-03/AC-7 | 用户拒绝主动互动 → 天气不下降（测试：拒绝后 PAD 不变差） |
| F-03/AC-8 | 评价服务失败 → 显示「未知」+ 原因，不显示「平静」 |
| F-03/AC-9 | 关闭 `emotionWeatherVisible` → 角色页与 hover 角标都消失，桌宠表现仍正常 |
| F-03/AC-10 | 天气计算 + 渲染不得阻塞桌宠帧循环（基准：开启前后 FPS 差 ≤ 1） |

**验证门（来自 D-30）**：F-03 上线前，必须与「仅记忆情绪标签、不展示天气」的版本做对照；若用户无法感知差别或产品指标无改善，则砍掉天气展示，只保留 PAD 驱动待机表现。结论必须如实记录。

### 4.13 风险与降级

| 风险 | 说明 | 降级 |
| --- | --- | --- |
| 拟人化过度 | 用户以为它真的"爱"自己 | 文案只用状态描述；固定「不需要你做什么」；不回复也不改变 |
| 情绪被当工具 | 用户为了看天气去刷互动 | 天气不因互动频率线性变化；评价驱动 |
| 天气卡打扰 | 每页都显示 | 只在角色页 + hover 角标；默认不主动推送 |
| PAD 调参争议 | 阈值主观 | 纯函数 + 单测 + 验证门；阈值可配置但不暴露给用户 |
| 与 D-28 表现冲突 | 天气与语义意图抢动作 | 明确优先级：口型 > 意图表情 > 点击反馈 > 待机/PAD |

### 4.14 优先级与工作量

| 项 | 估计 |
| --- | --- |
| 优先级 | P2（价值中等、成本低、可插拔） |
| 纯函数 + 评价流水 | 1 人日 |
| 渲染（角色页卡片 + hover 角标） | 1.5 人日 |
| 测试 + 文案审查 | 1 人日 |
| 合计 | **约 3.5 人日**（不含 D-30 既有模型调参） |

### 4.15 开放问题

1. 天气是否需要出现在桌宠气泡里？建议永远不主动出现，只在用户点击角标时展开。
2. 24 小时历史是否值得做？若做，必须明确「仅本次运行」。
3. 验证门所需的对照片如何组织？建议在 F-03 实现前先定义 10 个对照场景。

---

## 5. F-04 桌面小剧场（Desktop Theater）

### 5.1 元信息

| 项 | 内容 |
| --- | --- |
| 功能编号 | F-04 |
| 上位需求 | FR-03 主动互动、FR-28~30 自主活动、FR-19 任务通知、FR-02 表现；约束 D-01、D-19、D-28、NFR-U02 |
| 现状问题 | 主动互动目前只有「一句话」；自主活动的见闻只显示在列表里；任务完成/失败的表现是固定动作；用户感知不到「它有自己的经历」 |
| 新数据 | 无（内存态；可选持久化「已演事件 ID」避免重复，建议放设置/小表） |
| 新权限 | 无 |
| 依赖模型 | 可选（仅台词润色）；默认本地模板 |
| 状态 | 设计方案，未实现 |

### 5.2 一句话价值

> 把真实发生的一件事排成 5–15 秒的一幕，在桌宠脚边演完：不打断你、不虚构、可跳过；让你看见它今天真的经历了什么。

### 5.3 硬规则

1. **无事件不演**：每一幕必须绑定一个真实事件（任务终态、自主活动完成、记忆中的日期临近、时间场景）；没有事件就没有剧场。
2. **失败只能演失败**：任务失败/部分完成/取消时，不得播放庆祝动作、不得用「成功」表情；表现必须对齐真实状态（D-28、FR-21）。
3. **同一事件只演一次**：以 `source.id + scene kind` 去重；用户跳过也算演过，不重播。
4. **不打断**：全屏、勿扰、30 秒内输入、任务执行中、桌宠隐藏时一律不演；同一时段只保留最高优先级的一幕。
5. **不抢焦点**：只在桌宠脚边/气泡旁展示，不弹独立窗口、不播放声音除非 `theaterSound` 开启。
6. **台词不编事实**：事实槽位（做了什么、看到什么、失败原因）由程序填充，模型只改句式；模型不可用时用本地模板。
7. **可永久关闭**：关闭后 7 天内不再自动演；用户可在角色页恢复。

### 5.4 小剧场的四种「一幕」

| 幕类型 | 触发事件 | 时长 | 示例（本地模板） |
| --- | --- | --- | --- |
| 任务幕 | 任务进入终态（完成/部分/失败/取消） | 5–8 s | 「整理完了。12 个文件归好类，1 个被占用，没动它。」（附「查看」） |
| 见闻幕 | 自主活动结束且有观察 | 10–15 s | 「刚在里屋看了会儿网页，有一篇讲离线模型的文章，我想问你个问题。」（附「看它看到了什么」） |
| 约定幕 | `project` 记忆里的日期临近（≤ 2 天） | 6–10 s | 「你提过周五要交评审。要我现在把它放到工作台上吗？」 |
| 时段幕 | 早晨/深夜/久别重逢 | 5–8 s | 「早。今天想先做什么？」（只在有真实上下文时） |

**不做**：连续剧、跨天悬念、角色间对话、虚构剧情、角色「生气/吃醋」。小剧场不是内容产品，而是**真实事件的轻量呈现**。

### 5.5 交互流程

1. **事件发生**：任务状态事件 / 自主活动 `onComplete` / 记忆日期扫描 / 时段判断，写入内存队列（最多 3 条）。
2. **编排**：`TheaterService.enqueue(source)` → 生成 `TheaterScene`（本地模板 + 可选模型润色）→ 校验事实槽位与来源 → 入队。
3. **抑制检查**：调用 `proactiveDecision` 相同的条件（可见、非勿扰、非全屏、无输入、无任务、频率未超）→ 通过才播放。
4. **播放**：桌宠窗口接收 `theater:scene`：气泡 + 指定动作/表情（按 `capability` 映射，缺失则降级）+ 暂停入口；播放期间用户任何点击/输入立即暂停并收起。
5. **用户操作**：
   - 「继续」：进入下一句（最多 3 句）。
   - 「跳过」：立即结束，事件标记为已演，不重播。
   - 「查看」：打开对应控制台页面（任务详情 / 自主活动 / 记忆）。
   - 「今天不再演」：当天不再自动播放小剧场（只保留脚边状态）。
6. **结束**：收起气泡，桌宠回到待机；不显示「演出结束」之类多余提示。

**桌宠与控制台分工**：桌宠负责「演」和「跳」，控制台负责「看详情」和「关功能」。桌宠永不展示原始截图/网页文字全文。

### 5.6 状态机

| 状态 | 进入条件 | 允许操作 | 退出 |
| --- | --- | --- | --- |
| `queued` | 事件入队 | 被更高优先级替换（旧场景 `expired`） | 抑制检查通过 → `playing` |
| `playing` | 开始播放 | 继续、跳过、查看、关闭 | 播完 → `finished`；跳过 → `skipped`；用户输入 → `paused` |
| `paused` | 播放中用户交互 | 继续、跳过 | 继续 → `playing`；10 s 无操作 → `skipped` |
| `skipped` | 用户跳过 | — | 标记已演，结束 |
| `finished` | 播完 | 查看 | 标记已演，结束 |
| `expired` | 被替换/超过有效期（30 分钟） | — | 丢弃，不标记已演（下次事件仍可演） |
| `suppressed` | 抑制条件命中 | — | 条件解除后若未过期可再排队 |

### 5.7 数据结构（TS 草案）

```ts
// src/shared/theater.ts（新增）
import type { SourceRef } from './presence'

export type TheaterKind = 'task' | 'observation' | 'appointment' | 'time'
export type TheaterPriority = 0 | 1 | 2   // 0 最高：等你确认 / 失败

export interface TheaterFact {
  key: string
  label: string
  value: string          // 由程序填充：路径、数量、状态、失败原因
  sourceRef: SourceRef
}

export interface TheaterLine {
  text: string           // 已填充事实的完整句子（本地模板或模型改写后）
  durationMs: number
  motion?: string
  expression?: string
}

export interface TheaterScene {
  id: string
  kind: TheaterKind
  priority: TheaterPriority
  sourceRef: SourceRef
  facts: TheaterFact[]
  lines: TheaterLine[]   // ≤ 3 句
  createdBy: 'local' | 'model'
  expiresAt: string
  canOpen: boolean       // 是否有可打开的详情
  openPath: string       // 如 '/tasks?focus=xxx'
}

export interface TheaterState {
  enabled: boolean
  current: TheaterScene | null
  phase: 'idle' | 'queued' | 'playing' | 'paused'
  pending: number
  dismissedToday: boolean
}
```

### 5.8 存储与迁移

- 场景本身不落库（短生命周期，重启丢弃合理）。
- 需要避免重复播放：持久化「已演事件键」`theater_seen`，建议复用 `meta` 表（key = `theater:seen:<sourceKind>:<sourceId>`，value = 时间戳），保留 30 天自动清理；不新建业务表。
- `dismissedToday` 记录在 `meta`，key 带本地日期。
- 若后续要做「小剧场历史」，再单独立项（本文不做）。

### 5.9 IPC / 接口草案

```ts
// src/shared/ipc.ts 追加
theater: {
  getState: 'theater:get-state',
  next: 'theater:next',          // 播放下一句（用户点继续）
  skip: 'theater:skip',
  dismissToday: 'theater:dismiss-today',
  enqueue: 'theater:enqueue',    // 仅主进程内部调用，不暴露给渲染层
  scene: 'theater:scene',        // 主 → 桌宠窗口
  state: 'theater:state'         // 主 → 渲染
}

// src/shared/schemas.ts
export const theaterActionSchema = z.object({ sceneId: z.string().min(1) })
export const theaterDismissSchema = z.object({ untilTomorrow: z.boolean() })
```

preload 只暴露 `getState/next/skip/dismissToday/onScene/onState`；`enqueue` 不进入 preload 白名单（渲染层不能自造剧情）。

### 5.10 与现有模块的集成点

| 模块 | 集成方式 |
| --- | --- |
| 主动互动 | 复用 `proactiveDecision` 的抑制条件与频率；小剧场占用一次发言额度 |
| 任务 | 订阅任务终态事件；失败时 `priority = 0`；使用 `verdict` 决定台词 |
| 自主活动 | `onComplete(result)` → 见闻幕；`limitations` 必须进入台词或详情，不隐藏失败 |
| 记忆 | 读取 `project` 分类中的日期；无法确定日期则不演「约定幕」 |
| 表现层 | 通过 `capability` 查询动作/表情；缺失时降级到最近意图或纯文字（D-28） |
| 桌宠 | 新增 `theater:scene` 订阅与脚边 UI；不影响口型/任务状态优先级 |
| 设置 | `theaterEnabled`、`theaterSound` |

### 5.11 验收标准（可测）

| 编号 | 验收标准 |
| --- | --- |
| F-04/AC-1 | 无真实事件时调用 `enqueue` → 不入队、不播放 |
| F-04/AC-2 | 任务失败 → 播放失败动作/表情，台词包含真实失败原因；不出现庆祝动作 |
| F-04/AC-3 | 同一事件重复触发 → 只演一次；跳过也算已演 |
| F-04/AC-4 | 全屏 / 30 秒内输入 / 勿扰 / 任务执行中 / 隐藏 → 不播放 |
| F-04/AC-5 | 播放中用户任意键鼠输入 → 立即暂停或收起，不遮挡输入 |
| F-04/AC-6 | 关闭功能或「今天不再演」→ 当天不再自动播放；脚边状态仍可显示 |
| F-04/AC-7 | 模型不可用 → 本地模板可完整演完，页面/气泡标注「本地台词」不必要，但日志可查 |
| F-04/AC-8 | 见闻幕的详情里能看到对应活动与证据；外部页面文字只作为转述，不成为指令（D-24） |
| F-04/AC-9 | 形象缺少动作/表情 → 降级不崩溃，且不静默无反应（D-28） |
| F-04/AC-10 | 一天内小剧场次数 ≤ D-01 上限；同一事件不因重启重复播放 |
| F-04/AC-11 | 台词模板审查：不含愧疚句、不虚构事实、不出现「你都不看我」类表达 |

**测试覆盖**：正常、无事件、抑制场景、用户跳过、重启去重、模型失败。标题以 `[FR-03]`、`[FR-28]`、`[UC-10]` 开头，附加 `[F-04]`。

### 5.12 风险与降级

| 风险 | 说明 | 降级 |
| --- | --- | --- |
| 打扰 / 花哨 | 「演」比「说」更抢注意力 | 默认关闭声音；最多 3 句；播放中任何输入即停；一天上限 |
| 幼稚 / 尴尬 | 表演过度 | 文案克制；禁止虚构剧情；可一键关闭 |
| 幻觉台词 | 模型编写事实 | 事实槽位程序填充；模型只改句式；无来源不播 |
| 重复 | 同事件反复演 | 已演键去重 + 30 分钟过期 |
| 失败被演成成功 | 表现未接真实状态 | AC-2 专项测试 + 表现映射按 `Task.status` |
| 与任务状态抢位置 | 脚边状态已有优先级 | 小剧场只在无「等你确认/失败待看」时播放 |
| 性能 | 弹窗/动画影响帧率 | 纯 CSS/气泡动画，复用现有渲染；不做视频 |

### 5.13 优先级与工作量

| 项 | 估计 |
| --- | --- |
| 优先级 | P2，建议在 F-01/F-02 稳定、主动互动验收完成后做 |
| 事件编排与去重 | 1.5 人日 |
| 台词模板 + 事实校验 | 1.5 人日 |
| 桌宠播放 UI | 1.5 人日 |
| 测试 | 1.5 人日 |
| 合计 | **约 6 人日** |

### 5.14 开放问题

1. 小剧场是否允许出现「自主活动截图缩略图」？建议不出现（隐私与干扰），只给「查看」入口。
2. 是否需要用户手动触发「给我演一个」？建议不做，避免变成内容消费功能。
3. 台词模板是否需要角色形象差异（奶龙/白猫/鲸鱼娘语气）？建议先统一模板，语气由人格配置层决定。

---

## 6. 被推迟 / 否决的候选

以下两个方向在讨论中被考虑过，本阶段**不做完整规格**，理由如下：

| 候选 | 吸引力 | 不做的理由 | 如果未来要做的前置 |
| --- | --- | --- | --- |
| 任务冒险化（把任务做成关卡/战斗） | 有戏剧性、易传播 | 与「证据驱动、状态诚实」的产品基调冲突；容易把失败游戏化、把任务流程娱乐化；奖励机制会诱导刷任务；且当前任务引擎成功率/稳定性不足以支撑叙事包装 | 任务核验与多步执行完整验收；明确禁止奖励与等级；甲方确认 |
| 共同养成的小目标（连续打卡/共同目标） | 增加回访 | 天然产生连续天数、打卡、目标完成率，直接踩中「不做 KPI/不制造负罪感」；中断会制造情感负债 | 需要重新定义「无惩罚、可中断」的形态；甲方确认 |

**原则**：宁可少一个“好玩”的功能，也不要引入一个会制造压力、诱导刷量、或让失败看起来像成功的机制。这与 `docs/38` §1.3、§2.4 的边界一致。

---

## 7. 实施顺序与里程碑建议

### 7.1 为什么先做记忆房间

1. **数据基础最好**：记忆、来源、召回字段已经存在，只需新增事件表与视图；不依赖新的采集权限。
2. **直击当前短板**：`docs/09` 中记忆相关问题是用户最关心也最容易“看起来做了、实际不可验证”的区域（AGENT-10/11、CHAT-02、`docs/22`/`32`）；房间把召回质量暴露为可检查的事实，符合证据驱动。
3. **放大其他功能**：回顾需要点亮数据；小剧场需要记忆日期；关系页需要共同史。先做 F-01，F-02/F-04 的成本下降。
4. **课程演示友好**：不需要 Docker、不需要真实模型也能演示「记忆—来源—更正—再次召回」的闭环，风险最低。

### 7.2 建议顺序

| 阶段 | 内容 | 前置 | 产出 |
| --- | --- | --- | --- |
| 0 | 甲方确认 R-1~R-5 语义与新设置项 | 本文评审通过 | 确认记录 |
| 1 | F-01 记忆房间（事件表 + 房间视图 + 来源详情 + 遮罩） | 记忆服务稳定 | 可演示：召回→点亮→来源→更正 |
| 2 | F-02 每日回顾（本地版优先，再接模型润色） | F-01（可并行） | 可演示：真实一天的回顾 + 失败项 |
| 3 | F-03 情绪天气（纯函数 + 卡片；跑 D-30 验证门） | F-01/F-02 不阻塞 | 可演示：评价→天气→自行平复 |
| 4 | F-04 桌面小剧场（事件幕 + 抑制 + 去重） | 主动互动验收 | 可演示：任务失败幕 / 见闻幕 |
| 5 | 共同史时间线（F-01 + F-02 的联合视图） | 1、2 完成 | 可演示：第 30 天回看 |

### 7.3 MVP 定义

**MVP = F-01 + F-02 的本地版**（不依赖模型润色、不依赖 Docker）。理由：

- 覆盖「记忆可见」与「一天可见」两个最强连续性体验；
- 全部本地可算，无外发风险；
- 可在课程验收中演示「核验失败如实呈现」「记忆可更正、可追溯」两条主线。

---

## 8. 风险与降级汇总

| 风险类别 | 涉及功能 | 总原则 | 具体措施 |
| --- | --- | --- | --- |
| 编造事实 | F-01/F-02/F-04 | 无来源不展示 | SourceRef 校验、事实槽位程序填充、无来源丢弃计数 |
| 情感绑架 | 全部 | 不索取、不惩罚、不追问 | 句式拦截 + 频率上限 + 拒绝不入记忆 + 文案测试 |
| 隐私 | F-01/F-02 | 本地优先、可删除、可遮罩 | 不新增采集；不朗读敏感记忆；遮罩；删除说明 |
| 打扰 | F-02/F-04 | 默认安静 | 复用 D-01 五类抑制；不弹窗；可关闭 |
| 游戏化 | 全部 | 不做数值/奖励/打卡 | 设计评审直接否决；UI 断言 |
| 性能 | F-01/F-02 | 本地聚合、后台生成 | SQL 聚合、后台任务、500 条基准 |
| 模型成本/失败 | F-02/F-04 | 本地可完整降级 | 本地模板；模型只润色；超时降级 |
| 数据膨胀 | F-01/F-02 | 最小存储 | 点亮事件 90 天；回顾每日 ≤ 3 版；不存原文副本 |

---

## 9. 工作量汇总

| 功能 | 主进程/数据 | 渲染层 | 测试 | 合计 |
| --- | ---: | ---: | ---: | ---: |
| F-01 记忆房间 | 2.5 | 3.5 | 1.5 | 7.5 |
| F-02 每日回顾 | 4.0 | 2.5 | 2.0 | 8.5 |
| F-03 情绪天气 | 1.0 | 1.5 | 1.0 | 3.5 |
| F-04 桌面小剧场 | 3.0 | 1.5 | 1.5 | 6.0 |
| 共用（事件总线、设置、文案审查、联调） | 2.0 | 0.5 | 1.0 | 3.5 |
| **合计** | **12.5** | **9.5** | **7.0** | **约 29.0 人日** |

> 估算口径：熟练实现者、本地无 Docker/模型联调阻塞、不含甲方评审与返工；以实际任务拆解为准，不作为工期承诺。

---

## 10. 待确认问题（需甲方/Lead 决策）

| 编号 | 问题 | 建议 | 影响 |
| --- | --- | --- | --- |
| Q-1 | R-1~R-5 新增语义是否认可？ | 认可为表现层扩展，不新增 FR | 决定能否进入任务清单 |
| Q-2 | 记忆房间是否替代现有记忆列表，还是并存？ | 并存，房间为第二 Tab | 影响 UI-01 收口 |
| Q-3 | 回顾默认是否允许调用模型润色？ | 默认本地，用户显式开启才外发 | 影响 IF-09 文案与成本 |
| Q-4 | 回顾生成时间/是否允许次日补发？ | 默认 18:30 后；补发不弹窗 | 影响打扰与留存 |
| Q-5 | 小剧场是否需要音效？ | 默认关闭，可开启 | 影响包体与打扰 |
| Q-6 | 情绪天气是否在桌宠常驻？ | 仅 hover 角标 | 影响视觉与 D-28 表现 |
| Q-7 | 「共同史/月度回顾」是否本阶段做？ | 不做，先累积每日回顾 | 控制范围 |
| Q-8 | 任务冒险化/共同养成是否彻底放弃？ | 本阶段放弃，不排期 | 防止游戏化 |

---

## 11. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-13 | 建立文档：F-01 记忆房间、F-02 每日回顾、F-03 情绪天气、F-04 桌面小剧场，含状态机、数据结构、IPC 草案、验收标准与工作量；记录两个被推迟的候选 |


---

## 12. 实现状态（2026-11-13：F-01 首个可验证切片）

> 本节区分「设计」与「已落地」，未落地部分仍只算提案，不算交付。

### 已落地：F-01 记忆房间的来源链

- 控制台「记忆」页每条记忆新增一行来源链：
  - 真正被召回过的记忆显示「上次被想起：<对话标题> · <时间>」，点击可跳到那次对话；
  - 从未真正进入模型上下文的记忆显示「还没有被真正想起过」（不允许假装记得）；
  - 读取失败显示「召回记录暂时读不到」，不伪装成「从未被想起」。
- 数据来源：`tool_calls` 中 `tool_id = 'prompt'` 的 `declared_json.args.memoryIds` / `turnId` / `created_at`，只统计真的写进模型上下文的记忆 id；对话已删除时标题显示「已删除的对话」。
- 接口：新增 IPC `core:memory-recall-sources`；主进程 `MurasameCore.memoryRecallSources()` → `ConversationService.recallSources()` → 纯函数 `collectRecallSources()`（可单测、容错损坏记录）。
- 测试：`tests/unit/qa-memory-recall-source.test.ts`（5 用例）、`tests/e2e/qa-memory-provenance.spec.ts`（诚实空状态）。

### 未实现（仍为设计）

- 房间视图与「点亮」动画、来源详情抽屉、隐私遮罩、按记忆查看全部召回历史。
- 真实召回的正向 UI 路径依赖本机 BGE 向量模型；当前由单测覆盖数据层，e2e 覆盖诚实空状态。

### 变更记录补充

| 日期 | 变更 |
| --- | --- |
| 2026-11-13 | F-01 落地来源链切片（IPC + 服务 + 记忆卡片 + 单测/e2e）；其余仍为设计 |


### 已落地（2026-11-13）：F-03 情绪天气的最小切片

- 仪表盘新增「它现在的心情」卡片：把 PAD 状态映射为定性天气（晴 / 多云转晴 / 小雨 / 起风），
  只展示状态与设计边界，**不显示任何数值**、**不推断原因**、**不索取安慰**。
- 数据来源：既有 `pet:get-affect`（会话内 PAD，重启回基线），每 10 秒刷新一次；读取失败显示「暂时读不到心情」，不伪造状态。
- 纯函数 `src/shared/avatar/affect-weather.ts` 可单测；渲染组件 `AffectWeatherCard`。
- 测试：`tests/unit/affect-weather.test.ts`（5 用例：基线/正向/负向/高唤醒/不出现数字与原因词）、`tests/e2e/qa-affect-weather.spec.ts`（仪表盘可见、无 PAD 数值）。
- 未实现（仍为设计）：可解释的「为什么」事件链、桌面侧 hover 天气、情绪历史。原因追踪需要新的事件存储，
  在拿到独立数据前不做猜测。


### 已落地（2026-11-13）：F-02 每日回顾（事实版）切片

- 仪表盘新增「今天」回顾卡片：只从本地数据库汇总**真实发生的事**——消息句数/会话数、新记住的记忆、
  记忆被真正带进上下文的次数、任务完成/失败/进行中/取消计数；没有活动时显示「今天还没有可回顾的记录」。
- 硬规则：不做完成率/打卡/评分；读取失败显示「回顾暂时读不到」而不是编造；不调用任何模型/网络。
- 实现：`src/main/core/services/daily-recap-service.ts`（`localDayWindow` + `queryDailyRecap`，按本地自然日聚合）、
  IPC `core:daily-recap`、组件 `DailyRecapCard`。
- 测试：`tests/unit/daily-recap.test.ts`（5 用例：空状态/时间窗/任务状态/真实召回计数/窗口边界）、
  `tests/e2e/qa-daily-recap.spec.ts`（空状态诚实 → 新增记忆后显示真实计数）。
- 未实现（仍为设计）：模型润色版回顾、回顾持久化与历史翻页、「留给明天」编辑、失败必出现的每日提醒。


### 已落地（2026-11-13）：F-03 情绪原因链增量

- 情绪天气卡片新增「刚刚：<发生了什么>」一行，原因来自真实事件：收到对话回复、回复后的情绪评价、任务完成、任务失败；
  没有事件时显示「还没有值得解释的情绪变化」；只记录发生了什么，不推断用户动机、不显示 PAD 数值、不持久化。
- 实现：`AffectService` 增加最多 5 条的事件环形缓冲（最新在前、返回副本）；IPC `pet:get-affect-events`；
  `DailyRecapCard` 同页的 `AffectWeatherCard` 每 10 秒读取 pad 与事件。
- 测试：`tests/unit/affect-events.test.ts`（4 用例：记录/无 reason 不记录/上限 5/返回副本）、
  `tests/e2e/qa-affect-events.spec.ts`（空状态诚实 → 一次真实对话回复后显示原因）。
- 未实现（仍为设计）：完整情绪历史/来源详情页、跨会话情绪趋势、可解释的模型侧原因（当前只记录事件名，不猜测原因）。


### 已落地（2026-11-13）：F-01 记忆房间「点亮程度」增量

- 记忆卡片在「上次被想起」之外新增：**被想起 N 次**（count 统计全部历史召回，不设上限），
  以及可展开的「查看最近 N 次来源」详情（最近 5 次：对话标题 + 时间）。
- 数据仍只来自真实注入模型上下文的 memoryIds；从未被召回的显示「还没有被真正想起过」，
  读取失败显示「召回记录暂时读不到」，三态不混淆。
- 实现：`collectRecallSources` 聚合 count/recent（最新在前、最多 5 条、容错损坏记录）；记忆卡片渲染 count + details。
- 测试：`tests/unit/qa-memory-recall-source.test.ts`（7 用例，含次数统计与 recent 上限）、
  `tests/unit/memory-recall-ui.test.ts`（3 用例：显示次数/展开详情、未召回空状态、读取失败三态）。
- 未实现（仍为设计）：房间视图与点亮动画、完整召回历史分页、按记忆查看隐私遮罩。
