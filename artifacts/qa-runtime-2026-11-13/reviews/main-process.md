# murasame 主进程与 IPC 健壮性审查报告

- 审查日期：2026-11-13
- 审查者：qa-main（team task-1）
- 仓库：`E:\Desktop\软件工程\murasame`
- 范围：`src/main/**`、`src/preload/index.ts`、`src/shared/{ipc,schemas,types}.ts` 的静态审查 + 可单测问题的回归测试
- 约定依据：`docs/00-OVERVIEW.md` 第 4 节（不新增 mock 回退、不把失败 catch 成成功、测试标题带需求/问题编号、用户可见文案简体中文、IPC 层把 `NotImplementedError` 转为明确提示）
- 边界：本次只新增 `tests/unit/qa-*.test.ts` 与本报告；**未修改 `src/**`、未改其他 tests、未 commit**。所有需要改源码的修复由 Lead 执行。

---

## 1. 结论摘要

| 项目 | 结果 |
| --- | --- |
| P0（进程崩溃 / 不可恢复数据损坏） | **0**：本轮静态审查未找到可确定复现的 P0 路径 |
| P1（功能失效 / 静默数据丢失） | **2** |
| P2（体验 / 边界防御不足） | **7** |
| P3（打磨 / 低频竞态） | **10** |
| 缺陷合计 | **19**（其中 9 条有回归测试覆盖，共 14 个失败用例） |
| 新增回归测试 | 5 个文件 / 30 个用例：**16 通过，14 失败（待 Lead 修复）** |
| `npm test` 全量 | 77 文件 / 955 用例：**941 通过，14 失败**；失败全部是本报告新增的「待修」回归用例，既有 925 个用例全绿 |

**最关键的 3 个问题**：
1. **QA-MAIN-01（P1）** `app.whenReady().then(async () => {...})` 没有 `.catch`：初始化中途抛错时进程会“挂起”——没有窗口、没有托盘、没有 IPC，只写一行日志。
2. **QA-MAIN-02（P1）** 数据导入时同对话内“前 12 字相同”的两条消息会生成同一个回退 ID，被 `INSERT OR IGNORE` **静默丢弃**，而导入结果仍报告成功（违反 NFR-R01）。
3. **QA-MAIN-05（P2）** 向已销毁 `webContents` 的广播没有隔离，异常会从 IPC handler 冒泡成 invoke 拒绝（业务已成功却报失败），并会中断 `core:task-updated` 回调里后续的协作/表现处理。

P0/P1 判定口径：P0 = 主进程崩溃、数据库损坏/不可恢复；P1 = 用户可见主流程失效或数据静默丢失且无补偿；P2 = 异常输入/异常状态下体验或状态一致性受损；P3 = 低频竞态、资源泄漏、可维护性。

---

## 2. 缺陷清单（详细）

> 编号规则：`QA-MAIN-*` 为本报告缺陷编号；「回归测试」列给出 `tests/unit/qa-*.test.ts` 中的用例标题，用例标题同时以该测试编号开头。

### QA-MAIN-01 启动链路缺少终态错误处理（P1）

- **证据**：`src/main/index.ts:118`（`app.whenReady().then(async () => {`，全函数 118-231 行无 `.catch`）；`src/main/index.ts:247-257` 仅 `log.error`，不退出、不提示。异常点包括 `MurasameCore.create`（index.ts:135）、`initializeWindows`（158）、`createTray`（159）、`registerIpcHandlers`（157）、`initializeUpdater`（201）、`ProactiveLoop` 构造（203）。
- **触发条件**：数据库打开成功之后，任一初始化步骤抛错。例如用户目录权限异常导致 tray/窗口创建失败、插件目录不可读、`ProactiveLoop` 依赖构造异常等。
- **后果**：`unhandledRejection` 被全局兜底吞成日志；窗口/托盘可能都没建出来，用户只能去任务管理器结束进程，且看不到任何提示。
- **建议修复**：把 whenReady 的 async 流程收敛为 `run().catch(error => { log.error('启动失败', error); dialog.showErrorBox('Murasame 启动失败', 中文原因); app.exit(1) })`；`process.on('uncaughtException')` 记录后同样进入可控退出。
- **回归测试**：无（需要 Electron 启动集成测试；本报告未写，Lead 修复后建议补 e2e 冒烟）。

