# Murasame Desktop

Murasame 的 Windows 桌面伙伴。文字对话、历史、长期记忆、任务核验、屏幕读取和隔离活动使用本地持久化数据。语音使用本地模型，缺少依赖时明确停用。自主活动在 Docker 未启动时停止，不控制当前桌面。naiwa 的分发许可仍未确认，见 `docs/05-LICENSES.md`。

## 当前范围

- 已接入：加密本地库、可配置模型、对话与历史、长期记忆、任务状态与工具核验、屏幕读取与 OCR、自主活动的隔离容器、本地语音输入与输出、角色表现与主动开口、首次使用说明、加密数据包导出导入。
- 需本机准备：语音模型（见下）与隔离镜像（`node scripts/build-isolation.mjs`，需 Docker）。
- 未公开分发：来源未确认的 naiwa 形象不得放进面向公众的安装包，见 `docs/05-LICENSES.md`。

## 消息格式与代码复制

交流、历史记录和桌宠对话面板共用 Markdown 展示，支持标题、强调、列表、链接、表格和代码块。回复逐步显示，未闭合代码块可继续更新；历史只保存完整回复。代码块的「复制代码」保留代码缩进和空白，流式期间提示「已复制当前片段」，复制失败会显示重试提示。

交流和历史记录在消息下方提供「复制消息」或「复制回复」，复制完整文本并保留 Markdown 与代码缩进，回复完成后显示整条回复的复制入口。桌宠对话面板保留「查看原文」。原始 HTML 只显示为文本，不执行；图片不自动加载，链接仅支持 HTTP/HTTPS，流式完成后才能打开。文件写入等审批仍展示原始待批准内容，不用渲染结果替代核对。桌宠短气泡仍使用简短提示，完整格式在对话面板查看。

摘要草稿审批保留始终可见的完整原文，并提供可展开的「Markdown 预览」。预览使用相同的安全渲染规则，不改变待保存内容、校验值或两阶段审批流程。

## 长期记忆检索模型

在「长期记忆」页面查看「记忆检索模型」状态。点击「下载并准备模型」会从 Hugging Face 下载约 25 MB 的固定版本文件，校验完整性并实际运行一次本地推理；只有推理成功才显示「可用」。异常时可「重新下载修复」，手动补齐文件后可「重新检查」。下载不上传对话或记忆，不会开启记忆开关。

未安装或异常时仍可添加、查看、编辑和删除记忆，但无法进行语义召回；保存成功不代表已经用于聊天。模型可用且长期记忆已开启后，相关记忆会进入你配置的聊天模型上下文，可在聊天上下文面板核对实际使用记录。

