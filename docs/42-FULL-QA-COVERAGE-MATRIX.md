# Murasame 全量测试与检查 · 覆盖矩阵

> 目标：把软件所有页面、IPC、主进程服务、数据/持久化、窗口/桌宠、自主活动/语音/屏幕/模型/设置/导入导出、安全与异常路径都纳入测试或明确记录缺口。
> 状态标记：✅ 已自动验证（单元/E2E/探测）；🟡 部分覆盖（有测试但缺关键场景）；⬜ 尚未覆盖；📌 已知限制（无法自动验证，已记录原因）。
> 更新方式：每轮补齐后修改对应行并在 `docs/40` 记录证据；最终以全量验证输出为准。

## 1. 页面/交互

| 区域 | 现有覆盖 | 缺口 / 下一步 | 状态 |
| --- | --- | --- | --- |
| 启动 / 单实例 / Onboarding | app.spec（包含首启引导→模型验证→首次真实对话）、adversarial（损坏设置/数据库/重启循环）、qa-window-lifecycle | 托盘首次引导气泡（无自动化驱动方式） | ✅（核心）/📌（托盘引导） |
| 仪表盘 Dashboard | app.spec、qa-daily-recap、qa-affect-weather/events、**qa-dashboard 2 用例（快捷跳转 + 统计真实计数）** | 无 | ✅ |
| 对话 Chat | app.spec、qa-chat-stress、model-lifecycle/status-sync、local-memory、memory-*、recording-hidden、speech-responsive、**qa-autonomy-chat-task [CHAT-10]（朗读降级/上下文面板/快捷总结）** | 停止/重试/复制/编辑消息（当前产品无这些入口）、长历史滚动、附件上传 | 🟡（核心已覆盖；缺失功能不作为缺陷） |
| 屏幕感知 Screen | app.spec 冒烟、**qa-screen-tools 5 用例**、**qa-screen-capture 1 用例（采集不可用降级 + 外发边界；采集可用时断言发送）**、**verify:perception 实跑 PASS（UIA/OCR）** | 真实截图链路在 Playwright 隐藏窗口环境不可稳定复现（已记录）；敏感窗口排除需真实桌面人工验收 | 🟡/📌（真实截图需人工） |
| 自主活动 Autonomy | autonomy-external-status、isolated-creation×2（真实 Docker 3/3）、**qa-autonomy-chat-task [AUTONOMY-10]（UI 未确认禁用 + 真实开始/停止 + 无残留容器）** | preview/watch/look、容器清理失败注入、Docker 不可用提示文案 | 🟡（核心已覆盖） |
| 任务 Tasks | task-directory、task-directory-checkpoints、task-continuation、grounded-summary、qa-task-memory、qa-theater、**qa-autonomy-chat-task [TASK-10]（取消与筛选一致）** | 失败/部分完成/中断状态矩阵、并发任务 | 🟡（核心已覆盖） |
| 历史 History | qa-history-search、memory-clear-ui、flows、pet-history-sync、app.spec | 导出历史由数据包导出覆盖；无 | ✅（核心） |
| 记忆 Memory | local-memory、memory-clear-ui、memory-correction-source、memory-degraded-context、qa-memory-provenance、qa-memory-recall-source（单测）、qa-a11y | 真实召回的正向来源详情（已由单测覆盖 UI；e2e 真实召回路径由 local-memory 覆盖注入） | ✅ |
| 工具 Tools | app.spec 冒烟、tool 单测、**qa-screen-tools.spec 4 用例（开关持久化/禁用拒绝任务/不可用禁用/详情弹窗）** | 插件目录坏文件加载错误 | ✅（核心）/🟡（插件坏文件） |
| 模型 Models | model-lifecycle、model-status-sync、notifications、qa-a11y、qa-window-lifecycle、**qa-model-edges 4 用例（密钥不暴露/不回填/删除默认/预设填充）** | 并发保存/并发验证长尾 | ✅（核心）/🟡（并发长尾） |
| 角色 Character | app.spec、mesh-pet*、qa-theater（角色页恢复入口）、**qa-character-validation 6 用例（保存/校验/非法导入/重置/形象取消/开关）** | 多形象资产矩阵、关系演进长期路径 | ✅（核心）/🟡（长期路径） |
| 设置 Settings | **qa-settings-matrix 10 用例（开关/权限/持续观察/热键/更新检查/帮助/退出/清除/导出/加密）**、qa-settings-observers（单测）、flows（导入导出）、notifications、qa-theater、qa-a11y | 开机自启的真实系统行为、DND 组合触发 | ✅（核心）/🟡（系统级行为） |
| 桌宠窗口 Pet | pet-history-sync、pet-work、mesh-pet*、qa-pet-stress、qa-theater、recording-hidden、speech-responsive | 拖拽边界多 DPI、消息气泡长文本、多实例（单例已测） | 🟡 |
| 托盘 / 全局快捷键 / 窗口 | qa-window-lifecycle、flows（单实例）、qa-notification-hotkey | 原生托盘菜单项（无法用 Playwright 驱动，📌）、关闭行为 ask 对话框、真实快捷键触发 | 🟡/📌 |
| 语音 Voice | recording-hidden、speech-responsive（真实模型 + utilityProcess 专用进程，2/2 通过）、18 个语音单测 | 识别质量、朗读长文本边界、权限拒绝 | ✅（朗读路径）/🟡（识别质量） |
| 更新 Updater | qa-updater-timer（单测）、qa-settings-matrix [SET-05]（检查更新按钮诚实结果与恢复） | 真实更新服务器下载/安装（不可控）；本地逻辑与失败提示已覆盖 | ✅（本地/UI）/📌（真实更新） |
| 数据导入导出 / 加密 | merge/portability/migrate/key 单测、qa-import-refresh、qa-ipc-payload、adversarial、kill-restart、**qa-data-security（加密包无明文/错误口令/损坏包）** | 超大数据包/极慢磁盘、跨版本包 | 🟡（核心已覆盖） |
| 安全 / 隐私 | IPC 大载荷、qa-ipc-shapes、模型 scheme、日志脱敏单测、**qa-data-security（API Key 不落明文、加密包边界）** | 出站图片同意的实际发送路径、敏感窗口截图排除（需真实桌面） | 🟡（核心已覆盖） |
| 性能 / 稳定性 | 9 个探测脚本（soak/adversarial/kill-restart/renderer-crash/main-thread/ipc-payload/ui-memory/ipc-shapes/memory-perf） | 无（持续复核） | ✅ |
| 打包 / 安装 | **npm run package:win 构建成功**（Setup 293MB + win-unpacked；asar 含 speech-worker、resources/models 含真实模型）；**npm run test:e2e:packaged 9 用例通过**（打包态启动/页面/模型对话/记忆/真实语音/BGE/设置跨重启） | 真实安装/升级/卸载系统级行为需人工验收 | ✅（构建+运行）/🟡（安装器流程） |

