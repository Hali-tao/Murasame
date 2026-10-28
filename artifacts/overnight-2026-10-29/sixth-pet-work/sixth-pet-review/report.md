# 第六轮桌宠集成独立只读复核

只读检查范围：activity-motion-director、Live2DPet 活动接口、pet.tsx 接线、followAutonomyStatus、AutonomyService/IPC/preload 状态事件。生产修复均由 root 负责，本目录仅放独立用例与证据。

## 已复现并修复：旧动作结束吞掉仍在加载的新回复

`director-race-red.txt`：旧回复正在播放，新回复文件尚在加载时，旧 motionFinish 把当前请求误当作已经完成，新回复 current() 变为 false，恢复工作动作并丢掉新回复。

root 已增加 started 回调和 pendingResponse/pendingStart 标记。独立用例已适配实际开始确认，再次验证通过；同时验证新回复真正结束后才恢复工作动作。见 `director-race.test.ts` 和 `integration-first.txt`。

## 已复现并修复：旧 bootstrap 覆盖新任务事件

`pet-integration.test.ts` 最后一项：挂载 pet.tsx，延迟 getBootstrap，先发出新的待确认任务事件，页面正确显示 task 等待；旧 bootstrap 返回空 tasks 后，页面用空快照覆盖新事件，确认卡消失，data-work-source 从 task 退回 autonomy。`integration-first.txt` 为独立红证据。已通知 root。

root 已用每次 effect 的最新事件 Map 合并恢复快照，并用 disposed 丢弃 StrictMode 旧实例返回。独立复验通过，按 root 授权将这项及既有三个集成场景提升为 `tests/unit/pet-bootstrap-lifecycle.test.ts`，不改生产导出。2026-10-29 06:47:38 运行该文件及 director/status 专项：4 个文件 22/22 通过，见 `integration-final.txt`。新增测试 ESLint 通过；包含新增文件的 Node TypeScript 检查通过，见 `permanent-lint.txt`、`permanent-typecheck.txt`。

## 已通过的集成与状态检查

独立真实 pet.tsx 组件测试只替换 WebGL 显示组件和 IPC 边界：

- 没有在线 VNC URL 时，离线创作阶段仍可见，并输出实际 WorkingLoop 意图。
- 结束请求失败后可以重试，具体错误可见。
- stopped 忽略残留 creation.ready，进度卡与工作动作都撤下。
- 待确认任务 > sending 聊天等待 > 隔离执行的优先级正确。
- 切换导入模型后保留活动文字，但不输出内置工作动作。

另运行 `autonomy-status-events.test.ts` 与 `pet-autonomy-status.test.ts`：10/10 通过，见 `status-events.txt`。核对了真实阶段发布、停止与迟到结果丢弃、失败 busy 释放、监听者异常/快照隔离、取消订阅、旧活动结束不污染新活动、导出失败仍保留核验产物、串行健康恢复和旧 poll 不覆盖新事件。

SDK 本地实现确认 motionFinish 先于 motion state complete 和自动 Idle 预留，因此 director 的恢复微任务顺序必要；Live2DPet 的预加载后 current/disposed 检查和模型实例比对覆盖旧加载、卸载、换模型。root 的 pendingStart 也阻止新动作加载间隙的低优先级点按/拖动抢占。

未构建 out，未运行完整 E2E，未访问真实用户资料。

截至 2026-10-29 06:47:50 +08:00，本次已复现的两项功能缺陷均已由 root 修复并独立复验，未见新的阻止问题。新增永久测试已冻结，SHA256：`33BE8E9918E751B62B556F3ACAC79CB40921A5A5CF157DE9D7582E2AA0DBFB3F`。真实 Cubism 播放与 Electron 端到端验收仍由 root 接续。

## 最终两处窄差异只读复核

root 的实际 Electron 发现查看/保存入口受主窗口导航白名单拦截。`windows.ts` 仅在原 MAIN_PATHS 集合添加 `/autonomy`；它与 App.tsx 的实际 Route 和宠物卡按钮目标完全一致，原路径筛选、窗口唤起及导航事件逻辑保留。

root 将隔离停止从任务审批共用的 activityBusy 拆为 isolationStopping。核对了按钮 disabled 条件、处理函数重复请求守卫、try/catch/finally 释放均使用独立停止状态；task 审批按钮仍使用自己的 activityBusy。root 新增的第 5 个真实组件用例准确挂起批准 Promise，捕捉停止按钮仍可操作；读取了 `sixth-pet-integration/independent-stop-red.txt` 的原失败与 `independent-stop-green.txt` 的 5/5 通过结果。此次按要求只读复核，没有重复全量运行或修改生产/测试。两处未见新的阻止问题；实际 Electron 最终复验由 root 继续。

## 导航链补充纠正

真实 Electron 后续仍失败，root 定位到 App.tsx 的 onNavigated 接收回调还有第二层白名单。前次窄复核仅核对主进程白名单与静态 Route，漏查了这个接收过滤条件；不应将静态 Route 存在等同于整条导航可达。

root 现仅在 App.tsx 该判断增加 `/autonomy`。本次逐段只读核对：宠物按钮调用 `window.murasame.window.openPath('/autonomy')` → preload invoke `window:open-path` → main IPC 转交 `openMainPath` → MAIN_PATHS 允许 `/autonomy`、唤起主窗口并发送 `window:navigated` → preload onNavigated 订阅同一通道 → App 的第二白名单现允许 `/autonomy` 并调用 navigate(path) → 已注册 AutonomyPage Route。两端仍只接受原路径集合加 `/autonomy`，未改导航协议或扩大为任意路径。

源码整条链现已一致；本次未修改任何生产/测试文件，未代替 root 尚在进行的 e2e-route 实际验收。e2e-final 原失败证据保留。

## 保存回执最终窄修复复核

只读检查 `isolated-creation.ts`、`autonomy-service.ts` 的 exportCreation 和 `pet-work.ts`，并检查新增单测与 Docker E2E 断言。未发现阻止问题。

- saved 是结构化回执，包含 artifactId、path、bytes、sha256。服务仍先读取当前容器产物并验证实际证据，再用 wx 写入新目标并回读逐字节匹配，成功后才写入和发布 saved。校验、写入、回读或拒绝覆盖失败均不会制造新回执；已有有效回执保留。
- 桌宠只在 ready 且当前 artifact 存在、回执 artifactId/SHA/bytes 全匹配且 path.trim() 非空时显示“产物已保存”和路径，否则保留“待保存”。stopped/idle 仍先丢弃残留 creation。
- 保存前后 work key 保持 activityId/phase/artifactId 不变；motion、expression、loop 也不变，符合 director 去重条件，不重复庆祝。
- 读取了 root 原始 2 项红回归及 31/31 绿日志。独立再次运行 pet-work 与 autonomy-status-events 两文件：2026-10-29 07:04:37 开始，31/31 通过，见 `saved-receipt-independent.txt`。TEMP/TMP 指向 previews/tmp，只使用合成数据。
- 新真实 Docker E2E 断言覆盖导出前“产物已核验，待保存”、导出后“产物已保存”及目标路径、目标文件 SHA、再次导出拒绝覆盖、停止后桌宠撤卡。此次仅检查该断言，未运行或冒称完整包验收通过。

本次无生产/测试修改、无构建；sixth-release 最终打包和实际 E2E 由 root 继续。
