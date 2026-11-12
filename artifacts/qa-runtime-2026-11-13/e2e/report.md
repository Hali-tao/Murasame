# murasame E2E 边界/压力用例 QA 报告

- 任务：团队任务 `task-2`（owner：qa-e2e）
- 日期：2026-11-13（Asia/Shanghai）
- 环境：Windows / Node v22.19.0 / Electron ^44.9.1（实际 44.x devDependency 安装版本）/ Playwright 1.64.1
- 被测构建：`npm run build`（`electron-vite build`，exit 0）后以 `out/main/index.js` 启动
- 运行命令（PowerShell 不会展开通配符，用等价的文件正则；等价于需求里的 `tests/e2e/qa-*.spec.ts`）：

```powershell
npm run build
npx playwright test "tests/e2e/qa-.*\.spec\.ts" --reporter=line
```

## 结论摘要

| 指标 | 结果 |
| --- | --- |
| 新增用例文件 | 4 个 spec + 1 个专用 helper（`tests/e2e/qa-helpers.ts`） |
| 用例总数 | 13 |
| 通过 | 12 |
| 失败 | 1（`[QA-E2E-07]`，**疑似产品缺陷，待 Lead 修复**） |
| 全量运行耗时 | 第 1 次 1.3 分钟；第 2 次 1.5 分钟（1 worker） |
| 稳定性 | 连续 2 次全量运行结果一致：12 passed / 1 failed；`[QA-E2E-07]` 两次均稳定复现 |
| 约束遵守 | 未修改 `src/**`、未改其它 spec/helpers、未 `git commit`/`push`；只新增 `tests/e2e/qa-*` 与 `artifacts/qa-runtime-2026-11-13/e2e/**` |

结论：桌宠形象热切换、窗口显隐/开关、拖拽越界、桌宠连点、流式回复期间重发/换模型/关窗重开、任务创建-取消循环、记忆并发清空与快速增删改、通知洪泛与过期、快捷键反复注册等场景**未发现卡死、崩溃、未响应、状态不一致或数据损坏**。唯一稳定失败是**审批对话框连点「批准并继续」会弹出重复的红色错误提示**（数据层仍只执行一次），定位见下文，**待 Lead 修复**。

## 用例清单

| 编号 | 文件 | 场景 | 结果 |
| --- | --- | --- | --- |
| QA-E2E-01 | `tests/e2e/qa-pet-stress.spec.ts` | 快速切换形象预设 20 次（4 形象轮换），校验控制台 aria-pressed、settings.petPreset、桌宠 `data-model-id`/`ready` 三处最终一致，窗口唯一、无 pageerror | PASS |
| QA-E2E-02 | 同上 | 快速隐藏/显示桌宠 15 次 + 隐藏到托盘/重开控制台 10 次，窗口可见性与设置一致、窗口不重复、桌宠仍可键盘唤起对话 | PASS |
| QA-E2E-11 | 同上 | 桌宠拖到屏幕四角（真实 `begin-drag/drag-move/end-drag` IPC），窗口不越出工作区、拖拽后仍可点击交互 | PASS（1px DPI 抖动见观察项 O2） |
| QA-E2E-12 | 同上 | 桌宠连点 10 次、打开对话后再连点 5 次：不刷出多个气泡/菜单/对话面板，消息列表不增长，控制台仍可响应 | PASS |
| QA-E2E-03 | `tests/e2e/qa-chat-stress.spec.ts` | 流式请求未结束时再次发送：发送按钮禁用、快捷动作不发新请求、输入草稿不丢、最终只落 1 条用户消息 + 1 条完整回复 | PASS |
| QA-E2E-04 | 同上 | 流式请求未结束时切换默认模型配置：原请求仍收完整回复，新默认服务生效，会话不丢 | PASS |
| QA-E2E-05 | 同上 | 流式请求中隐藏到托盘 1s 再唤回：隐藏期间的流式内容仍送达，回复完整；重开后可继续发第二条并完整回复 | PASS |
| QA-E2E-06 | `tests/e2e/qa-task-memory.spec.ts` | 任务「创建→取消」循环 3 轮：任务数/ID 唯一/全部已取消，源文件未被移动或改写，无红色提示 | PASS |
| QA-E2E-07 | 同上 | 审批对话框三连点「批准并继续」：只执行一次、文件只移动一次、只有 1 条 approval 调用链 | **FAIL（产品缺陷，待 Lead 修复）** |
| QA-E2E-08 | 同上 | 清除全部记忆与进行中的对话并发：清空成功、回复仍完整落库、清空后不被并发提取写回、无 pageerror | PASS |
| QA-E2E-09 | 同上 | 记忆列表快速新增 5 条、同一卡片连续改 3 次、连续删 3 条：前端卡片数与持久化一致，无重复卡片 | PASS |
| QA-E2E-10 | `tests/e2e/qa-notification-hotkey.spec.ts` | 连发 5 条不同例行通知：同时最多 2 条、5s 后全部自动消失；连续 3 次同类通知合并为 1 条并显示「重复 3 次」 | PASS |
| QA-E2E-13 | 同上 | 全局快捷键反复切换 4 轮 + 重复设置 3 次：任一时刻最多 1 个注册、设置值与真实注册状态一致；重复触发 focusChat 只产生 1 个桌宠对话面板 | PASS |