使用的资产为 [Xenova/bge-small-zh-v1.5](https://huggingface.co/Xenova/bge-small-zh-v1.5)，固定版本 `75c43b069aac4d136ba6bc1122f995fedcfd2781`。检索在本机运行，不依赖额外后台服务。开发时也可执行 `node scripts/fetch-memory-model.mjs <用户资料目录>` 安装；真实模型测试读取 `build/bundled-models/bge-small-zh-v1.5`，模型二进制不提交 Git。

## 本地语音模型

语音不走云端，也不使用系统语音兜底。模型放在 `userData/models` 下：

```powershell
node scripts/fetch-builder-binaries.mjs   # 打包用的 NSIS 等组件
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-whisper.ps1
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-kokoro.ps1
```

识别用 `onnx-community/whisper-base`，合成用 `onnx-community/Kokoro-82M-v1.0-ONNX`。中文合成的汉字转音素由本机 Python 完成，需要一次性安装：

```powershell
python -m pip install "misaki[zh]"
```

这一步只做音素转换，不装 PyTorch，ONNX 推理仍在应用进程内。模型文件不全时，界面会说明缺哪些，不改用其他来源。

## 打包

```powershell
npm run package:win
```

产物在 `release\Murasame-Setup-0.9.0.exe`。没有代码签名证书，打包脚本关闭了自动签名，安装器以当前用户权限安装，卸载默认保留数据。

## 环境要求

- Windows 10/11 x64
- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`（Vitest 5 的要求）
- npm

## 加密数据库（SQLCipher）

本地对话、记忆和任务存在 SQLCipher 加密库里，绑定是 `better-sqlite3-multiple-ciphers`，必须按 Electron 44 的 ABI 编译。`npm install` 会通过 `postinstall` 执行：

```powershell
npx electron-rebuild -f -w better-sqlite3-multiple-ciphers
```

需要本机已安装 Visual Studio 的 C++ 构建工具。Electron 本体不在 npm 包里，若 `node_modules/electron/dist/electron.exe` 不存在，下载 `electron-v44.9.1-win32-x64.zip`（SHA256 `41bd7900bd42d0f49110a81617876137041fbbf473466920248ddb076349ef91`）放到仓库根目录后解压到 `node_modules/electron/dist`，并在 `node_modules/electron/path.txt` 写入 `electron.exe`。

验收：

```powershell
npm run verify:native
```

脚本在 Electron 主进程里建一个 SQLCipher（legacy 4）库，确认错误口令无法读取、文件中没有明文、正确口令能读回。这一步没有降级方案。

## 屏幕感知（UI Automation 与 Windows OCR）

前台窗口的标题、进程和控件树由异步 .NET `UIAutomationClient` 读取，图中文字使用 Windows.Media.Ocr。图像只采集按原生窗口 ID 匹配的目标窗口，不退回整个屏幕；另行取得图片外发授权后才调用视觉模型。密码窗口、声明排除于系统截图的窗口以及敏感进程会拒绝采集。隐藏、锁屏和撤权在等待后再次核验。

```powershell
npm run verify:perception
```

脚本会打印当前前台窗口的控件树，并对一张程序生成的文字图片做一次 OCR。任一环节失败就退出，不改用假数据。

## 隔离桌面

`isolation/Dockerfile` 构建 Debian、XFCE、TigerVNC、noVNC、Firefox、LibreOffice 和 code-server。默认不挂载宿主目录、不透传设备。Docker 没启动时，自主活动会说明原因并停在隔离环境，不会改去控制当前桌面。

```powershell
node scripts/build-isolation.mjs
```

镜像体积大约数 GB，构建脚本会打印大小和耗时。

## 启动

```powershell
cd "D:\Software Engineering\murasame-desktop"
npm install
npm run dev
```

首次安装依赖后，后续只需运行 `npm run dev`。

开发模式会自动显示主控制台，即使已完成引导或隐藏了桌宠；安装版保留原有托盘启动行为。

卸载默认保留数据，升级和静默卸载也不清理数据。明确选择删除时，会先检查文件占用并创建、校验完整备份；需要额外的临时磁盘空间。文件占用或备份失败时不删除原数据，删除中途失败时尝试恢复并保留备份。失败提示中的 `murasame-desktop.uninstall-backup-*` 目录应完整保留，其中数据库、密钥及 `Local State` 必须一起恢复；不要只复制数据库。强制结束清理进程或断电后的自动恢复不在此保证范围，需在关闭应用后使用完整备份恢复。

## Live2D 桌宠

角色设置页提供三套内置预置形象：白猫 `tororo`、鲸鱼娘和奶龙。可以导入带 `model3.json`、`moc3` 和贴图的 Cubism 4/5 目录；缺少贴图或 Cubism 2.1 的 `.moc` 会被拒绝，并保留原来的角色。动作和表情编辑仍不提供。

白猫 `tororo` 的资源位于：

```text
src/renderer/public/live2d/tororo/tororo.model3.json
```

当前已接入：

- 官方 Cubism Core 运行时（与 `pixi-live2d-display` 兼容的 5.x 版本）
- 三套预置形象的即时切换与待机动作循环
- 单击播放当前形象配置的互动动作
- 白猫拖动时根据方向播放 `FlickUp` / `FlickDown` / `Flick`
- 鼠标移动时头部和视线跟随
- 缩放、拖动位置、隐藏与托盘恢复
- 模型加载失败时显示明确的错误提示

使用 `npm run inspect:pet` 可以启动一次 Electron、等待模型进入 ready 状态，并生成 `pet-inspect.png` 用于视觉检查。

模型和 Core 的使用需要遵守各自的素材及 SDK 许可。白猫许可说明保存在：

```text
src/renderer/public/live2d/tororo/LICENSE-Live2D-Sample.txt
```

鲸鱼娘的署名与许可位于 `src/renderer/public/live2d/whale-girl/NOTICE.md` 和 `AUTHORS.md`。

## 配置真实模型

1. 打开左侧「模型服务」。
2. 选择已有配置，或点击左上角 `+` 新建配置。
3. 选择接口协议，填写服务地址、API Key 和模型名称。
4. 点击「验证并开始使用」。验证成功后自动设为当前服务。
5. 点击「开始第一次对话」，或到「交流」页新建会话并发送消息。完整回复流式显示并保存，桌宠使用短气泡和短台词。

常用服务地址示例：

| 协议 | 服务地址 | 说明 |
| --- | --- | --- |
| OpenAI Compatible | `https://api.openai.com/v1` | 也可以只填 `https://api.openai.com` |
| OpenAI Compatible | `https://api.deepseek.com/v1` | 模型名称填服务商提供的 ID，例如 `deepseek-chat` |
| Anthropic | `https://api.anthropic.com` | 使用 Anthropic Messages 协议 |
| Ollama | `http://127.0.0.1:11434` | 本地服务通常不需要 API Key |

API Key 只发送到 Electron 主进程，并使用 Windows 安全存储（`safeStorage`）加密后保存在本地用户数据目录。渲染进程拿不到密钥，日志与错误提示也会脱敏。已保存的 Key 在输入框中显示为空，留空保存表示保持原密钥。

## 本轮可靠性修复

修复范围、验证结果和仍需现场验收的项目见 [可靠性修复记录](docs/13-RELIABILITY-REPAIR.md)。原始需求文档保持原要求。

- 完整回答与桌宠短台词分开；长历史事实、真实召回引用、记忆更正和清除竞争已接入回归测试。
- 任务按步骤及依赖执行，Worker 与 Critic 各自核验；同名文件保护、审批清单、检查点恢复、隔离代码暂存及产物导出统一记录实际结果。
- 自主活动使用独立容器和活动编号，取消后旧回调不能继续操作；视频读取真实播放时间、字幕及容器内音轨，不能读取时明确说明限制。
- 桌宠位置、缩放、透明命中、会话切换、语音取消和关系管理已修复；新安装可从引导直接完成模型验证和首轮对话。

绘图队友目前提供隔离生成与核验的程序示例 PNG，没有接入任意文生图模型。自主办公及通用自主编程不作为已完成能力。奶龙新形象保存在 [V2 动作预览](artifacts/nailong-natural-v2-2026-10-28/README.md)，尚未完成 Cubism 原生绑定及软件内替换。

## 验证命令

```powershell
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run inspect:pet
```

`test:e2e` 会启动 Electron 和本地模拟模型服务，覆盖 10 页导航、真实流式聊天、任务审批、桌宠、托盘与单实例行为。

Electron 44.9.1 与 Playwright 1.64.1 的默认截图路径曾出现元素稳定性等待超时。遇到该问题时，可使用 Playwright 的旧截图兼容模式复核，保留原始失败记录，不改变业务断言和超时：

```powershell
$env:PLAYWRIGHT_LEGACY_SCREENSHOT = '1'
npm run test:e2e
Remove-Item Env:PLAYWRIGHT_LEGACY_SCREENSHOT
```

该设置只用于测试进程，超时根因尚未确认。真实 BGE 用例需要 `build/bundled-models/bge-small-zh-v1.5` 的完整模型文件，Docker 集成用例需要已验证的隔离镜像并显式设置 `MURASAME_E2E_ISOLATION=1`。缺少这些条件时，跳过项应单独报告，不能计为通过。

## 质量与交付（QA）

- 最终交付索引：[docs/41-QA-DELIVERABLES.md](docs/41-QA-DELIVERABLES.md)
- 可重复运行的 QA 报告：[docs/40-QA-RUNTIME-REPORT.md](docs/40-QA-RUNTIME-REPORT.md)
- 功能提案与规格：[docs/38-PRODUCT-VISION.md](docs/38-PRODUCT-VISION.md)、[docs/39-FEATURE-SPECS.md](docs/39-FEATURE-SPECS.md)
- 快速复核：`npm run verify`（typecheck/lint/单元/追溯）与 `npx playwright test --reporter=line`（全量 E2E）；依赖齐全时用 `npm run test:e2e:all` 跑零跳过全量；运行时探测脚本见 docs/41 §5
- 全量覆盖矩阵：[docs/42-FULL-QA-COVERAGE-MATRIX.md](docs/42-FULL-QA-COVERAGE-MATRIX.md)
