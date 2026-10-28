# 第四轮增量独立审查

审查时间：2026-10-29 04:23（Asia/Shanghai）。基线 HEAD：`08b20bcb0e7b63d6660dea758af3bdb39d342706`。审查对象为本轮未提交的 embedding / MemoryService 兼容标记 / 模型选择，以及 Windows 模型打包脚本、配置和对应测试。

依据 `requesting-code-review` 的 reviewer 模板完成独立只读审查。未修改生产代码、测试、Git 索引或分支；只生成本报告。没有另派代理、运行安装器、生成真实安装包、读取用户数据库或改动真实模型资产。测试 TEMP/TMP 均设为项目 `previews/tmp`。

## 结论与优先级

- **P0 / Critical：无。**
- **P1 / Important：无。**
- **P2 / Minor：没有需要单独提出的具体增量缺陷。**

本次审查没有发现需要先修复才能进入最终集成验收的代码问题。结论不等于语义质量目标已全部达成，也不等于真实新安装包已通过验收。

## 已核对的实现与优点

1. `src/main/local/embedding.ts:23-25, 118-125`：兼容身份增加 `cls-q8-l2-v1`；推理使用 CLS 与归一化，拒绝维度不符、非有限或全零向量。已检查本地已安装 Transformers 的实现，`cls` 分支确实取首 token。模型参数是选定目录的绝对路径，并带 `local_files_only: true`。
2. `src/main/local/embedding.ts:97-111`：同一路径的并发首次调用共享加载 Promise；加载拒绝后清除对应缓存，允许重试；路径变化不会返回上一目录缓存的模型。全局禁远程配置仍被调用。
3. `src/main/local/model-env.ts:26-39`：按完整的普通非空文件集合选择单份用户模型或内置模型，不从两个目录混拼文件。用户仅有语音目录或不完整 BGE 覆盖时，完整内置 BGE 可被使用。`src/main/index.ts:121` 在构造核心服务前设置打包模型根目录。
4. `src/main/core/services/memory-service.ts:395-406`：兼容标记更新与数据库旧向量清空放在同一事务中，保留事实文本；加载或事务失败会走既有 `storageReady=false` 保护。已检查既有 `recall/startIndex/rebuildMissingVectors` 接线：首次召回如实降级并启动后台重建，完成部分持久化，跨重启可使用；本轮没有绕过取消或时限机制。
5. `scripts/package-models.mjs:43-78`：每次独立创建 staging，只复制明确的 18 文件清单，逐文件比较复制前源 SHA-256 与复制后目标 SHA-256，失败时不启动 builder。源不完整时仅留下准确的缺失说明，manifest 明确标记 omitted；不会从旧 staging 补齐。
6. `scripts/package-win.mjs:6-35` 与 `electron-builder.yml:31-34`：默认输出目录唯一，显式非空输出被拒绝；实际 builder 宏解析能消费本轮 staging 的项目相对路径。旧 release、旧 bundled-models 及源文件不被脚本重写。

## 独立验证

实际执行：

```text
node node_modules/vitest/vitest.mjs run tests/unit/embedding-runtime.test.ts tests/unit/packaging-model-integrity.test.ts --maxWorkers=1
```

- 2026-10-29 04:21:13 开始，耗时 6.58 秒，退出码 0。
- **2 个测试文件、20 项测试全部通过**：7 项 embedding 运行契约 + 13 项打包完整性。
- 模型推理契约测试使用 SDK mock；数据库迁移测试实际使用独立 SQLite；打包测试运行真实脚本和真实文件复制/哈希，仅替换昂贵的安装包生成边界，资源路径解析使用实际安装的 electron-builder 实现。
- `git diff --check` 通过。只出现既有 Vite 配置兼容性提示与 Node SQLite experimental 提示。
- 为避免与 root 集成争抢资源，没有重复跑全量测试、构建、真实模型推理或 Electron 验收；不把这些项目表述为本审查已执行。

## 真实评测证据的准确边界

已阅读 root 生成的 `previews/overnight-2026-10-29/real-memory/current-production.json`，其时间戳为 `2026-10-28T20:20:24.979Z`。这是 root 的验证结果，**本审查没有独立重跑该真实模型测量**。

- 当前快照为 22 个查询、19 个正向查询、17 个正向期望命中；`qualityTargetsMet=false`，记录的禁止项命中数为 0，`networkAttempts=0`。
- `周边有什么地方可以散步` 未召回 `city`；`讲讲所有权和借用` 未召回 `rust`，返回 `explain`、`confirm`。因此 CLS 修复不能被描述为语义召回质量全部解决。
- 同一快照中，500 条合成记忆的首次召回约 8.04 ms，先返回降级结果，后台恢复约 7.11 s 后完成 500/500，跨重开保留 500 条向量。它证明这一环境和合成负载的恢复行为，不代表所有设备和资料规模。
- 打包 SHA 回执只证明复制与指定本机源一致；不证明源模型可信或语义质量。新安装包内实际资源哈希及独立资料目录启动仍需 root 后续验收。

## Declined to judge

- 现有语音 STT/TTS 的全局根目录选择：它们仍使用既有 `modelsRoot`，本轮只新增并接入 BGE 的完整模型目录选择；未把既有语音行为列成本轮回归。
- 更换模型、调整检索阈值或增加新的排序策略：本轮计划明确以证据修复确切缺陷并保留诊断失败，本审查未建议用未经回归的策略掩盖剩余漏召回。
- 新安装器实际生成、安装升级与旧版本替换：父任务要求本审查不运行安装器；本轮仅判断脚本与资源路径契约，不能替代安装验收。
- 桌宠/原生资源及旧未跟踪资料：本轮未变更且明确不属于委派审查范围。

## Assessment

**Ready to merge?** 从所审查的增量代码与已执行专项检查看，可以继续 root 规定的最终集成验收；无须为本审查新增修复。提交或发布结论应使用 root 最终的全量检查、构建和受影响 Electron 流程结果，并明确保留上述语义质量与实际安装包边界。
