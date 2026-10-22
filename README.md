# Murasame Desktop

Murasame 的 Windows 桌面端产品壳，使用 Electron + React + TypeScript 构建。当前版本已经接入真实的大模型 HTTP API，同时保留任务、记忆、工具和屏幕辅助等演示数据。

## 环境要求

- Windows 10/11 x64
- Node.js 22 或更新版本
- npm

## 启动

```powershell
cd "D:\Software Engineering\murasame-desktop"
npm install
npm run dev
```

首次安装依赖后，后续只需运行 `npm run dev`。

## Live2D 桌宠

角色设置页提供三套内置预置形象：白猫 `tororo`、鲸鱼娘和奶龙。当前版本不提供应用内导入、动作/表情编辑，也不承诺兼容任意第三方资源包；新增形象需按 Cubism 资源结构在构建时内置。

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
