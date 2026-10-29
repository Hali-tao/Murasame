# 本地记忆漏召回诊断（2026-10-29）

本轮没有修改生产检索策略。原来的两项漏召回仍未修复：散步地点没有关联到居住城市，所有权与借用没有关联到 Rust 学习背景。真实本地 BGE 的新增配对实验不支持采用查询前缀或降低阈值，因此没有将实验改动带入产品。

归档：[`artifacts/continuous-24h-2026-10-29/memory-recall/`](../artifacts/continuous-24h-2026-10-29/memory-recall/)。开始诊断时 Git HEAD 为 `85a9b58e2f04f892de138efb594c66f1eeba2332`；报告另存当前检索源码、固定资料集和模型文件的 SHA-256，以及 Node、CPU、编码身份和逐问排名。没有使用用户真实资料、远程 API 或网络下载。

## 原始失败发生在哪里

使用当前 `bge-small-zh-v1.5`、512 维、`cls-q8-l2-v1`，原 22 问中 19 个正向问题仍命中 17 个：

| 查询 → 应召回事实 | 实际相似度 | 在全部 14 条事实中的排名 | 结果 |
| --- | ---: | ---: | --- |
| 周边有什么地方可以散步 → 我住在南京 | 0.345602 | 4 | 阈值筛选前存在，低于 0.45，最终未召回任何条目 |
| 讲讲所有权和借用 → 我正在学习 Rust 编程语言 | 0.369236 | 7 | 低于 0.45，最终带入解释偏好和文件确认偏好 |

这两个候选并没有因为 8 条上限、RRF 排名或 1500 字的现行预算实现而丢失；它们在语义阈值阶段已经被排除。查询与事实之间也没有当前关键词通道能匹配的完整词串。证据支持“现有编码对间接语境的相似度不足”，不能推导出只改一个阈值就能提高整体回复质量。

## 提前固定的独立留出集

在查看本轮模型结果前写入 `holdout.json`：18 条独立合成事实，38 个正向问题，16 个负例。它使用不同城市、语言、饮食限制、职业、宠物、设备和项目资料。原 22 问保留为另一个独立报告，不混合成一个高分。

正向命中表示所有标注的应召回事实进入实际注入列表，不代表整个列表都相关。负例是无需个人背景的一般知识或文本任务；计入无关记忆时豁免 `style`（先结论后解释）与 `eye`（大字号）两条可普遍适用的输出偏好。这个豁免在首次运行脚本时已固定。正例没有完整的逐条相关性标注，因此这些结果不是总体 precision、回答准确率或用户收益的估计。

| 查询编码 | 原正向命中 | 独立正向命中 | 独立负例出现无关记忆 |
| --- | ---: | ---: | ---: |
| 当前直接编码 | 17/19 | 35/38 | 1/16 |
| 在查询前加“为这个句子生成表示以用于检索相关文章：” | 15/19 | 30/38 | 0/16 |

前缀仅用于实验查询向量，事实向量不变；仍调用生产 `recallMemories`，保留 0.45 阈值、8 条和现行注入预算。它没有修复原两项失败，并损失更多正例，故不采用。两种编码的 `qualityTargetsMet` 均为 `false`。

当前编码的独立正向漏项为：推荐离家近的公园 → 苏州（0.407358）；所在城市明天下雨吗 → 苏州（0.425214）；午餐适合做什么 → 素食限制（0.430941）。这说明原失败模式可以在不同资料上重现。负例“把 hello 转换为大写字母”带入 Go 和 Neovim 背景，说明当前阈值也存在误召回，不能只按正例命中率调参。

## 降低阈值的代价

以下仅对已经保存的真实向量排名进行反事实计算，没有修改源码，也没有重新定义标签。使用同一 RRF 和最多 8 条；这批短事实不会触发预算裁剪。

| 假设阈值 | 原正向命中 | 原明确禁止项被带入的问数 | 独立正向命中 | 独立负例侵入 |
| --- | ---: | ---: | ---: | ---: |
| 0.45（现行） | 17/19 | 0 | 35/38 | 1/16 |
| 0.40 | 17/19 | 0 | 38/38 | 6/16 |
| 0.35 | 18/19 | 2 | 38/38 | 11/16 |
| 0.30 | 19/19 | 3 | 38/38 | 14/16 |