## 2. IPC 通道（按域）

| 域 | 通道数 | 现有验证 | 状态 |
| --- | --- | --- | --- |
| app / window / pet / settings | 9 / 6 / 20 / 3 | qa-ipc-shapes（69 invoke 通道全量错误形态审计）、qa-window-lifecycle、pet e2e | ✅ |
| core（对话/任务/记忆/模型/回顾） | 39 | 单元 + 多份 e2e；qa-ipc-shapes 业务 Result 契约 | ✅ |
| screen / voice / autonomy | 3 / 5 / 14 | 语音真实模型 e2e；自主真实 Docker 开始/停止；屏幕门禁/外发边界 + verify:perception；真实截图 📌 | 🟡（真实截图人工） |
| character / relationship / data / updates / task 事件 | 1 / 4 / 2 / 1 / 1 | 角色/关系 e2e、数据包安全 e2e、更新检查 UI、任务事件 e2e | ✅（核心）；updates 真实网络 📌 |

## 3. 主进程服务

| 服务 | 验证方式 | 状态 |
| --- | --- | --- |
| conversation / memory / model / task / character / relationship / tool / daily-recap / affect / theater | 单元 + e2e（多数有专项） | ✅ |
| voice / speech-process | 单测（17）+ 真实语音 e2e（专用 utilityProcess） | ✅ |
| screen / autonomy / proactive | autonomy 真实 Docker e2e + UI 开始/停止；screen 手动脚本 + 边界 e2e；proactive 单测（ProactiveLoop/proactiveDecision） | 🟡（screen 真实截图 / proactive 真实空闲时长 📌） |
| updater / keys / migrate / portability / merge-bundle | 单元（含 14 个数据库恢复场景） | ✅ |

