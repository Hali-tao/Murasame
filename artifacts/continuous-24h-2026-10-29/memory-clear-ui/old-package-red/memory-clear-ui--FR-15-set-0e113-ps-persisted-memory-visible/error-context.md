# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: memory-clear-ui.spec.ts >> [FR-15] settings reports real IPC clear failures and keeps persisted memory visible
- Location: tests\e2e\memory-clear-ui.spec.ts:71:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.toast-red')
Expected substring: "受控记忆写入失败"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" locator('.toast-red') with timeout 5000ms
  - waiting for locator('.toast-red')

```

```yaml
- complementary:
  - text: m murasame 桌面伙伴
  - navigation "主导航":
    - text: 对话
    - link "交流":
      - /url: "#/chat"
    - link "历史":
      - /url: "#/history"
    - link "长期记忆":
      - /url: "#/memory"
    - link "任务":
      - /url: "#/tasks"
    - text: 角色
    - link "角色设置":
      - /url: "#/character"
    - text: 设置
    - link "运行与隐私":
      - /url: "#/settings"
    - link "模型服务":
      - /url: "#/models"
    - link "工具与插件":
      - /url: "#/tools"
    - link "屏幕辅助":
      - /url: "#/screen"
    - link "自主活动":
      - /url: "#/autonomy"
    - link "概览":
      - /url: "#/"
  - text: 未
  - strong: 未命名
  - text: 运行中 · 本地加密 v0.9.0 · 本机运行
- banner:
  - heading "运行与隐私" [level=1]
  - paragraph: 控制权限、数据保留、托盘与退出行为
  - text: 18:09 · 10月29日 模型服务待验证
  - button "隐藏桌宠"
  - button "隐藏到托盘"
- region "操作提示":
  - status:
    - text: 已按所选范围清除本地数据
    - button "关闭提示：已按所选范围清除本地数据"
