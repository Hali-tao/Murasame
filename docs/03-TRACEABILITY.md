# murasame 执行方案 · 需求追溯矩阵

> NFR-M02 要求「测试应能独立覆盖正常输入、权限拒绝、服务失败、取消与部分完成等情形，并将结果关联到 FR、UC 或 NFR 编号」。
> 本文档是该要求的交付载体，也是课程验收的主要凭据。
>
> 下半部分的「需求 → 测试用例」矩阵由 `npm run trace`（P0-05 建立）自动生成，**请勿手工编辑自动生成区**。
> 上半部分的「需求 → 任务」映射为手工维护，新增或拆分任务时同步更新。

需求总量：**74 项** = 30 FR + 10 UC + 9 IF + 16 NFR + 3 OR + 5 CON + 1 ASM

> CON（一般性限制，SRS 2.4）与 ASM（假设和依赖，SRS 2.5）在初版矩阵中被遗漏，现补入。
> 它们虽不以 FR/NFR 编号出现，但 SRS 正文以「须」「应」表述，属于硬性约束，必须可追溯。

状态图例：`基线` 已在现有代码中实现且保留 · `重写` demo 有实现但本方案整体重做 · `待实现` 由列出的任务交付 · `部分` 基线已有一半、需任务补齐

---

## 1. 功能需求（FR）

| 编号 | 名称 | 状态 | 交付任务 | 口径 |
| --- | --- | --- | --- | --- |
| FR-01 | 文字与语音交流 | 部分 | P1-01, P1-04, P2-03, P6-01~06 | D-25, D-28 |
| FR-02 | 点击与待机互动 | 部分 | P6-03~06, P7-02 | D-28 |
| FR-03 | 主动互动 | 部分 | P6-07 | D-01 |
| FR-04 | 交互异常处理 | 部分 | P1-01, P6-01 | |
| FR-05 | 获取屏幕内容 | 部分 | P4-00, P4-01, P4-05 | D-02, D-24 |
| FR-06 | 理解与分析 | 部分 | P0-07, P4-02 | D-16, D-23 |
| FR-07 | 辅助转为任务 | 部分 | P4-03 | D-14 |
| FR-08 | 采集与模型异常处理 | 部分 | P4-04 | |
| FR-09 | 角色设定 | 部分 | P1-04 | |
| FR-10 | 形象与表现定制 | 部分 | P1-05 | D-03 |
| FR-11 | 资源加载检查 | 部分 | P1-05 | D-03 |
| FR-12 | 历史检索与清除 | 部分 | P1-01, P1-02 | |
| FR-13 | 清除范围说明 | 待实现 | P1-03 | D-04 |
| FR-14 | 自动提取与使用 | 待实现 | P2-02, P2-03, P2-05 | D-05, D-17, D-21, D-22 |
| FR-15 | 查看与管理记忆 | 部分 | P2-01, P2-04 | D-04, D-21 |
| FR-16 | 任务识别与确认 | 待实现 | P3-01, P3-04 | |
| FR-17 | 规划与协作执行 | 待实现 | P3-05, P3-12 | D-18 |
| FR-18 | 敏感操作审批 | 待实现 | P3-06 | D-06 |
| FR-19 | 进度查询与通知 | 待实现 | P3-01, P3-08, P3-13 | |
| FR-20 | 取消任务 | 待实现 | P3-09 | D-07 |
| **FR-21** | **结果核验与反馈** | 待实现 | **P0-04, P3-07, P3-12** | 技术主线核心 · D-18 |
| FR-22 | 工具配置与启停 | 待实现 | P3-02, P3-03, P3-10 | |
| FR-23 | 调用状态管理 | 待实现 | P3-02, P3-10 | |
| FR-24 | 模型配置验证 | **重写** | P0-07, P0-08 | D-16 |
| FR-25 | 模型保存与切换 | **重写** | P0-07, P3-01（配置快照） | D-08, D-16 |
| FR-26 | 显示与应用控制 | 部分 | P7-01, P7-02 | |
| FR-27 | 运行状态提示 | 部分 | P8-04 | D-09 |
| FR-28 | 隔离环境内活动 | 部分 | P5-01, P5-03, P5-04 | D-15, D-19, D-23, D-27 |
| FR-29 | 启停与环境隔离 | 部分 | P5-02 | D-15 |
| FR-30 | 活动状态管理 | 部分 | P5-05 | |

## 2. 用例（UC）

