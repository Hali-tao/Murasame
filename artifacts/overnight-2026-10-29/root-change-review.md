# 根侧改动独立只读审查

审查范围：executor 的审批 scope、TaskService 的审批过期/图片恢复/实时进度、审批与调用展示辅助函数、TasksPage/ApprovalDialog、Live2DPet 动作结束与口型处理。没有修改实现或测试，没有运行全量测试；复现采用内存编译、内存 SQLite 和拦截运行器，没有执行真实命令或生成文件成果。

## 最终结论

本轮发现的三项问题均已闭环。最后一次复核只针对已报告的导入动作兼容修复，没有开启新审查轮次。当前没有本轮已确认但尚未修复的问题。

## 已闭环：导入模型继承奶龙专属动作名，点击静默失效（原 P2）

以下为原始复现记录：

- 位置：`src/renderer/src/components/Live2DPet.tsx:65-69`；关联 `src/renderer/src/pet.tsx:126-129`、`src/shared/pet-presets.ts:74`。
- 触发：先选择奶龙，再导入一个具有 `Idle` 和 `Tap`、没有 `Greet` 的合法 Cubism 模型。仓库的 `src/renderer/public/live2d/tororo` 就是现成复现资源。导入后的 `preset` 仅替换 URL 和名字，保留奶龙的 `tap: Greet`；点击时仍执行 `model.motion('Greet', 0, FORCE)`。
- 实际结果：模型正常加载并播放 Idle，但点击没有动作。当前 pixi-live2d-display 的 `MotionManager.startMotion()` 在定义不存在时返回 `false`（`dist/cubism4.js:4193-4196`），不是拒绝 Promise，因此新增的 `.catch()` 也不会处理这个情况。此前奶龙点击指向 `Idle`，对该合法导入资源仍是有效组；本轮改成 `Greet` 后该路径回退失效。
- 只读回放结果：`validateCharacterDirectory(tororo)` 返回 `{ok:true, reason:'资源可以加载'}`；按 `pet.tsx` 的真实合成方式构造导入 preset 后，`idle='Idle' / idleExists=true / tap='Greet' / tapExists=false / realTapExists=true`。
- 最小修复建议：播放前根据已加载模型的实际 motion definitions 解析动作。预置映射存在才使用，否则选择当前模型实际提供的对应动作或 Idle；处理 `motion()` 返回 `false` 的情况。导入模型不能无条件继承内置奶龙的动作能力。补一条“奶龙为当前预置时导入带 Idle/Tap 的模型，点击仍调用存在的组”的回归即可。

闭环核对：已读取新增的 `src/shared/avatar/motion-groups.ts`、`tests/unit/imported-motion-groups.test.ts` 以及 Live2DPet 的接线。初始化 Idle、点击和命名动作均以 loaded motion definitions 解析实际组；奶龙专属呼吸/眨眼处理仍仅在精确内置 URL 生效。独立内存回放使用真实 tororo 资源，结果为 `tap: Tap / idle: Idle / named: Idle / empty: null`，消除了原复现中对不存在的 Greet 组的调用。根侧报告对应回归已通过；本复核没有重复运行全量测试或修改实现。

## 其他已闭环发现与审查边界

本次还直接复现过两项问题，根侧已修复并报告针对回归通过，最终只读检查已看到对应实现，因此不再列为待修问题：

1. 命令步骤省略 argv 时，审批显示空参数，执行却继承 plan.command 的参数。原回放为显示 `safe-tool / []`、运行器收到 `safe-tool / ['--unshown-value']`。现由 executor 的 `invocationArgs` 同时服务审批与执行，亦覆盖 git 默认参数及 browser 实际 URL。
2. 重启后任务为“已中断”，步骤和调用却仍显示“进行中/running”。原内存 SQLite 恢复回放直接出现该组合。现 `currentTaskCalls` 接收任务状态并将非运行任务的开始回执显示为 unknown，`recover()` 将活跃步骤转为待核对，保留原始回执。

其余所审查的审批 scope 切换、拒绝/过期图片请求恢复、任务选择与弹窗绑定、口型在模型更新前覆盖及销毁清理路径，未找到新的可证明问题。没有进行真实 WebGL 的人工交互验收；本报告不把代码阅读当作完整形象视觉验收。
