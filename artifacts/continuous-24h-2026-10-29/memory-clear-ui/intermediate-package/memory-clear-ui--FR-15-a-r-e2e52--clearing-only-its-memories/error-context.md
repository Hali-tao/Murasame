# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: memory-clear-ui.spec.ts >> [FR-15] a retained conversation can learn new facts after clearing only its memories
- Location: tests\e2e\memory-clear-ui.spec.ts:111:5

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.message-row.assistant')
Expected: 2
Received: 3
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" locator('.message-row.assistant') with timeout 5000ms
  - waiting for locator('.message-row.assistant')
    8 × locator resolved to 3 elements
      - unexpected value "3"

```

# Test source

```ts
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
  97  |     await expect(page.locator('.toast-red')).toContainText('受控记忆写入失败')
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
  111 | test('[FR-15] a retained conversation can learn new facts after clearing only its memories', async () => {
  112 |   test.setTimeout(90_000)
  113 |   let currentFact = '喜欢绿茶'
  114 |   const server = await startModelServer({ toolResponse: tool => tool === 'remember'
  115 |     ? { memories: [{ action: 'ADD', category: 'user', text: '喜欢绿茶' }, { action: 'ADD', category: 'project', text: currentFact }] } : undefined })
  116 |   const app = await launchWithMemory()
  117 |   try {
  118 |     const page = await findMainPage(app)
  119 |     await configureTestModel(page, server.url)
  120 |     await page.getByTestId('nav-chat').click()
  121 |     await page.getByLabel('新建会话', { exact: true }).click()
  122 |     await page.getByTestId('chat-input').fill('我喜欢喝绿茶')
  123 |     await page.getByTestId('chat-send').click()
  124 |     await page.getByTestId('nav-memory').click()
  125 |     await expect(page.getByTestId('memory-card')).toContainText('喜欢绿茶', { timeout: 20_000 })
  126 |     await page.getByTestId('nav-history').click()
  127 |     await page.getByTestId('clear-history').click()
  128 |     const dialog = page.getByRole('dialog')
  129 |     await dialog.getByRole('checkbox', { name: /对话历史/ }).uncheck()
  130 |     await dialog.getByRole('checkbox', { name: /相关长期记忆/ }).check()
  131 |     await dialog.getByRole('button', { name: '按范围清除' }).click()
  132 |     await expect(dialog).toHaveCount(0)
  133 |     currentFact = '正在开发白桦项目'
  134 |     await page.getByTestId('nav-chat').click()
  135 |     await page.getByTestId('chat-input').fill('我现在正在开发白桦项目')
  136 |     await page.getByTestId('chat-send').click()
> 137 |     await expect(page.locator('.message-row.assistant')).toHaveCount(2)
      |                                                          ^ Error: expect(locator).toHaveCount(expected) failed
  138 |     await page.getByTestId('nav-memory').click()
  139 |     await expect(page.getByTestId('memory-card')).toContainText('正在开发白桦项目', { timeout: 20_000 })
  140 |     const result = await page.evaluate(() => window.murasame.core.getBootstrap())
  141 |     if (!result.ok) throw new Error(result.error)
  142 |     expect(result.data.memories.map(item => item.text)).toEqual(['正在开发白桦项目'])
  143 |     expect(result.data.conversations).toHaveLength(1)
  144 |     await page.reload()
  145 |     await page.getByTestId('nav-memory').click()
  146 |     await expect(page.getByTestId('memory-card')).toContainText('正在开发白桦项目')
  147 |     await page.screenshot({ path: test.info().outputPath('retained-conversation-learns-after-clearing.png') })
  148 |   } finally { await closeApp(app); await server.close() }
  149 | })
  150 |
```
