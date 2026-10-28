# 第五轮验收证据

基线`c024fe5`。本目录只含独立合成资料、实际测试产物及原生角色渲染证据；不含真实对话资料或外部模型凭据。最终交付状态见`docs/14-OVERNIGHT-ITERATION.md`。

诊断源文件以`.txt`追加后缀作为证据快照，映射见`source-snapshots.json`。可读文本副本只规范行尾空白和末尾空行；`raw-text-evidence.zip`保存归档前全部文本的原始字节。生成bundle及一次性运行入口仅留在该ZIP中，清单见`runtime-snapshots-in-zip.json`，避免把第三方生成代码误当业务源码。正式可复现脚本位于`scripts/fifth-*`，永久回归位于`tests/`，原诊断运行目录仍保留在`previews/`。归档前误将生成bundle纳入lint导致的失败日志保留为`fifth-verify-archive-format-failure.txt`；没有因此放宽生产检查规则。

- `fifth-final-verify.txt`：模型表单修复后的最终完整检查，54文件675项单测、类型/lint/trace74通过。`fifth-verified.txt`保留较早53文件665项结果。`fifth-verify-concurrent-package-timeout.txt`保留与打包同时运行时674通过/1项5000ms超时的原始结果；打包结束后单独运行全量通过，未放宽超时或断言。
- `fifth-packaged-e2e.txt`是首批16通过/2录音按钮定位歧义失败，未改业务代码，仅将测试按钮名匹配改为精确匹配后重跑。`packaged-second-failure/`保留第二批17通过/1新增模型名称拼接失败的日志、截图和trace；该问题需生产表单事务修复，不能只增加测试等待。开发版及早期失败日志分开保留，不合并成不存在的一次全通过。
- `fifth-packaged-complete.txt`：包含表单修复的最终包内程序完整 **18/18通过，无跳过，4.7分钟**。实际UI/IPC/容器办公和代码创作均通过；原先失败的录音按钮和目录配置两条流程均在这同一批次通过。
- `package-receipt.json`：108个包内生产文件（含原生模型）、18个模型文件、6个隔离文件与当前来源逐个SHA一致；新安装器及旧安装器哈希。
- `fifth-creation-live/result.json`：真实Docker/Writer/code-server/Python运行、回读、一次修订、导出拒绝覆盖、错误与清理。模型角色回调是fixture，不能据此推断外部模型内容质量。`actual-code-server.png`中代码是真实已生成文件。
- `fifth-creation-boundaries/result.json`：真实独立代码UID、文件保护、网络与子进程限制、输出上限、15秒中止6项。
- `fifth-final-review/`：独立最终功能审查，预算分类/排队取消/ODT空白三个原样复现从红转绿。`office-results-green.json`是最终runner真实LibreOffice空白回读证据。
- `ui-review/`：14项独立组件/服务回归，含重入、准备、清理重试、错误跨轮询保留、离线帧串行/停止/迟到丢弃。已归档源fixture供追溯，其原始运行位置在报告中。
- `notifications/`：通知聚合、正常布局、小窗口/键盘/错误保留的真实Electron截图与红绿日志。
- `model-form/`及`fifth-final-review/model-form-review.md`：新增配置输入丢失和精确名称拼接的原始复现；10项永久回归、7项独立新增/验证/删除/重测/离页重入检查。
- `native/`：原生动作抢占31项、时钟12项及鲸鱼娘表情7项的实际Cubism证据；原love表情仍未测到效果。没有新奶龙绑定或美术完成宣称。
- `packaged-screenshots/`：最终完整批次的23张包内应用实际界面与离线桌面截图。

最终安装包`release/overnight-2026-10-29-fifth-final/Murasame-Setup-0.9.0.exe`，292,502,372字节，SHA-256 `900b2085844039969bbaa7adfff34ff3304b1ba58ca116c312c7818210146df6`。`release/overnight-2026-10-29-fifth/`是最终审查修复前的中间检查点，`release/overnight-2026-10-29-fifth-verified/`缺少模型配置时序修复，均有NOT-FINAL说明，不能作为本轮验收交付。没有运行安装器覆盖现用版本；包内程序验收不等于安装/升级场景验收。

范围说明：`docs/18-ISOLATED-CREATION-AND-NATIVE-MOTION.md`。复杂办公、多文件/任意语言项目、完整协同、离线交互式VNC、KasmVNC迁移、外部回答质量及更自然的新美术仍需后续推进；原需求未修改。