### QA-MAIN-02 导入消息静默丢失（P1，数据丢失）

- **证据**：`src/main/data/merge-bundle.ts:43` 回退消息 ID 为 `` `msg-import-${id}-${conversations}-${text.slice(0, 12)}` ``，不含消息序号/序号去重；`merge-bundle.ts:27-29` 使用 `INSERT OR IGNORE`；`merge-bundle.ts:56` 返回值只统计 `conversations`/`memories`，不报告被丢弃的消息。
- **触发条件**：导入包（或旧数据包）里同一对话有两条前 12 个字符相同的消息、或两条消息显式 `id` 相同。正常聊天记录极易出现「好的，我明白了……」这类同前缀消息。
- **后果**：`INSERT OR IGNORE` 静默丢弃后续消息；`data:import-bundle` 仍返回 `{ok:true, note:'已合并导入'}`，用户以为完整恢复。
- **建议修复**：回退 ID 加入对话内消息下标/随机后缀（如 `msg-import-${id}-${index}-${hash}`）；对 `INSERT OR IGNORE` 带来的忽略做统计并在结果里显式给出「已跳过 N 条重复/冲突消息」。
- **回归测试**：
  - `tests/unit/qa-data-integrity.test.ts` › `[QA-DATA-01] 同一对话中前缀相同的两条导入消息都必须保留，不能静默丢弃`（当前失败）

### QA-MAIN-03 数据包未做长度/结构校验，损坏包把底层英文异常透传给用户（P2）

- **证据**：`src/main/data/portability.ts:22-31`：只检查 `MUR1` magic 与 `version`，不校验最小长度（salt 16 / iv 12 / tag 16 之后才可能有密文），`Buffer.from('MUR1')` 会直接触发 `createDecipheriv` 的 `Invalid initialization vector`；`portability.ts:32-38` 直接 `JSON.parse` 后按 `PortableBundle` 使用，不校验 `conversations`/`memories` 是数组、`bundle` 是对象；`src/main/ipc.ts:512-519` 把异常 `message` 原样返回给渲染进程（`ipc.ts:538-540` 同样）。
- **触发条件**：用户导入损坏/截断/被第三方工具改写过的 `.murapack`；或包内 `conversations` 为对象。
- **后果**：用户看到英文底层报错（违反「用户可见文案一律简体中文」）；`bundle` 为 `null` 时 `bundle.version` 直接 TypeError；若非数组，`merge-bundle.ts:34` 的 `for...of` 抛 `is not iterable`。数据库事务本身是安全的（不会半写），但错误不可理解。
- **建议修复**：`importBundle` 先校验 `payload.length >= 49`、`salt/iv/tag` 长度，再用 zod（或手写）校验 `version:number`、`conversations/memories: array`、`character` 形状，失败统一抛「数据包结构无效或已损坏，现有数据保持不变」。
- **回归测试**：
  - `tests/unit/qa-data-integrity.test.ts` › `[QA-DATA-02] 截断的导入包以中文错误拒绝，不能把底层“Invalid initialization vector”抛给用户`（当前失败）
  - `tests/unit/qa-data-integrity.test.ts` › `[QA-DATA-03] 结构非法的导入包被拒绝，不能带着错误结构进入数据库合并`（当前失败）

### QA-MAIN-04 设置观察者无失败隔离，一个监听器抛错阻断其余监听器并抛回持久化后调用方（P2）

- **证据**：`src/main/settings.ts:71-73`：`store().set('settings', next)` 成功后才 `listeners.forEach(listener => listener(next))`，无 try/catch；对照项目既有做法 `src/main/core/services/conversation-service.ts:25-27`（`notify`）与 `src/main/model/registry.ts:99-101`（`try { listener(...) } catch {}`）。`src/main/ipc.ts:204-209` 的监听器会执行 `core.syncMemoryPolicy()`、`privacyKey()`、`broadcast()`（`ipc.ts:86-90` 的 send 可能抛）。
- **触发条件**：任一设置监听器抛错（例如广播到已销毁 webContents、syncMemoryPolicy 内读 DB 失败、未来新增监听器异常）。
- **后果**：设置已落盘，但后续监听器全部不执行（UI 收不到 `settings:changed`）；`updateSettings` 把异常抛给 IPC handler → `settings:update` invoke reject；`windows.ts` 内部调用 `updateSettings` 的路径（showPet/hidePet/close 等）也会被异常打断。
- **建议修复**：`listeners.forEach` 内 try/catch + `log.warn`（观察者不得回滚已提交写入）。
- **回归测试**：
  - `tests/unit/qa-settings-observers.test.ts` › `[QA-SET-01] 一个设置监听器抛错不应阻止其他监听器收到最新设置`（当前失败）
  - `tests/unit/qa-settings-observers.test.ts` › `[QA-SET-02] 设置监听器抛错时 updateSettings 仍完成持久化并返回新设置`（当前失败）

