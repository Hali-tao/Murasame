# QA 与功能演进 · 最终交付汇总（Murasame 桌面应用）

> 目标回顾：对 Electron 桌宠应用做持续 QA 与功能演进——系统性挖掘并复现漏洞、构造测试并留下证据、能修的修掉并补测试、修不掉的如实记录；同时提出结构完整、有创意的功能扩展方案并落地可验证的部分。
> 本文件是**交付索引与结论汇总**；完整过程证据见 [docs/40-QA-RUNTIME-REPORT.md](40-QA-RUNTIME-REPORT.md)，功能设计见 [docs/38-PRODUCT-VISION.md](38-PRODUCT-VISION.md) 与 [docs/39-FEATURE-SPECS.md](39-FEATURE-SPECS.md)。

---

## 1. 交付物地图

| 交付 | 位置 | 说明 |
| --- | --- | --- |
| 全量覆盖矩阵 | [docs/42-FULL-QA-COVERAGE-MATRIX.md](42-FULL-QA-COVERAGE-MATRIX.md) | 页面/IPC/服务/安全/打包 × 现有覆盖 × 缺口 × 状态 |
| 可重复运行的 QA 报告 | [docs/40-QA-RUNTIME-REPORT.md](40-QA-RUNTIME-REPORT.md) | 范围/方法、已修复缺陷（含验证）、性能测量、已知限制、复跑方式 |
| 缺陷清单（含严重度/复现/修复状态） | 本文 §2 + docs/40 §3 各表 | 每条含严重度、问题、修复/状态；复现步骤见对应测试与 §3 证据 |
| 新增自动化测试 | `tests/unit/**`、`tests/e2e/qa-*.spec.ts` | 单元 89 文件 / 1025 用例；默认 E2E 111 passed / 7 skipped；`test:e2e:all` 116 passed / 2 skipped；`test:e2e:packaged` 9 passed |
| 可复跑 QA 探测脚本 | `scripts/qa-*.mjs` | soak / adversarial / kill-restart / renderer-crash / main-thread / ipc-payload / ui-memory / ipc-shapes / memory-perf |
| 功能提案文档 | [docs/38-PRODUCT-VISION.md](38-PRODUCT-VISION.md)、[docs/39-FEATURE-SPECS.md](39-FEATURE-SPECS.md) | 完整叙事 + F-01..F-04 规格、验收标准、风险与降级 |
| 功能落地切片 | 见 §4 | F-01/F-02/F-03/F-04 均有可验证增量 |
| 运行证据 | `artifacts/qa-runtime-2026-11-13/` | soak、adversarial、crash、ipc-payload、ui-memory、ipc-shapes、memory-perf 等 summary/report |

## 2. 缺陷清单总表（修复状态）

> 完整字段（问题描述、修复点）见 docs/40 §3 对应小节。严重度定义：P0 数据不可用/白屏卡死；P1 崩溃/挂死/核心功能不可用；P2 功能错误/数据丢失风险/明显交互死角；P3 观察项或加固。

### 2.1 已修复（含验证）

