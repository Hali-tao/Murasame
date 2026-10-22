# Murasame Desktop

Murasame 的 Windows 桌面伙伴。文字对话、历史、长期记忆、任务核验、屏幕读取和隔离活动策略已经接到本地数据上。语音在没有本地模型时会标明 Windows 降级。自主活动在 Docker 未启动时停止，不控制当前桌面。naiwa 的分发许可仍未确认，见 `docs/05-LICENSES.md`。

## 当前范围

- 已接入：加密本地库、可配置模型、对话与历史、长期记忆、任务状态与工具核验、屏幕读取与 OCR、自主活动的隔离容器、本地语音输入与输出、角色表现与主动开口、首次使用说明、加密数据包导出导入。
- 需本机准备：语音模型（见下）与隔离镜像（`node scripts/build-isolation.mjs`，需 Docker）。
- 未公开分发：来源未确认的 naiwa 形象不得放进面向公众的安装包，见 `docs/05-LICENSES.md`。

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
- Node.js 22 或更新版本
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

前台窗口的标题、进程和控件树通过 .NET `UIAutomationClient` 在 Electron 主进程里读取。图中文字使用 Windows.Media.Ocr，不把截图发给模型来代替这一步。密码窗口、声明排除于系统截图的窗口、以及 KeePass 一类进程不会被采集。

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
4. 点击「保存并测试连接」。连接成功后，点击「保存并设为当前服务」。
5. 到「交流」页新建会话并发送消息。回复会以流式方式显示。

常用服务地址示例：

| 协议 | 服务地址 | 说明 |
| --- | --- | --- |
| OpenAI Compatible | `https://api.openai.com/v1` | 也可以只填 `https://api.openai.com` |
| OpenAI Compatible | `https://api.deepseek.com/v1` | 模型名称填服务商提供的 ID，例如 `deepseek-chat` |
| Anthropic | `https://api.anthropic.com` | 使用 Anthropic Messages 协议 |
| Ollama | `http://127.0.0.1:11434` | 本地服务通常不需要 API Key |

API Key 只发送到 Electron 主进程，并使用 Windows 安全存储（`safeStorage`）加密后保存在本地用户数据目录。渲染进程拿不到密钥，日志与错误提示也会脱敏。已保存的 Key 在输入框中显示为空，留空保存表示保持原密钥。

## 当前范围

- 已实现模型配置的新增、保存、连接测试、默认模型切换和持久化。
- 已实现 OpenAI Compatible、Anthropic Messages 和 Ollama 的流式文本对话。
- 已实现 `tororo` Live2D 桌宠渲染与基础动作交互。
- 聊天上下文、任务、记忆和其他页面数据仍是内存演示数据，重启应用后恢复初始内容。
- 工具执行、屏幕真实分析、语音输入和本地数据库持久化尚未接入。
- 打包命令为 `npm run package:win`，安装包产物会写入 `release` 目录。

## 验证命令

```powershell
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run inspect:pet
```

`test:e2e` 会启动 Electron 和本地模拟模型服务，覆盖 10 页导航、真实流式聊天、任务审批、桌宠、托盘与单实例行为。