| 编号 | 名称 | 状态 | 交付任务 | 验收依据（SRS 原文摘要） |
| --- | --- | --- | --- | --- |
| UC-01 | 与桌宠交流互动 | 部分 | P1-01, P1-04, P6-01~03 | 成功产生可见回应；失败明确标识未完成 |
| UC-02 | 获取屏幕内容辅助 | 部分 | P4-01~05 | 以已知文档/代码/错误画面核对；拒绝授权不得产生新采集；操作意图必须出现任务确认 |
| UC-03 | 个性化设置桌宠 | 部分 | P1-04, P1-05 | 有效配置已保存生效，或原配置保持不变 |
| UC-04 | 检索与管理对话历史 | 部分 | P1-01, P1-02, P1-03 | 成功清除的记录不再出现；失败范围保留为未完成 |
| UC-05 | 管理长期记忆 | 部分 | P2-01~04 | 更正后使用新值；删除后不再返回；关闭后不个性化 |
| **UC-06** | **委托并跟踪任务** | 待实现 | **P3-01, P3-04~09** | **以指定测试文件夹整理任务核对实际文件结果；未确认不执行；敏感操作拒绝后不发生；取消后不再安排新操作；长任务期间聊天可用** |
| UC-07 | 管理工具和插件 | 待实现 | P3-02 | 禁用后不接受新调用；运行中调用单独显示状态 |
| UC-08 | 配置与选择模型服务 | **重写** | P0-07, P0-08 | 配置成功保存并显示状态，或原配置不变 |
| UC-09 | 控制桌宠的显示与运行 | 部分 | P7-01, P7-02, P8-04 | 隐藏不等同取消；退出后不再安排新操作 |
| UC-10 | 桌宠自主活动 | 部分 | P5-03~07 | 活动状态清楚可见；用户软件环境不被直接控制 |

## 3. 外部接口需求（IF）

| 编号 | 范围 | 状态 | 交付任务 |
| --- | --- | --- | --- |
| IF-01 | 桌宠与对话界面入口 | 部分 | P8-04 |
| IF-02 | 任务确认与审批分别显示、状态可区分 | 待实现 | P3-06, P5-07, P8-04 |
| IF-03 | 记忆界面可读、错误提示含可采取操作 | 部分 | P1-03, P2-01, P8-04 |
| IF-04 | 硬件接口（显示/麦克风/音频） | 部分 | P4-01, P6-01 |
| IF-05 | 模型接口（文本/图像/语音/工具能力） | 部分 | P0-07, P4-02 |
| IF-06 | 角色资源与工具插件接口契约 | 待实现 | P1-05, P3-02 |
| IF-07 | 应用操作的目标环境识别 | 部分 | P5-03 |
| IF-08 | 通信传输保护 | 部分 | P8-01 |
| IF-09 | 外发数据的用途与授权边界 | 部分 | P2-05, P8-01 |

## 4. 性能与质量属性（NFR）

| 编号 | 主题 | 状态 | 交付任务 | 口径 |
| --- | --- | --- | --- | --- |
| NFR-P01 | 常驻资源占用（五场景分别测） | 部分 | P5-02, P7-03, P8-03 | D-10 |
| NFR-P02 | 耗时调用不阻塞关键入口 | 待实现 | P2-02, P3-08, P3-12, P8-03 | D-10 |
| NFR-P03 | 屏幕理解三段耗时可分测 | 部分 | P4-05, P8-03 | D-10 |
| NFR-S01 | 加密存储与凭据保护 | 待实现 | P0-01, P0-02, P0-10, P4-06, P8-01 | D-22, D-24 |
| NFR-S02 | 可清除且清除后不再出现 | 待实现 | P1-03, P8-01 | D-13 |
| NFR-S03 | 环境隔离可测试验证 | 部分 | P5-02, P5-06 | D-15 |
| NFR-R01 | 失败不被解释为成功 | 待实现 | P3-07, P8-02 | |
| NFR-R02 | 失败保留既有有效状态 | 待实现 | P1-05, P3-12, P8-02 | |
| NFR-R03 | 崩溃后不自动重放副作用 | 待实现 | P3-01, P8-02 | D-11 |
| NFR-U01 | 入口可发现、状态可区分 | 待实现 | P0-09, P8-04 | |
| NFR-U02 | 不持续打断用户工作 | 部分 | P6-04, P8-04 | D-01 |
| NFR-U03 | 本地功能不因外部服务失效而阻断 | 待实现 | P5-02, P8-04 | |
| NFR-C01 | 多系统支持与能力明示 | 待实现 | P8-05 | D-12 |
| NFR-C02 | 配置能力说明、不重建角色与记忆 | 待实现 | P0-07, P3-11, P8-05 | D-16 |
| NFR-M01 | 可定位失败且不记录敏感内容 | 待实现 | P0-11, P2-02, P3-13, P3-14, P8-06 | D-13, D-26 |
| NFR-M02 | 测试覆盖五类情形并关联编号 | 待实现 | P0-05, P0-11, P0-12, P8-07 | D-19 |

