# QA 运行时与健壮性报告（2026-11-13）

> 目标：持续挖掘软件漏洞（崩溃 / 卡死 / 未响应 / 内存与 CPU 失控 / 数据损坏 / IPC 与交互死角），构造可复现测试用例；能修的修掉并补回归测试，修不掉的如实列为已知问题。

## 1. 范围与方法

| 工作流 | 方法 | 证据 |
| --- | --- | --- |
| 静态审查 | 主进程/IPC/数据库/窗口/更新器逐点审查，产出 19 条缺陷 | `artifacts/qa-runtime-2026-11-13/reviews/main-process.md` |
| 单元回归 | 30 个针对缺陷的回归用例（不依赖真实 Electron） | `tests/unit/qa-*.test.ts` |
| E2E 压力 | 13 个边界/压力用例：快速切形象、隐藏/显示、流式并发、任务连点、记忆并发、通知风暴、快捷键重复、拖拽到屏幕边缘 | `tests/e2e/qa-*.spec.ts` |
| 启动/退出对抗 | 损坏设置、未知形象、非法缩放、损坏数据库、第二实例、快速重启 | `scripts/qa-adversarial.mjs` + `artifacts/qa-runtime-2026-11-13/adversarial/` |
| 运行时压测 | 隔离 userData 启动真实应用；预热→交互压力→非法输入模糊→空闲 soak；采样主进程/渲染进程 CPU、内存、IPC 延迟；检测崩溃/未响应 | `scripts/qa-soak.mjs` + `artifacts/qa-runtime-2026-11-13/soak/` |

## 2. 结果总览

- 全量单元测试：**79 文件 / 967 用例全部通过**（含 30 个主进程/IPC 回归、7 个渲染崩溃恢复、5 个记忆来源链用例）。
- `npm run typecheck`、`npm run lint`：通过。
- 全量 E2E：**49 passed / 5 skipped / 0 failed**（4.8 分钟；含渲染进程崩溃恢复与记忆来源链用例；5 个 skip 为需要离线语音模型或真实 Docker 的用例）。
- 运行时压测（标准 18s 压力 + 120s 空闲，以及 10 分钟空闲长跑）：**0 崩溃、0 未响应、0 异常退出、0 控制台错误**；主进程最大响应延迟 13ms；空闲 CPU < 1%；10 分钟空闲内存 337–388MB 波动（GC 回收，无单调增长）。
- 对抗启动场景：损坏设置 JSON / 未知形象 / 非法缩放 / 第二实例 / 重启循环 均按预期启动或退出；损坏数据库场景见 §5 已知限制。

## 3. 已修复缺陷（含验证）

### 3.1 主进程与 IPC（来源：qa-main 审查）