### QA-MAIN-05 向已销毁 `webContents` 广播未隔离，异常冒泡打断 IPC 结果/任务事件链（P2）

- **证据**：
  - `src/main/windows.ts:94-100` `broadcastPetState` 只判 `window.isDestroyed()`；
  - `src/main/windows.ts:296-299` `broadcastPetPerformance`、`src/main/windows.ts:556-562` `focusPetChat` 无任何保护；
  - `src/main/ipc.ts:86-90` `broadcast` 同样只判 `window.isDestroyed()`；
  - `src/main/ipc.ts:330-344` 在 `core.createConversation/setActiveConversation` 成功后广播；`src/main/ipc.ts:187-202` `core.tasks.onChange` 回调里先 `broadcast(...)`，抛错会跳过后续 `invalidatePresentation`、`learnVerifiedImageSkill` 之后的表现广播与兜底。
- **触发条件**：窗口尚未销毁但 `webContents` 已销毁/渲染帧已释放（渲染进程崩溃后立刻更新、窗口销毁瞬间、关闭动画期间），`send` 抛 `Render frame was disposed …`。
- **后果**：业务已成功但 IPC 返回 reject（渲染层提示失败）；任务状态回调链中断，桌宠表现不再更新。
- **建议修复**：新增统一的 `safeSend(window, channel, payload)`（`!window.isDestroyed() && !window.webContents.isDestroyed()` + try/catch + `log.warn`），替换 `windows.ts`/`ipc.ts` 中所有 `webContents.send`。
- **回归测试**：
  - `tests/unit/qa-window-broadcast.test.ts` › `[QA-WIN-01] 渲染进程 webContents 不可用时广播桌宠状态不抛异常`（当前失败）
  - `tests/unit/qa-window-broadcast.test.ts` › `[QA-WIN-02] 表现事件发送失败不应让任务/对话回调崩溃`（当前失败）
  - `tests/unit/qa-ipc-handlers.test.ts` › `[QA-IPC-06] 广播时渲染窗口不可用不应让 IPC 请求本身失败`（当前失败）
  - `tests/unit/qa-ipc-handlers.test.ts` › `[QA-IPC-07] 任务状态回调中广播失败不应中断协作者与表现处理`（当前失败）

### QA-MAIN-06 录音样本无长度/元素校验，超长录音把整段 PCM 经 IPC 送入主进程（P2）

- **证据**：`src/main/ipc.ts:471-475`：`Float32Array.from(payload.samples)`，仅判 `Array.isArray`，无长度上限、无有限数字校验；`src/preload/index.ts:154` 直接把 `number[]` 传入；渲染层 `src/renderer/src/lib/audio.ts:42-65` 录音无时长上限，`stop()` 返回 `Array.from(downsample(...))`（16kHz 单声道，60 秒 = 96 万个 number，经 IPC 结构化克隆 + `Float32Array.from` 再复制一份）。
- **触发条件**：用户按住录音较长时间（或渲染层 bug 传入超大数组/含 `null`、字符串的数组）。
- **后果**：主进程同步分配/复制巨量数据，UI 卡顿甚至内存峰值失控；非数字元素被转成 `NaN` 进入本地识别模型，结果不可解释（且不报错）。
- **建议修复**：在 `ipc.ts` 加 zod 或手写校验：`samples` 必须是长度 ≤ `16_000 * 120`（建议 120 秒）的有限数字数组；非法时返回 `{text:'', accepted:false, message:'录音数据无效或过长，已忽略这次录音。'}`；渲染层同时限制单次录音时长。
- **回归测试**：
  - `tests/unit/qa-ipc-handlers.test.ts` › `[QA-IPC-03] 录音样本超长或含非数字时拒绝，不把失控数据送进识别推理`（当前失败）