用例设计说明：全部走真实 Electron 进程、真实 preload/IPC 与真实渲染层；模型侧用可控 fake model 服务（`tests/e2e/qa-helpers.ts`），模型探测/验证请求按协议真实返回，聊天流由用例控制推送节奏，**没有 mock 成功结果**，也没有直接改写 store/数据库。每个 spec 使用 `launchApp` 自动生成的独立 `userData` 临时目录。

## 失败详情：[QA-E2E-07] 审批连点出现重复错误提示（待 Lead 修复）

**失败断言错误摘要（stack 前几行）**

```
Error: 连点批准后不应出现错误提示，实际：["当前没有待批准的操作重复 2 次"]
expect(locator).toHaveCount(expected) failed
Locator:  locator('.toast-red')
Expected: 0
Received: 1
Timeout:  5000ms
  ...
  at E:\Desktop\软件工程\murasame\tests\e2e\qa-task-memory.spec.ts:96:95
```

**同一用例中已通过的硬性断言**（说明数据层没有被重复执行）：

- 任务最终状态 `已完成`；
- `文档/example.txt` 存在且内容 `e2e real file`，原 `example.txt` 已不存在（只移动一次）；
- `task.toolCalls` 中 `toolId === 'approval'` 恰好 1 条；
- 任务总数 1、产物 1 个。

**失败事实**：三连点后出现红色（持久）提示「当前没有待批准的操作」，并因 2 条相同提示合并显示「重复 2 次」。

**复现步骤**

1. `npm run build`，随后 `npx playwright test "tests/e2e/qa-task-memory.spec.ts" -g "QA-E2E-07" --reporter=line`；
2. 启动后配置 fake model（test-model / test-key，指向本地 fake server），进入「任务」，新建任务 `整理文件夹 <临时目录>`（目录内含 `example.txt`，内容 `e2e real file`）；
3. 任务进入「等待批准」后点「处理审批」，在对话框内对「批准并继续」按钮于同一帧内执行 3 次 `click()`（等价于用户手抖双击/三击，Playwright 侧用 `evaluate` 同步连点）；
4. 观察：任务最终 `已完成`、文件只移动一次，但右下角出现红字「当前没有待批准的操作重复 2 次」。

失败截图：`artifacts/qa-runtime-2026-11-13/e2e/approval-triple-click-failure-console.png`（控制台红字）与 `approval-triple-click-failure-pet.png`（桌宠窗口）；trace 见 `test-results/qa-task-memory--QA-E2E-07-*/trace.zip`（每次运行会重建）。

**责任判定：疑似产品缺陷（非用例问题）**。同一用户动作连点在真实产品里应当幂等：要么按钮在请求中禁用（按钮已有 `busy` 禁用逻辑，但 React 重渲染发生在这 3 次同步 click 之后，未拦住同帧连点），要么重复调用静默忽略；当前实现把多余的 2 次 IPC 当作错误弹红字，属于可感知的体验缺陷（P3，不造成重复执行/数据损坏）。