| 编号 | 严重度 | 问题 | 修复 |
| --- | --- | --- | --- |
| QA-MAIN-01 | P1 | `app.whenReady()` 启动链无 `.catch`，初始化失败后无窗口/托盘/IPC 的挂起进程 | `src/main/index.ts` 增加终止性 catch：记录日志 + 中文 `showErrorBox` + `app.exit(1)` |
| QA-MAIN-02 | P1 | 数据导入时同前缀消息生成同一回退 ID，被 `INSERT OR IGNORE` 静默丢弃却报成功 | `src/main/data/merge-bundle.ts` 回退 ID 加入对话内序号+文本哈希；统计 `skippedMessages` 并在导入结果中显示跳过条数 |
| QA-MAIN-03 | P2 | 损坏/截断导入包把底层英文异常透传，结构不合法仍进入合并 | `src/main/data/portability.ts` 增加包长、头部、口令长度、解密/解析、版本、数组/对象结构、凭据、中文错误 |
| QA-MAIN-04 | P2 | 设置监听器抛错会阻断其他监听器并回滚已保存设置 | `src/main/settings.ts` 逐监听器 try/catch，落盘后单个广播失败不影响其他订阅者 |
| QA-MAIN-05 | P2 | 向已销毁 webContents 广播会抛错，导致已成功 IPC 返回失败、任务回调链中断 | `src/main/windows.ts` 统一 `safeSend`；`src/main/ipc.ts` 广播逐窗口 try/catch |
| QA-MAIN-06 | P2 | 录音样本无上限/非数字可进入识别推理 | `src/main/ipc.ts` 校验数组、长度上限（16k×120）、有限数字；中文拒绝 |
| QA-MAIN-07 | P2 | 朗读文本无上限 | `src/main/ipc.ts` 空文本/超 2000 字中文拒绝 |
| QA-MAIN-08 | P2 | 自主浏览目标无长度上限 | `src/main/ipc.ts` 与创作目标一致：>2000 字中文拒绝 |
| QA-MAIN-09 | P3 | 更新器启动延迟 timer 未保存，停止后仍执行 | `src/main/updater.ts` 保存并清理 delayed timer |
| QA-MAIN-10 | P3 | 更新失败把英文网络错误回传用户 | `src/main/updater.ts` 中文提示，技术细节仅入日志；非法更新源也纳入错误处理 |
| QA-MAIN-11 | P2 | 非 `handleCore` 的 IPC（设置/关系/文件选择）无统一异常边界，英文错误直出 | `src/main/ipc.ts` 包裹设置读写、关系读写、文件选择、日志目录等；统一中文错误 |
| QA-MAIN-12 | P2 | 导入/导出口令与路径无长度校验 | `src/main/ipc.ts` 口令 6–200、路径 ≤32767、导入前校验路径/口令 |
| QA-MAIN-13 | P3 | 文件选择参数未校验 | `src/main/ipc.ts` 收敛 title/directory/filters/defaultPath 类型与长度 |
| QA-MAIN-14 | P3 | 若干未处理 Promise（loadURL/tray/updater/autonomy/proactive） | 逐点补 catch/log：`windows.ts`、`tray.ts`、`updater.ts`、`autonomy-service.ts`、`proactive-loop.ts` |
| QA-MAIN-15 | P3 | 窗口保存 timer 与会话请求队列不回收 | `windows.ts` 窗口关闭清 timer；`conversation-service.ts` 删除会话时清队列 |
| QA-MAIN-16 | P3 | `schema_version` 损坏时全量重跑迁移，英文 SQL 错误 | `src/main/data/migrate.ts` 校验版本元数据，中文说明并停止打开 |
| QA-MAIN-17 | P3 | 角色导入 DB 写失败留下孤儿目录 | `src/main/ipc.ts` 失败时删除已复制目录，中文错误 |
| QA-MAIN-18 | P3 | 快捷键“先写后回滚”导致两次广播与不可用配置残留 | `src/main/ipc.ts` 先注册快捷键，失败不写盘，其余设置正常保存 |
| QA-MAIN-19 | P3 | `settings.ts` 注释乱码 | 已重写为可读注释 |

回归验证：`npx vitest run tests/unit/qa-*.test.ts` → **30/30 通过**。

### 3.2 交互与 E2E（来源：qa-e2e）

| 编号 | 问题 | 修复 |
| --- | --- | --- |
| QA-E2E-07 | 审批框三连点「批准并继续」会重复请求并弹出两次红字错误（数据层只执行一次） | `ConfirmDialog` 用同步 ref 挡住同帧重入；store `approveTask` 增加 busy 去重 |
| QA-E2E-11 | 112.5% DPI 拖到工作区边缘时窗口大 1px 越界 | `movePetDrag` 落位后回读真实 bounds 再夹一次 |
| QA-E2E-13 | 记忆类别是自由文本但后端只认白名单，非法值弹错且对话框不关 | 前端规范化（偏好/反馈/项目/参考及其英文别名），非法值就地中文提示、不提交 |

### 3.3 渲染进程崩溃恢复（本轮新增，来源：崩溃探测脚本）

| 编号 | 严重度 | 问题 | 修复 |
| --- | --- | --- | --- |
| QA-CRASH-01 | P1 | 桌宠渲染进程崩溃后窗口保留但**永久空白**，`render-process-gone` 只写日志 | `src/main/windows.ts` 崩溃后自动 `webContents.reload()`；60 秒内最多 3 次，超过后停止自动恢复并记录错误 |
| QA-CRASH-02 | P0 | 控制台渲染进程崩溃后同样永久空白，用户只看到死窗口（主进程仍存活但无 UI，属严重"卡死"类） | 同一恢复机制覆盖主窗口与桌宠窗口；正在退出/窗口已销毁时不重载 |