- main:
  - text: 正在运行
  - strong: Murasame 正在运行
  - paragraph: 隐藏到托盘不会取消任务；退出前会说明运行中活动的状态。
  - button "隐藏到托盘"
  - button "退出应用"
  - heading "运行行为" [level=2]
  - paragraph: 常驻桌面时保持低打扰
  - text: 开机时启动 仅在登录后加载轻量控制台。
  - switch "开机时启动"
  - text: 最小化到托盘 隐藏后仍可从托盘重新唤醒。
  - switch "最小化到托盘" [checked]
  - text: 忙时免打扰 全屏应用或正在输入时暂停主动互动。
  - switch "忙时免打扰"
  - text: 回复时朗读 桌宠说出回复。关掉后只显示文字。声音不可用时会说明原因。
  - switch "回复时朗读" [checked]
  - text: 任务完成通知 任务失败、需要批准或结束时分别展示。
  - switch "任务完成通知" [checked]
  - text: 关闭窗口时
  - combobox "关闭窗口时":
    - option "最小化到托盘" [selected]
    - option "每次询问"
    - option "询问后退出"
  - heading "系统权限" [level=2]
  - paragraph: 拒绝授权后仍可使用不依赖该权限的功能
  - strong: 屏幕读取
  - text: 只在你提问时截取一次 未授权
  - button "申请"
  - strong: 麦克风
  - text: 本地语音转写；不保留原始录音 未授权
  - button "申请"
  - strong: 辅助功能
  - text: 读取窗口信息与执行已批准操作 未授权
  - button "申请"
  - paragraph: 系统权限可在操作系统设置中撤销，撤销后应用会显示受限状态。日志默认保留 14 天，不记录完整密钥和原始屏幕。
  - text: 写图片
  - combobox "写图片":
    - option "每次询问。写到桌面或图片文件夹之前要点允许" [selected]
    - option "写图免问。选定之后，画到桌面或图片文件夹不再询问"
  - text: 持续观察
  - combobox "持续观察":
    - option "关闭，只在分析时截取" [selected]
    - option "每 5 秒"
    - option "每 15 秒"
    - option "每 60 秒"
  - heading "平台能力" [level=2]
  - paragraph: 非 Windows 上不支持的能力标成不可用
  - strong: 文字交流
  - text: 本阶段只承诺 Windows 10/11 x64 可用
  - strong: 屏幕采集
  - text: 依赖 Windows UI Automation 与系统 OCR 部分
  - strong: 语音
  - text: 本地模型缺失时使用 Windows 语音并标明降级 部分
  - strong: 自主活动
  - text: 需要本机 Docker，不可用时不改去控制宿主 部分
  - button "重新查看使用说明"
  - heading "数据与隐私" [level=2]
  - paragraph: 本地存储 · 清除范围明确
  - text: 加密本地数据 数据库始终加密，不能关闭。
  - switch "加密本地数据" [checked] [disabled]
  - text: 允许把截图发给模型 屏幕分析会把画面发给当前模型服务。关掉后只在本机阅读文字，不会外发截图。
  - switch "允许把截图发给模型"
  - text: 运行日志保留
  - combobox "运行日志保留 日志不记录完整 API Key、原始截图或不必要个人信息。":
    - option "7 天"
    - option "14 天" [selected]
    - option "30 天"
    - option "90 天"
    - option "180 天"
  - text: 日志不记录完整 API Key、原始截图或不必要个人信息。
  - button "清除历史与记忆…"
  - button "导出我的数据"
  - button "导出加密数据包"
  - button "导入数据包"
  - paragraph: 导出不包含手动移出应用的文档；备份是否包含在清除范围内需单独确认。
  - heading "关于与帮助" [level=2]
  - paragraph: Murasame 0.9.0
  - text: 版本
  - strong: 0.9.0
  - text: 运行方式
  - strong: 已安装应用
  - text: 当前模型
  - strong: 未配置
  - text: 唤起桌宠
  - strong: "Alt+` 注册失败，可能被其他程序占用或写法不对。请在设置里换一个组合，例如 Ctrl+Alt+M。"
  - text: 换一个快捷键
  - strong:
    - textbox "唤起桌宠的快捷键":
      - /placeholder: 例如 Ctrl+Alt+M
      - text: "Alt+`"
    - button "应用" [disabled]
  - text: 语音
  - strong: 中文音素转换已验证；识别模型文件齐全，麦克风及识别效果尚待录音测试；合成依赖已验证，模型运行与扬声器效果尚待试听。语音始终使用本地环境。
  - text: 数据位置
  - strong: C:\Users\LENOVO\AppData\Local\Temp\murasame-e2e-GGcSx5
  - text: 日志位置
  - strong: C:\Users\LENOVO\AppData\Local\Temp\murasame-e2e-GGcSx5\logs
  - button "打开数据目录"
  - button "打开日志"
  - button "使用说明"
  - button "检查更新"
  - text: 对话、记忆和截图只在你允许时才会发给当前模型。密钥不会出现在日志里。
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test'
  2   | import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
  3   | import { dirname, join, resolve } from 'node:path'
  4   | import { EMBEDDING_FILES, EMBEDDING_MODEL_ID } from '../../src/main/local/embedding'
  5   | import { IPC } from '../../src/shared/ipc'
  6   | import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'
  7   |
  8   | async function launchWithMemory() {
  9   |   const model = resolve('build/bundled-models', EMBEDDING_MODEL_ID)
  10  |   const packaged = Boolean(process.env.MURASAME_E2E_EXECUTABLE)
  11  |   test.skip(!packaged && EMBEDDING_FILES.some(file => !existsSync(join(model, file))), 'Requires actual BGE assets')
  12  |   return launchApp(true, userData => {
  13  |     if (packaged) return
  14  |     for (const file of EMBEDDING_FILES) {
  15  |       const target = join(userData, 'models', EMBEDDING_MODEL_ID, file)
  16  |       mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(model, file), target)
  17  |     }
  18  |   })
  19  | }
  20  |
  21  | test('[FR-15] memory source opens its history and scoped clearing leaves no stale extraction notice', async () => {
  22  |   test.setTimeout(90_000)
  23  |   const server = await startModelServer({ toolResponse: tool => tool === 'remember'
  24  |     ? { memories: [{ action: 'ADD', category: 'user', text: '喜欢白茶' }] } : undefined })
  25  |   const app = await launchWithMemory()
  26  |   try {
  27  |     const page = await findMainPage(app)
  28  |     await configureTestModel(page, server.url)
  29  |     await page.getByTestId('nav-chat').click()
  30  |     await page.getByLabel('新建会话', { exact: true }).click()
  31  |     await page.getByTestId('chat-input').fill('我喜欢喝白茶')
  32  |     await page.getByTestId('chat-send').click()
  33  |     await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
  34  |     await page.getByTestId('nav-memory').click()
  35  |     const card = page.getByTestId('memory-card').filter({ hasText: '喜欢白茶' })
  36  |     await expect(card).toBeVisible({ timeout: 20_000 })
  37  |     await expect(page.locator('.memory-extraction-status')).toContainText('已保存新记忆')
  38  |     const before = await page.evaluate(() => window.murasame.core.getBootstrap())
  39  |     if (!before.ok) throw new Error(before.error)
  40  |     const source = before.data.memories[0].source
  41  |     await page.getByRole('textbox', { name: '搜索记忆' }).fill('我喜欢喝白茶')
  42  |     await card.getByRole('link', { name: '查看来源：我喜欢喝白茶' }).click()
  43  |     await expect(page.locator('.history-detail-head h2')).toHaveText('我喜欢喝白茶')
  44  |     await page.getByTestId('clear-history').click()
  45  |     await page.getByRole('dialog').getByRole('button', { name: '按范围清除' }).click()
  46  |     await expect(page.getByRole('dialog')).toHaveCount(0)
  47  |     await page.getByTestId('nav-memory').click()
  48  |     await expect(card).toContainText('来源会话已删除')
  49  |     await expect(card).not.toContainText(source)
  50  |     await expect(page.locator('.memory-extraction-status')).toHaveCount(0)
  51  |     await page.screenshot({ path: test.info().outputPath('memory-survives-history-only-clear.png') })
  52  |
  53  |     await page.getByTestId('nav-settings').click()
  54  |     await page.getByTestId('clear-data').click()
  55  |     const dialog = page.getByRole('dialog')
  56  |     await dialog.getByRole('checkbox', { name: /对话历史/ }).uncheck()
  57  |     await dialog.getByRole('checkbox', { name: /相关长期记忆/ }).check()
  58  |     await dialog.getByRole('checkbox', { name: /本地缓存/ }).check()
  59  |     await dialog.getByRole('button', { name: '执行清除' }).click()
  60  |     await expect(dialog).toHaveCount(0)
  61  |     const after = await page.evaluate(() => window.murasame.core.getBootstrap())
  62  |     if (!after.ok) throw new Error(after.error)
  63  |     expect(after.data.memories).toEqual([])
  64  |     expect(after.data.conversations.some(item => item.id === source)).toBe(false)
  65  |     await page.getByTestId('nav-memory').click()
  66  |     await expect(page.getByText('还没有长期记忆', { exact: true })).toBeVisible()
  67  |     await page.screenshot({ path: test.info().outputPath('memory-cleared-without-old-notices.png') })
  68  |   } finally { await closeApp(app); await server.close() }
  69  | })
  70  |
  71  | test('[FR-15] settings reports real IPC clear failures and keeps persisted memory visible', async () => {
  72  |   test.setTimeout(60_000)
  73  |   const app = await launchWithMemory()
  74  |   try {
  75  |     const page = await findMainPage(app)
  76  |     const seeded = await page.evaluate(async () => {
  77  |       const conversation = await window.murasame.core.createConversation()
  78  |       const memory = await window.murasame.core.addMemory('偏好', '清理失败后保留白茶')
  79  |       return { conversation, memory }
  80  |     })
  81  |     expect(seeded.conversation.ok && seeded.memory.ok).toBe(true)
  82  |     // The failure boundary is the main IPC handler. Renderer/store/preload and
  83  |     // existing persisted data are real; this is not a simulated disk failure.
  84  |     await app.evaluate(({ ipcMain }, channels) => {
  85  |       ipcMain.removeHandler(channels.clearMemories)
  86  |       ipcMain.handle(channels.clearMemories, () => ({ ok: false, error: '受控记忆写入失败' }))
  87  |       ipcMain.removeHandler(channels.deleteConversation)
  88  |       ipcMain.handle(channels.deleteConversation, () => ({ ok: false, error: '受控缓存清除失败' }))
  89  |     }, { clearMemories: IPC.core.clearMemories, deleteConversation: IPC.core.deleteConversation })
  90  |     await page.getByTestId('nav-settings').click()
  91  |     await page.getByTestId('clear-data').click()
  92  |     const dialog = page.getByRole('dialog')
  93  |     await dialog.getByRole('checkbox', { name: /对话历史/ }).uncheck()
  94  |     await dialog.getByRole('checkbox', { name: /相关长期记忆/ }).check()
  95  |     await dialog.getByRole('checkbox', { name: /本地缓存/ }).check()
  96  |     await dialog.getByRole('button', { name: '执行清除' }).click()
> 97  |     await expect(page.locator('.toast-red')).toContainText('受控记忆写入失败')
      |                                              ^ Error: expect(locator).toContainText(expected) failed
  98  |     await expect(page.locator('.toast-red')).toContainText('受控缓存清除失败')
  99  |     await expect(dialog).toBeVisible()
  100 |     await dialog.getByRole('button', { name: '取消', exact: true }).click()
  101 |     await page.getByTestId('nav-memory').click()
  102 |     await expect(page.getByTestId('memory-card')).toContainText('清理失败后保留白茶')
  103 |     const actual = await page.evaluate(() => window.murasame.core.getBootstrap())
  104 |     if (!actual.ok) throw new Error(actual.error)
  105 |     expect(actual.data.memories.map(item => item.text)).toEqual(['清理失败后保留白茶'])
  106 |     expect(actual.data.conversations).toHaveLength(1)
  107 |     await page.screenshot({ path: test.info().outputPath('failed-clear-keeps-actual-memory.png') })
  108 |   } finally { await closeApp(app) }
  109 | })
  110 |
```
