# 自主活动页面同步修复证据

本目录属于24小时优化第二轮，详细实现与范围见 `docs/23-AUTONOMY-PAGE-SYNC.md`。第一轮根目录manifest保持原样，本目录使用独立manifest。

- `old-package-red.txt` / `old-package-red/`：旧最终包公开API成功启动真实Docker代码活动，已打开的闲置页面仍显示浏览网页；保留失败截图与trace。
- `red*.txt` / `green*.txt`：页面首次订阅、草稿、晚回执、准备失败、停止阶段及断连错误的失败复现和修复验证。`green-reviewed-final.txt`为最终14页面+3跟随器回归。
- `full-verify-final.txt`：冻结后全仓63文件757项通过，类型、lint和trace74/74通过。其他full-verify文件是中间版本，不是最终依据。
- `dev-green/`：中间开发构建截图，仅保留过程证据。
- `package.txt` / `package-receipt.json`：独立安装包构建、SHA-256及109程序文件、18模型、6隔离文件核对。包指纹脚本以 `.mjs.txt`保存，复制为`.mjs`后可在项目根目录重跑；路径对应本轮输出。
- `package-e2e.txt` / `package-e2e/`：新独立包完整20项通过，无跳过，包含真实Docker和本地BGE。新增公开入口代码输出42，停止后界面撤销画面和保存能力；最后截图已目视核对。

最终包为 `release/continuous-2026-10-29-autonomy-sync/Murasame-Setup-0.9.0.exe`，SHA-256 `7b5d5c4fd3704140a7c6a5f0f005bf747eac60e5901b9b3dd3861ebdf2f2337c`。测试运行其win-unpacked程序，没有安装、升级或触碰真实用户资料。固定本地模型服务只用于控制外部模型边界，不能代表真实模型质量；实际IPC、页面、文件、Docker、Python、LibreOffice和BGE均实际运行。

`raw-text-evidence.zip`保留顶层日志、包清单和指纹脚本原始字节。可读副本只统一换行与行末空白；manifest记录复制文件的原始与可读哈希，文本另有LF规范化哈希，便于跨Git换行核对。原始旧包trace未修改。README和manifest本身不计入manifest的文件项。

奶龙源工程位于旁边的 `native-rig/`，不包含在本安装包中；不能把旧模型测试通过解释为新形象完成。