### QA-MAIN-07 朗读文本无长度上限（P2）

- **证据**：`src/main/ipc.ts:476-485`：`String(payload?.text ?? '')` 直接交给 `core.voice.speak`；`src/main/local/tts.ts:51-88` 对入参无长度上限（`phonemizeChinese(trimmed)` 先处理全文）。
- **触发条件**：渲染层把整段长文（例如整页历史/模型输出）传给 `voice.speak`。
- **后果**：音素化/模型推理在主进程内长时间占用；IPC 返回的 `samples` 数组同样巨大（24kHz × 时长）。
- **建议修复**：IPC 层限制 ≤ 2000 字（与 `autonomy.create` 的 2000 字口径一致），超长返回 `{played:false, message:'这段文字太长，已保留文字回复。'}`。
- **回归测试**：
  - `tests/unit/qa-ipc-handlers.test.ts` › `[QA-IPC-04] 朗读文本超长时拒绝，不把整段文字交给语音合成`（当前失败）

### QA-MAIN-08 自主浏览目标没有长度上限，与创作口径不一致（P3）

- **证据**：`src/main/ipc.ts:622-627` `autonomy.browse` 只做 `trim()` 非空；对照 `ipc.ts:549` 的 `autonomy.create` 有 `.max(2000)`、`autonomy-service.ts:343` `produce` 也有 2000 上限。
- **触发条件**：渲染层传入超长目标（≥2000 字）。
- **后果**：目标会逐轮进入看图模型提示词（每步一次），token 成本与延迟放大；与已声明的 2000 字口径不一致，容易被后续开发误用。
- **建议修复**：`browse` 与 `watch`/`look` 统一在 ipc.ts 用 zod 校验（goal ≤ 2000，url ≤ 500 且 http(s) 且拒绝换行）。
- **回归测试**：
  - `tests/unit/qa-ipc-handlers.test.ts` › `[QA-IPC-05] 自主浏览目标超长时拒绝，与创作目标的 2000 字上限保持一致`（当前失败）

### QA-MAIN-09 更新器延迟检查定时器未跟踪，停止后仍会发起网络请求（P3）

- **证据**：`src/main/updater.ts:64-72`：`initializeUpdater` 里 `setTimeout(() => void checkForUpdates(), 10_000)` 未保存句柄；`updater.ts:74-77` `stopUpdater` 只清 interval。`src/main/index.ts:233-236` 在 `before-quit` 调 `stopUpdater()`。
- **触发条件**：应用在启动后 10 秒内退出（或更新器随 before-quit 停止后，事件循环仍走到该 timer）。
- **后果**：退出清理期间仍发起更新网络请求（退出被拖慢、离线环境报错日志）；定时器句柄泄漏。
- **建议修复**：保存 delayed timer 句柄并在 `stopUpdater` 中 `clearTimeout`；`configure` 失败/未配置时不要排程。
- **回归测试**：
  - `tests/unit/qa-updater-timer.test.ts` › `[QA-UPD-01] 停止更新器后，启动时的延迟检查不应继续执行`（当前失败）

### QA-MAIN-10 更新检查失败原文回传英文网络错误（P3，违反用户文案约定）

- **证据**：`src/main/updater.ts:55-61`：`catch` 后 `message: error.message`。渲染层 `updates.check` 的结果会由控制台/通知直接展示。
- **触发条件**：断网/更新源不可达（工程内就会触发 `getaddrinfo ENOTFOUND …` 之类英文错误）。
- **后果**：用户看到 `getaddrinfo ENOTFOUND update.example.invalid`；不符合「用户可见文案一律简体中文」。
- **建议修复**：保留技术细节到 `log.error`，对用户返回「检查更新失败，请稍后重试。」（可附带已脱敏短原因）。
- **回归测试**：
  - `tests/unit/qa-updater-timer.test.ts` › `[QA-UPD-03] 检查更新抛错时返回中文错误结果，不把异常抛给 IPC 调用方`（当前失败）

### QA-MAIN-11 非 `handleCore` 的 IPC 处理器没有统一异常边界（P2）

