# 原生奶龙连续性增量：暂停、帧率与静态显示

完成时间：2026-10-29 03:48（北京时间）。基线：`e10f25fbe1ccf030d3bb303f62c9d8cff89e475f`。生产代码已冻结，无提交或推送。

本轮修复实际原生模型的播放生命周期；没有增加新的动作组、网格绑定或 3D 形象。原有 9 组 motion3、moc3、贴图、physics 和作者标识全部保留，未修改资源。

## 实际问题与修复

1. **隐藏或 fps=0 后恢复时跳过动作。** 已安装 `pixi-live2d-display` 的 `autoUpdate` 使用 `Ticker.shared`，而组件停止的是 `app.ticker`。隐藏期间模型时钟继续累计，恢复首帧一次消耗多秒时间。改为关闭 SDK 自动时钟，由同一个应用 ticker 在渲染前推进模型，因此暂停与恢复时模型和画面一致。
2. **8 fps 待机预算被提升到 10 fps。** Pixi 默认 `minFPS=10` 会反向钳制 `maxFPS=8`。设置上限之前解除下限钳制，再按所选帧率恢复有界时间步长，保证 8 fps 可用且不会缩短每帧实际播放时间。
3. **初始减少动态效果模式没有角色；缩放后静态角色消失。** ticker 在资源载入前就已停止，初始模型没有一次渲染；WebGL 尺寸变化又会清空画布。载入时为静态模式绘制一次初始姿态，尺寸变化后重绘已有姿态，保持时钟不推进。

变更仅包括：

- `src/renderer/src/components/Live2DPet.tsx`：18 行新增、3 行删除；同源时钟、8 fps 下限、静态首帧及缩放重绘。
- `scripts/nailong-motion-maturity.mjs`：可重复执行的真实组件/Cubism 回归与证据脚本。

## 红绿证据

脚本直接打包实际 `Live2DPet.tsx`，使用已安装 React、Pixi、Cubism SDK 和原始 `奶蛙.moc3`，在隐藏的 Electron 窗口运行。暂停检查使用真实墙钟；帧率检查向实际 Pixi ticker 提供受控显示时间，避开 Windows 隐藏窗口对 requestAnimationFrame 的额外节流。没有模型替身，也没有用拼接 HTML 角色代替原生渲染。

| 检查 | 修复前实际观察 | 最终实际观察 |
| --- | --- | --- |
| 隐藏暂停 | 模型时钟额外推进 3,450 ms；恢复首批更新最高 3,683.3 ms；Greet 被跳过并回 Idle | 暂停推进 0 ms；恢复最高 49.9 ms；继续 Greet |
| fps=0 | 模型时钟额外推进 1,766.7 ms；恢复首帧 1,900 ms，网格顶点单帧位移 0.17712 模型单位 | 暂停推进 0 ms；恢复最高 50.1 ms；继续 Think |
| 8 fps 预算 | 两秒受控显示时间产生 20 次模型更新（10 fps） | 15 次完成更新，1,883.3 ms 模型时间；尾部不足一帧尚未发出 |
| 初始静态模式 | 0 个非透明像素、0 次模型绘制 | 118,639 个非透明像素、只绘制 1 次；之后时钟冻结 |
| 静态缩放 | 改为 520×520 后 0 个非透明像素 | 79,339 个非透明像素；模型时钟与更新次数保持不变 |

60/24/12/8 fps 在两秒受控时间内分别完成 120/47/23/15 次模型更新。帧率上限边界处不足一帧的剩余时间会留到下次更新，因此不把这些数值当作屏幕真实刷新率或资源占用评测。

最初的隐藏窗口实时 fps 估计会受到操作系统节流影响，已替换为受控实际 ticker 检查；没有为通过测试放宽暂停或恢复契约。原始探索结果仍保留于 `before/`、`after/`。

## 最终验证

- 原生组件/Electron/Cubism 回归：**12/12**；页面运行错误 0。
- 原生动作资产与导入动作组回归：**2 文件，21/21**。
- `npx tsc --noEmit -p tsconfig.web.json`：通过。
- 定向 ESLint：通过。
- `git diff --check -- src/renderer/src/components/Live2DPet.tsx`：通过。
- 原生资源目录与 motion-groups 无变更。全局 verify、完整 Electron E2E 和安装包验收由主代理继续执行，本报告不宣称这些已通过。

最终组件 SHA-256：`719f11815de763b4ba6dc6fd22985c57797fd35c288073b438933f30a521f56c`。

## 证据位置与重跑

证据根目录：`E:/Desktop/软件工程/murasame/previews/overnight-2026-10-29/native-motion-maturity/`。

- `baseline/report.json`：从指定 Git 基线读取组件源码后执行，未回滚工作树；明确复现隐藏/fps=0 的失败。
- `cadence-before/report.json`：先修时钟后，8 fps 钳制检查失败的独立证据。
- `initial-before/report.json`：静态初始显示修复前可见像素为 0。
- `resize-before/report.json`：静态首帧已修复，但缩放后清空的失败证据。
- `final/report.json`：最终 12 项通过的完整参数与时序记录。
- `baseline/zero-fps-before.png`、`baseline/zero-fps-resumed.png`：原生恢复跳帧前后截图。
- `final/hidden-pause-before.png`、`final/hidden-pause-held.png`、`final/hidden-pause-resumed.png`：隐藏暂停和恢复原生截图。
- `final/zero-fps-before.png`、`final/zero-fps-held.png`、`final/zero-fps-resumed.png`：零帧率暂停和恢复截图。
- `final/initial-zero-fps.png`、`final/resized-zero-fps.png`：静态初始显示和缩放后显示截图，已人工查看。

重跑当前源码：`node scripts/nailong-motion-maturity.mjs verify-current`。

重跑原始基线（预期失败，且不修改工作树）：`node scripts/nailong-motion-maturity.mjs verify-baseline e10f25fbe1ccf030d3bb303f62c9d8cff89e475f`。

脚本将 Electron 临时文件与独立用户目录放在 `previews/tmp/nailong-motion-maturity`。未读取用户桌宠数据，未启动用户麦克风、外部模型或网络服务。

## 边界

这轮证明了真实模型生命周期和静态可见性修复，不将数值连续性等同于主观自然度评分。未改变动作设计或原模型可动范围；独立腿部与大幅举手仍受原网格/绑定限制。既有第一轮视频和动作连续性测量仍属第一轮成果，未冒充本轮新动作。