## 4. 已知限制（自动验证不了，明确不算已交付）

1. **原生托盘菜单**：无法用 Playwright 点击；只验证了托盘触发的 IPC/窗口行为（显隐、快捷键、通知）。
2. **真实窗口截图链路**：Playwright 隐藏窗口测试环境无法稳定采集真实前台窗口，产品按设计拒绝整屏回退；UIA/OCR 由 `npm run verify:perception` 验收，截图/敏感窗口排除需真实桌面人工验收。
3. **原生文件对话框**：安装包导入导出、形象/目录选择等经系统对话框的路径未在 E2E 中点击；对应业务逻辑由 IPC/数据包 e2e 覆盖（qa-data-security 等），对话框本身为系统 UI。
4. **安装器系统级行为**：完成 NSIS 构建与打包态运行验收，但未在干净机器执行真实安装/升级/卸载；NSIS 钩子由 native uninstall 单测覆盖，系统级需人工验收。
5. **真实更新服务器**：下载/安装/升级不可控；本地定时器逻辑与 UI 检查更新/失败提示已覆盖。
6. **混合 DPI / 多显示器矩阵**：单屏 112.5% 已验证；多屏/不同缩放矩阵需真实硬件环境。
7. **proactive 真实空闲触发时长**：ProactiveLoop/proactiveDecision 有单测，真实“空闲多久后主动开口”依赖使用节奏，未做长时观察。
8. **重负载测试时序抖动**：notifications.spec 曾在高负载全量中偶发超时一次；单独与后续多轮全量通过，持续观察，不视为产品缺陷。
9. **关闭行为 ask 的原生确认对话框**：设置项与窗口关闭逻辑有单测/e2e 覆盖，原生“每次询问”弹框需人工点击验收。
10. **真实语音识别质量/长文本朗读边界**：真实 whisper/kokoro 已跑通合成与朗读链路；识别准确率与长文本音质主观项不做自动化结论。

## 4.1 当前总状态（全量测试收尾）

- 默认套件：单元 89 文件 / 1025 用例；E2E **113 passed / 7 skipped**（无 Docker/无语音模型/未打包的机器）。
- 依赖齐全：`npm run test:e2e:all` → **118 passed / 2 skipped / 0 failed**（2 个 skip 为打包态用例）。
- 原生验收：`verify:native` PASS（SQLCipher）、`verify:perception` PASS（UIA/OCR）。
- 安装包形态：`npm run package:win` + `npm run test:e2e:packaged` → **9 passed**（含打包态真实语音与真实 BGE）。
- 运行时探测：9 项在最终 HEAD 复核，0 崩溃/0 未响应/0 异常退出。
- 已修复：QA-VOICE-01（语音专用进程缺失，P1）、QA-TOOLS-01（不可用工具开关，P3）、QA-WINLIFE-05（桌宠快速切换状态分叉，P3）。
- 测试稳定性加固：stream-kill 合法完成态契约、mesh-pet 眨眼 MutationObserver、重负载原生单测超时。
- 剩余均为已记录的已知限制（见 §4）；无 ⬜ 功能面缺口。

## 5. 复跑入口

```bash
npm run verify             # typecheck + lint + 单元 + 追溯
npm run test:e2e:all       # 自动检测 Docker/真实语音模型后跑全量 E2E（本机实测 118 passed / 2 skipped：2 个为打包态用例）
npm run package:win        # 构建安装包（NSIS）
npm run test:e2e:packaged  # 安装包形态验收（本机实测 9 passed）
npm run verify:native      # SQLCipher 原生加密验收
npm run verify:perception # UIA / Windows OCR 真实感知验收
node scripts/qa-*.mjs      # 9 个运行时探测
npm run qa:memory-perf     # 500 记忆 / 300 会话性能基准
```