## 4b. 一般性限制（CON，SRS 2.4）与假设依赖（ASM，SRS 2.5）

| 编号 | SRS 原文要求 | 状态 | 交付任务 |
| --- | --- | --- | --- |
| CON-01 | 桌宠形象采用 Live2D，导入的角色、动作与表情资源须与所用运行组件兼容 | 部分 | P1-05, P6-03 |
| CON-02 | 系统需常驻个人计算机，资源使用应兼顾其他软件，避免影响正常工作 | 部分 | P5-02, P6-07, P7-03, P8-03 |
| CON-03 | 屏幕采集、录音和应用操作须遵循操作系统权限机制并取得用户授权 | 部分 | P4-01, P6-01, P8-04 |
| CON-04 | 自主活动须在独立隔离环境运行，不得直接占用或控制用户正在使用的应用会话 | 部分 | P5-02、P5-06 |
| **CON-05** | **角色、声音及第三方插件的使用与分发须符合相应许可；模型调用须遵守服务提供方使用规则** | **⏸ 暂缓** | **P8-08**（须在公开打包前有结论） |
| ASM-01 | 依赖失效时应提示受影响功能，并保留退出、取消和状态查询入口 | 部分 | P0-06, P0-09, P5-02, P8-04 |

**CON-05 是初版方案的实质性遗漏**：现有仓库已捆绑三套 Live2D 资源，其中 `whale-girl` 为 CC BY-NC-SA 4.0（非商业 + 相同方式共享）、`naiwa` 标注为「仅用于本项目课程演示」且来源待确认，另有 Live2D Cubism SDK 自身的许可约束。这不是文档工作，而是会影响**能否分发安装包**的硬约束。

## 5. 其他需求（OR）

| 编号 | 主题 | 状态 | 交付任务 | 口径 |
| --- | --- | --- | --- | --- |
| OR-01 | 使用说明；未支持功能不得展示为已实现 | 待实现 | P0-03, P3-02, P3-10, P8-07 | |
| OR-02 | 保存与清除范围；迁移、备份、卸载、容量 | 待实现 | P0-02, P1-03, P3-14, P8-07, P8-09 | D-13, D-26 |
| OR-03 | 不擅自扩权；退出说明与隐藏差异一致 | 部分 | P7-04, P8-07, P8-09 | D-09 |

---

## 6. 覆盖率目标

| 阶段结束时 | 应达成的累计覆盖 |
| --- | --- |
| P0 | NFR-S01、NFR-M02、OR-01 基本机制就位 |
| P1 | FR-09~13、UC-01/03/04 全覆盖 |
| P2 | FR-14/15、UC-05 全覆盖 |
| P3 | FR-16~23、UC-06/07 全覆盖（**里程碑重点**） |
| P4 | FR-05~08、UC-02 全覆盖 |
| P5 | FR-28~30、UC-10、NFR-S03 全覆盖 |
| P6 | FR-01/03/04 全覆盖 |
| P8 | 全部 74 项要么有测试映射，要么明确标注为未实现；CON-05 已暂缓但须在打包前结论 |

**P8-07 的终验条件**：追溯矩阵中不存在「声称已实现但无测试映射」的条目。允许存在标注为未实现的条目（符合 OR-01），但不允许存在含糊状态。

---

## 7. 需求 → 测试用例矩阵（自动生成区）