- **证据**：`src/main/ipc.ts:311-325`（`settings:get/update`）、`ipc.ts:449-469`（`relationship:get/reset/changeAppearance`）、`ipc.ts:240-259`（`pickOpen/pickSave`）等直接调用可能抛错的服务（`getSettings/updateSettings` 依赖 electron-store，`settings.ts:58-74` 未捕获读写/解析异常）；`handleCore` 有 try/catch（`ipc.ts:124-139`），这些没有。
- **触发条件**：`murasame.json` 配置损坏、磁盘满/只读、safeStorage 不可用等。
- **后果**：所有设置读取/写入与关系页 IPC 以 invoke rejection 形式抛到渲染层，错误文本为 electron-store/Node 原始英文；`getBootstrap` 同样会被 `getSettings()` 连带失败，用户进入控制台即白屏。
- **建议修复**：IPC 边界统一包装（返回中文结构化错误或明确的中文 `Error`），settings 读取损坏时按项目已有 `data/recovery.ts` 口径给出可恢复提示，而不是静默回退默认值。
- **回归测试**：无（可在 `qa-ipc-handlers.test.ts` 的 mock 基础上补「store 抛错」用例，待 Lead 决定错误形态后补）。

### QA-MAIN-12 数据导入/导出的口令与路径没有 schema 校验（P2，防御纵深）

- **证据**：`src/main/ipc.ts:486-506`（`data.exportBundle`）：`String(requested.passphrase)` 仅长度 <6 检查，`requested.path` 任意字符串直接 `writeFileSync`（`ipc.ts:501`）；`ipc.ts:507-541`（`data.importBundle`）：`readFileSync(source)` 任意路径、`scryptSync`（`portability.ts:28`）对超长口令无上限、导入侧不校验口令长度。
- **触发条件**：渲染层被注入（供应链/XSS）或渲染层 bug 传入超长口令/任意路径。
- **后果**：主线程 `scryptSync` 长时间占用（口令越长越明显）；任意路径读写突破「渲染进程不接触文件系统」的最小校验纵深。
- **建议修复**：`data.*` 加 zod：`passphrase: z.string().min(6).max(200)`、`path: z.string().max(32767)`；导出目录限制在 `app.getPath('downloads')` 或经 `dialog.showSaveDialog` 选择。
- **回归测试**：无（现有 `qa-ipc-handlers.test.ts` 已覆盖口令过短返回中文错误的通过路径）。

### QA-MAIN-13 `app:pick-open` / `app:pick-save` 参数无校验（P3）

- **证据**：`src/main/ipc.ts:240-259`：`raw as { title?, directory?, filters? }` 直接传给 `dialog.showOpenDialog/showSaveDialog`，非法 `filters` 结构或缺 `filePaths` 假设（`result.filePaths[0]`）会让 Electron 抛 TypeError；错误以 invoke rejection 英文形式到渲染层。
- **建议修复**：zod 校验 `title`（字符串/≤200）、`directory` 布尔、`filters` 数组（每项 `{name, extensions[]}` 上限）。
- **回归测试**：无。

### QA-MAIN-14 若干未处理 Promise（P3）

- **证据**：
  - `src/main/windows.ts:62-70` `void window.loadURL(...)`（加载失败只靠 `did-fail-load` 日志，Promise rejection 走全局兜底）；
  - `src/main/tray.ts:39-47` `void checkForUpdates().then(...)` 无 `.catch`（`dialog.showMessageBox` 失败时未处理）；
  - `src/main/updater.ts:66-71` `void checkForUpdates()`：`configure()` 在 `checkForUpdates` 的 try 之外（`updater.ts:37`），`autoUpdater.setFeedURL` 对非法 `MURASAME_UPDATE_URL` 抛错时成为未处理 rejection；
  - `src/main/core/services/autonomy-service.ts:182` `void this.finish(...)` 无 catch（`finish` 内部大多已收敛，但清理/状态更新仍可能抛）；
  - `src/main/core/proactive-loop.ts:31` `void this.tick()`：`tick` 的 42 行前置判断在 try 之外，`deps.*` 抛错会成为未处理 rejection。
- **后果**：全部被 `index.ts:255-257` 的 `unhandledRejection` 记为日志，不崩但可能静默丢状态；仍建议逐点补 `.catch`（与项目「不把失败 catch 成成功」一致，只记录并明示）。
- **回归测试**：无（属代码卫生；修复后不需要新单测）。

