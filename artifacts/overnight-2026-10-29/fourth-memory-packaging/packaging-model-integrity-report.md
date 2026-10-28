# Windows 打包模型完整性修复

时间：2026-10-29 04:17（Asia/Shanghai）。基线：`08b20bc`。代码已冻结，等待 root 统一集成验证。

## 范围与结论

修改仅为 `scripts/package-win.mjs`、新增 `scripts/package-models.mjs`、新增 `tests/unit/packaging-model-integrity.test.ts`，以及经 root 同意的 `electron-builder.yml` 模型来源配置。没有修改应用、embedding、MemoryService、用户资料或 `build/bundled-models` 实体资产。没有提交、推送、生成真实安装包、运行安装器或下载模型。

已复现并修复：

1. 旧脚本仅比较大小，等长损坏模型会保留。现在每轮从源文件复制至新建的独立暂存目录，复制前计算源 SHA-256，复制后重新计算目标 SHA-256；不相同就抛错，绝不启动 builder。
2. 旧 staging 的旧模型、旧 README 会被一同打入。现在暂存目录由 `mkdtemp` 独占创建在 `previews/package-staging/run-*/models`，只复制明确的 18 文件清单，不递归源目录，不复用或删除旧 staging。
3. 来源缺失时旧逻辑仍留下旧模型。现在保持既有“可生成无模型包”的策略，但全体模型一律省略，资源目录只有 README，列出全部缺失/空文件/非普通文件，并准确说明语音及记忆向量模型均未包含。
4. 输出原来固定为 `release`，同名 0.9.0 安装包可能被覆盖。现在默认输出 `release/build-<ISO时间>-<随机后缀>`；`MURASAME_PACKAGE_OUTPUT` 可显式指定，非空既有目录或文件会在 builder 启动前被拒绝。

暂存的同级 `model-manifest.json` 保存 `source`、`status`（`bundled` / `omitted`）、`missing` 及逐文件路径/字节数/SHA-256；该回执不混入安装后的模型目录。

## 红、绿与边界证据

所有测试均用 `previews/tmp/packaging-model-integrity/case-*` 自建小文件 fixture，运行真实打包脚本。只把实际生成安装包的 CLI 边界替换为记录器；记录器真实调用已安装 electron-builder 的资源匹配和宏展开代码，解析仓库实际配置。没有把小文件 fixture 当作有效 ONNX 或语义质量验收。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 初始 7 项行为回归 | 旧代码 7/7 失败；等长错误字节、额外旧资产、缺失源时残留及独立输出/哈希回执缺失均按预期被抓到 | `packaging-model-integrity-red.log` |
| 首轮修复 | 7/7 通过 | 中间运行输出，最终绿日志包含全部回归 |
| builder 实际路径消费 | 新增用例先失败，发现 Windows 上 builder 先 resolve 再展开环境宏，绝对路径被拼接两遍；改传项目相对 staging 路径后通过 | `packaging-model-builder-path-red.log` |
| 边界变异检查 | 暂时撤去普通非空文件检查和 SHA 不一致阻断，空文件、目录、复制损坏三项全部失败；随即恢复修复 | `packaging-model-boundary-mutation-red.log` |
| 最终专项 | **13/13 通过**，04:16:11 开始，8.58 秒，exit 0 | `packaging-model-integrity-green.log` |
| 定向 ESLint | exit 0 | `packaging-model-integrity-lint.log`（成功无输出） |
| 两个打包脚本语法 | `node --check` 均 exit 0 | 本轮工具输出 |
| diff 空白检查 | `git diff --check` 无错误 | 本轮工具输出 |

13 项包含：等长损坏、精确清单、缺失全省略、显式输出、默认输出每次不同且旧安装包不变、18 文件 SHA 回执、拒绝占用输出、真实 builder 解析路径、空文件、目录、复制损坏停止且源文件不变、builder 的失败退出码传播，以及直接调用 builder 缺少暂存环境变量时明确失败。

测试运行只出现仓库既有的 Vite CommonJS/未来 native configLoader 兼容性提示。Node/Web 类型检查曾在新增后续边界测试前通过；不把该次检查宣传为最终全库验收。根据 root 在应用模块同步修改期间的指示，最终全库 `npm run verify`、构建与 Electron 流程统一由 root 运行，本子任务未重复启动整库测试。

## 原安装包与文件安全

旧文件 `release/Murasame-Setup-0.9.0.exe` 初读及最终读取均为 **292431074 字节**，最后写入时间仍为 **2026-10-24 21:59:52**。04:16 记录 SHA-256：

`324A7B8735AD1E11AA0C4F3E72FCC3D8458EC353E7679A416867F6DF51016C2E`

本轮没有运行任何删除或移动命令。小型 fixture 与日志保留在被忽略的 previews 目录，TEMP/TMP 指向项目 `previews/tmp`。没有重试此前被阻止的 `.sdd` 清理路径。

## 后续真实打包建议（尚未执行）

root 完成统一验证后，在仓库根目录通过打包入口执行。当前已知完整来源是 `build/bundled-models`；脚本仅从那里读取，生成的新 staging 不在该目录内。

```powershell
$env:TEMP = 'E:\Desktop\软件工程\murasame\previews\tmp'
$env:TMP = $env:TEMP
$env:MURASAME_MODELS = 'E:\Desktop\软件工程\murasame\build\bundled-models'
$env:MURASAME_PACKAGE_OUTPUT = 'E:\Desktop\软件工程\murasame\release\overnight-2026-10-29-verified'
npm run package:win
```

所选显式输出必须不存在或为空；若已有内容，选择另一新目录。省略 `MURASAME_PACKAGE_OUTPUT` 时脚本自动使用每次不同的独立输出目录。不要直接调用 electron-builder 绕过 staging；缺少内部 `MURASAME_STAGED_MODELS` 环境变量时配置会明确拒绝展开。

真正完整离线交付前，需检查对应 `model-manifest.json` 是 `bundled`、18 项且 `missing` 为空，再将安装包内 `resources/models` 文件清单及哈希与回执逐项核对，最后在独立资料目录做真实启动验收。`omitted` 只能标记为无模型包，不满足完整离线能力。

## 限制

- SHA-256 证明本轮复制内容与指定本机来源一致，不证明来源是官方可信资产、有效模型或具有期望的语义准确率；源模型正确性由 root 的真实模型评估独立验证。
- 每轮保留新 staging，换取明确的隔离与可审查回执。实际大模型打包会增加磁盘占用；需要清理时应由后续明确流程核验具体目录后处理，本轮不清理。
- 未执行真实 electron-builder 生成安装包，未运行安装器，未宣称新安装版已替换旧版本。