<!-- TRACE:BEGIN -->
| 需求 | 测试 |
| --- | --- |
| FR-01 | tests/unit/mesh-pet.test.ts<br>tests/unit/p4-p6.test.ts |
| FR-02 | tests/e2e/pet-history-sync.spec.ts<br>tests/unit/mesh-pet.test.ts<br>tests/unit/p4-p6.test.ts<br>tests/unit/p7-p8.test.ts |
| FR-03 | tests/unit/p4-p6.test.ts |
| FR-04 | tests/unit/p4-p6.test.ts |
| FR-05 | tests/unit/memory-extraction.test.ts<br>tests/unit/p4-p6.test.ts |
| FR-06 | tests/unit/p4-p6.test.ts |
| FR-07 | tests/unit/p4-p6.test.ts |
| FR-08 | tests/unit/p4-p6.test.ts |
| FR-09 | tests/unit/mesh-pet.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p4-p6.test.ts |
| FR-10 | tests/unit/p7-p8.test.ts |
| FR-11 | tests/unit/p1-p3.test.ts |
| FR-12 | tests/unit/conversation-memory-maturity.test.ts<br>tests/unit/p1-p3.test.ts |
| FR-13 | tests/unit/p1-p3.test.ts |
| FR-14 | tests/e2e/local-memory.spec.ts<br>tests/unit/conversation-memory-maturity.test.ts<br>tests/unit/embedding-runtime.test.ts<br>tests/unit/memory-extraction.test.ts<br>tests/unit/p1-p3.test.ts |
| FR-15 | tests/e2e/memory-category-filter.spec.ts<br>tests/e2e/memory-clear-ui.spec.ts<br>tests/e2e/memory-correction-source.spec.ts<br>tests/e2e/pet-history-sync.spec.ts<br>tests/unit/conversation-memory-maturity.test.ts<br>tests/unit/memory-category-filter.test.ts<br>tests/unit/memory-extraction.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p4-p6.test.ts<br>tests/unit/settings-clear-results.test.ts |
| FR-16 | tests/e2e/task-directory.spec.ts<br>tests/unit/mesh-pet.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/task-directory.test.ts<br>tests/unit/task-store-events.test.ts<br>tests/unit/task-system-folders.test.ts |
| FR-17 | tests/e2e/task-directory-checkpoints.spec.ts<br>tests/unit/grounded-summary.test.ts<br>tests/unit/grounded-task-service.test.ts<br>tests/unit/memory-extraction.test.ts<br>tests/unit/p1-p3.test.ts |
| FR-18 | tests/e2e/task-directory.spec.ts<br>tests/unit/grounded-approval.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/task-directory.test.ts<br>tests/unit/task-system-folders.test.ts |
| FR-19 | tests/unit/memory-extraction.test.ts<br>tests/unit/p1-p3.test.ts |
| FR-20 | tests/unit/memory-extraction.test.ts<br>tests/unit/p1-p3.test.ts |
| FR-21 | tests/unit/autonomy-status-events.test.ts<br>tests/unit/errors.test.ts<br>tests/unit/isolated-creation.test.ts<br>tests/unit/memory-extraction.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/task-status.test.ts<br>tests/unit/traceability.test.ts |
| FR-22 | tests/unit/p1-p3.test.ts |
| FR-23 | tests/unit/p1-p3.test.ts |
| FR-24 | tests/unit/p0-finish.test.ts<br>tests/unit/p7-p8.test.ts |
| FR-25 | tests/e2e/model-status-sync.spec.ts<br>tests/unit/gateway-contract.test.ts<br>tests/unit/model-maturity-regression.test.ts<br>tests/unit/p7-p8.test.ts<br>tests/unit/task-model-binding.test.ts |
| FR-26 | tests/unit/p7-p8.test.ts |
| FR-27 | tests/e2e/recording-hidden.spec.ts<br>tests/unit/p7-p8.test.ts<br>tests/unit/recording-hidden-regression.test.ts<br>tests/unit/window-hidden-event.test.ts |
| FR-28 | tests/unit/autonomy-lifecycle-regression.test.ts<br>tests/unit/autonomy-status-bridge.test.ts<br>tests/unit/autonomy-status-events.test.ts<br>tests/unit/isolated-creation.test.ts<br>tests/unit/p4-p6.test.ts |
| FR-29 | tests/e2e/qa-autonomy-chat-task.spec.ts<br>tests/unit/isolated-creation.test.ts<br>tests/unit/p4-p6.test.ts |
| FR-30 | tests/e2e/qa-autonomy-chat-task.spec.ts<br>tests/unit/autonomy-lifecycle-regression.test.ts<br>tests/unit/autonomy-status-bridge.test.ts<br>tests/unit/autonomy-status-events.test.ts<br>tests/unit/isolated-creation.test.ts<br>tests/unit/p4-p6.test.ts |
| UC-01 | tests/unit/conversation-memory-maturity.test.ts<br>tests/unit/model-maturity-regression.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p4-p6.test.ts |
| UC-02 | tests/unit/p4-p6.test.ts |
| UC-03 | tests/unit/p1-p3.test.ts |
| UC-04 | tests/unit/p1-p3.test.ts |
| UC-05 | tests/unit/conversation-memory-maturity.test.ts<br>tests/unit/memory-extraction.test.ts<br>tests/unit/p1-p3.test.ts |
| UC-06 | tests/unit/p1-p3.test.ts |
| UC-07 | tests/unit/p1-p3.test.ts |
| UC-08 | tests/unit/model-maturity-regression.test.ts<br>tests/unit/p7-p8.test.ts |
| UC-09 | tests/unit/p0-finish.test.ts<br>tests/unit/p7-p8.test.ts |
| UC-10 | tests/unit/p4-p6.test.ts |
| IF-01 | tests/unit/p7-p8.test.ts |
| IF-02 | tests/unit/p0-finish.test.ts |
| IF-03 | tests/unit/errors.test.ts<br>tests/unit/p7-p8.test.ts |
| IF-04 | tests/unit/p4-p6.test.ts |
| IF-05 | tests/unit/gateway-contract.test.ts<br>tests/unit/model-client.test.ts<br>tests/unit/model-maturity-regression.test.ts |
| IF-06 | tests/unit/p1-p3.test.ts |
| IF-07 | tests/unit/p4-p6.test.ts |
| IF-08 | tests/unit/model-maturity-regression.test.ts<br>tests/unit/p7-p8.test.ts |
| IF-09 | tests/unit/model-maturity-regression.test.ts<br>tests/unit/p0-finish.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p4-p6.test.ts<br>tests/unit/p7-p8.test.ts |
| NFR-P01 | tests/unit/embedding-runtime.test.ts<br>tests/unit/p7-p8.test.ts |
| NFR-P02 | tests/unit/conversation-memory-maturity.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p7-p8.test.ts |
| NFR-P03 | tests/unit/p4-p6.test.ts<br>tests/unit/p7-p8.test.ts |
| NFR-S01 | tests/electron/migrate-entry.ts<br>tests/unit/model-maturity-regression.test.ts<br>tests/unit/native-encryption.test.ts<br>tests/unit/p0-finish.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p4-p6.test.ts<br>tests/unit/p7-p8.test.ts<br>tests/unit/traceability.test.ts |
| NFR-S02 | tests/unit/p1-p3.test.ts |
| NFR-S03 | tests/integration/isolation.spec.ts<br>tests/unit/p4-p6.test.ts |
| NFR-R01 | tests/unit/conversation-memory-maturity.test.ts<br>tests/unit/gateway-contract.test.ts<br>tests/unit/isolated-creation.test.ts<br>tests/unit/model-maturity-regression.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p4-p6.test.ts<br>tests/unit/p7-p8.test.ts |
| NFR-R02 | tests/unit/conversation-memory-maturity.test.ts<br>tests/unit/database-recovery.test.ts<br>tests/unit/embedding-runtime.test.ts<br>tests/unit/model-maturity-regression.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p7-p8.test.ts<br>tests/unit/task-model-binding.test.ts |
| NFR-R03 | tests/unit/p1-p3.test.ts<br>tests/unit/p7-p8.test.ts<br>tests/unit/task-model-binding.test.ts |
| NFR-U01 | tests/unit/p0-finish.test.ts<br>tests/unit/p7-p8.test.ts |
| NFR-U02 | tests/unit/p4-p6.test.ts |
| NFR-U03 | tests/e2e/memory-degraded-context.spec.ts<br>tests/unit/conversation-memory-maturity.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p7-p8.test.ts |
| NFR-C01 | tests/unit/embedding-runtime.test.ts<br>tests/unit/p7-p8.test.ts |
| NFR-C02 | tests/unit/conversation-memory-maturity.test.ts<br>tests/unit/embedding-runtime.test.ts<br>tests/unit/p0-finish.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p7-p8.test.ts |
| NFR-M01 | tests/unit/errors.test.ts<br>tests/unit/memory-extraction.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p7-p8.test.ts |
| NFR-M02 | tests/unit/http-server.test.ts<br>tests/unit/model-fixture-port.test.ts<br>tests/unit/p0-finish.test.ts<br>tests/unit/traceability.test.ts |
| OR-01 | tests/unit/murasame-core.test.ts<br>tests/unit/p0-finish.test.ts<br>tests/unit/p4-p6.test.ts<br>tests/unit/p7-p8.test.ts |
| OR-02 | tests/unit/capacity.test.ts<br>tests/unit/p1-p3.test.ts<br>tests/unit/p7-p8.test.ts<br>tests/unit/uninstall-policy-native.test.ts |
| OR-03 | tests/unit/p7-p8.test.ts<br>tests/unit/uninstall-policy-native.test.ts |
| CON-01 | tests/unit/p4-p6.test.ts |
| CON-02 | tests/unit/p7-p8.test.ts |
| CON-03 | tests/unit/p4-p6.test.ts |
| CON-04 | tests/unit/p4-p6.test.ts |
| CON-05 | tests/unit/p7-p8.test.ts |
| ASM-01 | tests/unit/p7-p8.test.ts |

未覆盖：无
<!-- TRACE:END -->