**初步定位（IPC / 状态机）**

1. 渲染层 `src/renderer/src/components/dialogs.tsx:245-292`：`ApprovalDialogContent.approve()`/`deny()` 没有 in-flight 去重，`busy` 仅来自 store，同帧多次 click 都会各自发起 `approveTask`；`busy` 生效要等重渲染，晚于同步连点。
2. store `src/renderer/src/store.ts:441-451`：`approveTask` 用 `busyRun('task:approve', …)` 只记录 busy，不阻止重入。
3. IPC `core:approve-task`：`src/main/ipc.ts:388-391` 每次调用都会进入主进程 `task-service.approve()`。
4. 主进程 `src/main/core/services/task-service.ts:314-316`：第一次批准同步把任务状态改成「执行中」，第二/三次进入 `approve()` 时 `current.status !== '等待批准'`，返回 `fail('当前没有待批准的操作')`；渲染层 `unwrap` 把该 error 转成红色 toast（`src/renderer/src/store.ts:84-88`）。
5. 由此 2 条相同 error 合并成 1 条红色 toast「当前没有待批准的操作重复 2 次」（`src/renderer/src/store.ts:266-287` 的合并逻辑）。

**建议修复方向（供 Lead 选择，任选其一即可让本用例转绿）**

- 渲染层：`ApprovalDialogContent.approve/deny` 开头加本地 `submitting` ref 或 `if (busy) return`，或在按钮 `onClick` 置一次性标记；确保第一次点击后同帧后续 click 直接忽略。
- store：`approveTask` 在 `busy['task:approve']` 为真时直接返回当前任务/`null`（幂等），不重复发 IPC。
- 主进程：`task-service.approve()` 对「已不在等待批准」的任务返回 `ok(this.emit(id))`（幂等语义）而不是 `fail`，同时保证审批过期/状态其他异常仍走原错误分支。建议渲染层与主进程都做，防止其它入口连点。

修复后请重跑 `npx playwright test "tests/e2e/qa-.*\.spec\.ts" --reporter=line`，预期 13 passed。

## 观察项（不作为失败，但建议关注）

**O2（P3）桌宠窗口在高 DPI 下拖到屏幕边缘会越界 1px**

- 环境有 2 块显示器：workArea 分别为 `1536x816 @ (0,-864)` 与 `1707x1019 @ (0,0)`（即 125% / 112.5% 缩放）。
- 拖拽前桌宠窗口 bounds `360x500`；拖到右下极限后实测 `x=1347, y=519, width=361, height=501`，右边缘 1708 > 工作区 1707、下边缘 1020 > 1019，即宽高各被 Windows 取整放大 1px，右/下越界 1px。
- `[QA-E2E-11]` 以 2px 容差通过（越界幅度远小于可见范围，不影响点击与显示）。
- 初步定位：`src/main/windows.ts:480-501` `beginPetDrag/movePetDrag` 用 `setBounds` 传入计算尺寸后未回读 `getBounds()` 校正；`src/main/desktop/placement.ts:28-36 clampToDisplay` 以请求尺寸假设包含关系。代码里已有「setBounds 不会像 setPosition 那样每次撑大 1px」的注释，但实测 112.5% 缩放下仍会多 1px。
- 建议：`movePetDrag/endPetDrag` 落位后回读实际 bounds，按实际尺寸再做一次 clamp（超出的 1px 用 `setPosition` 或偏移 `x/y` 修正）；或 `endPetDrag` 时对最终位置做一次「实际 bounds 是否仍在 display 内」的校正。

**O3（P3，待确认）记忆类别是自由文本输入，但后端只接受别名白名单**