### QA-MAIN-15 定时器/内存资源回收不完整（P3）

- **证据**：
  - `src/main/windows.ts:142-152`（`saveBoundsTimer`）与 `282-287`（`savePetTimer`）：窗口 `closed`/退出时不 `clearTimeout`，最后一次延迟写盘可能在退出清理期间执行；
  - `src/main/core/services/conversation-service.ts:70,285-289`：`queues: Map<conversationId, RequestQueue>` 永不移除，`deleteHistory`（250-259）不清理该 Map，长期使用会话数增长即常驻；
  - `src/main/updater.ts:66` interval 已在 `stopUpdater` 清理（此处无问题，仅记录核对结果）。
- **建议修复**：窗口 `close/closed` 与 `before-quit` 清理两个 timer；`deleteHistory` 时 `this.queues.delete(id)`。
- **回归测试**：无（可直接代码修复；如 Lead 需要，可在后续补 fake timer 用例）。

### QA-MAIN-16 数据库版本元数据损坏时全量重跑迁移，启动失败信息不可读（P3）

- **证据**：`src/main/data/migrate.ts:11-16`：`Number(currentRow?.value ?? 0)`，值非数字得 `NaN`；`migrate.ts:23-31` 的 `migration.version <= current` 对 `NaN` 恒为 false，于是所有迁移重跑，`001_init.sql` 的 `CREATE TABLE conversations` 抛 `table conversations already exists`；`src/main/index.ts:122-130` 弹窗展示的 `message` 即该英文 SQLite 错误。
- **触发条件**：`meta.schema_version` 被外部工具写坏（如 `'v3'`/空串）。
- **后果**：应用无法启动，提示英文 SQL；数据本身未损坏（事务回滚）。
- **建议修复**：读到非法 `schema_version` 时抛中文「本地数据库版本元数据损坏，已停止打开以免重复迁移」；或按 `max(0, floor)` 校验后走 recovery 流程。
- **回归测试**：`[QA-DATA-07]`/`[QA-DATA-08]` 覆盖正常回滚与降级拒绝（当前通过），元数据损坏路径未写用例。

### QA-MAIN-17 导入角色失败的中间态未清理（P3）

- **证据**：`src/main/ipc.ts:425-438`：先把角色目录复制进 `userData/characters`（`importCharacterDirectory`），再写 `characters_imported` 表；DB 写入失败时只返回错误（`ipc.ts:434-436`），已复制的目录留在磁盘上。
- **后果**：重复导入会累积孤儿目录/占用空间，UI 不显示但磁盘残留。
- **建议修复**：DB 写失败时 `rm` 已导入目录（或先记录 DB 再落盘），并保留明确中文错误。
- **回归测试**：无。

### QA-MAIN-18 快捷键设置“先写后回滚”，通知两次且回滚失败会留下不可用配置（P3）

- **证据**：`src/main/ipc.ts:313-325`：先 `updateSettings(parsed.data)`（触发持久化 + `settings:changed` 广播），再校验 `applyHotkey`；失败时 `updateSettings({ petHotkey: previous.petHotkey })`。两次持久化、两次广播，UI 可能闪一下失败值；若第二次 `updateSettings` 抛错（store 异常），设置里会留下注册失败的快捷键。
- **建议修复**：先 `applyHotkey`（或先校验 accelerator 可注册性），成功后再持久化；失败只返回中文原因不写盘。
- **回归测试**：无。

### QA-MAIN-19 源码注释乱码（P3）

- **证据**：`src/main/settings.ts:24` 注释为 `/** ? keys.ts??????? userData ???????? app ????? */`，中文已被错误编码破坏，无法阅读。
- **建议修复**：重写该注释（说明延迟构造 electron-store 的原因，与 `src/main/data/keys.ts:15-18` 风格一致）。
- **回归测试**：不适用。

### 其他已核对、未发现问题的项（记录审查结论）