为让原两问都命中而降低阈值，会明显扩大负例污染。本轮保持生产阈值不变。

另外用 24 个独立项目代号测试裸词、问号结尾、大写加引号、嵌入中文句子四种写法，共 96 个正例，当前生产召回 96/96。没有发现可据此声称修复的标点或大小写缺陷。这只是已知代号的召回测试，没有验证未知代号的拒绝能力，也不代表只返回了目标项目。

## 复现

在仓库根目录执行。需要已有完整本地 BGE，默认 `build/bundled-models/bge-small-zh-v1.5`，也可提前设置 `MURASAME_MODELS` 指向模型共同根目录。

源码脚本以 `.mjs.txt` 归档，运行时复制到忽略的 `previews/`；临时编译模块只写入 `previews/tmp/`，不把生成的 JS 放入 lint 源码目录。每次复现使用新的目录，保留已有报告。

```powershell
New-Item -ItemType Directory -Path 'previews/tmp' -Force | Out-Null
$env:TEMP=(Resolve-Path 'previews/tmp').Path
$env:TMP=$env:TEMP
$archive=(Resolve-Path 'artifacts/continuous-24h-2026-10-29/memory-recall').Path
$run=Join-Path (Resolve-Path 'previews').Path ('memory-diagnostic-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $run | Out-Null
foreach ($name in @('diagnose.mjs','identifier-check.mjs','threshold-sensitivity.mjs')) {
  Copy-Item -LiteralPath (Join-Path $archive ($name+'.txt')) -Destination (Join-Path $run $name)
}
foreach ($name in @('original-fixture.json','holdout.json')) {
  Copy-Item -LiteralPath (Join-Path $archive $name) -Destination (Join-Path $run $name)
}
node (Join-Path $run 'diagnose.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Local model diagnostic failed' }
node (Join-Path $run 'identifier-check.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Identifier diagnostic failed' }
node (Join-Path $run 'threshold-sensitivity.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Sensitivity diagnostic failed' }
```

真实模型两组实验记录的网络尝试均为 0。诊断脚本退出 0 只说明本地模型与流程可用；质量失败在 JSON 中保留，不把成功退出当成召回质量达标。

已按上述流程从归档脚本和资料复制到新目录重新执行，汇总结果一致；复跑输出保存在 `archive-replay.txt`。

定向测试命令：

```powershell
npx vitest run tests/unit/embedding-runtime.test.ts tests/unit/conversation-memory-regression.test.ts tests/unit/conversation-memory-maturity.test.ts tests/unit/core-memory-status-regression.test.ts
```

本轮 4 个文件、87 项通过，用时 8.69 秒。日志保留既有 Vite 配置兼容提示与 Node SQLite experimental 提示。没有运行全仓测试、构建或打包；由主代理统一执行。没有生产代码修复，因此没有声称新的红绿回归或语义准确率收益。

## 下一轮可检验的方向

1. **把间接关系和直接事实分开评测。** 固定另一套未使用过的城市/活动、语言/概念、饮食限制/菜单配对，同时加入同词不同义的负例。分别报告 direct、indirect、negative 结果；若只对已有南京/Rust问题有效则拒绝。
2. **验证写入时保留来源语境的价值。** 仅在独立合成来源本来明确提到关系时，比较短事实与忠于来源的稍完整事实，不从外部知识或固定词典替用户补写背景。保持模型、阈值和预算，检查收益是否跨实体成立，同时检查错误语境是否污染召回及索引迁移成本。当前没有实现，也没有收益结论。
3. **为查询侧语境补充预设验收标准。** 只有当前对话已经明确给出关联时，才研究将该上下文纳入查询；同时测换话题、否定、同名项目和无关背景。保留纯离线要求，不用远程重写兜底。候选必须在新留出集提升间接召回且不增加既定负例侵入，再考虑生产改动。

这三项是实验建议，不是已交付能力。当前两项原漏召回、弱相关事实注入和真实模型回答质量仍属未解决限制。
