# 第五轮补充：鲸鱼娘原生表情注册

root 在首次冻结后明确批准此小增量。唯一新增业务改动为 `src/renderer/public/live2d/whale-girl/c_0120.model3.json` 的 `FileReferences.Expressions`，注册既有目录中的 44 个原始文件；没有修改任何 exp3、moc3、纹理、physics、动作或作者信息。

## 缺陷与修复

原清单完全缺少 Expressions，SDK 没有表情管理器。已有“思考→idle+问号”“抱歉→idle+悲伤”等映射会请求名称，但原生画面不会显示。此次按真实文件名注册，名称与现有语义映射一致，实际生产组件无需额外修改。

## 核验结果

- `tests/unit/fifth-whale-expression-assets.test.ts`：修复前 46 项中注册完整性失败 1 项，45 项通过；修复后全部通过。新增测试使用原始 Cubism Core 检查真实参数和问号图层。
- `whale-related-tests.log`：新增资产验证、原奶龙资产和导入动作回退共 **3 文件67项通过**。
- `whale-expressions/baseline/report.json`：实际生产组件的 7 项验证中 **5 项失败**；问号参数一直为 0，44 份表情均未注册。
- `whale-expressions/current/report.json`：修复后 **7/7 通过**，44 份文件均由实际 SDK 解析成功。
- `post-whale/report.json`：注册新清单后，原生产组件动作优先级/衔接专项再次 **31/31 通过**。
- `whale-node-typecheck.log`、`whale-web-typecheck.log`、`whale-lint.log`：Node/Web 类型与定向 ESLint 均通过，退出码 0。
- `whale-integrity.json`：整个 Live2D 目录相对基线唯一改变的文件就是上述 model3；删除新 Expressions 字段后，JSON 与原基线完全相同。附44份原文件哈希。

真实问号参数 `ParamCheek74` 从 0 到 **1**，对应原生 **ArtMesh247** 图层从不可见变为可见。点击后该语义表情与 idle 动作保持。切换悲伤后问号参数及图层透明度均归 **0**，悲伤参数 `ParamCheek15` 为 **1**；再切回问号后分别为 **1/0**。重新载入形象恢复两参数均为 **0**。这一过程由最终生产组件驱动，而非网页叠图或模拟动画。

## 可直接核对的截图

| 场景 | 基线 | 修复 |
| --- | --- | --- |
| 请求问号 | `whale-expressions/baseline/02-question.png` | `whale-expressions/current/02-question.png` |
| 点击后保留问号 | `whale-expressions/baseline/03-question-after-tap.png` | `whale-expressions/current/03-question-after-tap.png` |
| 切悲伤、旧问号消失 | `whale-expressions/baseline/04-sad-question-cleared.png` | `whale-expressions/current/04-sad-question-cleared.png` |
| 切回问号 | `whale-expressions/baseline/05-question-restored.png` | `whale-expressions/current/05-question-restored.png` |
| 重新载入恢复中性 | — | `whale-expressions/current/06-reloaded-neutral.png` |

原始参数和图层透明度见各批次 `poses.json`。

## 44 份原文件的实际效果边界

额外以原始 Core 逐一施加未修改的表情，隔离动作/物理造成的干扰，检查网格、透明度和颜色。数据见 `whale-expression-effects.json`，可重跑同目录 `whale-expression-effect-probe.mjs`。

- 40 份在默认姿态上能测到可见网格或透明度变化。
- “手机换色”需要 `phone=1`，“魔爪换色”需要 `mozhua=1`；开启相应原生配件后均测到透明度变化 1。“挤”在 `danbaofan=1, point=-1` 的蛋包饭场景中可见网格变化约 0.00716427。这是原配件依赖，不是新增动作。
- 原 `love.exp3.json` 的参数存在，但在 0.25、0.5、0.75、1 的采样中均未测到网格、透明度或颜色变化。文件正常加载，已保留，但**不宣称该源表情已具备可见效果**；修复原绑定超出此清单增量。
- 原“喵喵手~喵~动画”有真实有效 `maoshou`，另含不存在的 `ParamCheek51/ParamCheek61` 两个零值 Add 遗留项。两项是无副作用的无效项，保留原文件且不作为能力证据。

本轮验证不等于完整44种表情的人工审美验收，也未重验全应用 E2E。没有运行全量单测或改动其他代理模块。全项目最终验证由 root 统一执行。

复跑（TEMP/TMP 指向项目 `previews/tmp`）：

```text
node scripts/fifth-whale-expressions.mjs <new-label>
node scripts/fifth-whale-expressions.mjs <new-baseline-label> c024fe5
npx vitest run tests/unit/fifth-whale-expression-assets.test.ts tests/unit/nailong-motion-assets.test.ts tests/unit/imported-motion-groups.test.ts
```

基线命令应失败；使用新标签保留旧证据。未提交或推送。
