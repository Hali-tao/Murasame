# 奶龙官方网格桌宠（新预设 `nailong`）

日期：2026-11-04。范围：把奶龙新形象做成软件内可用的桌宠，外观以第七印象官方图片为准。
原 SRS 与 `docs/00`–`02` 未改写；现有三套 Live2D 形象（tororo / whale-girl / naiwa）行为不变。

## 需求与口径

- 用户要求"外观跟真实形象一样"，并指出原"动作和美观程度都很低"。
- 已确认官方站素材可用范围：官方版权，仅课程演示，不公开分发（`docs/05-LICENSES.md`）。
- 外观优先：贴图直接用官方渲染，不重画、不生成近似形象。

## 素材

- 官网 IP 页主形象 500×500，由 `artifacts/nailoong-official-2026-11-04/` 抓取与处理：
  去白底/去烘焙投影 → Lanczos 放大到 1000×1000 并轻锐化。
- 产物：`src/renderer/public/pets/nailong/nailong_front_official_1000.png`。
- 许可与来源：同目录 `NOTICE.md`。

## 实现

- `src/shared/avatar/mesh-pose.ts`：30×40 加权网格（1271 顶点 / 2400 三角形），
  区域权重在头/胸/腹/髋/双臂/双脚之间 smoothstep 过渡；纯函数，可单测。
- `src/renderer/src/components/MeshPet.tsx`：pixi 连续网格；按 `min(dpr,2)` 渲染，
  与 `Live2DPet` 同一套 imperative 接口（点击/拖拽/口型/命中测试）；
  眨眼与说话为跟随头部矩阵的叠加层；接地阴影在渲染层绘制。
- `src/shared/pet-presets.ts`：新预设 `nailong`，`format: 'Mesh 2D · 官方图'`。
- `src/renderer/src/pet.tsx`：按 `preset.format` 选择渲染器。
- `src/shared/pet-work.ts`：任务状态映射（Working / Think / Agree / Confused）。
- `src/shared/avatar/capability.ts`：能力表登记网格状态与口型/眨眼参数。

## 验收

- 原型截帧与数值：`previews/nailong-official/`（NaN 0、三角形翻折 0、覆盖与源图差 0.18%）。
- 真实应用（CDP 连运行中的桌宠）：
  - `[MeshPet] 形象就绪: nailong`，无错误；
  - 1 秒画布 alpha 平均差 21.09/255，持续动画；
  - `data-blink` 在 18.28s / 39.32s 闭合（约 21 秒周期）；
  - 点击后 `Greet` 持续约 1.4 秒并回到 `Idle`；
  - `nailong → tororo → nailong` 切换均 `ready`。
- 单元测试：`tests/unit/mesh-pet.test.ts` 11 项通过。
- 端到端（Playwright Electron）：
  - `tests/e2e/mesh-pet.spec.ts`：加载、持续动画、眨眼、切回 Live2D —— 通过；
  - `tests/e2e/mesh-pet-interaction.spec.ts`：点击 Greet→Idle、拖拽 Settle→Idle、
    任务状态 Think→Working→Agree —— 通过；
  - `tests/e2e/app.spec.ts`：十页导航、桌宠显隐、角色页四预置切换 —— 4 项通过；
  - `tests/e2e/pet-work.spec.ts`：原 naiwa Live2D 工作循环回归 —— 通过。
- 全仓检查：`npm run typecheck`、`npm run lint`、`npm test`（925 项）全部通过。

端到端此前被宿主环境变量 `ELECTRON_RUN_AS_NODE=1` 阻断：Playwright 把它传给 Electron，
Electron 以 Node 模式启动并拒绝 `--remote-debugging-port`。`tests/e2e/helpers.ts` 启动前剔除该变量后恢复。

## 修掉的缺陷

pixi 6 的 ticker 回调参数是归一化帧数而非毫秒。误当毫秒使用会让时钟每帧只走 1–3ms，
导致角色几乎静止、眨眼永不触发；改为读取 `ticker.deltaMS` 后恢复。

## 附带补齐

原工作区里被中断的语音独立进程草稿只剩测试、缺 `src/main/local/speech-process.ts`，导致全仓检查红。
本轮补上了该客户端（串行调度、容量上限、超时、进程退出、旧编号忽略、关闭语义，13 项单测通过）。
worker 入口与 TTS 接线仍按原计划（`docs/superpowers/plans/2026-10-30-speech-responsiveness.md`）待做，
本轮没有改变朗读行为。

## 已知限制

1. 贴图源只有 500px；1000px 为放大，200% 缩放仍会偏软。更高清需官方原图或 1080p 视频抽帧。
2. 单张正面图不能真 3D 转头；只有小幅倾斜/位移。
3. 姿态固定为举手；不能挥手、走路、打字。
4. 眨眼/口型是叠加层近似，不是官方分层素材。
5. `nailong` 形象与 `naiwa` 一样不得公开分发。
