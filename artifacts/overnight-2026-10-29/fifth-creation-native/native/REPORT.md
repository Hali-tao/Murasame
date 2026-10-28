# 第五轮：原生动作优先级与连续性

后续状态：root 随后明确批准鲸鱼娘表情注册小增量，注册缺口已修复并完成真实问号渲染验证。详见同目录 `WHALE-EXPRESSIONS-REPORT.md`。下文保留第一次冻结时的证据与限制，原资产全未变的结论仅适用于该动作优先级子阶段。

基线：`c024fe5`。本轮只修改 `src/renderer/src/components/Live2DPet.tsx`，新增可重复执行的 `scripts/fifth-native-motion.mjs`。未提交、未推送。

## 发现与修复

**P2：低优先级点击/拖动能抢占语义动作。** 生产组件对所有动作使用 Cubism `FORCE`，导致奶龙思考中已收拢的双手被一次点击切回问候，拖动释放同样会截断该姿态。白猫与鲸鱼娘使用同一组件，真实原生模型也复现；动作尚在异步加载时，点击还能夺走其预约。D28 要求情绪表现优先于点击反馈，问题在实际播放器而非动作资产。

修改后，指针反馈使用 SDK 的普通优先级，语义响应使用强制优先级，初始待机使用待机优先级。显式纯待机完成接管后释放优先级；同组动作不重启，直接更新优先级。鲸鱼娘的思考映射会请求 `idle + 问号表情`，因此携带表情请求的待机仍按语义表现处理。已有 SDK 的单动作队列及动作渐入保持不变。该用例验证请求的动作仲裁，问号的实际视觉尚受下文注册缺口影响。

## 实际验证

- `baseline-final/report.json`：相同的最终 31 项检查在原基线失败 8 项；均为播放中/加载中的低优先级抢占，以及鲸鱼娘表情待机被抢占。
- `final/report.json`：修复后 **31/31 通过**。三种原始 Cubism 模型、实际 React 生产组件、实际 Pixi ticker，无模拟模型或模拟 motion manager。
- `expression-red/report.json`：首次修复后补测发现表情待机边界，独立失败 1 项；最终已闭环。
- `clock-final-report.json`：最终组件复跑上轮生命周期专项 **12/12 通过**，包括隐藏/零帧率暂停、恢复、60/24/12/8 fps、卸载、静态首次载入与缩放。
- `web-typecheck.log`、`lint.log`：Web 类型检查与本组件/新脚本 ESLint 通过，退出码均为 0。
- `integrity.json`：相对 `c024fe5`，整个 `src/renderer/public/live2d` 无改动；另记录奶龙 moc3、纹理、physics、model3 和本轮源文件 SHA-256。

本轮先启动的全项目类型检查遇到 root 正在新增模块的 `isolated-creation.test.ts` 导入缺失；未修改在建文件。全量单测按 root 指示中止，其日志仅供追溯，不作为通过结果。最终全量验证由 root 统一执行。

## 渲染证据

同一生产调用在固定帧推进下的对照：

- `baseline-final/naiwa-semantic-after-tap.png`：点击已切成 Greet，思考抱手被打断。
- `final/naiwa-semantic-after-tap.png`：点击后仍保留 Think，身体与双手继续原动作。
- `final/tororo-semantic-after-tap.png`、`final/whale-girl-semantic-after-tap.png`：内置参照模型在同样输入下保留各自语义动作。
- `final/whale-girl-expressive-idle-after-tap.png`：携带问号表情请求时，点击后仍保持待机；此图没有可见问号，不能当成问号表情已经显示的证据。
- `final/naiwa-transition-{Working,Greet,DragRight,Comfort,Idle}.png`、`final/naiwa-drag-from-idle.png`：动作切换、鼠标移动与待机后的拖动反应。
- `final/transition-samples.json`：对应实际原生参数和网格逐帧数据。

Working → Greet → DragRight → Comfort → Idle 在 60 Hz 受控推进中最大网格坐标帧差 **0.01176414**，队列最大为 **1**。口型设置 0.63 后实际送入 Cubism 的值为 0.629999995；释放后正常回到动作曲线。原动作结束后 SDK 自动回 Idle，随后 drag 可正常启动。这些是本次有限序列的连续性测量，并非人类主观自然度评分。

## 边界与复跑

保留已有 9 组动作及原作者标识。本轮没有新建网格、绑定、腿部动作或 3D 模型；原模型缺少有效独立腿部变形的限制未改变。验证覆盖生产组件的 mousemove 与真实 `playMotion('drag')` 路径，未重新做原生窗口拖动全过程或全应用 E2E，不能据此声称那些路径已在本轮重验。

**额外发现但未修改：鲸鱼娘表情注册缺口。** 截图复核发现问号未出现；实际 `c_0120.model3.json` 的 `FileReferences` 没有 `Expressions`，虽然目录有 44 份 exp3 文件且 capability/intent 声明了多个表情。SDK 对无注册名称返回 false，因此本轮的 31 项只证明该请求不会被点击抢占，不证明问号已渲染。此资产不在奶龙改动边界，已通知 root；修复需要注册真实引用并再做参数/视觉验证。

复跑时将 TEMP/TMP 指向项目 `previews/tmp`：

```text
node scripts/fifth-native-motion.mjs <new-label>
node scripts/fifth-native-motion.mjs <new-baseline-label> c024fe5
node scripts/nailong-motion-maturity.mjs <new-clock-label>
npx tsc --noEmit -p tsconfig.web.json
npx eslint src/renderer/src/components/Live2DPet.tsx scripts/fifth-native-motion.mjs
```

使用新的标签保留历史证据；基线命令应失败。业务代码已冻结，待 root 独立审查和整体验证。