- UI `src/renderer/src/components/dialogs.tsx:223-228` 的「类别」是自由文本输入框（默认「偏好」）；后端 `src/main/core/services/memory-service.ts:9-13` 只认 `偏好/反馈/项目/参考`（及英文内部名），`add()`（`:199-202`）对其它值返回「记忆类别或内容无效」，弹红色 toast 且对话框不关闭。
- 行为不算崩溃，提示也算清楚，但用户在自由输入框里输入任意类别容易被拒。建议改为下拉选择，或在输入框旁提示允许的 4 个类别，或在提交前做前端校验。此项因不影响既有用例流程，测试中改用合法类别「偏好」，只作为观察上报。

**O4（说明，非缺陷）控制台聊天流式期间不逐字上屏**

- `src/main/core/services/conversation-service.ts:213-216` 明确「闲聊不把模型原文一个字一个字流进气泡，等这一句完整回来」；因此 `[QA-E2E-03/04/05]` 在流式未结束时断言的是「正在连接/忙碌态 + 发送禁用 + 草稿保留 + 请求数不增加」，而不是逐字 UI。这是现有设计，不是用例缺口。

## 用例开发期修正记录（均已修正，不计入最终失败）

- 控制台聊天不逐字上屏（见 O4）→ 流式期间改为断言 `.thinking-bubble` 忙碌态与请求数。
- 新建会话会自带 1 条「我在。」欢迎语 → 消息条数断言改为按 role 过滤，避免把欢迎语算成回复。
- fake model 的看图探测请求 content 是数组（text + image_url）→ helper 的文本提取需兼容数组，否则模型验证卡死。
- 记忆类别必须命中别名白名单（见 O3）→ 用例改用「偏好」。
- 高 DPI 下窗口 bounds 有 1px 取整（见 O2）→ 边界断言使用 2px 容差，并在本报告单独记录观察。

## 产物

| 路径 | 说明 |
| --- | --- |
| `tests/e2e/qa-helpers.ts` | 可控 fake model 服务（挂起/分段推送/结束/失败流；模型探测即时完成） |
| `tests/e2e/qa-pet-stress.spec.ts` | QA-E2E-01/02/11/12 |
| `tests/e2e/qa-chat-stress.spec.ts` | QA-E2E-03/04/05 |
| `tests/e2e/qa-task-memory.spec.ts` | QA-E2E-06/07/08/09 |
| `tests/e2e/qa-notification-hotkey.spec.ts` | QA-E2E-10/13 |
| `artifacts/qa-runtime-2026-11-13/e2e/approval-triple-click-failure-console.png` | QA-E2E-07 失败时控制台（红色提示）截图 |
| `artifacts/qa-runtime-2026-11-13/e2e/approval-triple-click-failure-pet.png` | QA-E2E-07 失败时桌宠窗口截图 |
| `test-results/qa-task-memory--QA-E2E-07-*/trace.zip` | QA-E2E-07 trace（每次运行重建） |

## 未覆盖 / 限制

- 全局快捷键的「真实 OS 按键」没有合成（避免占用测试机输入），`[QA-E2E-13]` 验证的是：反复切换/重复设置时 `globalShortcut.isRegistered` 真实状态唯一且不泄漏、设置值与状态一致，并通过真实 `focusChat` IPC 边界重复触发桌宠对话面板。若需要真实按键冒烟，建议单独人工/CI 专用用例。
- 托盘菜单点击未自动化（Electron Tray 菜单项无法从 Playwright 稳定触发），仅通过窗口显隐/快捷键路径覆盖桌宠与控制台的可见性状态。
- 未运行其它既有 e2e spec（按要求只跑 `qa-*`，避免与其它 QA 任务抢占桌面/数据库）。


## 修复状态（Lead 更新，2026-11-13）

- QA-E2E-07（唯一失败）：已修复——ConfirmDialog 同步 ref 挡重入、store approveTask busy 去重；现在三连点只执行一次且不刷红字。本用例已通过。
- O2（DPI 1px 越界）：已修复——movePetDrag 落位后回读真实 bounds 再夹一次。
- O3（记忆类别自由文本）：已修复——前端规范化类别（偏好/反馈/项目/参考及英文别名），非法值就地中文提示且不提交。
- 全量 e2e（含本套 13 个用例）：**47 passed / 5 skipped / 0 failed**。