| 审查点 | 结论与证据 |
| --- | --- |
| `ipcMain.handle` 参数校验（`handleCore` 通道） | `ipc.ts:124-139` 统一 `safeParse`，非法参数返回 `{ok:false,error:'请求参数无效：字段'}`；22 个核心通道回归用例通过（`[QA-IPC-01]`/`[QA-IPC-02]`）；`shared/schemas.ts` 对长度/URL/枚举覆盖良好 |
| `handleCore` 异常与脱敏 | `ipc.ts:103-122` `errorMessage` 捕获 `NotImplementedError`/`AppError`，`redact` 脱敏 `sk-*`/api key；回归用例 `[QA-IPC-08]` 通过 |
| process 级兜底 | `index.ts:247-257` 同时注册 `uncaughtException`/`unhandledRejection`（仅单实例分支内，见 QA-MAIN-01 的补充修复建议） |
| 事件监听器泄漏 | `core.memory.subscribe`/`subscribeIndex`、`core.subscribeModels`、`core.tasks.onChange`、`core.autonomy.subscribe` 均在 `registerIpcHandlers` 的 `registered` 守卫内只注册一次（`ipc.ts:84,157-209`）；`windows.ts` 每次建窗注册的监听随窗口生命周期结束；`screen.on('display-*')`（`windows.ts:323-325`）只注册一次；`app-state/updater` 同样有幂等守卫。未发现无界监听器增长 |
| 定时器泄漏（除 QA-MAIN-09/15） | `index.ts:171-184` 的 `watchTimer`/`healthTimer` 均在 `before-quit` `clearInterval`；`proactive-loop.ts:29-38` `start/stop` 幂等且清理；`agent/*`、`isolation/*`、`tools/*` 的 `setTimeout` 均在 `finally` 清理 |
| DB 事务/迁移失败路径 | `migrate.ts:25-29` 每个 migration 独立事务，失败回滚且不写版本号（`[QA-DATA-07]` 通过）；`db.ts:26-32` 迁移失败即 `db.close()`；`cipher.ts:20-27` 对 `SQLITE_NOTADB/SQLITE_CORRUPT` 转为 recovery 错误；`keys.ts:29-67` 对「有库无钥/有旁车无主库/安全存储不可用」均 fail-closed（`[QA-DATA-08]` 通过）。并发写方面 better-sqlite3 为同步单线程，未见进程内写交叉；异步场景均用事务包裹 |
| 加密库异常 | `cipher.ts`/`keys.ts`/`portability.ts` 的异常路径均有明确处理；导入包的校验缺口见 QA-MAIN-03/12 |
| 任务取消/继续竞态 | `task-service.ts:337,357,467-484` 的 AbortController + stop 标记 + continuation 版本守卫；既有 `task-continuation-races.test.ts`/`task-reliability-regression.test.ts` 全绿；`[QA-DATA-06]` 验证导入事务回滚 |
| 模型请求取消/超时 | `model/gateway.ts:47-84`：排队后 `throwIfAborted`、`beforeSend`、timeout + abort listener 在 `finally` 成对清理；`transport.ts:115-131` 流读取 `finally` 中 cancel/releaseLock；未发现取消失效 |
| 记忆索引取消 | `memory-service.ts:120-140,182-197` `cancelIndex`/`waitForIndex` 正确移除 abort listener 与 timer；跨代 (`generation`) 结果丢弃 |
| 窗口生命周期（正常路径） | `createMainWindow/createPetWindow` 有 `isDestroyed` 复用守卫（`[QA-WIN-03]` 通过）；`openMainPath` 白名单只放行 `/tasks /chat /settings /autonomy`（`windows.ts:337-345`，`[QA-WIN-04]` 通过）；关闭到托盘/最小化后 `window:hidden` 通知已有测试覆盖；销毁后状态查询安全（`[QA-WIN-05]` 通过） |
| 隔离环境取消 | `ipc.ts:160-169,565-590,633-638` 的 `prepareGeneration` 代际检查 + `AbortController.abort`；`autonomy-service.stop` 会 `await run.starting` 后 `finish`。残余风险：若 Docker 启动不响应 signal，`stop` 会等待 `starting` 到超时（代码未设上限），记为 P3 观察项 |

---

## 3. 新增回归测试与执行结果

### 3.1 新增文件