| 编号 | 严重度 | 摘要 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| QA-CRASH-02 | P0 | 控制台渲染进程崩溃后永久白屏（主进程存活但无 UI，属卡死类） | 已修复：自动 reload + 10s 内最多 3 次上限 | docs/40 §3.3；qa-renderer-crash e2e |
| QA-DBKEY-01 | P0 | 首启约 10s 内强杀导致数据库密钥永久不可解密，只能删数据 | 已修复：耐久化重加密 + 备份/恢复标记 + 中文告警 | docs/40 §3.5；qa-db-key-recovery 单测 |
| QA-TOOLS-01 | P3（交互死角） | 未实现能力（Obsidian/日历）在工具页仍可点击开关，点击只弹错误提示 | 已修复：不可用能力开关禁用，e2e 断言 disabled + 「不可用/尚未实现」 | docs/40 §3.43 |
| QA-WINLIFE-05 | P3（状态一致性） | 桌宠连续快速显示/隐藏 20 次后，逻辑状态 visible=true 但实际窗口仍隐藏（toggle 基于瞬时 isVisible，异步窗口操作导致奇偶翻转错位） | 已修复：togglePet 以持久化 petVisible 意图为准；e2e 轮询窗口收敛，5 次重复 30/30 通过 | docs/40 §3.44 |
| QA-VOICE-01 | P1（性能/实现缺失） | 语音"专用 utilityProcess"设计只有调度器与单测，没有 worker/构建入口/接线：真实模型下首次朗读阻塞主进程约 3 秒，且不存在 `Murasame Local Speech` 进程（此前测试 env-gated 被跳过） | 已修复：拆出 `synthesizePhonemes` + 新增 `speech-worker.ts` + electron-vite 多入口 + VoiceService 注入 `utilityProcess` 工厂 + 退出释放；语音 e2e 2/2、单测 18 个、全量 81/0 skip | docs/40 §3.42 |
| QA-MAIN-01 | P1 | `app.whenReady()` 链无 catch，初始化失败后无窗口/托盘/IPC 挂起进程 | 已修复：记录日志 + 中文错误框 + exit(1) | docs/40 §3.1 |
| QA-MAIN-02 | P1 | 导入时消息 ID 冲突被 INSERT OR IGNORE 静默丢弃却报成功 | 已修复：冲突 ID 加序号/哈希 + skippedMessages 计数 | docs/40 §3.1 |
| QA-CRASH-01 | P1 | 桌宠渲染进程崩溃后窗口永久空白 | 已修复：与 QA-CRASH-02 同一恢复机制 | docs/40 §3.3 |
| QA-MAIN-03 | P2 | 损坏/截断导入包把底层英文异常透传 | 已修复：结构/长度/凭据/版本校验 + 中文错误 | docs/40 §3.1 |
| QA-MAIN-04 | P2 | 设置监听器抛错会阻断其他监听器并回滚已保存设置 | 已修复：逐监听器隔离 | docs/40 §3.1 |
| QA-MAIN-05 | P2 | 向已销毁 webContents 广播导致成功 IPC 返回失败 | 已修复：safeSend + 逐窗口 try/catch | docs/40 §3.1 |
| QA-MAIN-06/07/08 | P2 | 录音样本、朗读文本、浏览目标缺少输入上限 | 已修复：中文拒绝 + 长度上限 | docs/40 §3.1 |
| QA-MAIN-11/12 | P2 | 非 handleCore IPC 无统一错误边界；导入口令/路径无长度校验 | 已修复：统一中文错误 + 长度校验 | docs/40 §3.1 |
| QA-E2E-07 | P2 | 审批框三连点会重复请求并弹两次错误 | 已修复：同步 ref 去重 + busy 守卫 | docs/40 §3.2 |
| QA-E2E-11 | P2 | 112.5% DPI 拖到边缘窗口越界 1px | 已修复：落位后回读真实 bounds 再夹一次 | docs/40 §3.2 |
| QA-E2E-13 | P2 | 记忆类别自由文本但后端只认白名单，非法值弹错且对话框不关 | 已修复：前端规范化 + 就地中文提示 | docs/40 §3.2 |
| QA-IMPORT-01 | P2 | 导入数据包后界面不刷新（提示成功但记忆页为空） | 已修复：主进程重载缓存 + 渲染层 reloadData | docs/40 §3.6；qa-import-refresh e2e |
| QA-NOTIFY-01 | P2 | 持久错误提示无上限，失败风暴让 toast DOM 无限增长 | 已修复：持久提示上限 20（保留独立错误到关闭）+ 风暴 e2e | docs/40 §3.13 |
| QA-BOUNDARY-01 | P2 | 控制台页面无错误边界，任一页面渲染异常整窗白屏 | 已修复：页面级 ErrorBoundary，切路由自动恢复 | docs/40 §3.13 |
| QA-A11Y-01 | P2 | 桌宠右键菜单无键盘支持（无 Esc/键盘打开/焦点归还） | 已修复：Esc/F10/ContextMenu + 焦点管理 + 可访问性语义 | docs/40 §3.11；qa-a11y e2e |
| QA-SEC-01 | P2 | 模型 endpoint 允许 file:// 等非 http(s) scheme | 已修复：仅 http/https（zod refine） | docs/40 §3.11；qa-model-endpoint-schema 单测 |
| QA-RECAP-01 | P2 | 停留仪表盘时「今天」回顾不自动刷新 | 已修复：数据变化即刷新 | docs/40 §3.16 |
| QA-RECAP-02 | P3 | 消息到达时回顾「聊了 N 句」不刷新（需等轮询/重挂载） | 已修复：消息总数纳入刷新信号 | docs/40 §3.30 |
| QA-RECAP-03 | P2 | 自动刷新覆盖未保存的「留给明天」草稿（数据丢失） | 已修复：dirty 保护，自动刷新不覆盖输入 | docs/40 §3.32；qa-daily-recap e2e |
| QA-THEATER-01 | P2 | 超长任务名撑爆小剧场气泡，跳过按钮可能被推出窗口 | 已修复：clipText 有界截断 + 换行规则 | docs/40 §3.29；qa-theater e2e |
| QA-THEATER-02 | P2 | 无空格长 token 水平溢出气泡/窗口 | 已修复：overflow-wrap anywhere + e2e 断言无溢出 | docs/40 §3.31 |
| QA-SEARCH-01 | P3（加固） | 搜索 %/_ 被剥离后 LIKE 全表匹配（结果被内存过滤兜住） | 已加固：LIKE ESCAPE 字面匹配 | docs/40 §3.35；history-search-wildcards 单测 |
| QA-MAIN-09/10/13..19 | P3 | 更新器 timer 未清理、英文错误、未处理 Promise、窗口 timer、迁移校验、角色导入残留、快捷键先写后回滚、注释乱码等 | 已修复（逐项见 docs/40 §3.1） | docs/40 §3.1 |
| QA-IPC-11/12 | P2/P3 | 导入后记忆缓存不刷新；reloadData 失败被伪装成最新 | 已修复：reloadData + 如实报错 | docs/40 §3.6；store 单测 |

