# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: memory-degraded-context.spec.ts >> [NFR-U03] unusable local model does not silently become a successful empty memory search
- Location: tests\e2e\memory-degraded-context.spec.ts:7:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('memory-recall-status')
Expected substring: "记忆检索受限"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByTestId('memory-recall-status') with timeout 5000ms
  - waiting for getByTestId('memory-recall-status')

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
  - heading "交流" [level=1]
  - paragraph: 和桌宠是同一段对话
  - text: 22:31 · 10月29日 模型服务在线
  - button "隐藏桌宠"
  - button "隐藏到托盘"
- main:
  - heading "会话" [level=2]
  - paragraph: 本地保存 · 已加密
  - button "新建会话"
  - textbox "搜索会话":
    - /placeholder: 搜索会话…
  - button "我之前喜欢喝什么茶 22:31 这是来自测试模型的真实流式回复。":
    - strong: 我之前喜欢喝什么茶
    - time: 22:31
    - paragraph: 这是来自测试模型的真实流式回复。
  - heading "我之前喜欢喝什么茶" [level=2]
  - text: 3 条消息 · 仅保存在此设备 记忆已开启
  - button "收起上下文" [expanded]
  - text: 文字 雨
  - strong: 桌宠
  - time: 22:31
  - button "朗读"
  - text: 我在。
  - strong: 你
  - time: 22:31
  - text: 我之前喜欢喝什么茶 雨
  - strong: 桌宠
  - time: 22:31
  - button "朗读"
  - text: 这是来自测试模型的真实流式回复。
  - textbox "和桌宠说点什么… Enter 发送，Shift + Enter 换行"
  - button "语音"
  - button "屏幕"
  - button "转任务"
  - text: test-model
  - button "发送" [disabled]
  - heading "本轮上下文" [level=2]
  - paragraph: 显示最近一轮实际注入的长期记忆
  - text: 仅本机 角色
  - strong: 未命名
  - text: 模型
  - strong: 记忆降级独立测试
  - text: 已保存记忆
  - strong: 1 条
  - text: 屏幕
  - strong: 未附加入口
  - text: 已召回的记忆
  - paragraph: 本轮未注入长期记忆
  - text: 快捷动作
  - button "总结这段对话"
  - button "解释这段代码"
  - button "把讨论整理成任务"
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { mkdirSync, writeFileSync } from 'node:fs'
  3  | import { dirname, join } from 'node:path'
  4  | import { EMBEDDING_FILES, EMBEDDING_MODEL_ID } from '../../src/main/local/embedding'
  5  | import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'
  6  |
  7  | test('[NFR-U03] unusable local model does not silently become a successful empty memory search', async () => {
  8  |   test.setTimeout(90_000)
  9  |   const requests: Array<Array<{ role: string; content: unknown }>> = []
  10 |   const server = await startModelServer({ onMessages: messages => requests.push(messages) })
  11 |   const app = await launchApp(true, userData => {
  12 |     // A complete but invalid user override simulates damaged model files.
  13 |     // Only this fresh synthetic profile is changed; bundled models stay intact.
  14 |     for (const file of EMBEDDING_FILES) {
  15 |       const target = join(userData, 'models', EMBEDDING_MODEL_ID, file)
  16 |       mkdirSync(dirname(target), { recursive: true })
  17 |       writeFileSync(target, 'synthetic invalid model content')
  18 |     }
  19 |   })
  20 |   try {
  21 |     const page = await findMainPage(app)
  22 |     await configureTestModel(page, server.url, '记忆降级独立测试')
  23 |     await page.getByTestId('nav-memory').click()
  24 |     await page.getByTestId('add-memory').click()
  25 |     await page.getByTestId('memory-category').fill('偏好')
  26 |     await page.getByTestId('memory-text').fill('我喜欢白茶，长期保留这条独立测试偏好。')
  27 |     await page.getByRole('button', { name: '添加记忆', exact: true }).click()
  28 |     await expect(page.getByRole('dialog')).toHaveCount(0)
  29 |     await expect(page.getByTestId('memory-card')).toContainText('我喜欢白茶')
  30 |     const bootstrap = await page.evaluate(() => window.murasame.core.getBootstrap())
  31 |     expect(bootstrap.ok && bootstrap.data?.memoryIndex).toMatchObject({ completed: 0, total: 1 })
  32 |     await page.getByTestId('nav-chat').click()
  33 |     await page.getByLabel('新建会话', { exact: true }).click()
  34 |     const question = '我之前喜欢喝什么茶'
  35 |     await page.getByTestId('chat-input').fill(question)
  36 |     await page.getByTestId('chat-send').click()
  37 |     await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
  38 |     const request = requests.find(messages => messages.some(item => item.role === 'user' && item.content === question))
  39 |     const system = request?.filter(item => item.role === 'system').map(item => String(item.content)).join('\n') ?? ''
  40 |     expect(system).toContain('本轮长期记忆检索不完整或暂不可用')
  41 |     expect(system).toContain('不得把未检出当作用户从未说过或没有这项偏好')
  42 |     expect(system).not.toContain('可参考的长期记忆：')
> 43 |     await expect(page.getByTestId('memory-recall-status')).toContainText('记忆检索受限')
     |                                                            ^ Error: expect(locator).toContainText(expected) failed
  44 |     await page.reload()
  45 |     await expect(page.getByTestId('memory-recall-status')).toContainText('记忆检索受限')
  46 |     await page.getByLabel('新建会话', { exact: true }).click()
  47 |     await expect(page.getByTestId('memory-recall-status')).toContainText('尚无检索记录')
  48 |     await page.locator('.conversation-item').filter({ hasText: question }).click()
  49 |     await expect(page.getByTestId('memory-recall-status')).toContainText('记忆检索受限')
  50 |     await page.screenshot({ path: test.info().outputPath('persisted-recall-warning.png'), fullPage: true })
  51 |     await page.getByTestId('nav-memory').click()
  52 |     await expect(page.getByTestId('memory-card')).toContainText('我喜欢白茶')
  53 |     await page.screenshot({ path: test.info().outputPath('preserved-memory-with-unavailable-index.png'), fullPage: true })
  54 |   } finally { await closeApp(app); await server.close() }
  55 | })
  56 |
```