证据：`scripts/qa-renderer-crash.mjs`（修复前 pet/main 均 `recovered=false, crashed=true`；修复后均在 ≈0.52s 恢复）。回归：`tests/unit/qa-renderer-recovery.test.ts`（7 用例：恢复/clean-exit/崩溃循环上限/计数过期/退出/销毁/桌宠）+ `tests/e2e/qa-renderer-crash.spec.ts`（真实崩溃两个窗口并断言恢复）。

### 3.4 测试基础设施缺陷（本轮修复）

| 问题 | 修复 |
| --- | --- |
| `speech-responsive.spec.ts` 的 `async (_fixtures, info)` 违反 Playwright 参数解构要求，导致**整个 e2e 套件无法收集**（基线 0 用例可跑） | 改为解构空对象并注明原因 |
| `flows.spec.ts` 第二个实例 spawn 继承了宿主的 `ELECTRON_RUN_AS_NODE=1`，Electron 以 Node 模式运行导致退出码非 0，单实例用例必失败 | 启动第二实例前删除该环境变量 |
| 压测脚本把「非法输入被校验拒绝」误判为缺陷 | 明确为预期行为（结构化拒绝），只把超时/崩溃计为缺陷 |

## 4. 复跑方式

```powershell
cd E:\Desktop\软件工程\murasame
npm run typecheck && npm run lint && npm test          # 静态 + 单元（955）
npm run test:e2e                                      # 构建 + 全量 e2e
node scripts/qa-soak.mjs                              # 运行时压测（约 4 分钟）
node scripts/qa-adversarial.mjs                       # 启动/退出对抗场景
QA_IDLE_SECONDS=600 node scripts/qa-soak.mjs          # 10 分钟空闲内存观察
npx vitest run tests/unit/qa-*.test.ts                # 30 个 QA 回归用例
```

## 5. 未修复 / 已知限制（不计为已完成）

1. **Docker 停止无超时上限**：隔离活动停止会等待容器启动阶段结束；若 Docker 不响应，停止可能长时间等待（P3 观察，未改代码）。Docker 相关验证需要真实 Docker Desktop 环境，不在本轮自动化覆盖内。
2. **设置/数据库损坏时不自动恢复默认**：采取 fail-closed——启动阶段弹出中文错误框（模态，需用户确认后退出，主进程在确认前阻塞），而不是重建默认数据；避免静默丢用户数据。自动化对抗脚本把该场景记为 `EXPECTED_MODAL_BLOCK`（预期行为，由脚本主动结束进程）。
3. **语音/自主活动的真实能力未做端到端验证**：需要离线语音模型与 Docker 镜像；本轮只覆盖降级与错误路径。
4. **e2e 使用 fake model**：覆盖流式、取消、失败与交互节奏，但不能证明真实模型服务的所有边界。
5. **记忆类别仍是文本输入 + 规范化**，未改为下拉控件（避免破坏既有 e2e 的 `fill('偏好')` 交互约定）；非法值已就地拦截。
6. **渲染进程崩溃循环不再自动恢复**：60 秒内崩溃超过 3 次时停止自动重载（避免无限重载拖垮主进程），需要用户重启应用；恢复后控制台回到默认页面，不保留崩溃前的路由。
7. **极端多显示器/混合 DPI** 只修正了单次越界 1px 的问题，未做多屏矩阵遍历测试。

## 6. 功能扩展提案

见 `docs/38-PRODUCT-VISION.md`（世界观、一天场景、D1→D30 旅程、30 FR/10 UC 映射）与 `docs/39-FEATURE-SPECS.md`（记忆房间 / 每日回顾 / 情绪天气 / 桌面小剧场，含状态机、数据结构、IPC 草案、验收标准）；可交互静态原型在 `previews/vision/`。


## 7. 功能演进：F-01 记忆房间已落地切片

- 控制台记忆页新增「上次被想起」来源链；从未真正召回的记忆显示「还没有被真正想起过」，读取失败显示「召回记录暂时读不到」（诚实三态，不把失败伪装成成功）。
- 新增 IPC `core:memory-recall-sources`（主进程 `memoryRecallSources` → `ConversationService.recallSources` → 纯函数 `collectRecallSources`）。
- 测试：`tests/unit/qa-memory-recall-source.test.ts`（5）、`tests/e2e/qa-memory-provenance.spec.ts`（1）。
- 设计全文见 [docs/39-FEATURE-SPECS.md](39-FEATURE-SPECS.md) §12「实现状态」；未落地部分仍只算提案。