### 2.2 验证性覆盖（不是缺陷修复）

| 编号 | 内容 | 结果 |
| --- | --- | --- |
| QA-CRASH-08 / 11 | 可见窗口崩溃恢复；隐藏到托盘时崩溃静默恢复且不自动弹出 | PASS（e2e） |
| QA-VOICE-02 | 真实本地语音：冷/热朗读、控制响应 <500ms、专用进程被 kill 后文字回退与下次恢复 | PASS（e2e，需真实模型 + `MURASAME_E2E_SPEECH=1`） |
| QA-ISO-01 | 真实 Docker 隔离创作（office/code）与外部活动跟随/停止 | PASS（e2e，需 `murasame-isolation:local` 镜像 + `MURASAME_E2E_ISOLATION=1`） |
| QA-BGE-01 | 真实 BGE 资产召回、清空/更正来源链 | PASS（e2e，需 `build/bundled-models`） |
| QA-SCREEN-TOOLS-01 | 屏幕页门禁/隐私文案/持续观察/外发文案；工具页开关持久化、禁用工具拒绝任务、不可用工具不可操作、详情弹窗（8 用例） | PASS（e2e） |
| QA-SETTINGS-CHAR-01 | 设置页 10 用例（开关/权限/热键/更新检查/帮助/退出/清除/导出/加密）+ 角色页 6 用例（保存/校验/非法导入/重置/形象/开关） | PASS（e2e） |
| QA-MODEL-DATA-SEC-01 | 模型页边界 4 用例（密钥不暴露/不回填/删除默认/预设自动填充）+ 数据包与密钥安全 3 用例（加密包无明文、错误口令中文拒绝、损坏包拒绝、API Key 不落明文） | PASS（e2e） |
| QA-PACKAGED-01 | 安装包形态：构建成功、11 页面/真实模型对话/记忆、资源含真实模型与 speech-worker、设置跨重启持久化、打包态真实语音与真实 BGE | PASS（`npm run test:e2e:packaged`，9 用例） |
| QA-NATIVE-PERCEPTION-01 | verify:native（SQLCipher 错误口令/无明文/正确回读）+ verify:perception（真实前台窗口/控件树/OCR） | PASS（原生验收脚本） |
| QA-SCREEN-CAPTURE-01 | 屏幕采集不可用时中文降级且不向模型发送图像；采集可用时 outboundImages 关→不发送、开→发送并采用视觉摘要 | PASS（e2e；真实截图路径受测试环境限制，见 §3 已知限制） |
| QA-AUTONOMY-CHAT-TASK-01 | 自主活动 UI 未确认禁用 + 真实 Docker 开始/停止无残留容器；聊天朗读中文降级/上下文面板/快捷总结落库；任务取消与筛选一致 | PASS（e2e，3 用例） |
| QA-WINLIFE-01..06 | 托盘显隐、最小化到托盘、最小尺寸、非法快捷键、桌宠显隐、模型不可达 | PASS（e2e，未发现缺陷） |
| QA-SEARCH-10 | 60 会话长历史搜索、通配符回归、清空恢复 | PASS（e2e） |
| QA-STREAMKILL-01 | 流式中途强杀后数据库可读、无半截/重复消息 | PASS（e2e；整轮原子提交的丢失语义见 §3） |
| QA-NOTIFY-03 | 连续 30 次失败提示不无限堆叠 | PASS（e2e） |

