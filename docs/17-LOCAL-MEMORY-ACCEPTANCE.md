# 本地记忆模型验收与独立打包

本轮保持原需求 D17 选择的 `bge-small-zh-v1.5`、512 维、本机推理与禁止远程下载，不改成外部记忆服务，也不修改原召回数量、阈值和注入预算。

## 编码与已有资料

- 根据 [BGE 官方模型说明](https://huggingface.co/BAAI/bge-small-zh-v1.5#using-huggingface-transformers)，使用首 token（CLS）向量并归一化。旧实现采用 token 均值；两种编码不能混用。
- 兼容标记增加 `cls-q8-l2-v1`。升级保留原记忆文字，持久清除旧向量并使用已实现的后台索引恢复。交流可以先返回降级结果，长期记忆页显示恢复进度。中止、关闭记忆与失败仍遵守既有规则。
- 用户目录只有语音模型或 BGE 不完整时，选择安装包内完整的 BGE。完整用户 BGE 优先；不从两个位置拼凑模型文件。本次没有同时改变语音模型的目录选择。
- 同一目录首次并发请求只加载一份模型；加载失败可重试；非法数值、零向量与错误维度不入库。

## 可重复评测

准备完整的本地 BGE，默认位置为 `build/bundled-models/bge-small-zh-v1.5`，或用 `MURASAME_MODELS` 指定三种模型的共同根目录。在项目根运行：

```powershell
node scripts/verify-memory-local.mjs
node scripts/verify-memory-local.mjs --legacy-mean
```

脚本使用独立合成事实、独立 SQLite 和临时目录，禁止网络请求，记录模型文件哈希、CPU、每个问题的排名、召回项和延迟。旧编码对照从 Git 基线 `08b20bc` 读取，不回退工作树。结果在 `previews/overnight-2026-10-29/real-memory/`。

质量诊断与运行正确性分别报告：基础设施、离线或索引身份错误会使脚本失败；语义漏召回会明确保留 `qualityTargetsMet=false` 和失败问题，不能把脚本退出成功说成所有质量目标通过。

2026-10-29 本机合成评测共 22 个问题，其中 19 个有应召回事实、17 个命中；旧均值编码也是 17 个。当前两项漏召回分别是散步地点没有联系到居住城市、所有权与借用没有联系到 Rust 学习背景，且部分问题仍可能带入弱相关记忆。此修复纠正编码和升级契约，**没有证明整体召回准确率提高或回复质量已解决**。

最终一次 500 条恢复实测：首次召回约 11.94 ms；后台约 9.22 s 完成；重开服务后保留 500 条索引；网络请求 0。另一次相同负载约 7.11 s，耗时受机器负载影响。这些是本机合成负载结果，不能推广成所有设备的承诺。

## 安装包检查

`npm run package:win` 每次使用独立输出与独立暂存目录。`MURASAME_PACKAGE_OUTPUT` 可指定不存在或为空的目录；非空目录会拒绝，保留旧安装包。仅复制 18 个明确的语音/记忆模型文件，复制前后比较 SHA-256；等长但内容不同的文件不能蒙混通过。

暂存回执 `previews/package-staging/run-*/model-manifest.json` 必须为 `status=bundled`、18 个文件、无缺失，才可称为完整带模型版本。既有不带模型打包模式仍可运行，但回执会标注 `omitted` 并列出缺失，不能作为完整离线交付验收。

端到端用例 `tests/e2e/local-memory.spec.ts` 在真实 Electron 内添加合成偏好、核对真实索引已生成、发起实际召回并检查对话请求包含该事实。模型回答服务为独立测试服务，不能代表实际外部大模型回答质量。设置 `MURASAME_E2E_EXECUTABLE` 指向独立包内的 `Murasame.exe` 后，用例直接启动包内程序且不从源码复制 BGE，验证真正打包资源。每个测试仍使用独立用户资料目录。

```powershell
$env:TEMP=(Resolve-Path 'previews/tmp').Path
$env:TMP=$env:TEMP
$env:MURASAME_E2E_EXECUTABLE=(Resolve-Path 'release/overnight-2026-10-29-verified/win-unpacked/Murasame.exe').Path
npx playwright test
Remove-Item Env:MURASAME_E2E_EXECUTABLE
```

测试会使用正式 IPC 显示控制台再操作；普通已完成引导的启动仍按现有产品行为留在托盘。第二实例测试也使用同一包内程序。没有为了获取截图改掉产品启动、隐藏或录音行为。

本轮实际安装包生成与启动结果以 `artifacts/overnight-2026-10-29/fourth-memory-packaging/README.md` 为准；没有运行安装器覆盖用户现有安装或真实资料。