| 文件 | 用例数 | 通过 | 失败（待 Lead 修复） |
| --- | --- | --- | --- |
| `tests/unit/qa-data-integrity.test.ts` | 8 | 5 | 3（`QA-DATA-01/02/03`） |
| `tests/unit/qa-ipc-handlers.test.ts` | 9 | 4 | 5（`QA-IPC-03/04/05/06/07`） |
| `tests/unit/qa-settings-observers.test.ts` | 4 | 2 | 2（`QA-SET-01/02`） |
| `tests/unit/qa-updater-timer.test.ts` | 4 | 2 | 2（`QA-UPD-01/03`） |
| `tests/unit/qa-window-broadcast.test.ts` | 5 | 3 | 2（`QA-WIN-01/02`） |
| **合计** | **30** | **16** | **14** |

测试标题均以问题编号开头（`[QA-DATA-01]`、`[QA-IPC-03]`…），便于追溯；全部不依赖真实 Electron（`vi.mock('electron', …)` + fake `ipcMain`/`BrowserWindow`/`autoUpdater`，数据层用 `node:sqlite` 内存库 + 迁移 SQL，设置层 mock `electron-store`）。

### 3.2 `npm test` 结果（命令：`npx vitest run`，2026-11-13）

```
 Test Files  5 failed | 72 passed (77)
      Tests  14 failed | 941 passed (955)
   Duration  43.57s
```

- **既有 925 个测试全部通过**，未因本次改动出现回归。
- 14 个失败**全部**是本报告新增的、针对上述缺陷的回归用例；这些失败是**预期中的「待 Lead 修复」状态**，测试断言未放宽、未删除。
- 失败用例与缺陷对应：`QA-MAIN-02 → [QA-DATA-01]`；`QA-MAIN-03 → [QA-DATA-02/03]`；`QA-MAIN-04 → [QA-SET-01/02]`；`QA-MAIN-05 → [QA-WIN-01/02]、[QA-IPC-06/07]`；`QA-MAIN-06/07/08 → [QA-IPC-03/04/05]`；`QA-MAIN-09/10 → [QA-UPD-01/03]`。
- 原始日志：`artifacts/qa-runtime-2026-11-13/reviews/.tmp-full-test.log`（临时文件，可随报告保留或删除）。
- `npm run typecheck`（`tsc --noEmit -p tsconfig.node.json`）在新增测试文件上零错误。

### 3.3 测试可修性核对（给 Lead 的修复顺序建议）

1. **先修 P1**：QA-MAIN-01（index.ts whenReady catch，仅启动链路）、QA-MAIN-02（merge-bundle 回退 ID，单文件小改）。
2. **再修 P2**：QA-MAIN-03（portability 校验）、QA-MAIN-04（settings 观察者 try/catch）、QA-MAIN-05（统一 safeSend，涉及 windows.ts + ipc.ts 两个文件）、QA-MAIN-06/07/08（ipc.ts 输入上限）。
3. **最后 P3**：QA-MAIN-09/10（updater）、11/12（IPC 边界）、13-19（资源/中间态/注释）。
4. 修完运行 `npx vitest run tests/unit/qa-*.test.ts` 确认 30 个用例全绿，再跑 `npm test`/`npm run typecheck`。

---

## 4. 范围与限制说明

- 本报告为**静态审查 + 单元级回归**，不包含真实 Electron 运行时/e2e；广播崩溃、启动失败悬挂等竞态用 mock 复现，真实触发概率取决于渲染进程崩溃/窗口销毁时序。
- `agent/executor.ts`、`isolation/docker-runtime.ts` 等大文件仅做了针对性抽查（取消、超时、失败路径），未逐行审查；与本次结论相关的点已在上表列出。
- 所有要求修改 `src/**` 的结论均只记录在上述缺陷条目中，未在本次边界内实施。


## 5. 修复状态（Lead 更新，2026-11-13）

- **19/19 处理完毕**：QA-MAIN-01~19 均已在源码实施对应修复（详见 docs/40-QA-RUNTIME-REPORT.md §3.1）。
- 验证：`npx vitest run tests/unit/qa-*.test.ts` → **30/30 通过**；全量单测 **77 文件 / 955 用例通过**；全量 e2e **47 passed / 5 skipped / 0 failed**。
- QA-MAIN-11 口径说明：采用 fail-closed —— 设置读写失败返回中文错误，启动阶段失败弹中文错误框并退出；未做设置文件自动重建（避免静默丢数据），列为已知限制（docs/40 §5）。