## 3. 已知限制 / 未修复项（明确不计为已交付）

完整列表见 [docs/40 §5](40-QA-RUNTIME-REPORT.md)。重点：

1. **真实 Docker 隔离活动**：已能在本机 Docker + `murasame-isolation:local` 镜像下自动跑通（3/3）；仍是 opt-in 环境依赖，默认套件在无 Docker 机器会 skip，并有 `npm run test:e2e:all` 自动检测入口。
2. **真实语音**：已用本机真实 whisper/kokoro + 专用 utilityProcess 跑通 2/2；仍需真实模型与中文音素器，缺依赖时默认套件 skip（不冒充已验证）。
3. **流式中途崩溃的丢轮语义**：对话回合是整轮原子提交，强杀会丢失整轮（含用户消息），但不会产生半截/重复数据；改为先落用户消息会改变既有失败语义，待决策。
4. **首次启动 10 秒内强杀的旧数据库**：已自动备份并重开新库，但旧加密数据无法恢复（已在应用内中文告警）。
5. **崩溃循环上限**：10 秒内 3 次崩溃后停止自动恢复，需重启应用（有意的防无限重载）。
6. **混合 DPI/多显示器矩阵**：只验证了 112.5% 单屏边缘拖拽；未做多屏矩阵。
7. **F-04 事件持久化去重**：去重与队列是进程内的，重启后可能重演同一事件（当前任务终态事件只在状态变化时产生，实际影响有限）。
8. **F-02 daily_reviews 多版本表**：未实现；「留给明天」存于本地设置（electron-store），不是数据库多版本日签。
9. **7 天冷却**：设计取舍为「显式开关 + 角色页恢复」替代自动 7 天冷却（见 docs/39 §12），不作为待实现项。
10. **重负载下的测试时序抖动**：全量套件在测试机高负载时曾出现 1 次 notifications.spec 超时（单独与后续全量通过），属测试环境抖动，持续观察；不视为产品缺陷。
11. **安装器系统级行为**：本轮完成 NSIS 构建与打包态运行验收，但未在干净机器执行真实安装/升级/卸载；NSIS 钩子由 native uninstall 单测覆盖，系统级行为需人工验收。
12. **真实窗口截图路径**：Playwright 隐藏窗口测试环境无法稳定采集真实前台窗口（产品按设计拒绝整屏回退）；UIA/OCR 由 verify:perception 验收，截图与外发同意边界只验证到降级路径 + 服务端无图像请求，完整截图链路需真实桌面人工验收。

## 4. 功能提案与落地状态

| 功能 | 设计文档 | 已落地可验证切片 | 未落地（明示） |
| --- | --- | --- | --- |
| F-01 记忆房间 | docs/39 §2 | 点亮次数、最近来源详情、房间视图 + 正文默认遮蔽/Esc、来源已删除显示 | 完整房间视觉/点亮动画、单条召回原始上下文、遮罩持久化、角标高亮 |
| F-02 每日回顾 | docs/39 §3 | 事实版今日回顾（本地聚合、不评分不打卡）、自动刷新、留给明天一句话（本地持久化） | daily_reviews 多版本表、模型润色、历史日签浏览 |
| F-03 情绪天气 | docs/39 §4 | 定性天气卡 + 真实事件原因链（最近 5 条，不猜动机、不显示数值） | 跨会话情绪趋势、来源详情页 |
| F-04 桌面小剧场 | docs/39 §5 | 任务幕/见闻幕、优先级、最多 3 条队列、跳过/今天不再演/永久关闭+角色页恢复、查看入口、内容有界与 Unicode 清洗 | capability 动作编排、模型润色台词、音效、已演事件持久化、观看/暂停 10s 规则 |

## 5. 测试与证据复跑

```bash
npm run typecheck && npm run lint && npm test     # 单元：89 文件 / 1025 用例
npx playwright test --reporter=line               # 默认 E2E：111 passed / 7 skipped / 0 failed
npm run test:e2e:all                              # 依赖齐全时全量：116 passed / 2 skipped / 0 failed（2 个为打包态用例）
npm run test:e2e:packaged                         # 安装包形态：9 passed（含打包态真实语音/BGE）
npm run qa:ipc-shapes                             # IPC 错误形态审计（69 通道，0 挂起/0 裸英文）
node scripts/qa-adversarial.mjs                   # 启动/退出对抗场景
node scripts/qa-soak.mjs                          # 运行时 soak（CPU/内存/IPC 延迟）
node scripts/qa-kill-restart.mjs                  # 强杀/重启数据一致性
node scripts/qa-renderer-crash.mjs                # 渲染进程崩溃恢复与循环上限
node scripts/qa-main-thread.mjs                   # 主线程阻塞量化
node scripts/qa-ipc-payload.mjs                   # IPC 大载荷/循环引用/内存
node scripts/qa-ui-memory.mjs                     # 重复导航内存平台期
npm run qa:memory-perf                            # 500 记忆 / 300 会话本地性能基准
npm run trace                                     # 需求可追溯性（74/74 covered，missing 0）
```

产物在 `artifacts/qa-runtime-2026-11-13/{soak,adversarial,kill-restart,crash-recovery,main-thread,ipc-payload,ui-memory,ipc-shapes,memory-perf,e2e,reviews}`。

## 6. 目标达成核对

| 目标要求 | 交付情况 |
| --- | --- |
| 系统性挖掘并复现漏洞（崩溃/卡死/内存/CPU/IPC/数据/交互） | 覆盖崩溃恢复、主线程阻塞、soak、IPC 大载荷、数据密钥恢复、导入一致性、交互死角；关键缺陷均有复现证据 |
| 构造测试用例并留下可复现证据 | 单元 1025 用例 + 默认 E2E 111 passed、依赖齐全全量 E2E 116 passed/2 skip + 安装包形态 9 passed + 9 个可复跑探测脚本 + artifacts |
| 能修的修掉并补测试 | 见 §2.1（含 P0×2、P1×3、P2 多条）；每条有回归测试 |
| 修不掉的明确记录、不算交付 | 见 §3 与 docs/40 §5；未包装为已完成 |
| 结构完整、有创意的功能扩展方案 | docs/38 视觉叙事 + docs/39 F-01..F-04 规格（验收标准/风险/降级） |
| 落地可验证的部分 | F-01..F-04 均有切片、测试与文档；未落地部分逐项标注 |
| 需求可追溯性 | `npm run trace`：74/74 covered，missing 0；文档内部链接 15/15 有效 |
| 最终交付 PDF/文档/测试/提案 | 本文件 + docs/40 + docs/38/39 + tests/ + artifacts/ |

---

*最后更新：2026-11-15（全量测试第 8 轮）：新增自主活动/聊天/任务取消 3 个 e2e；`test:e2e:all` 116 passed / 2 skipped；打包态 9 passed；单元 89 文件/1025 用例，trace 74/74。覆盖矩阵见 [docs/42-FULL-QA-COVERAGE-MATRIX.md](42-FULL-QA-COVERAGE-MATRIX.md)。*
